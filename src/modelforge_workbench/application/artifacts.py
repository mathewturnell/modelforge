"""Delivery-neutral artifact registration, projection, and access use cases."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, BinaryIO, Mapping, Protocol

from .runs import RunScope, RunService, _json_mapping, thaw_json


_SHA256 = re.compile(r"^[a-f0-9]{64}$")


class LocalArtifactIO(Protocol):
    """Filesystem adapter used for local candidate and registered-byte checks."""

    def verify_candidate(
        self, root: Path, path: Path, *, size_bytes: int, sha256: str,
    ) -> Path: ...

    def open_registered(self, artifact: Mapping[str, Any]) -> "OpenedArtifact": ...


@dataclass(frozen=True)
class ArtifactAllocation:
    """One run-derived local evidence boundary."""

    run_id: str
    evidence_root: Path

    def __post_init__(self) -> None:
        if not str(self.run_id or "").strip():
            raise ValueError("Artifact allocation requires its run identity")
        object.__setattr__(self, "run_id", str(self.run_id))
        object.__setattr__(self, "evidence_root", Path(self.evidence_root).expanduser())


@dataclass(frozen=True)
class OpenedArtifact:
    """Opaque verified artifact stream without a host storage locator."""

    stream: BinaryIO
    size_bytes: int
    filename: str
    content_type: str
    sha256: str


@dataclass(frozen=True)
class LocalArtifactCandidate:
    """Action-handler-approved local artifact awaiting durable registration."""

    name: str
    kind: str
    path: Path
    content_type: str
    size_bytes: int
    sha256: str
    metadata: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not str(self.name or "").strip() or Path(str(self.name)).name != str(self.name):
            raise ValueError("Validated artifact name must be a filename")
        if not str(self.kind or "").strip():
            raise ValueError("Validated artifact kind is required")
        if isinstance(self.size_bytes, bool) or not isinstance(self.size_bytes, int):
            raise ValueError("Validated artifact size must be an integer")
        digest = str(self.sha256 or "").strip().casefold()
        if self.size_bytes < 0 or not _SHA256.fullmatch(digest):
            raise ValueError("Validated artifact integrity is incomplete")
        object.__setattr__(self, "path", Path(self.path).expanduser())
        object.__setattr__(self, "sha256", digest)
        object.__setattr__(self, "metadata", _json_mapping(self.metadata, "Artifact metadata"))


class ArtifactService:
    """Own artifact binding, safe projection, and checked local access."""

    def __init__(self, runs: RunService, local_io: LocalArtifactIO) -> None:
        self.runs = runs
        self.local_io = local_io

    def local_record(
        self,
        allocation: ArtifactAllocation,
        candidate: LocalArtifactCandidate,
    ) -> dict[str, Any]:
        if not isinstance(allocation, ArtifactAllocation):
            raise TypeError("Local artifact registration requires its run allocation")
        if not isinstance(candidate, LocalArtifactCandidate):
            raise TypeError("Local artifact registration requires a validated candidate")
        resolved = self.local_io.verify_candidate(
            allocation.evidence_root, candidate.path,
            size_bytes=candidate.size_bytes, sha256=candidate.sha256,
        )
        return {
            "name": candidate.name,
            "kind": candidate.kind,
            "storage_backend": "local",
            "storage_ref": str(resolved),
            "content_type": candidate.content_type,
            "size_bytes": candidate.size_bytes,
            "sha256": candidate.sha256,
            "metadata": {
                **thaw_json(candidate.metadata),
                "evidence_id": allocation.run_id,
            },
        }

    def get(
        self,
        scope: RunScope,
        run_id: str,
        artifact_id: str,
    ) -> dict:
        if scope.project_id is None:
            raise ValueError("Artifact lookup requires a project scope")
        run = self.runs.get(scope, run_id)
        artifact = next(
            (
                item for item in run.get("artifacts") or []
                if str(item.get("id") or "") == str(artifact_id)
            ),
            None,
        )
        if artifact is None:
            raise KeyError("Artifact was not found")
        return artifact

    def open_local(
        self,
        scope: RunScope,
        run_id: str,
        artifact_id: str,
    ) -> OpenedArtifact:
        artifact = self.get(scope, run_id, artifact_id)
        if str(artifact.get("storage_backend") or "") != "local":
            raise ValueError("Artifact is not stored in the local filesystem")
        return self.local_io.open_registered(artifact)

    @staticmethod
    def public_job(
        run: Mapping[str, Any], *, redact_dataset_reference: bool = False,
    ) -> dict[str, Any]:
        """Remove storage locators while retaining durable artifact identity."""

        value = dict(run)
        value.pop("artifact_prefix", None)
        if redact_dataset_reference:
            value.pop("dataset_ref", None)
        artifacts = []
        for artifact in run.get("artifacts") or []:
            item = dict(artifact)
            item.pop("storage_ref", None)
            metadata = (
                dict(item.get("metadata") or {})
                if isinstance(item.get("metadata"), Mapping) else {}
            )
            metadata.pop("storage_ref", None)
            metadata.pop("provider_storage_ref", None)
            item["metadata"] = metadata
            artifacts.append(item)
        value["artifacts"] = artifacts
        return value
