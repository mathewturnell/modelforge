"""Bind registered project actions to the shared managed local lifecycle."""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import threading
import uuid
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
from .execution import ProviderFunctionInvocation
from .modal_bindings import (
    ModalActionBindingService,
    modal_action_binding_sha256,
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
    validation_sample: ResolvedSample | None = None

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
        if action["kind"] == "training":
            if self.sample is None or self.validation_sample is None:
                raise ValueError("Training requires resolved train and validation inputs")
            inputs = allocation.work_root / "training-inputs"
            inputs.mkdir(mode=0o700)
            for key, sample in (("training_sample", self.sample), ("validation_sample", self.validation_sample)):
                if sample.path.is_symlink() or _sha256(sample.path) != sample.sha256:
                    raise OSError("Training input changed after resolution")
                destination = inputs / (key + sample.path.suffix)
                shutil.copyfile(sample.path, destination)
                destination.chmod(0o400)
                if _sha256(destination) != sample.sha256:
                    raise OSError("Training input changed while preparing the run")
                values[key] = str(destination)
            values["dataset_root"] = str(inputs)
            values["artifact"] = values["training_sample"]
            for key in ("epochs", "max_batches", "learning_rate", "seed"):
                values[key] = str(self.private_request[key])
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


@dataclass(frozen=True)
class RegisteredModalActionBinder:
    """Bind only one owner-authorized deployed function after durable allocation."""

    binding: Mapping[str, Any]
    private_request: Mapping[str, Any]
    action_kind: str

    def bind(self, allocation) -> BoundManagedAction:
        request_path = allocation.evidence_root / "request.json"
        payload_bytes = _json_bytes(self.private_request)
        if request_path.exists():
            if request_path.is_symlink() or request_path.read_bytes() != payload_bytes:
                raise OSError("Recovered provider request differs from durable evidence")
        else:
            request_path.write_bytes(payload_bytes)
            os.chmod(request_path, 0o600)
        binding_sha = modal_action_binding_sha256(self.binding)
        return BoundManagedAction(
            (), None, {},
            ProviderFunctionInvocation(
                provider="modal",
                application=str(self.binding["application"]),
                function=str(self.binding["function"]),
                environment_name=str(self.binding["environment"]),
                payload={
                    "protocol": "modelforge.modal-project-action-request/v1",
                    "run_id": allocation.execution_id,
                    "binding_sha256": binding_sha,
                    "project_id": self.binding["project_id"],
                    "action_id": self.binding["action_id"],
                    "action_kind": self.action_kind,
                    "request": dict(self.private_request),
                    "assets": [dict(item) for item in self.binding["assets"]],
                },
            ),
        )


class ProjectActionService:
    """Prepare real project actions without named-project logic in shared services."""

    def __init__(
        self,
        projects: ProjectRuntimeConfigurationService,
        datasets: DatasetService,
        managed: ManagedLocalActionService,
        modal_bindings: ModalActionBindingService | None = None,
        *,
        organization_id: str = "local-alpha",
        user_id: str = "local-user",
    ) -> None:
        self.projects = projects
        self.datasets = datasets
        self.managed = managed
        self.modal_bindings = modal_bindings
        self.organization_id = organization_id
        self.user_id = user_id
        self._launch_lock = threading.RLock()

    def start(
        self, project_id: str, payload: Mapping[str, Any], *, on_event=None,
    ) -> ManagedActionExecution | dict[str, Any]:
        project = self.projects.get(project_id)
        action = project["action"]
        kind = action["kind"]
        execution_request = payload.get("execution") if isinstance(payload, Mapping) else None
        managed_envelope = payload.get("protocol") == "modelforge.managed-action-request/v1"
        if managed_envelope:
            if not isinstance(execution_request, Mapping) or not isinstance(payload.get("input"), Mapping):
                raise ValueError("Managed action request requires execution and input objects")
            action_input = dict(payload["input"])
            target = str(execution_request.get("target") or "").casefold()
        else:
            action_input = dict(payload)
            target = "local"
        sample = None
        validation_sample = None
        if kind == "inference":
            dataset_id = str(action_input.get("dataset_id") or "")
            sample_id = str(action_input.get("sample_id") or "")
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
                "adaptation_sha256": (project.get("bindings", {}).get("adaptation") or {}).get("sha256"),
                "device": action.get("parameters", {}).get("device", "auto"),
                "max_frames": action.get("parameters", {}).get("max_frames", 0),
            }
            private_request = request
            dataset_ref = f"{dataset_id}:{sample_id}:{sample.sha256}"
            authorized = (str(sample.path), str(checkpoint.get("path") or ""))
        elif kind == "training":
            if set(action_input) - {"dataset_id", "sample_id", "validation_sample_id"}:
                raise ValueError("Training input accepts only declared train and validation selections")
            dataset_id = str(action_input.get("dataset_id") or "")
            sample = self.datasets.resolve(project_id, dataset_id, str(action_input.get("sample_id") or ""))
            validation_sample = self.datasets.resolve(project_id, dataset_id, str(action_input.get("validation_sample_id") or ""))
            if sample.split != "train" or validation_sample.split not in {"val", "validation"}:
                raise ValueError("Training requires explicit train and validation splits; held-out data is forbidden")
            if sample.sha256 == validation_sample.sha256 or sample.path == validation_sample.path:
                raise ValueError("Training and validation inputs must be disjoint")
            from .training_telemetry import validate_training_parameters
            parameters = validate_training_parameters(action.get("parameters") or {})
            checkpoint = (project.get("bindings") or {}).get("checkpoint") or {}
            request = {
                "protocol": "modelforge.training-request/v1", "workflow": "training",
                "action_id": action["id"], "dataset_id": dataset_id,
                "dataset_sample_id": sample.sample_id, "dataset_sample_sha256": sample.sha256,
                "dataset_split": "train", "validation_sample_id": validation_sample.sample_id,
                "validation_sample_sha256": validation_sample.sha256, "evaluation_split": "validation",
                "checkpoint_id": checkpoint.get("id"), "checkpoint_sha256": checkpoint.get("sha256"),
                **parameters,
            }
            private_request = request
            dataset_ref = f"{dataset_id}:{sample.sample_id}:{sample.sha256}"
            authorized = (str(sample.path), str(validation_sample.path), str(checkpoint.get("path") or ""))
        elif kind == "prompt":
            private_request = {
                "protocol": "modelforge.prompt-request/v1",
                "workflow": "prompt",
                "action_id": action["id"],
                "messages": action_input.get("messages"),
                "generation": action_input.get("generation") or {},
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
        if target == "local":
            if managed_envelope and (
                execution_request.get("billable_confirmed") not in (None, False)
                or execution_request.get("binding_sha256") not in (None, "")
            ):
                raise ValueError("Local execution cannot carry Modal authority or confirmation")
            if not project.get("local_enabled", True):
                raise ValueError("Local execution is not configured for this project action")
            configuration = self._execution_identity(project)
            plan = ManagedActionPlan(
                RunScope(self.organization_id, project["id"]), self.user_id, kind,
                action["display_name"], request, action["result_protocol"], dataset_ref,
                tuple(item for item in authorized if item), configuration,
            )
            return self.managed.start_plan(
                plan, RegisteredActionBinder(project, private_request, sample, validation_sample), on_event=on_event,
            )
        if target != "modal" or not managed_envelope:
            raise ValueError("Managed action execution target is unsupported")
        if validation_sample is not None:
            if self.modal_bindings is None:
                raise ValueError("Modal execution is not configured")
            self._validate_modal_assets(project, validation_sample, self.modal_bindings.get(project["id"], action["id"]))
        return self._start_modal(
            project, request, private_request, dataset_ref, sample,
            execution_request, on_event=on_event,
        )

    def _start_modal(
        self, project, request, private_request, dataset_ref, sample, execution_request,
        *, on_event=None,
    ) -> ManagedActionExecution | dict[str, Any]:
        if self.modal_bindings is None:
            raise ValueError("Modal execution is not configured")
        if execution_request.get("billable_confirmed") is not True:
            raise ValueError("Modal execution requires explicit billable-action confirmation")
        try:
            idempotency_key = str(uuid.UUID(str(execution_request.get("idempotency_key") or "")))
        except ValueError as exc:
            raise ValueError("Managed action idempotency key must be a UUID") from exc
        binding = self.modal_bindings.get(project["id"], project["action"]["id"])
        binding_sha = modal_action_binding_sha256(binding)
        if execution_request.get("binding_sha256") != binding_sha:
            raise ValueError("Modal confirmation is stale; review the current binding and confirm again")
        self._validate_modal_assets(project, sample, binding)
        request_sha = hashlib.sha256(_json_bytes({
            "project_id": project["id"],
            "action_id": project["action"]["id"],
            "binding_sha256": binding_sha,
            "input": private_request,
        })).hexdigest()
        durable_request = {
            **request,
            "idempotency_key": idempotency_key,
            "managed_request_sha256": request_sha,
        }
        public_binding = self.modal_bindings.public(binding)
        plan = ManagedActionPlan(
            RunScope(self.organization_id, project["id"]), self.user_id,
            project["action"]["kind"], project["action"]["display_name"],
            durable_request, project["action"]["result_protocol"], dataset_ref,
            (), {
                "modal": public_binding,
                "idempotency_key": idempotency_key,
                "managed_request_sha256": request_sha,
            },
            "modal", binding["compute"]["target"], True,
            binding["compute"]["timeout_seconds"],
        )
        run_id = hashlib.sha256(
            f"{self.organization_id}\0{project['id']}\0{project['action']['id']}\0{idempotency_key}".encode(),
        ).hexdigest()[:32]
        with self._launch_lock:
            try:
                existing = self.managed.runs.get(plan.scope, run_id)
            except KeyError:
                existing = None
            if existing is not None:
                if existing.get("request", {}).get("managed_request_sha256") != request_sha:
                    raise ValueError("Managed action idempotency key was reused for different input")
                return existing
            try:
                return self.managed.start_plan(
                    plan,
                    RegisteredModalActionBinder(binding, private_request, project["action"]["kind"]),
                    on_event=on_event,
                    run_id=run_id,
                )
            except FileExistsError:
                try:
                    existing = self.managed.runs.get(plan.scope, run_id)
                except KeyError as exc:
                    raise RuntimeError("Managed action allocation is already in progress") from exc
                if existing.get("request", {}).get("managed_request_sha256") != request_sha:
                    raise ValueError("Managed action idempotency key was reused for different input")
                return existing

    @staticmethod
    def _validate_modal_assets(project, sample, binding) -> None:
        assets = list(binding.get("assets") or ())
        if sample is not None and not any(
            item.get("verification") == "sha256"
            and item.get("sha256") == sample.sha256
            and item.get("size_bytes") == sample.size_bytes
            and item.get("role") in {"input", "dataset"}
            for item in assets
        ):
            raise ValueError("Selected input is not present in the owner-authorized Modal assets")
        configured = project.get("bindings") or {}
        checkpoint = configured.get("checkpoint") or {}
        if checkpoint.get("sha256") and not any(
            item.get("role") == "checkpoint"
            and item.get("sha256") == checkpoint.get("sha256")
            and item.get("size_bytes") == checkpoint.get("size_bytes")
            for item in assets
        ):
            raise ValueError("Configured checkpoint differs from the owner-authorized Modal asset")
        model = configured.get("model") or {}
        if model.get("revision") and not any(
            item.get("role") == "model"
            and item.get("verification") == "revision"
            and item.get("revision") == model.get("revision")
            for item in assets
        ):
            raise ValueError("Configured model differs from the owner-authorized Modal asset")

    def recover_modal(self, project_id: str, run_id: str, *, on_event=None) -> ManagedActionExecution:
        project = self.projects.get(project_id)
        action = project["action"]
        scope = RunScope(self.organization_id, project_id)
        durable = self.managed.runs.get(scope, run_id, include_artifacts=False)
        if durable.get("provider") != "modal":
            raise ValueError("Only a Modal project action can be recovered")
        binding = self.modal_bindings.get(project_id, action["id"]) if self.modal_bindings else None
        if binding is None:
            raise ValueError("Modal execution is not configured")
        binding_sha = modal_action_binding_sha256(binding)
        if durable.get("configuration", {}).get("modal", {}).get("binding_sha256") != binding_sha:
            raise ValueError("Modal recovery binding differs from the durable request")
        request_path = self.managed.state_root / "runs" / "modal" / run_id / "evidence" / "request.json"
        if request_path.is_symlink() or not request_path.is_file() or request_path.stat().st_size > 128 * 1024:
            raise ValueError("Durable provider request evidence is unavailable")
        private_request = json.loads(request_path.read_text(encoding="utf-8"))
        configuration = durable.get("configuration", {})
        plan = ManagedActionPlan(
            scope, self.user_id, action["kind"], action["display_name"],
            durable["request"], action["result_protocol"], durable.get("dataset_ref") or "",
            (), configuration, "modal", durable["compute_target"], True,
            configuration.get("deadline_seconds") or binding["compute"]["timeout_seconds"],
        )
        return self.managed.recover_plan(
            plan, RegisteredModalActionBinder(binding, private_request, action["kind"]),
            run_id, on_event=on_event,
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
            if expected_request.get("dataset_sample_sha256") and input_identity.get("sha256") != expected_request.get("dataset_sample_sha256"):
                raise OSError("Inference result input identity differs from the durable request")
            if expected_request.get("checkpoint_sha256") and model_identity.get("sha256") != expected_request.get("checkpoint_sha256"):
                raise OSError("Inference result checkpoint identity differs from the durable request")
            adaptation_identity = value.get("adaptation_artifact") or {}
            if adaptation_identity.get("sha256") != expected_request.get("adaptation_sha256"):
                raise OSError("Inference adaptation identity differs from the durable request")
        if expected_request and expected_request.get("workflow") == "training":
            for field in ("dataset_sample_sha256", "validation_sample_sha256", "checkpoint_sha256"):
                if value.get("provenance", {}).get(field) != expected_request.get(field):
                    raise OSError("Training result provenance differs from the durable request")
        return value

    def training_telemetry(self, project_id: str, run_id: str) -> dict:
        """Resolve telemetry only after checking project-scoped durable run ownership."""
        from .training_telemetry import read_training_telemetry
        run = self.managed.runs.get(RunScope(self.organization_id, project_id), run_id)
        if run.get("configuration", {}).get("action_kind") != "training":
            return {"status": "unavailable", "events": [], "reason": "This is not a training run"}
        provider = run.get("provider")
        if provider not in {"local", "modal"}:
            raise ValueError("Training telemetry provider is unsupported")
        root = self.managed.state_root / "runs" / provider / run_id / "evidence"
        if root.is_symlink() or any(p.is_symlink() for p in root.parents if p != self.managed.state_root.parent):
            raise ValueError("Training evidence directory cannot be symlinked")
        path = root / "telemetry.jsonl"
        if run.get("status") == "completed":
            artifact = next((item for item in run.get("artifacts", ()) if item.get("kind") == "training-telemetry"), None)
            if artifact is None or path.is_symlink() or not path.is_file() or _sha256(path) != artifact.get("sha256"):
                raise OSError("Completed training telemetry differs from its registered identity")
        return read_training_telemetry(path, complete=run.get("status") == "completed")

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
        if protocol == "modelforge.training-result/v1":
            from .training_telemetry import read_training_telemetry
            telemetry = read_training_telemetry(root / "telemetry.jsonl", complete=True)
            if telemetry["status"] != "available":
                raise ValueError("Training success requires scientific telemetry")
            telemetry_path = root / "telemetry.jsonl"
            if _sha256(telemetry_path) != result["telemetry"]["sha256"]:
                raise OSError("Training telemetry digest does not match its envelope")
            artifacts.append(self._candidate(telemetry_path, "training-telemetry", "application/x-ndjson"))
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


__all__ = ["ProjectActionService", "RegisteredActionBinder", "RegisteredModalActionBinder"]
