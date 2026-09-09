# Copyright (C) 2026 Mathew Turnell
# SPDX-License-Identifier: Apache-2.0

"""Small worker-side helpers for the bounded Modal result transport."""

from __future__ import annotations

import base64
import hashlib
import json
from pathlib import Path
from typing import Any, Mapping, Sequence


MAX_FILES = 8
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_TOTAL_BYTES = 2 * 1024 * 1024
MAX_STREAM_BYTES = 256 * 1024


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verified_asset(
    root: str | Path, asset: Mapping[str, Any], *, expected_role: str | None = None,
) -> Path:
    """Resolve one binding-supplied provider path beneath the fixed mount."""

    mount = Path(root).resolve()
    candidate = Path(str(asset.get("provider_path") or ""))
    if expected_role is not None and asset.get("role") != expected_role:
        raise ValueError("Provider asset role is invalid")
    if not candidate.is_absolute() or candidate.is_symlink():
        raise ValueError("Provider asset path is invalid")
    resolved = candidate.resolve()
    if not resolved.is_relative_to(mount):
        raise ValueError("Provider asset escaped the fixed input mount")
    if asset.get("verification") == "sha256":
        if not resolved.is_file():
            raise ValueError("Provider file asset is unavailable")
        if resolved.stat().st_size != asset.get("size_bytes") or sha256_file(resolved) != asset.get("sha256"):
            raise ValueError("Provider file asset identity changed")
    elif asset.get("verification") == "revision":
        if not resolved.is_dir() or resolved.name != asset.get("revision"):
            raise ValueError("Provider revision asset identity changed")
    else:
        raise ValueError("Provider asset verification is unsupported")
    return resolved


def asset_by_id(payload: Mapping[str, Any], asset_id: str) -> Mapping[str, Any]:
    assets = payload.get("assets")
    if not isinstance(assets, list):
        raise ValueError("Provider request assets must be a list")
    matches = [item for item in assets if isinstance(item, Mapping) and item.get("id") == asset_id]
    if len(matches) != 1:
        raise ValueError(f"Provider request requires exactly one {asset_id} asset")
    return matches[0]


def validate_request(payload: Any, *, project_id: str, action_id: str, action_kind: str) -> dict:
    if not isinstance(payload, Mapping):
        raise ValueError("Provider request must be an object")
    expected = {
        "protocol", "run_id", "binding_sha256", "project_id", "action_id",
        "action_kind", "request", "assets",
    }
    if set(payload) != expected:
        raise ValueError("Provider request fields are invalid")
    if payload.get("protocol") != "modelforge.modal-project-action-request/v1":
        raise ValueError("Provider request protocol is unsupported")
    if (
        payload.get("project_id") != project_id
        or payload.get("action_id") != action_id
        or payload.get("action_kind") != action_kind
    ):
        raise ValueError("Provider request action identity is invalid")
    run_id = str(payload.get("run_id") or "")
    binding_sha = str(payload.get("binding_sha256") or "")
    if len(run_id) != 32 or any(character not in "0123456789abcdef" for character in run_id):
        raise ValueError("Provider request run identity is invalid")
    if len(binding_sha) != 64 or any(character not in "0123456789abcdef" for character in binding_sha):
        raise ValueError("Provider request binding identity is invalid")
    if not isinstance(payload.get("request"), Mapping):
        raise ValueError("Provider action request must be an object")
    json.dumps(payload, allow_nan=False)
    return dict(payload)


def result_envelope(
    execution_id: str, files: Sequence[Path], *, stdout: str = "", stderr: str = "",
    return_code: int = 0,
) -> dict:
    """Encode checked regular output files within the public transport bounds."""

    if len(files) > MAX_FILES:
        raise ValueError("Provider result contains too many files")
    encoded_files = []
    total = 0
    for path in files:
        if path.is_symlink() or not path.is_file() or path.name != str(path.name):
            raise ValueError("Provider result file is invalid")
        content = path.read_bytes()
        if len(content) > MAX_FILE_BYTES:
            raise ValueError("Provider result file exceeds the transport bound")
        total += len(content)
        if total > MAX_TOTAL_BYTES:
            raise ValueError("Provider result files exceed the aggregate transport bound")
        encoded_files.append({
            "name": path.name,
            "content_base64": base64.b64encode(content).decode("ascii"),
            "size_bytes": len(content),
            "sha256": hashlib.sha256(content).hexdigest(),
        })
    if len(stdout.encode()) > MAX_STREAM_BYTES or len(stderr.encode()) > MAX_STREAM_BYTES:
        raise ValueError("Provider result stream exceeds the transport bound")
    return {
        "protocol": "modelforge.modal-execution-result/v1",
        "execution_id": execution_id,
        "return_code": int(return_code),
        "stdout": stdout,
        "stderr": stderr,
        "files": encoded_files,
    }


__all__ = [
    "asset_by_id", "result_envelope", "sha256_file", "validate_request",
    "verified_asset",
]
