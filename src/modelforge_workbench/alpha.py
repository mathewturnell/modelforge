"""Composition root for the bounded public-alpha workflow."""

from __future__ import annotations

import hashlib
import codecs
import json
import os
import secrets
import stat
import sys
from importlib.resources import files
from pathlib import Path
from typing import Callable, Mapping

from .application.artifacts import ArtifactService, LocalArtifactCandidate
from .application.execution import ExecutionEvent, ProviderFunctionInvocation
from .application.managed_execution import (
    BoundManagedAction,
    ManagedActionIntent,
    ManagedActionPlan,
    ManagedActionService,
)
from .application.datasets import DatasetService
from .application.project_actions import ProjectActionService
from .application.modal_bindings import (
    FileModalActionBindingRepository,
    ModalActionBindingService,
)
from .application.runtime_configurations import (
    FileProjectRuntimeConfigurationRepository,
    ProjectRuntimeConfigurationService,
)
from .application.projects import ProjectService
from .application.runs import RunScope, RunService
from .contracts.project_capabilities import project_capabilities
from .execution.local import LocalExecutor
from .infrastructure.local_artifacts import LocalFilesystemArtifactIO
from .infrastructure.file_projects import FileProjectRepository
from .infrastructure.sqlite_runs import SQLiteRunRepository
from .project_manifest import load_project_manifest


ALPHA_ORGANIZATION = "local-alpha"
ALPHA_PROJECT = "synthetic-threshold"
ALPHA_USER = "local-user"
ALPHA_SCOPE = RunScope(ALPHA_ORGANIZATION, ALPHA_PROJECT)
_STATE_MARKER = ".modelforge-alpha-state-v1"
_STATE_MARKER_CONTENT = b"ModelForge public alpha state root\n"


class _ModalSyntheticBinder:
    """Bind the fixed provider request only after a durable run allocation exists."""

    def __init__(self, environment_name: str) -> None:
        self.environment_name = environment_name

    def bind(self, allocation) -> BoundManagedAction:
        return BoundManagedAction(
            (),
            None,
            {},
            ProviderFunctionInvocation(
                provider="modal",
                application="modelforge-alpha-synthetic",
                function="run_synthetic_threshold",
                environment_name=self.environment_name,
                payload={
                    "protocol": "modelforge.modal-synthetic-request/v1",
                    "run_id": allocation.execution_id,
                },
            ),
        )


class _LiveEventProjection:
    """Incrementally decode bounded streams and parse only complete progress lines."""

    def __init__(self, target: Callable[[], dict]) -> None:
        self.target = target
        self.decoders = {
            name: codecs.getincrementaldecoder("utf-8")(errors="replace")
            for name in ("stdout", "stderr")
        }
        self.line_carry = {"stdout": "", "stderr": ""}

    def __call__(self, event: ExecutionEvent) -> None:
        decoder = self.decoders.setdefault(
            event.stream, codecs.getincrementaldecoder("utf-8")(errors="replace"),
        )
        text = decoder.decode(event.data, final=False)
        live = self.target()
        live["last_event_at"] = event.timestamp.isoformat()
        live["log_tail"] = (live.get("log_tail", "") + text)[-16_384:]
        combined = self.line_carry.get(event.stream, "") + text
        lines = combined.splitlines(keepends=True)
        self.line_carry[event.stream] = ""
        if lines and not lines[-1].endswith(("\n", "\r")):
            self.line_carry[event.stream] = lines.pop()
        for line in lines:
            line = line.rstrip("\r\n")
            if line.startswith("[MODELFORGE_TELEMETRY] "):
                try:
                    from .application.training_telemetry import validate_training_scalar
                    scalar = validate_training_scalar(json.loads(line.split(" ", 1)[1]))
                    observed = live.setdefault("telemetry_events", [])
                    same = [item for item in observed if (item["split"], item["name"]) == (scalar["split"], scalar["name"])]
                    if len(observed) < 2000 and (not same or scalar["step"] > same[-1]["step"]):
                        observed.append(scalar)
                except (ValueError, TypeError, KeyError):
                    pass
                continue
            if not line.startswith("[MODELFORGE_PROGRESS] "):
                continue
            try:
                value = json.loads(line.split(" ", 1)[1])
                if isinstance(value, dict):
                    live["progress"] = value
            except json.JSONDecodeError:
                continue


def default_state_root() -> Path:
    configured = os.environ.get("MODELFORGE_STATE_ROOT")
    if configured:
        return Path(configured).expanduser()
    return Path.home() / ".modelforge" / "alpha"


def _open_directory_without_symlinks(path: Path) -> tuple[int, bool]:
    """Open *path* by directory descriptor, creating missing components privately."""

    descriptor = os.open(path.anchor, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    created_final = False
    try:
        for index, part in enumerate(path.parts[1:]):
            final = index == len(path.parts[1:]) - 1
            try:
                child = os.open(
                    part,
                    os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                    dir_fd=descriptor,
                )
            except FileNotFoundError:
                os.mkdir(part, mode=0o700, dir_fd=descriptor)
                child = os.open(
                    part,
                    os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW,
                    dir_fd=descriptor,
                )
                created_final = final
            except OSError as exc:
                raise ValueError(
                    "ModelForge state root cannot contain symbolic links or non-directories"
                ) from exc
            os.close(descriptor)
            descriptor = child
        return descriptor, created_final
    except Exception:
        os.close(descriptor)
        raise


def _validate_or_create_state_marker(descriptor: int) -> None:
    entries = set(os.listdir(descriptor))
    if _STATE_MARKER not in entries:
        if entries:
            raise ValueError("Existing ModelForge state root is not an owned alpha state root")
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
        marker = os.open(_STATE_MARKER, flags, 0o600, dir_fd=descriptor)
        try:
            os.write(marker, _STATE_MARKER_CONTENT)
        finally:
            os.close(marker)
        return

    marker = os.open(_STATE_MARKER, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=descriptor)
    try:
        marker_stat = os.fstat(marker)
        if not stat.S_ISREG(marker_stat.st_mode):
            raise ValueError("ModelForge alpha state marker must be a regular file")
        if stat.S_IMODE(marker_stat.st_mode) != 0o600:
            raise ValueError("ModelForge alpha state marker must have mode 0600")
        if os.read(marker, len(_STATE_MARKER_CONTENT) + 1) != _STATE_MARKER_CONTENT:
            raise ValueError("ModelForge alpha state marker is invalid")
    finally:
        os.close(marker)


def _private_state_root(value: str | Path) -> Path:
    requested = Path(value).expanduser()
    absolute = Path(os.path.abspath(requested))
    forbidden = {
        Path("/"), Path.home().absolute(), Path("/tmp"), Path("/var"), Path("/etc"),
        Path("/usr"), Path("/opt"), Path("/home"), Path("/root"), Path("/run"),
        Path("/dev"), Path("/proc"), Path("/sys"),
    }
    if absolute in forbidden:
        raise ValueError("ModelForge state root cannot be a broad system or home directory")
    descriptor, _created = _open_directory_without_symlinks(absolute)
    try:
        if stat.S_IMODE(os.fstat(descriptor).st_mode) != 0o700:
            raise ValueError("Existing ModelForge state root must have mode 0700")
        _validate_or_create_state_marker(descriptor)
    finally:
        os.close(descriptor)
    return absolute


class AlphaWorkbench:
    """Use Phase 1–3 services without importing the proprietary browser stack."""

    def __init__(self, state_root: str | Path | None = None) -> None:
        self.state_root = _private_state_root(state_root or default_state_root())
        self.runs = RunService(SQLiteRunRepository(self.state_root / "runs.sqlite3"))
        self.artifacts = ArtifactService(self.runs, LocalFilesystemArtifactIO())
        self.actions = ManagedActionService(
            self.runs, self.artifacts, LocalExecutor(), self.state_root,
        )
        self.projects = ProjectService(FileProjectRepository(self.state_root))
        self.runtime_configurations = ProjectRuntimeConfigurationService(
            FileProjectRuntimeConfigurationRepository(self.state_root),
        )
        self.modal_bindings = ModalActionBindingService(
            FileModalActionBindingRepository(self.state_root), self.projects,
        )
        self.datasets = DatasetService(self.runtime_configurations)
        from .application.annotations import AnnotationService
        from .application.model_inspection import ModelInspectionService
        self.annotations = AnnotationService(self.state_root, self.datasets)
        self.model_inspection = ModelInspectionService(self.runtime_configurations)
        self.project_actions = ProjectActionService(
            self.runtime_configurations, self.datasets, self.actions, self.modal_bindings,
        )
        self._live: dict[str, dict] = {}

    @staticmethod
    def capabilities() -> dict:
        manifest = files("modelforge_workbench.example").joinpath("project.json")
        return project_capabilities(load_project_manifest(Path(str(manifest))))

    def list_projects(self) -> list[dict]:
        synthetic = {
            "id": ALPHA_PROJECT,
            "name": "Synthetic Threshold Lab",
            "description": "Bundled offline lifecycle smoke test; not real-model evidence.",
            "support_level": "conformance",
            "capabilities": ["action.inference", "dataset.default"],
            "action": {"id": "inference", "kind": "inference", "display_name": "Run local inference"},
            "runtime_readiness": "ready",
            "readiness_reasons": [],
            "execution_targets": [{
                "target": "local", "provider": "local", "billable": False,
                "readiness": "ready",
            }],
            "bindings": [],
        }
        configured = []
        for runtime in self.runtime_configurations.list():
            capabilities = self.projects.capabilities(runtime["id"])
            runtime["capabilities"] = [
                item["id"] for item in capabilities["capabilities"]
                if item["support"] == "supported"
            ]
            runtime = self._with_execution_targets(runtime)
            configured.append(runtime)
        return [synthetic, *configured]

    def register_project(self, path: str | Path) -> dict:
        runtime = self.runtime_configurations.prepare_file(path)
        authored = self.projects.prepare_registration(runtime["project_repository"])
        if authored.project_id != runtime["id"]:
            raise ValueError("Runtime configuration project identity differs from its authored manifest")
        capabilities = project_capabilities(dict(authored.manifest))
        action_id = f"action.{runtime['action']['id']}"
        declared = next(
            (item for item in capabilities["capabilities"] if item["id"] == action_id), None,
        )
        if declared is None or declared["support"] != "supported" or declared["kind"] != runtime["action"]["kind"]:
            raise ValueError("Runtime action differs from the authored project capability")
        self.projects.register_existing_folder(authored.repository)
        self.runtime_configurations.repository.put(runtime)
        return self.project(runtime["id"])

    def register_modal_action(self, path: str | Path) -> dict:
        """Register a separate owner-authorized Modal target for one action."""

        return self.modal_bindings.register_file(path)

    def _with_execution_targets(self, runtime: dict) -> dict:
        registered = self.runtime_configurations.get(runtime["id"])
        runtime["features"] = {
            "annotation": any(
                item.get("content_type", "").startswith(("image/", "video/"))
                for item in (registered.get("dataset") or {}).get("samples", [])
            ),
            "training": runtime.get("action", {}).get("kind") == "training",
            "model_inspection": any(
                item.get("id") == "model_descriptor" for item in runtime.get("bindings", [])
            ),
        }
        targets = []
        if runtime.get("local_enabled", True):
            targets.append({
                "target": "local", "provider": "local", "billable": False,
                "readiness": runtime["runtime_readiness"],
            })
        try:
            modal = self.modal_bindings.public(self.modal_bindings.get(
                runtime["id"], runtime["action"]["id"],
            ))
        except (KeyError, ValueError):
            modal = None
        if modal:
            executor = self.actions.executors.get("modal")
            modal_module = getattr(executor, "_modal_module", None) if executor else None
            provider = self.modal_status(modal["environment"], modal_module=modal_module)
            provider_ready = bool(provider.get("ready"))
            targets.append({
                "target": "modal", "provider": "modal", "billable": True,
                **modal,
                "readiness": "ready" if provider_ready else "unavailable",
                "ready": provider_ready,
                "provider_readiness": (
                    "configured_not_live_verified" if provider_ready else "not_configured"
                ),
                "reasons": list(provider.get("reasons") or ()),
            })
        runtime["execution_targets"] = targets
        ready = any(item.get("readiness") == "ready" for item in targets)
        runtime["runtime_readiness"] = "ready" if ready else "unavailable"
        if modal and not runtime.get("local_enabled", True):
            runtime["readiness_reasons"] = []
        return runtime

    def project(self, project_id: str) -> dict:
        if project_id == ALPHA_PROJECT:
            return self.list_projects()[0]
        runtime = self.runtime_configurations.public(
            self.runtime_configurations.get(project_id),
        )
        capabilities = self.projects.capabilities(project_id)
        runtime["capabilities"] = [
            item["id"] for item in capabilities["capabilities"]
            if item["support"] == "supported"
        ]
        return self._with_execution_targets(runtime)

    def list_samples(self, project_id: str, dataset_id: str, *, cursor=0, limit=50) -> dict:
        return self.datasets.list_samples(project_id, dataset_id, cursor=cursor, limit=limit)

    def open_sample(self, project_id: str, dataset_id: str, sample_id: str):
        return self.datasets.resolve(project_id, dataset_id, sample_id)

    def list_runs(self, project_id: str | None = None) -> list[dict]:
        project_ids = [project_id] if project_id else [item["id"] for item in self.list_projects()]
        values = []
        for current in project_ids:
            scope = RunScope(ALPHA_ORGANIZATION, current)
            values.extend(self._public_run(run) for run in self.runs.list(scope))
        return sorted(values, key=lambda item: item.get("created_at") or "", reverse=True)

    def _public_run(self, run: dict) -> dict:
        value = self.artifacts.public_job(run)
        run_id = str(value.get("id") or "")
        if value.get("status") in {"queued", "running"}:
            observable = self.runs.is_attached(run_id)
            value["runtime_observation"] = {
                "state": "current" if observable else "unavailable",
                "stale": not observable,
                "reason": (
                    None if observable
                    else "No live executor handle is attached in this workbench process"
                ),
            }
        if run_id in self._live:
            value["live"] = dict(self._live[run_id])
        if value.get("request", {}).get("workflow") == "training":
            try:
                value["telemetry"] = self.project_actions.training_telemetry(value["project_id"], run_id)
            except (OSError, ValueError):
                value["telemetry"] = {"status": "unavailable", "events": [], "reason": "Training evidence is invalid or changed"}
            if value["status"] in {"queued", "running"} and value.get("live", {}).get("telemetry_events"):
                value["telemetry"] = {"status": "available", "events": value["live"]["telemetry_events"], "source": "live-observation"}
        return value

    def get_run(self, run_id: str, project_id: str | None = None) -> dict:
        candidates = [project_id] if project_id else [item["id"] for item in self.list_projects()]
        for current in candidates:
            try:
                return self._public_run(
                    self.runs.get(RunScope(ALPHA_ORGANIZATION, current), run_id),
                )
            except KeyError:
                continue
        raise KeyError("Run was not found")

    def shutdown(self) -> tuple[dict, ...]:
        """Cancel local work and detach from provider work without stopping it."""

        stopped = self.actions.cancel_active(provider="local")
        self.actions.detach_active(provider="modal")
        return stopped

    @staticmethod
    def modal_status(environment_name: str, *, modal_module=None) -> dict:
        from .execution.modal import modal_readiness

        return modal_readiness(environment_name, modal_module=modal_module)

    def _configure_modal(self, *, modal_module=None) -> None:
        from .execution.modal import ModalExecutor

        self.actions.register_executor("modal", ModalExecutor(modal_module=modal_module))

    @staticmethod
    def _modal_plan(environment_name: str, billable_confirmed: bool) -> ManagedActionPlan:
        environment = str(environment_name or "").strip()
        if not environment:
            raise ValueError("Modal environment name is required")
        return ManagedActionPlan(
            scope=ALPHA_SCOPE,
            user_id=ALPHA_USER,
            kind="inference",
            name="Synthetic threshold inference",
            request={
                "workflow": "inference",
                "action_id": "inference",
                "dataset_identity": "modelforge.synthetic-samples/v1",
                "synthetic": True,
            },
            result_protocol="modelforge.inference-result/v1",
            dataset_ref="bundled://synthetic-threshold/v1",
            authorized_inputs=("bundled:synthetic-threshold:v1",),
            configuration={
                "modal": {
                    "application": "modelforge-alpha-synthetic",
                    "function": "run_synthetic_threshold",
                    "environment": environment,
                    "resources": {
                        "cpu": 0.125,
                        "memory_mib": 128,
                        "timeout_seconds": 60,
                        "retries": 0,
                        "max_containers": 1,
                    },
                },
            },
            provider="modal",
            compute_target="modal-cpu-0.125",
            billable_confirmed=billable_confirmed,
        )

    def start_example(
        self, *, executor: str = "local", modal_environment: str | None = None,
        billable_confirmed: bool = False, modal_module=None, on_event=None,
    ):
        provider = str(executor or "").strip().casefold()
        if provider == "modal":
            plan = self._modal_plan(str(modal_environment or ""), billable_confirmed)
            self._configure_modal(modal_module=modal_module)
            return self.actions.start_plan(
                plan, _ModalSyntheticBinder(str(modal_environment)), on_event=on_event,
            )
        if provider != "local":
            raise ValueError("Example executor must be local or modal")
        worker = Path(str(files("modelforge_workbench.example").joinpath("worker.py"))).resolve()
        intent = ManagedActionIntent(
            scope=ALPHA_SCOPE,
            user_id=ALPHA_USER,
            kind="inference",
            name="Synthetic threshold inference",
            request={
                "workflow": "inference",
                "action_id": "inference",
                "dataset_identity": "modelforge.synthetic-samples/v1",
                "synthetic": True,
            },
            result_protocol="modelforge.inference-result/v1",
            argv=(sys.executable, "-I", str(worker)),
            working_directory=self.state_root,
            environment={
                "PATH": os.environ.get("PATH", ""),
                "PYTHONNOUSERSITE": "1",
                "PYTHONDONTWRITEBYTECODE": "1",
                "PYTHONSAFEPATH": "1",
                "MODELFORGE_NETWORK": "disabled",
            },
            dataset_ref="bundled://synthetic-threshold/v1",
            authorized_inputs=("bundled:synthetic-threshold:v1",),
        )
        return self.actions.start(intent, on_event=on_event)

    def finish_example(self, execution) -> dict:
        def load_result(allocation) -> Mapping:
            return json.loads((allocation.evidence_root / "result.json").read_text(encoding="utf-8"))

        def load_artifacts(allocation, _result):
            result = []
            for name, kind in (("report.json", "result"), ("result.json", "manifest")):
                path = allocation.evidence_root / name
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                result.append(LocalArtifactCandidate(
                    name=name,
                    kind=kind,
                    path=path,
                    content_type="application/json",
                    size_bytes=path.stat().st_size,
                    sha256=digest,
                    metadata={"synthetic": True},
                ))
            return result

        return self.artifacts.public_job(self.actions.finish(
            execution, result_loader=load_result, artifact_loader=load_artifacts,
        ))

    def run_example(
        self, *, executor: str = "local", modal_environment: str | None = None,
        billable_confirmed: bool = False, modal_module=None,
    ) -> dict:
        return self.finish_example(self.start_example(
            executor=executor,
            modal_environment=modal_environment,
            billable_confirmed=billable_confirmed,
            modal_module=modal_module,
        ))

    def recover_modal_example(
        self, run_id: str, *, modal_environment: str,
        billable_confirmed: bool, modal_module=None,
    ) -> dict:
        """Recover one unfinished fc-* call into the same durable run identity."""

        plan = self._modal_plan(modal_environment, billable_confirmed)
        durable = self.runs.get(ALPHA_SCOPE, run_id, include_artifacts=False)
        modal_configuration = durable.get("configuration", {}).get("modal", {})
        if modal_configuration != dict(plan.configuration["modal"]):
            raise ValueError("Modal recovery target differs from the durable request")
        self._configure_modal(modal_module=modal_module)
        execution = self.actions.recover_plan(
            plan, _ModalSyntheticBinder(modal_environment), run_id,
        )
        return self.finish_example(execution)

    def start_project_action(self, project_id: str, payload: Mapping, *, on_started=None):
        execution_request = payload.get("execution") if isinstance(payload, Mapping) else None
        if isinstance(execution_request, Mapping) and execution_request.get("target") == "modal":
            if "modal" not in self.actions.executors:
                self._configure_modal()
            binding = self.modal_bindings.get(
                project_id, self.runtime_configurations.get(project_id)["action"]["id"],
            )
            executor = self.actions.executors["modal"]
            readiness = self.modal_status(
                binding["environment"], modal_module=getattr(executor, "_modal_module", None),
            )
            if not readiness.get("ready"):
                raise ValueError(
                    "; ".join(readiness.get("reasons") or ())
                    or "Modal SDK credentials are not configured"
                )
        pending_key = "pending-" + secrets.token_hex(16)
        run_key = [pending_key]
        self._live.setdefault(run_key[0], {})
        observe = _LiveEventProjection(lambda: self._live.setdefault(run_key[0], {}))
        execution = self.project_actions.start(project_id, payload, on_event=observe)
        if isinstance(execution, dict):
            self._live.pop(pending_key, None)
            return self.artifacts.public_job(execution)
        if pending_key in self._live:
            self._live[execution.run_id] = self._live.pop(pending_key)
        run_key[0] = execution.run_id
        if on_started:
            on_started(execution)
        return execution

    def finish_project_action(self, execution) -> dict:
        try:
            return self.artifacts.public_job(self.project_actions.finish(execution))
        finally:
            self._live.pop(execution.run_id, None)

    def recover_project_action(self, project_id: str, run_id: str):
        """Reattach to the same durable Modal call; never submit a replacement."""

        if "modal" not in self.actions.executors:
            self._configure_modal()
        execution = self.project_actions.recover_modal(project_id, run_id)
        return execution

    def cancel(self, run_id: str, project_id: str = ALPHA_PROJECT) -> dict:
        scope = RunScope(ALPHA_ORGANIZATION, project_id)
        durable = self.runs.get(scope, run_id, include_artifacts=False)
        if (
            durable.get("provider") == "modal"
            and durable.get("status") in {"queued", "running"}
            and not self.runs.is_attached(run_id)
        ):
            self.recover_project_action(project_id, run_id)
        return self.artifacts.public_job(
            self.actions.cancel(scope, run_id),
        )

    def open_artifact(self, run_id: str, artifact_id: str, project_id: str | None = None):
        candidates = [project_id] if project_id else [item["id"] for item in self.list_projects()]
        for current in candidates:
            try:
                return self.artifacts.open_local(
                    RunScope(ALPHA_ORGANIZATION, current), run_id, artifact_id,
                )
            except KeyError:
                continue
        raise KeyError("Artifact was not found")


__all__ = ["ALPHA_SCOPE", "AlphaWorkbench", "default_state_root"]
