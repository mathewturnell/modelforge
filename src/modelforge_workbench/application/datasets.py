"""Bounded catalog-backed dataset/sample access for registered local projects."""

from __future__ import annotations

import hashlib
import os
import stat
from dataclasses import dataclass
from pathlib import Path

from .runtime_configurations import ProjectRuntimeConfigurationService


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


@dataclass(frozen=True)
class ResolvedSample:
    project_id: str
    dataset_id: str
    sample_id: str
    root: Path
    path: Path
    relative_path: str
    content_type: str
    size_bytes: int
    sha256: str
    split: str


class DatasetService:
    """Page and resolve only samples explicitly registered in a bounded catalog."""

    def __init__(self, projects: ProjectRuntimeConfigurationService) -> None:
        self.projects = projects

    def list_samples(
        self, project_id: str, dataset_id: str, *, cursor: int = 0, limit: int = 50,
    ) -> dict:
        if isinstance(cursor, bool) or not isinstance(cursor, int) or cursor < 0:
            raise ValueError("Dataset cursor is invalid")
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 100:
            raise ValueError("Dataset page limit must be from 1 to 100")
        project = self.projects.get(project_id)
        dataset = project.get("dataset")
        if not dataset or dataset["id"] != dataset_id:
            raise KeyError("Dataset is not registered for this project")
        page = dataset["samples"][cursor:cursor + limit]
        return {
            "dataset_id": dataset_id,
            "samples": [
                {key: item[key] for key in (
                    "id", "name", "split", "content_type", "size_bytes", "sha256",
                )}
                for item in page
            ],
            "next_cursor": cursor + len(page) if cursor + len(page) < len(dataset["samples"]) else None,
            "truncated": cursor + len(page) < len(dataset["samples"]),
        }

    def resolve(self, project_id: str, dataset_id: str, sample_id: str) -> ResolvedSample:
        project = self.projects.get(project_id)
        dataset = project.get("dataset")
        if not dataset or dataset["id"] != dataset_id:
            raise KeyError("Dataset is not registered for this project")
        item = next((entry for entry in dataset["samples"] if entry["id"] == sample_id), None)
        if item is None:
            raise KeyError("Dataset sample is not registered")
        root = Path(dataset["root"])
        relative = Path(item["path"])
        current = root
        for part in relative.parts:
            current = current / part
            metadata = os.lstat(current)
            if stat.S_ISLNK(metadata.st_mode):
                raise ValueError("Dataset sample path cannot contain symbolic links")
        path = current.resolve()
        if not path.is_relative_to(root.resolve()) or not path.is_file():
            raise ValueError("Dataset sample escaped its registered root")
        if path.stat().st_size != item["size_bytes"] or _sha256(path) != item["sha256"]:
            raise OSError("Dataset sample bytes changed after registration")
        return ResolvedSample(
            project["id"], dataset["id"], item["id"], root.resolve(), path,
            relative.as_posix(), item["content_type"], item["size_bytes"], item["sha256"],
            item["split"],
        )


__all__ = ["DatasetService", "ResolvedSample"]
