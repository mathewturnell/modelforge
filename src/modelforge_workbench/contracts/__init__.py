# Copyright (C) 2026 Mathew Turnell
# SPDX-License-Identifier: Apache-2.0

"""Import-light, non-authorizing ModelForge wire contracts."""

from .project_manifest import (
    PROJECT_MANIFEST_MAX_BYTES,
    PROJECT_MANIFEST_SCHEMA_VERSION,
    ProjectManifestCompatibilityError,
    normalize_project_manifest,
)

__all__ = [
    "PROJECT_MANIFEST_MAX_BYTES",
    "PROJECT_MANIFEST_SCHEMA_VERSION",
    "ProjectManifestCompatibilityError",
    "normalize_project_manifest",
]
