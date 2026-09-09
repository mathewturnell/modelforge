# Copyright (C) 2026 Mathew Turnell
# SPDX-License-Identifier: Apache-2.0

"""Owner-authorized Modal targets for statically declared project actions.

An authored project manifest describes capabilities; it never grants provider
or spending authority.  This module owns the separate, machine-local binding
from one registered authored action to one already-deployed Modal function.
"""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import re
import stat
import threading
import uuid
from collections.abc import Mapping
from pathlib import Path, PurePosixPath
from typing import Any, Protocol


MODAL_ACTION_BINDING_PROTOCOL = "modelforge.modal-action-binding/v1"
MODAL_ACTION_BINDING_PROJECTION_PROTOCOL = (
    "modelforge.modal-action-binding-projection/v1"
)
MODAL_RESULT_TRANSPORT_PROTOCOL = "modelforge.modal-execution-result/v1"

_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_SHA256 = re.compile(r"^[a-f0-9]{64}$")
_REVISION = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._/@:+-]{0,199}$")
_MAX_CONFIG_BYTES = 256 * 1024
_MAX_STDIO_BYTES = 256 * 1024
_MAX_ARTIFACTS = 8
_MAX_ARTIFACT_BYTES = 2 * 1024 * 1024
_MAX_ASSETS = 16
_ASSET_ROLES = frozenset({"source", "input", "dataset", "checkpoint", "model"})
_MUTABLE_REVISIONS = frozenset({"head", "latest", "main", "master", "stable"})

_TOP_LEVEL_FIELDS = frozenset({
    "protocol", "project_id", "action_id", "provider", "environment",
    "application", "function", "compute", "transport", "deployment", "assets",
})
_COMPUTE_FIELDS = frozenset({
    "target", "gpu", "gpu_count", "cpu_millis", "memory_mib",
    "timeout_seconds", "retries", "max_containers", "warm_containers",
})
_TRANSPORT_FIELDS = frozenset({
    "protocol", "max_stdout_bytes", "max_stderr_bytes", "max_artifacts",
    "max_artifact_bytes", "max_total_artifact_bytes",
})
_DEPLOYMENT_FIELDS = frozenset({"source_manifest_sha256", "resource_plan_sha256"})
_ASSET_COMMON_FIELDS = frozenset({"id", "role", "provider_path", "verification"})
_ASSET_SHA_FIELDS = _ASSET_COMMON_FIELDS | {"sha256", "size_bytes"}
_ASSET_REVISION_FIELDS = _ASSET_COMMON_FIELDS | {"revision"}


class AuthoredProjectCatalog(Protocol):
    """Narrow dependency used to prove a binding names a supported action."""

    def capabilities(self, project_id: str) -> Mapping[str, Any]: ...


def _object(value: Any, label: str, fields: frozenset[str]) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{label} must be an object")
    result = {str(key): item for key, item in value.items()}
    unexpected = sorted(set(result) - fields)
    missing = sorted(fields - set(result))
    if unexpected:
        raise ValueError(f"{label} contains unexpected fields: {', '.join(unexpected)}")
    if missing:
        raise ValueError(f"{label} is missing required fields: {', '.join(missing)}")
    return result


def _identifier(value: Any, label: str) -> str:
    if not isinstance(value, str) or not _IDENTIFIER.fullmatch(value):
        raise ValueError(f"{label} identifier is invalid")
    return value


def _digest(value: Any, label: str) -> str:
    if not isinstance(value, str) or not _SHA256.fullmatch(value):
        raise ValueError(f"{label} SHA-256 is invalid")
    return value


def _integer(value: Any, label: str, *, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise ValueError(f"{label} must be an integer from {minimum} to {maximum}")
    return value


def canonical_json_bytes(value: Mapping[str, Any]) -> bytes:
    """Return the UTF-8 canonical form used by all binding identities."""

    return json.dumps(
        value, ensure_ascii=False, allow_nan=False, sort_keys=True, separators=(",", ":"),
    ).encode("utf-8")


def resource_plan_sha256(
    compute: Mapping[str, Any], transport: Mapping[str, Any],
) -> str:
    """Bind the exact resource disclosure and result-transport limits."""

    return hashlib.sha256(canonical_json_bytes({
        "compute": dict(compute), "transport": dict(transport),
    })).hexdigest()


def modal_action_binding_sha256(binding: Mapping[str, Any]) -> str:
    """Identify every field in one normalized owner binding."""

    return hashlib.sha256(canonical_json_bytes(binding)).hexdigest()


def _normalize_compute(value: Any) -> dict[str, Any]:
    source = _object(value, "Modal compute plan", _COMPUTE_FIELDS)
    gpu = source["gpu"]
    if gpu is not None:
        gpu = _identifier(gpu, "Modal GPU")
    gpu_count = _integer(source["gpu_count"], "Modal GPU count", minimum=0, maximum=1)
    if (gpu is None) != (gpu_count == 0):
        raise ValueError("Modal GPU and GPU count must describe the same optional GPU")
    result = {
        "target": _identifier(source["target"], "Modal compute target"),
        "gpu": gpu,
        "gpu_count": gpu_count,
        "cpu_millis": _integer(
            source["cpu_millis"], "Modal CPU millicores", minimum=1, maximum=128_000,
        ),
        "memory_mib": _integer(
            source["memory_mib"], "Modal memory MiB", minimum=1, maximum=1_048_576,
        ),
        "timeout_seconds": _integer(
            source["timeout_seconds"], "Modal timeout seconds", minimum=1, maximum=7_200,
        ),
        "retries": _integer(source["retries"], "Modal retries", minimum=0, maximum=0),
        "max_containers": _integer(
            source["max_containers"], "Modal maximum containers", minimum=1, maximum=1,
        ),
        "warm_containers": _integer(
            source["warm_containers"], "Modal warm containers", minimum=0, maximum=0,
        ),
    }
    return result


def _normalize_transport(value: Any) -> dict[str, Any]:
    source = _object(value, "Modal result transport", _TRANSPORT_FIELDS)
    if source["protocol"] != MODAL_RESULT_TRANSPORT_PROTOCOL:
        raise ValueError("Modal result transport protocol is unsupported")
    artifact_bytes = _integer(
        source["max_artifact_bytes"], "Modal artifact bytes",
        minimum=1, maximum=_MAX_ARTIFACT_BYTES,
    )
    total_bytes = _integer(
        source["max_total_artifact_bytes"], "Modal total artifact bytes",
        minimum=1, maximum=_MAX_ARTIFACT_BYTES,
    )
    if artifact_bytes > total_bytes:
        raise ValueError("Modal per-artifact bytes cannot exceed the total artifact bytes")
    return {
        "protocol": MODAL_RESULT_TRANSPORT_PROTOCOL,
        "max_stdout_bytes": _integer(
            source["max_stdout_bytes"], "Modal stdout bytes",
            minimum=1, maximum=_MAX_STDIO_BYTES,
        ),
        "max_stderr_bytes": _integer(
            source["max_stderr_bytes"], "Modal stderr bytes",
            minimum=1, maximum=_MAX_STDIO_BYTES,
        ),
        "max_artifacts": _integer(
            source["max_artifacts"], "Modal artifact count",
            minimum=1, maximum=_MAX_ARTIFACTS,
        ),
        "max_artifact_bytes": artifact_bytes,
        "max_total_artifact_bytes": total_bytes,
    }


def _provider_path(value: Any) -> str:
    if not isinstance(value, str) or not value or len(value) > 1_024 or "\x00" in value:
        raise ValueError("Modal asset provider path is invalid")
    if not value.startswith("/") or ".." in value.split("/"):
        raise ValueError("Modal asset provider path must be absolute and cannot contain '..'")
    if value.startswith("//"):
        raise ValueError("Modal asset provider path must have one absolute POSIX root")
    normalized = PurePosixPath(value).as_posix()
    if normalized == "." or normalized == "/" or normalized != value:
        raise ValueError("Modal asset provider path must be a canonical absolute POSIX path")
    return value


def _normalize_asset(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError("Modal asset must be an object")
    verification = value.get("verification")
    fields = {
        "sha256": _ASSET_SHA_FIELDS,
        "revision": _ASSET_REVISION_FIELDS,
    }.get(verification) if isinstance(verification, str) else None
    if fields is None:
        raise ValueError("Modal asset verification must be sha256 or revision")
    source = _object(value, "Modal asset", fields)
    role = source["role"]
    if not isinstance(role, str) or role not in _ASSET_ROLES:
        raise ValueError("Modal asset role is unsupported")
    result: dict[str, Any] = {
        "id": _identifier(source["id"], "Modal asset"),
        "role": role,
        "provider_path": _provider_path(source["provider_path"]),
        "verification": verification,
    }
    if verification == "sha256":
        result.update({
            "sha256": _digest(source["sha256"], "Modal asset"),
            "size_bytes": _integer(
                source["size_bytes"], "Modal asset size", minimum=0,
                maximum=2**63 - 1,
            ),
        })
    else:
        revision = source["revision"]
        if (
            not isinstance(revision, str)
            or not _REVISION.fullmatch(revision)
            or revision.casefold() in _MUTABLE_REVISIONS
        ):
            raise ValueError("Modal asset revision must be a bounded immutable identifier")
        result["revision"] = revision
    return result


def normalize_modal_action_binding(value: Mapping[str, Any]) -> dict[str, Any]:
    """Validate the closed v1 document and return a detached normalized value."""

    source = _object(value, "Modal action binding", _TOP_LEVEL_FIELDS)
    if source["protocol"] != MODAL_ACTION_BINDING_PROTOCOL:
        raise ValueError("Modal action binding protocol is unsupported")
    if source["provider"] != "modal":
        raise ValueError("Modal action binding provider must be modal")
    compute = _normalize_compute(source["compute"])
    transport = _normalize_transport(source["transport"])
    deployment = _object(source["deployment"], "Modal deployment", _DEPLOYMENT_FIELDS)
    assets = source["assets"]
    if not isinstance(assets, list) or len(assets) > _MAX_ASSETS:
        raise ValueError(f"Modal assets must be a list of at most {_MAX_ASSETS} entries")
    normalized_assets = [_normalize_asset(item) for item in assets]
    asset_ids = [item["id"] for item in normalized_assets]
    if len(asset_ids) != len(set(asset_ids)):
        raise ValueError("Modal asset IDs must be unique")
    normalized = {
        "protocol": MODAL_ACTION_BINDING_PROTOCOL,
        "project_id": _identifier(source["project_id"], "Project"),
        "action_id": _identifier(source["action_id"], "Action"),
        "provider": "modal",
        "environment": _identifier(source["environment"], "Modal environment"),
        "application": _identifier(source["application"], "Modal application"),
        "function": _identifier(source["function"], "Modal function"),
        "compute": compute,
        "transport": transport,
        "deployment": {
            "source_manifest_sha256": _digest(
                deployment["source_manifest_sha256"], "Modal deployment source manifest",
            ),
            "resource_plan_sha256": _digest(
                deployment["resource_plan_sha256"], "Modal deployment resource plan",
            ),
        },
        "assets": normalized_assets,
    }
    expected_resource_plan = resource_plan_sha256(compute, transport)
    if normalized["deployment"]["resource_plan_sha256"] != expected_resource_plan:
        raise ValueError("Modal deployment resource plan SHA-256 does not match compute and transport")
    encoded = canonical_json_bytes(normalized)
    if len(encoded) > _MAX_CONFIG_BYTES:
        raise ValueError("Modal action binding exceeds its byte limit")
    return normalized


def _binding_filename(project_id: str, action_id: str) -> str:
    key = f"{project_id}\x00{action_id}".encode("utf-8")
    return f"{hashlib.sha256(key).hexdigest()}.json"


class FileModalActionBindingRepository:
    """Persist immutable bindings beneath one installation's private state root."""

    def __init__(self, state_root: Path) -> None:
        self.state_root = Path(state_root)
        self.root = self.state_root / "modal-actions"
        self._write_lock = threading.Lock()

    def _ensure_root(self) -> None:
        if self.state_root.is_symlink():
            raise ValueError("ModelForge state root cannot be a symbolic link")
        self.state_root.mkdir(mode=0o700, exist_ok=True)
        if self.state_root.is_symlink() or not self.state_root.is_dir():
            raise ValueError("ModelForge state root is invalid")
        if self.root.is_symlink():
            raise ValueError("Modal action binding directory cannot be a symbolic link")
        self.root.mkdir(mode=0o700, exist_ok=True)
        if self.root.is_symlink() or not self.root.is_dir():
            raise ValueError("Modal action binding directory is invalid")
        os.chmod(self.root, 0o700)

    def _path(self, project_id: str, action_id: str) -> Path:
        return self.root / _binding_filename(
            _identifier(project_id, "Project"), _identifier(action_id, "Action"),
        )

    @staticmethod
    def _read_file(path: Path) -> dict[str, Any]:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
        try:
            details = os.fstat(descriptor)
            if not stat.S_ISREG(details.st_mode) or stat.S_IMODE(details.st_mode) != 0o600:
                raise KeyError("Modal action binding is not registered")
            if details.st_size > _MAX_CONFIG_BYTES:
                raise ValueError("Stored Modal action binding exceeds its byte limit")
            chunks = []
            remaining = details.st_size + 1
            while remaining:
                chunk = os.read(descriptor, remaining)
                if not chunk:
                    break
                chunks.append(chunk)
                remaining -= len(chunk)
            payload = b"".join(chunks)
        finally:
            os.close(descriptor)
        if len(payload) > _MAX_CONFIG_BYTES:
            raise ValueError("Stored Modal action binding exceeds its byte limit")
        value = json.loads(payload.decode("utf-8"))
        return normalize_modal_action_binding(value)

    def put(self, binding: Mapping[str, Any]) -> dict[str, Any]:
        normalized = normalize_modal_action_binding(binding)
        payload = (json.dumps(
            normalized, ensure_ascii=False, allow_nan=False, indent=2, sort_keys=True,
        ) + "\n").encode("utf-8")
        with self._write_lock:
            self._ensure_root()
            lock_path = self.root / ".write.lock"
            lock_descriptor = os.open(
                lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600,
            )
            try:
                os.chmod(lock_path, 0o600)
                fcntl.flock(lock_descriptor, fcntl.LOCK_EX)
                destination = self._path(normalized["project_id"], normalized["action_id"])
                if destination.exists() or destination.is_symlink():
                    existing = self.get(normalized["project_id"], normalized["action_id"])
                    if existing == normalized:
                        return existing
                    raise ValueError(
                        "Modal action binding already exists with a different identity"
                    )
                temporary = self.root / f".{destination.stem}.{uuid.uuid4().hex}.tmp"
                try:
                    descriptor = os.open(
                        temporary,
                        os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                        0o600,
                    )
                    try:
                        os.write(descriptor, payload)
                        os.fsync(descriptor)
                    finally:
                        os.close(descriptor)
                    os.replace(temporary, destination)
                    os.chmod(destination, 0o600)
                    directory = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
                    try:
                        os.fsync(directory)
                    finally:
                        os.close(directory)
                finally:
                    temporary.unlink(missing_ok=True)
            finally:
                fcntl.flock(lock_descriptor, fcntl.LOCK_UN)
                os.close(lock_descriptor)
        return normalized

    def get(self, project_id: str, action_id: str) -> dict[str, Any]:
        path = self._path(project_id, action_id)
        try:
            value = self._read_file(path)
        except (FileNotFoundError, NotADirectoryError, OSError) as exc:
            raise KeyError("Modal action binding is not registered") from exc
        if value["project_id"] != project_id or value["action_id"] != action_id:
            raise ValueError("Stored Modal action binding identity does not match its filename")
        return value

    def list(self) -> list[dict[str, Any]]:
        if self.root.is_symlink() or not self.root.is_dir():
            return []
        values = []
        for path in sorted(self.root.glob("[a-f0-9]" * 64 + ".json")):
            try:
                value = self._read_file(path)
                if path.name != _binding_filename(value["project_id"], value["action_id"]):
                    continue
                values.append(value)
            except (KeyError, OSError, UnicodeError, ValueError, json.JSONDecodeError):
                continue
        return values


class ModalActionBindingService:
    """Validate authored action ownership before persisting provider authority."""

    def __init__(
        self,
        repository: FileModalActionBindingRepository,
        project_catalog: AuthoredProjectCatalog,
    ) -> None:
        self.repository = repository
        self.project_catalog = project_catalog

    @staticmethod
    def prepare_file(path: str | Path) -> dict[str, Any]:
        source = Path(path).expanduser()
        if source.is_symlink() or not source.is_file() or source.stat().st_size > _MAX_CONFIG_BYTES:
            raise ValueError("Modal action binding must be a bounded regular JSON file")
        return normalize_modal_action_binding(json.loads(source.read_text(encoding="utf-8")))

    def _authored_action(self, binding: Mapping[str, Any]) -> dict[str, Any]:
        try:
            projection = self.project_catalog.capabilities(str(binding["project_id"]))
        except KeyError as exc:
            raise ValueError("Modal action binding project is not registered") from exc
        capabilities = projection.get("capabilities")
        if not isinstance(capabilities, list):
            raise ValueError("Registered project capability projection is invalid")
        matches = [item for item in capabilities if isinstance(item, Mapping) and (
            item.get("category") == "action"
            and item.get("id") == f"action.{binding['action_id']}"
        )]
        if len(matches) != 1:
            raise ValueError("Modal action binding does not name one authored action")
        action = dict(matches[0])
        if action.get("declared") is not True or action.get("support") != "supported":
            raise ValueError("Modal action binding requires a statically supported authored action")
        return action

    def register_file(self, path: str | Path) -> dict[str, Any]:
        binding = self.prepare_file(path)
        self._authored_action(binding)
        return self.public(self.repository.put(binding))

    def get(self, project_id: str, action_id: str) -> dict[str, Any]:
        binding = self.repository.get(project_id, action_id)
        self._authored_action(binding)
        return binding

    def list(self) -> list[dict[str, Any]]:
        result = []
        for binding in self.repository.list():
            try:
                self._authored_action(binding)
            except ValueError:
                continue
            result.append(self.public(binding))
        return result

    @staticmethod
    def public(binding: Mapping[str, Any]) -> dict[str, Any]:
        normalized = normalize_modal_action_binding(binding)
        return {
            "protocol": MODAL_ACTION_BINDING_PROJECTION_PROTOCOL,
            "project_id": normalized["project_id"],
            "action_id": normalized["action_id"],
            "provider": "modal",
            "environment": normalized["environment"],
            "compute": dict(normalized["compute"]),
            "binding_sha256": modal_action_binding_sha256(normalized),
            "binding_readiness": "configured",
            "provider_readiness": "not_evaluated",
            "billable": True,
            "resource_disclosure": "declared_unreconciled",
        }


__all__ = [
    "FileModalActionBindingRepository", "MODAL_ACTION_BINDING_PROTOCOL",
    "MODAL_ACTION_BINDING_PROJECTION_PROTOCOL", "MODAL_RESULT_TRANSPORT_PROTOCOL",
    "ModalActionBindingService", "canonical_json_bytes", "modal_action_binding_sha256",
    "normalize_modal_action_binding", "resource_plan_sha256",
]
