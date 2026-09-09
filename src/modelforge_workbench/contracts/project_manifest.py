# Copyright (C) 2026 Mathew Turnell
# SPDX-License-Identifier: Apache-2.0

"""Pure compatibility normalization for the retained project manifest v1."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any


PROJECT_MANIFEST_SCHEMA_VERSION = 1
PROJECT_MANIFEST_MAX_BYTES = 2 * 1024 * 1024


class ProjectManifestCompatibilityError(ValueError):
    """Raised when this ModelForge version cannot safely read a project manifest."""


def _declared_schema_version(value: Mapping[str, Any]) -> int:
    raw = value.get("schema_version", 1)
    if isinstance(raw, bool):
        raise ProjectManifestCompatibilityError("Project schema_version must be a positive integer")
    try:
        version = int(raw)
    except (TypeError, ValueError) as exc:
        raise ProjectManifestCompatibilityError(
            "Project schema_version must be a positive integer"
        ) from exc
    if version < 1 or str(raw).strip() not in {str(version), f"{version}.0"}:
        raise ProjectManifestCompatibilityError("Project schema_version must be a positive integer")
    return version


# Add an entry keyed by the schema it upgrades when introducing a new schema.
# Migrations must preserve unknown project-owned fields.
_MIGRATIONS: dict[int, Callable[[dict[str, Any]], dict[str, Any]]] = {}


def normalize_project_manifest(value: Mapping[str, Any]) -> dict[str, Any]:
    """Return the current in-memory shape without rewriting the project file."""
    if not isinstance(value, Mapping):
        raise ProjectManifestCompatibilityError("Project manifest must be an object")
    result = dict(value)
    version = _declared_schema_version(result)
    if version > PROJECT_MANIFEST_SCHEMA_VERSION:
        raise ProjectManifestCompatibilityError(
            "Project schema_version "
            f"{version} requires a newer ModelForge version; this installation supports up to "
            f"{PROJECT_MANIFEST_SCHEMA_VERSION}"
        )
    while version < PROJECT_MANIFEST_SCHEMA_VERSION:
        migrate = _MIGRATIONS.get(version)
        if migrate is None:
            raise ProjectManifestCompatibilityError(
                f"Project schema_version {version} has no registered migration"
            )
        result = migrate(result)
        version += 1
    result["schema_version"] = PROJECT_MANIFEST_SCHEMA_VERSION
    return result


__all__ = [
    "PROJECT_MANIFEST_MAX_BYTES",
    "PROJECT_MANIFEST_SCHEMA_VERSION",
    "ProjectManifestCompatibilityError",
    "normalize_project_manifest",
]
