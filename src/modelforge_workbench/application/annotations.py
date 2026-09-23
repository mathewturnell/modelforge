"""Checked sample annotations stored as private, revisioned JSON sidecars."""
from __future__ import annotations

import fcntl
import hashlib
import json
import math
import os
import re
import stat
import tempfile
from contextlib import contextmanager
from pathlib import Path

from .datasets import DatasetService, ResolvedSample

_PROTOCOL = "modelforge.annotations/v1"
_MAX_BYTES = 4 * 1024 * 1024
_MAX_RECTANGLES = 10_000
_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$")
_EDITABLE_SPLITS = frozenset({"train", "training", "val", "validation", "unspecified", "unassigned"})


class AnnotationConflictError(ValueError):
    """The caller edited an obsolete revision and must reload before saving."""


def _identifier(value: object, label: str) -> str:
    if not isinstance(value, str) or not _ID.fullmatch(value):
        raise ValueError(f"{label} identity is invalid")
    return value


def _annotations(value: object, sample: ResolvedSample) -> list[dict]:
    if not isinstance(value, list) or len(value) > _MAX_RECTANGLES:
        raise ValueError(f"Annotations must be a list of at most {_MAX_RECTANGLES} rectangles")
    result, identities = [], set()
    for item in value:
        if not isinstance(item, dict) or set(item) != {
            "id", "frame", "label", "track_id", "x", "y", "width", "height",
        }:
            raise ValueError("Annotation fields must describe a frame rectangle, label, and track")
        identity = _identifier(item["id"], "Annotation")
        if identity in identities:
            raise ValueError("Annotation identities must be unique")
        identities.add(identity)
        _identifier(item["track_id"], "Track")
        label = item["label"]
        if not isinstance(label, str) or not label.strip() or len(label) > 120 or any(ord(c) < 32 for c in label):
            raise ValueError("Annotation label must be bounded printable text")
        frame = item["frame"]
        if isinstance(frame, bool) or not isinstance(frame, int) or not 0 <= frame <= 1_000_000:
            raise ValueError("Annotation frame must be a bounded nonnegative integer")
        if sample.content_type.startswith("image/") and frame != 0:
            raise ValueError("Image annotation frame must be zero")
        for key in ("x", "y", "width", "height"):
            coordinate = item[key]
            if isinstance(coordinate, bool) or not isinstance(coordinate, (int, float)) or not math.isfinite(coordinate):
                raise ValueError("Rectangle coordinates must be finite numbers")
            if not 0 <= coordinate <= 1 or (key in {"width", "height"} and coordinate == 0):
                raise ValueError("Rectangle coordinates must be normalized inside the sample")
        if item["x"] + item["width"] > 1 or item["y"] + item["height"] > 1:
            raise ValueError("Rectangle extends outside the sample")
        result.append(dict(item))
    return result


class AnnotationService:
    """Delivery-neutral annotation port; original sample bytes are never written."""

    def __init__(self, state_root: Path, datasets: DatasetService) -> None:
        self.root = Path(state_root) / "annotations"
        self.datasets = datasets

    def _sample(self, project_id: str, dataset_id: str, sample_id: str) -> ResolvedSample:
        for identity in (project_id, dataset_id, sample_id):
            _identifier(identity, "Sample scope")
        sample = self.datasets.resolve(project_id, dataset_id, sample_id)
        if not sample.content_type.startswith(("image/", "video/")):
            raise ValueError("Rectangular annotations require an image or video sample")
        return sample

    def _directory(self, *, create: bool = False) -> bool:
        for path in reversed((self.root, *self.root.parents)):
            if path.is_symlink():
                raise ValueError("Annotation storage cannot contain symbolic links")
        if create:
            self.root.mkdir(mode=0o700, exist_ok=True)
        if not self.root.exists():
            return False
        metadata = self.root.stat()
        if not stat.S_ISDIR(metadata.st_mode) or stat.S_IMODE(metadata.st_mode) != 0o700:
            raise ValueError("Annotation storage must be an owner-only directory")
        if metadata.st_uid != os.getuid():
            raise ValueError("Annotation storage has a different owner")
        return True

    @staticmethod
    def _key(sample: ResolvedSample) -> str:
        scope = [sample.project_id, sample.dataset_id, sample.sample_id, sample.sha256]
        return hashlib.sha256(json.dumps(scope).encode()).hexdigest()

    @staticmethod
    def _empty(sample: ResolvedSample) -> dict:
        return {
            "protocol": _PROTOCOL, "project_id": sample.project_id,
            "dataset_id": sample.dataset_id, "sample_id": sample.sample_id,
            "sample_sha256": sample.sha256, "revision": 0,
            "editable": sample.split.casefold().strip() in _EDITABLE_SPLITS,
            "annotations": [],
        }

    def _read(self, sample: ResolvedSample) -> dict:
        expected = self._empty(sample)
        if not self._directory():
            return expected
        path = self.root / f"{self._key(sample)}.json"
        try:
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        except FileNotFoundError:
            return expected
        with os.fdopen(descriptor, "rb") as stream:
            metadata = os.fstat(stream.fileno())
            if (not stat.S_ISREG(metadata.st_mode) or stat.S_IMODE(metadata.st_mode) != 0o600
                    or metadata.st_uid != os.getuid() or metadata.st_size > _MAX_BYTES):
                raise ValueError("Annotation sidecar must be a bounded owner-only regular file")
            payload = stream.read(_MAX_BYTES + 1)
        if len(payload) > _MAX_BYTES:
            raise ValueError("Annotation sidecar is too large")
        value = json.loads(payload)
        if not isinstance(value, dict) or set(value) != set(expected):
            raise ValueError("Stored annotation fields are invalid")
        for field in ("protocol", "project_id", "dataset_id", "sample_id", "sample_sha256"):
            if value[field] != expected[field]:
                raise ValueError("Stored annotation sample identity differs")
        revision = value["revision"]
        if isinstance(revision, bool) or not isinstance(revision, int) or revision < 1:
            raise ValueError("Stored annotation revision is invalid")
        value["annotations"] = _annotations(value["annotations"], sample)
        value["editable"] = expected["editable"]
        return value

    @contextmanager
    def _lock(self, sample: ResolvedSample):
        self._directory(create=True)
        descriptor = os.open(
            self.root / f"{self._key(sample)}.lock",
            os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600,
        )
        try:
            metadata = os.fstat(descriptor)
            if (not stat.S_ISREG(metadata.st_mode) or stat.S_IMODE(metadata.st_mode) != 0o600
                    or metadata.st_uid != os.getuid()):
                raise ValueError("Annotation lock must be an owner-only regular file")
            fcntl.flock(descriptor, fcntl.LOCK_EX)
            yield
        finally:
            os.close(descriptor)

    def get(self, project_id: str, dataset_id: str, sample_id: str) -> dict:
        return self._read(self._sample(project_id, dataset_id, sample_id))

    def save(self, project_id: str, dataset_id: str, sample_id: str, payload: dict) -> dict:
        sample = self._sample(project_id, dataset_id, sample_id)
        if not self._empty(sample)["editable"]:
            raise ValueError("Annotations cannot mutate test, reserved, held-out, or unknown splits")
        if not isinstance(payload, dict) or set(payload) != {"expected_revision", "annotations"}:
            raise ValueError("Annotation save requires expected_revision and annotations")
        revision = payload["expected_revision"]
        if isinstance(revision, bool) or not isinstance(revision, int) or revision < 0:
            raise ValueError("Expected annotation revision must be a nonnegative integer")
        annotations = _annotations(payload["annotations"], sample)
        with self._lock(sample):
            current = self._read(sample)
            if revision != current["revision"]:
                raise AnnotationConflictError("Annotation revision changed; reload before saving")
            current.update(revision=revision + 1, annotations=annotations)
            encoded = (json.dumps(current, allow_nan=False, sort_keys=True) + "\n").encode()
            if len(encoded) > _MAX_BYTES:
                raise ValueError("Annotation sidecar is too large")
            destination = self.root / f"{self._key(sample)}.json"
            descriptor, temporary = tempfile.mkstemp(prefix=".annotation-", dir=self.root)
            try:
                with os.fdopen(descriptor, "wb") as stream:
                    stream.write(encoded)
                    stream.flush()
                    os.fsync(stream.fileno())
                os.replace(temporary, destination)
            finally:
                Path(temporary).unlink(missing_ok=True)
        return current


__all__ = ["AnnotationService", "AnnotationConflictError"]
