"""Inspect owner-bound, digest-checked JSON graphs without loading model code."""
from __future__ import annotations

import hashlib
import json
import os
import re
import stat
from pathlib import Path

from .runtime_configurations import ProjectRuntimeConfigurationService

_PROTOCOL = "modelforge.model-descriptor/v1"
_MAX_BYTES = 512 * 1024
_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
_SHA256 = re.compile(r"^[a-f0-9]{64}$")


def _text(value: object, label: str, maximum: int = 160) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > maximum or any(ord(c) < 32 for c in value):
        raise ValueError(f"Model {label} must be bounded printable text")
    return value


def _id(value: object) -> str:
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise ValueError("Model graph identity is invalid")
    return value


def validate_model_descriptor(value: object) -> dict:
    if not isinstance(value, dict) or set(value) != {"protocol", "model_id", "name", "checkpoint", "nodes", "edges"}:
        raise ValueError("Model descriptor fields are invalid")
    if value["protocol"] != _PROTOCOL:
        raise ValueError("Model descriptor protocol is unsupported")
    _text(value["model_id"], "identity")
    _text(value["name"], "name")
    checkpoint = value["checkpoint"]
    if not isinstance(checkpoint, dict) or not checkpoint or not set(checkpoint) <= {"sha256", "revision"}:
        raise ValueError("Model descriptor requires checkpoint digest or revision")
    if "sha256" in checkpoint and (
        not isinstance(checkpoint["sha256"], str) or not _SHA256.fullmatch(checkpoint["sha256"])
    ):
        raise ValueError("Model checkpoint digest is invalid")
    if "revision" in checkpoint:
        _text(checkpoint["revision"], "checkpoint revision", 200)
    nodes, edges = value["nodes"], value["edges"]
    if not isinstance(nodes, list) or not 1 <= len(nodes) <= 512:
        raise ValueError("Model graph must contain from 1 to 512 nodes")
    identities = set()
    for node in nodes:
        if not isinstance(node, dict) or not {"id", "label", "kind"} <= set(node) or not set(node) <= {
            "id", "label", "kind", "parameter_count",
        }:
            raise ValueError("Model node fields are invalid")
        identity = _id(node["id"])
        if identity in identities:
            raise ValueError("Model graph node identities must be unique")
        identities.add(identity)
        _text(node["label"], "node label")
        _text(node["kind"], "node kind", 80)
        if "parameter_count" in node:
            count = node["parameter_count"]
            if isinstance(count, bool) or not isinstance(count, int) or not 0 <= count <= 10**15:
                raise ValueError("Model parameter count must be a bounded nonnegative integer")
    if not isinstance(edges, list) or len(edges) > 2048:
        raise ValueError("Model graph must contain at most 2048 edges")
    connections = set()
    for edge in edges:
        if not isinstance(edge, dict) or set(edge) != {"source", "target"}:
            raise ValueError("Model edge fields are invalid")
        source, target = _id(edge["source"]), _id(edge["target"])
        if source not in identities or target not in identities:
            raise ValueError("Model edges must reference declared nodes")
        if source == target or (source, target) in connections:
            raise ValueError("Model edges cannot be self-references or duplicates")
        connections.add((source, target))
    return value


class ModelInspectionService:
    """Read structural evidence only; never import project code or unpickle weights."""

    def __init__(self, projects: ProjectRuntimeConfigurationService) -> None:
        self.projects = projects

    def get(self, project_id: str) -> dict:
        project = self.projects.get(project_id)
        bindings = project.get("bindings") or {}
        binding = bindings.get("model_descriptor")
        if not isinstance(binding, dict):
            raise KeyError("Model descriptor is not configured for this project")
        digest = binding.get("sha256")
        if not isinstance(digest, str) or not _SHA256.fullmatch(digest):
            raise ValueError("Model descriptor must have an owner-bound SHA-256")
        raw_path = binding.get("path")
        if not isinstance(raw_path, str) or not Path(raw_path).is_absolute():
            raise ValueError("Model descriptor must be an owner-bound absolute file")
        path = Path(raw_path)
        if ".." in path.parts or any(parent.is_symlink() for parent in (path, *path.parents)):
            raise ValueError("Model descriptor path cannot contain symbolic links")
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(descriptor, "rb") as stream:
            metadata = os.fstat(stream.fileno())
            if not stat.S_ISREG(metadata.st_mode) or metadata.st_size > _MAX_BYTES:
                raise ValueError("Model descriptor must be a bounded regular JSON file")
            payload = stream.read(_MAX_BYTES + 1)
        if len(payload) > _MAX_BYTES:
            raise ValueError("Model descriptor exceeds the size limit")
        if hashlib.sha256(payload).hexdigest() != digest:
            raise ValueError("Model descriptor bytes changed after owner binding")
        value = validate_model_descriptor(json.loads(payload))
        checkpoint = value["checkpoint"]
        candidates = [bindings.get(key) for key in ("checkpoint", "model")]
        if not any(isinstance(candidate, dict) and all(candidate.get(key) == item for key, item in checkpoint.items())
                   for candidate in candidates):
            raise ValueError("Model descriptor checkpoint identity differs from the project binding")
        return {**value, "project_id": project["id"], "descriptor_sha256": digest,
                "evidence_kind": "owner-authored-structural-descriptor"}


__all__ = ["ModelInspectionService", "validate_model_descriptor"]
