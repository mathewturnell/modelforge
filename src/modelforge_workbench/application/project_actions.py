"""Bind registered project actions to the shared managed local lifecycle."""

from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from .action_handlers import action_handler
from .artifacts import LocalArtifactCandidate
from .datasets import DatasetService, ResolvedSample
from .managed_execution import (
    BoundManagedAction,
    ManagedActionExecution,
    ManagedActionPlan,
    ManagedLocalActionService,
)
from .runtime_configurations import ProjectRuntimeConfigurationService
from .runs import RunScope


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _json_bytes(value: Mapping[str, Any]) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")


@dataclass(frozen=True)
class RegisteredActionBinder:
    project: Mapping[str, Any]
    private_request: Mapping[str, Any]
    sample: ResolvedSample | None

    def bind(self, allocation) -> BoundManagedAction:
        action = self.project["action"]
        request_path = allocation.evidence_root / "request.json"
        output_path = allocation.evidence_root / "result.json"
        request_path.write_bytes(_json_bytes(self.private_request))
        os.chmod(request_path, 0o600)
        values = {
            "request": str(request_path),
            "output": str(output_path if action["kind"] == "prompt" else allocation.evidence_root),
            "dataset_root": str(self.sample.root if self.sample else ""),
            "artifact": str(self.sample.path if self.sample else ""),
            "device": str(action.get("parameters", {}).get("device", "auto")),
            "max_frames": str(action.get("parameters", {}).get("max_frames", 0)),
            "checkpoint": "",
            "model_cache": "",
        }
        for binding_id, binding in (self.project.get("bindings") or {}).items():
            path = Path(str(binding.get("path") or ""))
            if path:
                if path.is_symlink() or not path.exists():
                    raise ValueError(f"Configured {binding_id} binding is unavailable")
                if path.is_file() and binding.get("sha256") and _sha256(path) != binding["sha256"]:
                    raise OSError(f"Configured {binding_id} bytes changed after registration")
            if binding_id == "checkpoint":
                values["checkpoint"] = str(path)
            elif binding_id == "model":
                values["model_cache"] = str(path)
            placeholder = str(binding.get("placeholder") or "")
            if placeholder:
                values[placeholder] = str(path)
        argv = [action["interpreter"], action["executable"]]
        for argument in action["arguments"]:
            try:
                argv.append(argument.format_map(values))
            except KeyError as exc:
                raise ValueError(f"Project action placeholder is unresolved: {exc}") from exc
        environment = {
            **action.get("environment", {}),
            "PATH": os.environ.get("PATH", ""),
            "LANG": os.environ.get("LANG", "C.UTF-8"),
            "LC_ALL": os.environ.get("LC_ALL", "C.UTF-8"),
            "PYTHONNOUSERSITE": "1",
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTHONSAFEPATH": "1",
            "HF_HUB_OFFLINE": "1",
            "TRANSFORMERS_OFFLINE": "1",
            "MODELFORGE_NETWORK": "disabled",
            "HOME": str(allocation.cache_root),
            "XDG_CACHE_HOME": str(allocation.cache_root / "xdg"),
            "HF_HOME": str(allocation.cache_root / "huggingface"),
            "TORCH_HOME": str(allocation.cache_root / "torch"),
            "TMPDIR": str(allocation.cache_root / "tmp"),
        }
        for directory in ("xdg", "huggingface", "torch", "tmp"):
            (allocation.cache_root / directory).mkdir(mode=0o700)
        for binding_id, binding in (self.project.get("bindings") or {}).items():
            if binding_id == "checkpoint":
                environment["MODELFORGE_MODEL_ARTIFACT_ID"] = str(binding.get("id") or "checkpoint")
                environment["MODELFORGE_MODEL_ARTIFACT_SHA256"] = str(binding.get("sha256") or "")
                environment["MODELFORGE_MODEL_ARTIFACT_PATH"] = str(binding.get("path") or "")
            if binding_id == "model":
                environment["MODELFORGE_MODEL_ID"] = str(binding.get("model_id") or "")
                environment["MODELFORGE_MODEL_REVISION"] = str(binding.get("revision") or "")
                environment["MODELFORGE_MODEL_CACHE"] = str(binding.get("path") or "")
            environment_variable = str(binding.get("environment_variable") or "")
            if environment_variable:
                environment[environment_variable] = str(binding.get("path") or "")
        return BoundManagedAction(tuple(argv), Path(action["working_directory"]), environment)


class ProjectActionService:
    """Prepare real project actions without named-project logic in shared services."""

    def __init__(
        self,
        projects: ProjectRuntimeConfigurationService,
        datasets: DatasetService,
        managed: ManagedLocalActionService,
        *,
        organization_id: str = "local-alpha",
        user_id: str = "local-user",
    ) -> None:
        self.projects = projects
        self.datasets = datasets
        self.managed = managed
        self.organization_id = organization_id
        self.user_id = user_id

    def start(self, project_id: str, payload: Mapping[str, Any], *, on_event=None) -> ManagedActionExecution:
        project = self.projects.get(project_id)
        action = project["action"]
        kind = action["kind"]
        sample = None
        if kind == "inference":
            dataset_id = str(payload.get("dataset_id") or "")
            sample_id = str(payload.get("sample_id") or "")
            sample = self.datasets.resolve(project_id, dataset_id, sample_id)
            checkpoint = (project.get("bindings") or {}).get("checkpoint") or {}
            request = {
                "workflow": "inference",
                "action_id": action["id"],
                "dataset_id": dataset_id,
                "dataset_sample_id": sample_id,
                "dataset_sample_sha256": sample.sha256,
                "dataset_split": sample.split,
                "checkpoint_id": checkpoint.get("id"),
                "checkpoint_sha256": checkpoint.get("sha256"),
                "device": action.get("parameters", {}).get("device", "auto"),
                "max_frames": action.get("parameters", {}).get("max_frames", 0),
            }
            private_request = request
            dataset_ref = f"{dataset_id}:{sample_id}:{sample.sha256}"
            authorized = (str(sample.path), str(checkpoint.get("path") or ""))
        elif kind == "prompt":
            private_request = {
                "protocol": "modelforge.prompt-request/v1",
                "workflow": "prompt",
                "action_id": action["id"],
                "messages": payload.get("messages"),
                "generation": payload.get("generation") or {},
            }
            validated = action_handler("prompt").validate_request(private_request).detached()
            request_digest = hashlib.sha256(_json_bytes(validated)).hexdigest()
            model = (project.get("bindings") or {}).get("model") or {}
            request = {
                "workflow": "prompt",
                "action_id": action["id"],
                "prompt_request_sha256": request_digest,
                "message_count": len(validated["messages"]),
                "generation": validated.get("generation", {}),
                "model_id": model.get("model_id"),
                "model_revision": model.get("revision"),
            }
            private_request = validated
            dataset_ref = ""
            authorized = (str(model.get("path") or ""),)
        else:  # pragma: no cover - registration validator closes this set.
            raise ValueError("Registered action kind is unsupported")
        configuration = self._execution_identity(project)
        plan = ManagedActionPlan(
            RunScope(self.organization_id, project["id"]), self.user_id, kind,
            action["display_name"], request, action["result_protocol"], dataset_ref,
            tuple(item for item in authorized if item), configuration,
        )
        return self.managed.start_plan(
            plan, RegisteredActionBinder(project, private_request, sample), on_event=on_event,
        )

    def finish(self, execution: ManagedActionExecution) -> dict:
        return self.managed.finish(
            execution,
            result_loader=lambda allocation: self._load_result(
                allocation, expected_request=execution.intent.request,
            ),
            artifact_loader=self._load_artifacts,
            retain_process_log=True,
        )

    @staticmethod
    def _load_result(allocation, *, expected_request=None) -> Mapping[str, Any]:
        path = allocation.evidence_root / "result.json"
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 2 * 1024 * 1024:
            raise ValueError("Managed action did not produce a bounded regular result")
        value = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(value, Mapping):
            raise ValueError("Managed action result must be an object")
        if expected_request and expected_request.get("workflow") == "inference":
            input_identity = value.get("input_artifact") or {}
            model_identity = value.get("model_artifact") or {}
            if input_identity.get("sha256") != expected_request.get("dataset_sample_sha256"):
                raise OSError("Inference result input identity differs from the durable request")
            if model_identity.get("sha256") != expected_request.get("checkpoint_sha256"):
                raise OSError("Inference result checkpoint identity differs from the durable request")
        return value

    @staticmethod
    def _execution_identity(project: Mapping[str, Any]) -> dict[str, Any]:
        action = project["action"]
        interpreter = Path(action["interpreter"])
        executable = Path(action["executable"])
        registration_sha = hashlib.sha256(_json_bytes(project)).hexdigest()
        action_sha = hashlib.sha256(_json_bytes(action)).hexdigest()
        interpreter_sha = _sha256(interpreter.resolve())
        executable_sha = _sha256(executable)
        revisions = {
            key: value["revision"] for key, value in (project.get("bindings") or {}).items()
            if value.get("revision")
        }
        environment_sha = hashlib.sha256(_json_bytes({
            "policy": "modelforge.trusted-local-offline/v1",
            "declared": action.get("environment") or {},
            "interpreter_sha256": interpreter_sha,
            "executable_sha256": executable_sha,
        })).hexdigest()
        return {
            "runtime_configuration_sha256": registration_sha,
            "action_sha256": action_sha,
            "interpreter_sha256": interpreter_sha,
            "executable_sha256": executable_sha,
            "environment_sha256": environment_sha,
            "source_revisions": revisions,
        }

    @staticmethod
    def _candidate(path: Path, kind: str, content_type: str, **metadata) -> LocalArtifactCandidate:
        if path.is_symlink() or not path.is_file():
            raise ValueError("Managed result artifact must be a regular file")
        return LocalArtifactCandidate(
            path.name, kind, path, content_type, path.stat().st_size, _sha256(path), metadata,
        )

    def _load_artifacts(self, allocation, result: Mapping[str, Any]):
        root = allocation.evidence_root
        artifacts = [self._candidate(root / "result.json", "result-envelope", "application/json")]
        protocol = result.get("protocol", result.get("format"))
        if protocol == "modelforge.prompt-result/v1":
            assistant = next(
                item["content"] for item in result["messages"]
                if item.get("role") == "assistant" and isinstance(item.get("content"), str)
            )
            text_path = root / "assistant.txt"
            text_path.write_text(assistant + "\n", encoding="utf-8")
            artifacts.append(self._candidate(text_path, "assistant-text", "text/plain"))
            return artifacts
        seen = {"result.json"}
        for item in result.get("results") or ():
            for path_field, digest_field, kind, fallback_type in (
                ("path", "sha256", str(item.get("kind") or "result"), str(item.get("mime_type") or "application/octet-stream")),
                ("manifest_path", "manifest_sha256", "result-manifest", "application/json"),
            ):
                name = str(item.get(path_field) or "")
                if not name or name in seen:
                    continue
                if Path(name).name != name:
                    raise ValueError("Managed result artifact path must be a filename")
                path = root / name
                candidate = self._candidate(path, kind, fallback_type)
                if item.get(digest_field) and candidate.sha256 != item[digest_field]:
                    raise OSError("Managed result artifact digest does not match its envelope")
                artifacts.append(candidate)
                seen.add(name)
        return artifacts


__all__ = ["ProjectActionService", "RegisteredActionBinder"]
