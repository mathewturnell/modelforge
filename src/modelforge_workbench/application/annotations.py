"""Owner-state annotations bound to immutable registered dataset samples."""

from __future__ import annotations

import json
import math
import os
import re
import stat
import threading
from pathlib import Path
from typing import Any, Mapping

from .datasets import DatasetService


_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,79}$")
_SHA256 = re.compile(r"^[a-f0-9]{64}$")
_HELD_OUT = frozenset({"test", "reserved-test", "reserved_test", "held-out", "held_out"})
_MAX_LABELS = 500
_MAX_NOTE_LENGTH = 16_384
_MAX_DOCUMENT_BYTES = 128 * 1024


class AnnotationConflictError(ValueError):
    """The caller edited an older annotation revision."""


def _identity(value: Any, label: str) -> str:
    result = str(value or "").strip().casefold()
    if not _ID.fullmatch(result):
        raise ValueError(f"{label} identity is invalid")
    return result


def _number(value: Any, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"Annotation {label} must be a number")
    result = float(value)
    if not math.isfinite(result) or not 0 <= result <= 1:
        raise ValueError(f"Annotation {label} must be from 0 to 1")
    return result


def _labels(value: Any) -> list[str]:
    if not isinstance(value, list) or len(value) > _MAX_LABELS:
        raise ValueError(f"Annotation labels must be a list of at most {_MAX_LABELS} items")
    result: list[str] = []
    for raw in value:
        if not isinstance(raw, str) or not raw.strip() or len(raw.strip()) > 100:
            raise ValueError("Annotation labels must be non-empty strings of at most 100 characters")
        result.append(raw.strip())
    if len(result) != len(set(result)):
        raise ValueError("Annotation labels must be unique")
    return result


def _boxes(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list) or len(value) > _MAX_LABELS:
        raise ValueError(f"Annotation boxes must be a list of at most {_MAX_LABELS} items")
    result: list[dict[str, Any]] = []
    for index, raw in enumerate(value):
        if not isinstance(raw, Mapping):
            raise ValueError("Each annotation box must be an object")
        unknown = set(raw) - {"id", "label", "x", "y", "width", "height"}
        if unknown:
            raise ValueError(f"Annotation box fields are unsupported: {', '.join(sorted(unknown))}")
        name = str(raw.get("label") or "").strip()
        if not name or len(name) > 100:
            raise ValueError("Annotation box label is required and bounded")
        item: dict[str, Any] = {
            "id": _identity(raw.get("id") or f"box-{index + 1}", "Annotation box"),
            "label": name,
        }
        geometry = ("x", "y", "width", "height")
        if not all(field in raw for field in geometry):
            raise ValueError("Annotation boxes require x, y, width, and height")
        for field in geometry:
            item[field] = _number(raw[field], field)
        if item["width"] <= 0 or item["height"] <= 0:
            raise ValueError("Annotation box width and height must be positive")
        if item["x"] + item["width"] > 1 or item["y"] + item["height"] > 1:
            raise ValueError("Annotation box must remain inside the sample")
        result.append(item)
    ids = [item["id"] for item in result]
    if len(ids) != len(set(ids)):
        raise ValueError("Annotation label identities must be unique")
    return result


class FileAnnotationRepository:
    """Store only annotation JSON in the private ModelForge state root."""

    def __init__(self, state_root: Path) -> None:
        self.root = state_root / "annotations"
        self._lock = threading.RLock()

    def _path(self, project_id: str, dataset_id: str, sample_id: str) -> Path:
        project = _identity(project_id, "Project")
        dataset = _identity(dataset_id, "Dataset")
        sample = _identity(sample_id, "Sample")
        return self.root / project / dataset / f"{sample}.json"

    @staticmethod
    def _empty(project_id: str, dataset_id: str, sample_id: str, digest: str) -> dict[str, Any]:
        return {
            "protocol": "modelforge.annotation/v1",
            "project_id": project_id,
            "dataset_id": dataset_id,
            "sample_id": sample_id,
            "sample_sha256": digest,
            "revision": 0,
            "labels": [],
            "note": "",
            "boxes": [],
        }

    def get(
        self, project_id: str, dataset_id: str, sample_id: str, digest: str,
    ) -> dict[str, Any]:
        path = self._path(project_id, dataset_id, sample_id)
        with self._lock:
            if not path.exists():
                return self._empty(project_id, dataset_id, sample_id, digest)
            if path.is_symlink() or not path.is_file():
                raise OSError("Stored annotation is not a regular owner-state file")
            metadata = path.stat()
            if stat.S_IMODE(metadata.st_mode) != 0o600 or metadata.st_size > _MAX_DOCUMENT_BYTES:
                raise OSError("Stored annotation permissions or size are invalid")
            value = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(value, dict) or value.get("protocol") != "modelforge.annotation/v1":
                raise ValueError("Stored annotation protocol is invalid")
            if value.get("sample_sha256") != digest:
                raise OSError("Stored annotation is bound to different sample bytes")
            return value

    def put(
        self, project_id: str, dataset_id: str, sample_id: str, digest: str,
        *, expected_revision: int, labels: list[str], note: str,
        boxes: list[dict[str, Any]],
    ) -> dict[str, Any]:
        path = self._path(project_id, dataset_id, sample_id)
        with self._lock:
            current = self.get(project_id, dataset_id, sample_id, digest)
            if current["revision"] != expected_revision:
                raise AnnotationConflictError(
                    f"Annotation revision changed; expected {expected_revision}, "
                    f"current revision is {current['revision']}"
                )
            value = {
                **self._empty(project_id, dataset_id, sample_id, digest),
                "revision": expected_revision + 1,
                "labels": labels,
                "note": note,
                "boxes": boxes,
            }
            payload = (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode()
            if len(payload) > _MAX_DOCUMENT_BYTES:
                raise ValueError("Annotation document exceeds the 128 KiB owner-state limit")
            for directory in (self.root, path.parent.parent, path.parent):
                if directory.exists() and (directory.is_symlink() or not directory.is_dir()):
                    raise OSError("Annotation owner-state path is invalid")
                directory.mkdir(mode=0o700, exist_ok=True)
                os.chmod(directory, 0o700)
            temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
            try:
                descriptor = os.open(
                    temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600,
                )
                try:
                    os.write(descriptor, payload)
                    os.fsync(descriptor)
                finally:
                    os.close(descriptor)
                os.replace(temporary, path)
                os.chmod(path, 0o600)
            finally:
                temporary.unlink(missing_ok=True)
            return value


class AnnotationService:
    """Validate annotation edits against the checked dataset catalog."""

    def __init__(self, repository: FileAnnotationRepository, datasets: DatasetService) -> None:
        self.repository = repository
        self.datasets = datasets

    def get(self, project_id: str, dataset_id: str, sample_id: str) -> dict[str, Any]:
        sample = self.datasets.resolve(project_id, dataset_id, sample_id)
        return self.repository.get(project_id, dataset_id, sample_id, sample.sha256)

    def save(
        self, project_id: str, dataset_id: str, sample_id: str, value: Mapping[str, Any],
    ) -> dict[str, Any]:
        sample = self.datasets.resolve(project_id, dataset_id, sample_id)
        if sample.split.strip().casefold() in _HELD_OUT:
            raise ValueError("Annotations cannot be written to a held-out dataset split")
        digest = str(value.get("sample_sha256") or "").strip().casefold()
        if not _SHA256.fullmatch(digest) or digest != sample.sha256:
            raise ValueError("Annotation sample digest differs from the checked dataset sample")
        revision = value.get("expected_revision")
        if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
            raise ValueError("Annotation expected revision must be a non-negative integer")
        note = value.get("note", "")
        if not isinstance(note, str) or len(note) > _MAX_NOTE_LENGTH:
            raise ValueError(f"Annotation note must be at most {_MAX_NOTE_LENGTH} characters")
        return self.repository.put(
            project_id, dataset_id, sample_id, sample.sha256,
            expected_revision=revision, labels=_labels(value.get("labels", [])), note=note,
            boxes=_boxes(value.get("boxes", [])),
        )


__all__ = ["AnnotationConflictError", "AnnotationService", "FileAnnotationRepository"]
