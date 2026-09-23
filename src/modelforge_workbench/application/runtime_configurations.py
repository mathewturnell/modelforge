"""Owner-only runtime configuration for local ML project actions.

This is deliberately not the authored Project Service from Decision 0099. It
stores machine-local execution paths and exposes only a redacted workbench
projection. Static authored capabilities remain owned by the manifest contract.
"""

from __future__ import annotations

import json
import os
import re
import stat
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping


_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,79}$")
_SHA256 = re.compile(r"^[a-f0-9]{64}$")
_MAX_CONFIG_BYTES = 256 * 1024
_PLACEHOLDERS = {
    "request", "output", "dataset_root", "artifact", "checkpoint", "device",
    "max_frames", "model_cache", "training_sample", "validation_sample",
    "epochs", "max_batches", "learning_rate", "seed",
}
_ENVIRONMENT_NAME = re.compile(r"^[A-Z][A-Z0-9_]{0,99}$")
_HOST_ENVIRONMENT = frozenset({
    "HOME", "PATH", "LANG", "LC_ALL", "TMPDIR", "PYTHONPATH",
    "PYTHONPYCACHEPREFIX", "XDG_CACHE_HOME", "HF_HOME", "TORCH_HOME",
    "MODELFORGE_RUN_ID", "MODELFORGE_WORK_ROOT", "MODELFORGE_EVIDENCE_ROOT",
    "MODELFORGE_CACHE_ROOT", "MODELFORGE_NETWORK",
})


def _object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{label} must be an object")
    return {str(key): item for key, item in value.items()}


def _identity(value: Any, label: str) -> str:
    result = str(value or "").strip().casefold()
    if not _ID.fullmatch(result):
        raise ValueError(f"{label} identity is invalid")
    return result


def _absolute_regular(value: Any, label: str, *, preserve_invocation: bool = False) -> str:
    path = Path(str(value or "")).expanduser()
    if not path.is_absolute() or not path.is_file():
        raise ValueError(f"{label} must be an existing absolute regular file")
    if preserve_invocation:
        if not os.access(path, os.X_OK):
            raise ValueError(f"{label} must be executable")
        # Python virtual environments depend on the symlink path used to invoke
        # their interpreter. Resolving it would silently select the base Python.
        return os.path.abspath(path)
    return str(path.resolve())


def _absolute_directory(value: Any, label: str) -> str:
    path = Path(str(value or "")).expanduser()
    if not path.is_absolute() or path.is_symlink() or not path.is_dir():
        raise ValueError(f"{label} must be an existing absolute directory")
    return str(path.resolve())


def _digest(value: Any, label: str) -> str:
    result = str(value or "").strip().casefold()
    if not _SHA256.fullmatch(result):
        raise ValueError(f"{label} SHA-256 is invalid")
    return result


def _normalize_project(value: Mapping[str, Any]) -> dict[str, Any]:
    source = _object(value, "Project registration")
    if source.get("protocol") != "modelforge.local-runtime-configuration/v1":
        raise ValueError("Project runtime configuration protocol is unsupported")
    project_id = _identity(source.get("id"), "Project")
    project_repository = _absolute_directory(
        source.get("project_repository"), "Authored project repository",
    )
    name = str(source.get("name") or "").strip()
    if not name or len(name) > 160:
        raise ValueError("Project name is required and bounded")
    action = _object(source.get("action"), "Project action")
    kind = str(action.get("kind") or "").strip().casefold()
    interface = str(action.get("interface") or "").strip()
    if (kind, interface) not in {
        ("inference", "inference_process"), ("prompt", "prompt_process"),
        ("training", "training_process"),
    }:
        raise ValueError("Supported actions are inference_process, prompt_process, or training_process")
    arguments = action.get("arguments")
    if not isinstance(arguments, list) or len(arguments) > 32 or not all(
        isinstance(item, str) and len(item) <= 4096 for item in arguments
    ):
        raise ValueError("Project action arguments must be a bounded string list")
    for argument in arguments:
        for placeholder in re.findall(r"\{([a-z_]+)\}", argument):
            if placeholder not in _PLACEHOLDERS:
                raise ValueError(f"Project action placeholder is unsupported: {placeholder}")
    environment = _object(action.get("environment") or {}, "Project action environment")
    if len(environment) > 32 or any(
        not isinstance(item, str) or len(str(key)) > 100 or len(item) > 4096
        for key, item in environment.items()
    ):
        raise ValueError("Project action environment is invalid or too large")
    for prohibited in ("MODELFORGE_RUN_ID", "MODELFORGE_WORK_ROOT", "MODELFORGE_EVIDENCE_ROOT"):
        if prohibited in environment:
            raise ValueError(f"Project action environment cannot set {prohibited}")
    result_protocol = str(action.get("result_protocol") or "").strip()
    expected_protocol = {
        "inference": "modelforge.inference-result/v1",
        "prompt": "modelforge.prompt-result/v1",
        "training": "modelforge.training-result/v1",
    }[kind]
    if result_protocol != expected_protocol:
        raise ValueError(f"{kind.title()} result protocol must be {expected_protocol}")
    local_enabled = source.get("local_enabled", True)
    if not isinstance(local_enabled, bool):
        raise ValueError("Project local execution flag must be boolean")
    normalized_action = {
        "id": _identity(action.get("id"), "Action"),
        "kind": kind,
        "interface": interface,
        "display_name": str(action.get("display_name") or name)[:160],
        "result_protocol": result_protocol,
        "interpreter": (
            _absolute_regular(action.get("interpreter"), "Project interpreter", preserve_invocation=True)
            if local_enabled else ""
        ),
        "executable": (
            _absolute_regular(action.get("executable"), "Project executable")
            if local_enabled else ""
        ),
        "working_directory": (
            _absolute_directory(action.get("working_directory"), "Project working directory")
            if local_enabled else ""
        ),
        "arguments": list(arguments),
        "environment": environment,
        "parameters": _object(action.get("parameters") or {}, "Project action parameters"),
    }
    if kind == "training":
        from .training_telemetry import validate_training_parameters
        normalized_action["parameters"] = validate_training_parameters(normalized_action["parameters"])
    result: dict[str, Any] = {
        "protocol": "modelforge.local-runtime-configuration/v1",
        "id": project_id,
        "project_repository": project_repository,
        "name": name,
        "description": str(source.get("description") or "")[:500],
        "support_level": str(source.get("support_level") or "experimental"),
        "local_enabled": local_enabled,
        "action": normalized_action,
        "bindings": _object(source.get("bindings") or {}, "Project bindings"),
    }
    dataset = source.get("dataset")
    if dataset is not None:
        dataset = _object(dataset, "Project dataset")
        samples = dataset.get("samples")
        if not isinstance(samples, list) or not 1 <= len(samples) <= 500:
            raise ValueError("Project dataset must declare from 1 to 500 samples")
        normalized_samples = []
        for item in samples:
            item = _object(item, "Dataset sample")
            relative = Path(str(item.get("path") or ""))
            if relative.is_absolute() or ".." in relative.parts or not relative.parts:
                raise ValueError("Dataset sample path must be relative and contained")
            size = item.get("size_bytes")
            if isinstance(size, bool) or not isinstance(size, int) or size < 0:
                raise ValueError("Dataset sample size is invalid")
            normalized_samples.append({
                "id": _identity(item.get("id"), "Sample"),
                "name": str(item.get("name") or relative.name)[:160],
                "path": relative.as_posix(),
                "split": str(item.get("split") or "unspecified")[:40],
                "content_type": str(item.get("content_type") or "application/octet-stream")[:100],
                "size_bytes": size,
                "sha256": _digest(item.get("sha256"), "Dataset sample"),
            })
        result["dataset"] = {
            "id": _identity(dataset.get("id"), "Dataset"),
            "name": str(dataset.get("name") or "Dataset")[:160],
            "root": _absolute_directory(dataset.get("root"), "Dataset root"),
            "samples": normalized_samples,
        }
    if kind == "training" and "dataset" not in result:
        raise ValueError("Registered training requires explicit train and validation samples")
    bindings = result["bindings"]
    for binding_id, binding in bindings.items():
        normalized_binding = _object(binding, f"{binding_id} binding")
        if "path" in normalized_binding:
            path = Path(str(normalized_binding["path"])).expanduser()
            if not path.is_absolute() or path.is_symlink() or not path.exists():
                raise ValueError(f"{binding_id} binding path is unavailable")
            normalized_binding["path"] = str(path.resolve())
        if "sha256" in normalized_binding:
            normalized_binding["sha256"] = _digest(
                normalized_binding["sha256"], f"{binding_id} binding",
            )
        environment_variable = normalized_binding.get("environment_variable")
        if environment_variable is not None and not _ENVIRONMENT_NAME.fullmatch(
            str(environment_variable),
        ):
            raise ValueError(f"{binding_id} binding environment variable is invalid")
        if environment_variable in _HOST_ENVIRONMENT:
            raise ValueError(f"{binding_id} binding cannot replace host environment policy")
        placeholder = normalized_binding.get("placeholder")
        if placeholder is not None and str(placeholder) not in _PLACEHOLDERS:
            raise ValueError(f"{binding_id} binding placeholder is unsupported")
        if "revision" in normalized_binding:
            revision = str(normalized_binding["revision"] or "").strip()
            if not revision or len(revision) > 200:
                raise ValueError(f"{binding_id} binding revision is invalid")
            normalized_binding["revision"] = revision
        bindings[binding_id] = normalized_binding
    json.dumps(result, allow_nan=False)
    return result


@dataclass(frozen=True)
class ProjectRuntimeConfiguration:
    value: Mapping[str, Any]

    @property
    def id(self) -> str:
        return str(self.value["id"])


class FileProjectRuntimeConfigurationRepository:
    """Owner-only runtime JSON below the installation state root.

    Construction and reads never create the configured root. A write creates
    only the narrow owner-only runtime-configuration directory.
    """

    def __init__(self, state_root: Path) -> None:
        self.root = state_root / "runtime-projects"
        self._write_lock = threading.Lock()

    def put(self, project: Mapping[str, Any]) -> dict[str, Any]:
        normalized = _normalize_project(project)
        with self._write_lock:
            self.root.mkdir(mode=0o700, exist_ok=True)
            destination = self.root / f"{normalized['id']}.json"
            if destination.exists() or destination.is_symlink():
                existing = self.get(normalized["id"])
                if existing == normalized:
                    return existing
                raise ValueError(
                    f"Project runtime configuration '{normalized['id']}' already exists "
                    "with a different identity"
                )
            payload = (json.dumps(normalized, indent=2, sort_keys=True) + "\n").encode()
            temporary = self.root / f".{normalized['id']}.{os.getpid()}.tmp"
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
                return normalized
            except Exception:
                temporary.unlink(missing_ok=True)
                raise

    def get(self, project_id: str) -> dict[str, Any]:
        project_id = _identity(project_id, "Project")
        path = self.root / f"{project_id}.json"
        if path.is_symlink() or not path.is_file() or stat.S_IMODE(path.stat().st_mode) != 0o600:
            raise KeyError("Project is not registered")
        value = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(value, dict) or value.get("protocol") != "modelforge.local-runtime-configuration/v1":
            raise ValueError("Stored project runtime configuration is invalid")
        if value.get("id") != project_id:
            raise ValueError("Stored project identity does not match its filename")
        return value

    def list(self) -> list[dict[str, Any]]:
        if not self.root.is_dir():
            return []
        values = []
        for path in sorted(self.root.glob("*.json")):
            try:
                values.append(self.get(path.stem))
            except (KeyError, OSError, ValueError, json.JSONDecodeError):
                continue
        return values


class ProjectRuntimeConfigurationService:
    """Own machine-local action configuration and its redacted UI projection."""

    def __init__(self, repository: FileProjectRuntimeConfigurationRepository) -> None:
        self.repository = repository

    def register_file(self, path: str | Path) -> dict[str, Any]:
        return self.public(self.repository.put(self.prepare_file(path)))

    @staticmethod
    def prepare_file(path: str | Path) -> dict[str, Any]:
        source = Path(path).expanduser()
        if source.is_symlink() or not source.is_file() or source.stat().st_size > _MAX_CONFIG_BYTES:
            raise ValueError("Project runtime configuration must be a bounded regular JSON file")
        value = json.loads(source.read_text(encoding="utf-8"))
        return _normalize_project(value)

    def get(self, project_id: str) -> dict[str, Any]:
        return self.repository.get(project_id)

    def list(self) -> list[dict[str, Any]]:
        return [self.public(item) for item in self.repository.list()]

    @staticmethod
    def public(project: Mapping[str, Any]) -> dict[str, Any]:
        action = project["action"]
        dataset = project.get("dataset")
        bindings = project.get("bindings") or {}
        local_enabled = bool(project.get("local_enabled", True))
        readiness = "ready" if local_enabled else "unavailable"
        reasons = [] if local_enabled else ["Local execution is not configured"]
        if local_enabled:
            for label, value in (
                ("interpreter", action["interpreter"]),
                ("executable", action["executable"]),
                ("working directory", action["working_directory"]),
            ):
                if not Path(value).exists():
                    readiness = "unavailable"
                    reasons.append(f"Configured {label} is unavailable")
        return {
            "id": project["id"],
            "name": project["name"],
            "description": project.get("description", ""),
            "support_level": project.get("support_level", "experimental"),
            "capabilities": [f"action.{action['kind']}"] + (["dataset.default"] if dataset else []),
            "action": {
                "id": action["id"], "kind": action["kind"],
                "display_name": action["display_name"], "interface": action["interface"],
            },
            "runtime_readiness": readiness,
            "readiness_reasons": reasons,
            "local_enabled": local_enabled,
            "dataset": None if not dataset else {
                "id": dataset["id"], "name": dataset["name"],
                "sample_count": len(dataset["samples"]),
            },
            "bindings": [
                {"id": key, "name": str(value.get("name") or key),
                 "sha256": value.get("sha256"), "revision": value.get("revision")}
                for key, value in sorted(bindings.items())
            ],
        }


__all__ = [
    "FileProjectRuntimeConfigurationRepository",
    "ProjectRuntimeConfiguration",
    "ProjectRuntimeConfigurationService",
]
