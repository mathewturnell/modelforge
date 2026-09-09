# Copyright (C) 2026 Mathew Turnell
# SPDX-License-Identifier: Apache-2.0

"""Backward-compatible normalization for customer project manifests."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .contracts.project_manifest import (
    PROJECT_MANIFEST_MAX_BYTES,
    PROJECT_MANIFEST_SCHEMA_VERSION,
    ProjectManifestCompatibilityError,
    normalize_project_manifest,
)


def load_project_manifest(
    path: str | Path,
    *,
    resolve_repository: bool = False,
    default_repository: bool = False,
    maximum_bytes: int = PROJECT_MANIFEST_MAX_BYTES,
) -> dict[str, Any]:
    """Load one regular, bounded project manifest through the version reader.

    ``resolve_repository`` is for host and CLI consumers that need an absolute
    working root. Portable-transfer validators can leave the authored value
    untouched and enforce their own root policy after version normalization.
    """
    location = Path(path).expanduser()
    try:
        if location.is_symlink() or not location.is_file():
            raise ProjectManifestCompatibilityError("Project manifest must be a regular file")
        size = location.stat().st_size
    except OSError as exc:
        raise ProjectManifestCompatibilityError("Project manifest could not be read") from exc
    if size > maximum_bytes:
        raise ProjectManifestCompatibilityError(
            f"Project manifest exceeds the {maximum_bytes}-byte limit"
        )
    try:
        value = json.loads(location.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ProjectManifestCompatibilityError("Project manifest is not valid JSON") from exc
    manifest = normalize_project_manifest(value)
    if resolve_repository and (str(manifest.get("repository") or "").strip() or default_repository):
        repository = Path(str(manifest.get("repository") or ".")).expanduser()
        if not repository.is_absolute():
            repository = location.parent / repository
        manifest["repository"] = str(repository.resolve())
    return manifest


__all__ = [
    "PROJECT_MANIFEST_MAX_BYTES",
    "PROJECT_MANIFEST_SCHEMA_VERSION",
    "ProjectManifestCompatibilityError",
    "load_project_manifest",
    "normalize_project_manifest",
]
