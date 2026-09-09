"""Checked local-filesystem adapter for registered artifacts."""

from __future__ import annotations

import hashlib
import os
import re
import stat
from pathlib import Path
from typing import Any, BinaryIO, Mapping

from modelforge_workbench.application.artifacts import OpenedArtifact


_SHA256 = re.compile(r"^[a-f0-9]{64}$")


class LocalFilesystemArtifactIO:
    """Verify local artifact bytes without following the final path component."""

    @staticmethod
    def _absolute_regular_path(path: Path) -> Path:
        path = Path(path).expanduser()
        if not path.is_absolute() or ".." in path.parts:
            raise OSError("The local artifact is not a regular non-symlink file")
        current = Path(path.anchor)
        for part in path.parts[1:]:
            current /= part
            if current.is_symlink():
                raise OSError("The local artifact is not a regular non-symlink file")
        return path.resolve(strict=True)

    @staticmethod
    def _open_verified(
        path: Path, *, expected_size: int, expected_sha256: str,
    ) -> tuple[Path, BinaryIO, int]:
        if expected_size < 0 or not _SHA256.fullmatch(expected_sha256):
            raise OSError("The local artifact has incomplete integrity evidence")
        resolved = LocalFilesystemArtifactIO._absolute_regular_path(path)
        descriptor = os.open(resolved, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        try:
            file_stat = os.fstat(descriptor)
            if not stat.S_ISREG(file_stat.st_mode) or file_stat.st_size != expected_size:
                raise OSError("The local artifact changed after registration")
            digest = hashlib.sha256()
            while True:
                chunk = os.read(descriptor, 8 * 1024 * 1024)
                if not chunk:
                    break
                digest.update(chunk)
            if digest.hexdigest() != expected_sha256:
                raise OSError("The local artifact changed after registration")
            os.lseek(descriptor, 0, os.SEEK_SET)
            return resolved, os.fdopen(descriptor, "rb"), file_stat.st_size
        except Exception:
            os.close(descriptor)
            raise

    def verify_candidate(
        self, root: Path, path: Path, *, size_bytes: int, sha256: str,
    ) -> Path:
        root = Path(root).expanduser()
        if root.is_symlink() or not root.is_dir():
            raise ValueError("Local artifact evidence root is unavailable")
        candidate = Path(path).expanduser()
        if ".." in candidate.parts:
            raise ValueError("Validated artifact escaped its evidence root")
        candidate = candidate if candidate.is_absolute() else root / candidate
        try:
            candidate.relative_to(root)
        except ValueError as exc:
            raise ValueError("Validated artifact escaped its evidence root") from exc
        try:
            resolved, stream, _size = self._open_verified(
                candidate, expected_size=size_bytes, expected_sha256=sha256,
            )
        except OSError as exc:
            message = str(exc)
            if "changed" in message:
                raise ValueError("Validated artifact changed before registration") from exc
            raise ValueError("Validated artifact is unavailable") from exc
        with stream:
            pass
        if not resolved.is_relative_to(root.resolve()):
            raise ValueError("Validated artifact escaped its evidence root")
        return resolved

    def open_registered(
        self, artifact: Mapping[str, Any],
    ) -> OpenedArtifact:
        try:
            expected_size = int(artifact.get("size_bytes"))
        except (TypeError, ValueError) as exc:
            raise OSError("The local artifact has no valid registered size") from exc
        expected_sha256 = str(artifact.get("sha256") or "").strip().casefold()
        _path, stream, size = self._open_verified(
            Path(str(artifact.get("storage_ref") or "")),
            expected_size=expected_size,
            expected_sha256=expected_sha256,
        )
        return OpenedArtifact(
            stream=stream,
            size_bytes=size,
            filename=Path(str(artifact.get("name") or "artifact")).name,
            content_type=str(artifact.get("content_type") or "application/octet-stream"),
            sha256=expected_sha256,
        )
