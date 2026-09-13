"""Bind registered project actions to the shared managed local lifecycle."""

from __future__ import annotations

import hashlib
import json
import os
import threading
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from .action_handlers import action_handler
from .annotations import AnnotationService
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
    action: Mapping[str, Any]
    private_request: Mapping[str, Any]
    sample: ResolvedSample | None
    dataset_root: Path | None = None
    effective_parameters: Mapping[str, Any] | None = None

    def bind(self, allocation) -> BoundManagedAction:
        action = self.action
        request_path = allocation.evidence_root / "request.json"
        output_path = allocation.evidence_root / "result.json"
        request_path.write_bytes(_json_bytes(self.private_request))
        os.chmod(request_path, 0o600)
        parameters = dict(action.get("parameters") or {})
        parameters.update(dict(self.effective_parameters or {}))
        values = {
            "request": str(request_path),
            "output": str(output_path if action["kind"] == "prompt" else allocation.evidence_root),
            "dataset_root": str(self.sample.root if self.sample else self.dataset_root or ""),
            "artifact": str(self.sample.path if self.sample else ""),
            "device": str(parameters.get("device", "auto")),
            "max_frames": str(parameters.get("max_frames", 0)),
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
        annotations: AnnotationService | None = None,
        *,
        organization_id: str = "local-alpha",
        user_id: str = "local-user",
    ) -> None:
        self.projects = projects
        self.datasets = datasets
        self.managed = managed
        self.modal_bindings = modal_bindings
        self.annotations = annotations
        self.organization_id = organization_id
        self.user_id = user_id
        self._launch_lock = threading.RLock()

    def start(
        self, project_id: str, payload: Mapping[str, Any], *, action_id: str | None = None,
        on_event=None,
    ) -> ManagedActionExecution | dict[str, Any]:
        project = self.projects.get(project_id)
        action = self._action(project, action_id)
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
        dataset_root = None
        effective_parameters: dict[str, Any] = {}
        if kind == "inference":
            dataset_id = str(action_input.get("dataset_id") or "")
            sample_id = str(action_input.get("sample_id") or "")
            sample = self.datasets.resolve(project_id, dataset_id, sample_id)
            checkpoint = (project.get("bindings") or {}).get("checkpoint") or {}
            effective_parameters = dict(action.get("parameters") or {})
            requested_parameters = action_input.get("parameters") or {}
            if not isinstance(requested_parameters, Mapping):
                raise ValueError("Inference parameters must be an object")
            if set(requested_parameters) - {"max_frames"}:
                raise ValueError("Inference parameter is not supported by the registered action")
            if "max_frames" in requested_parameters:
                if not any("{max_frames}" in value for value in action.get("arguments") or ()):
                    raise ValueError("Maximum frames is not configurable for this action")
                maximum = requested_parameters["max_frames"]
                if isinstance(maximum, bool) or not isinstance(maximum, int) or not 0 <= maximum <= 1_000_000:
                    raise ValueError("Maximum frames must be an integer from 0 to 1000000")
                effective_parameters["max_frames"] = maximum
            if target == "modal" and any(
                "{max_frames}" in value for value in action.get("arguments") or ()
            ) and not 1 <= effective_parameters.get("max_frames", 0) <= 24:
                raise ValueError("Modal inference requires an explicit maximum from 1 to 24 frames")
            request = {
                "workflow": "inference",
                "action_id": action["id"],
                "dataset_id": dataset_id,
                "dataset_sample_id": sample_id,
                "dataset_sample_sha256": sample.sha256,
                "dataset_split": sample.split,
                "checkpoint_id": checkpoint.get("id"),
                "checkpoint_sha256": checkpoint.get("sha256"),
                "device": effective_parameters.get("device", "auto"),
                "max_frames": effective_parameters.get("max_frames", 0),
            }
            private_request = request
            dataset_ref = f"{dataset_id}:{sample_id}:{sample.sha256}"
            authorized = (str(sample.path), str(checkpoint.get("path") or ""))
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
        elif kind == "training":
            dataset_id = str(action_input.get("dataset_id") or "")
            split = str(
                action_input.get("dataset_split") or action_input.get("split") or "train"
            ).strip().casefold()
            dataset = project.get("dataset") or {}
            if not dataset_id or dataset.get("id") != dataset_id:
                raise ValueError("Training requires the registered project dataset")
            selected = [
                item for item in dataset.get("samples") or ()
                if str(item.get("split") or "").strip().casefold() == split
            ]
            if not selected:
                raise ValueError("Training split has no registered samples")
            parameters = dict(action_input.get("parameters") or {})
            if "epochs" in action_input:
                parameters["epochs"] = action_input["epochs"]
            if not isinstance(parameters, Mapping) or len(parameters) > 64:
                raise ValueError("Training parameters must be a bounded object")
            resolved = [
                self.datasets.resolve(project_id, dataset_id, str(item["id"]))
                for item in selected
            ]
            dataset_root = Path(str(dataset["root"]))
            identities = [
                {"id": item.sample_id, "sha256": item.sha256, "size_bytes": item.size_bytes}
                for item in resolved
            ]
            manifest_sha = hashlib.sha256(_json_bytes({"samples": identities})).hexdigest()
            annotation_identities = []
            if self.annotations is not None:
                for item in resolved:
                    document = self.annotations.get(
                        project_id, dataset_id, item.sample_id,
                    )
                    annotation_identities.append({
                        "sample_id": item.sample_id,
                        "sample_sha256": item.sha256,
                        "revision": document["revision"],
                        "document_sha256": hashlib.sha256(_json_bytes(document)).hexdigest(),
                    })
            annotation_revision = max(
                (int(item["revision"]) for item in annotation_identities), default=0,
            )
            requested_annotation_revision = action_input.get("annotation_revision")
            if (
                requested_annotation_revision is not None
                and requested_annotation_revision != annotation_revision
            ):
                raise ValueError("Training annotation revision is stale")
            annotation_manifest_sha = hashlib.sha256(
                _json_bytes({"annotations": annotation_identities}),
            ).hexdigest()
            private_request = {
                "protocol": "modelforge.training-request/v1",
                "workflow": "training",
                "action_id": action["id"],
                "dataset_id": dataset_id,
                "split": split,
                "dataset_manifest_sha256": manifest_sha,
                "samples": identities,
                "annotation_revision": annotation_revision,
                "annotation_manifest_sha256": annotation_manifest_sha,
                "annotations": annotation_identities,
                "parameters": dict(parameters),
            }
            validated = action_handler("training").validate_request(private_request).detached()
            request = {
                "workflow": "training",
                "action_id": action["id"],
                "dataset_id": dataset_id,
                "dataset_split": split,
                "dataset_sample_count": len(identities),
                "dataset_manifest_sha256": manifest_sha,
                "annotation_revision": annotation_revision,
                "annotation_manifest_sha256": annotation_manifest_sha,
                "parameters": validated.get("parameters") or {},
            }
            private_request = validated
            dataset_ref = f"{dataset_id}:{split}:{manifest_sha}"
            authorized = tuple(str(item.path) for item in resolved)
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
            configuration = self._execution_identity(project, action)
            plan = ManagedActionPlan(
                RunScope(self.organization_id, project["id"]), self.user_id, kind,
                action["display_name"], request, action["result_protocol"], dataset_ref,
                tuple(item for item in authorized if item), configuration,
            )
            return self.managed.start_plan(
                plan,
                RegisteredActionBinder(
                    project, action, private_request, sample, dataset_root,
                    effective_parameters,
                ),
                on_event=on_event,
            )
        if target != "modal" or not managed_envelope:
            raise ValueError("Managed action execution target is unsupported")
        if kind == "training":
            raise ValueError("Modal execution is not configured for public training actions")
        return self._start_modal(
            project, action, request, private_request, dataset_ref, sample,
            execution_request, on_event=on_event,
        )

    @staticmethod
    def _action(project: Mapping[str, Any], action_id: str | None) -> Mapping[str, Any]:
        actions = list(project.get("actions") or (project["action"],))
        requested = str(action_id or project["action"]["id"]).strip().casefold()
        action = next((item for item in actions if item["id"] == requested), None)
        if action is None:
            raise ValueError("Action is not registered for this project")
        return action

    def _start_modal(
        self, project, action, request, private_request, dataset_ref, sample, execution_request,
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
        binding = self.modal_bindings.get(project["id"], action["id"])
        binding_sha = modal_action_binding_sha256(binding)
        if execution_request.get("binding_sha256") != binding_sha:
            raise ValueError("Modal confirmation is stale; review the current binding and confirm again")
        self._validate_modal_assets(project, sample, binding)
        request_sha = hashlib.sha256(_json_bytes({
            "project_id": project["id"],
            "action_id": action["id"],
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
            action["kind"], action["display_name"],
            durable_request, action["result_protocol"], dataset_ref,
            (), {
                "modal": public_binding,
                "idempotency_key": idempotency_key,
                "managed_request_sha256": request_sha,
            },
            "modal", binding["compute"]["target"], True,
            binding["compute"]["timeout_seconds"],
        )
        run_id = hashlib.sha256(
            f"{self.organization_id}\0{project['id']}\0{action['id']}\0{idempotency_key}".encode(),
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
                    RegisteredModalActionBinder(binding, private_request, action["kind"]),
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
        scope = RunScope(self.organization_id, project_id)
        durable = self.managed.runs.get(scope, run_id, include_artifacts=False)
        action = self._action(project, str(durable.get("request", {}).get("action_id") or ""))
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
        if expected_request and expected_request.get("workflow") == "training":
            claimed = value.get("dataset_manifest_sha256")
            expected = expected_request.get("dataset_manifest_sha256")
            if claimed not in (None, expected):
                raise OSError("Training result dataset identity differs from the durable request")
        return value

    @staticmethod
    def _execution_identity(
        project: Mapping[str, Any], action: Mapping[str, Any],
    ) -> dict[str, Any]:
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
                presentation_metadata = {}
                if path_field == "path":
                    for field in ("role", "frames", "fps", "duration_seconds"):
                        value = item.get(field)
                        if value is not None:
                            presentation_metadata[field] = value
                candidate = self._candidate(
                    path, kind, fallback_type, **presentation_metadata,
                )
                if item.get(digest_field) and candidate.sha256 != item[digest_field]:
                    raise OSError("Managed result artifact digest does not match its envelope")
                artifacts.append(candidate)
                seen.add(name)
        return artifacts


__all__ = ["ProjectActionService", "RegisteredActionBinder", "RegisteredModalActionBinder"]
