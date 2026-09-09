"""Delivery-neutral composition of Run, Executor, handler, and Artifact services."""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from types import MappingProxyType
from typing import Any, Callable, Mapping, Protocol, Sequence

from .action_handlers import ActionHandler, action_handler
from .artifacts import ArtifactAllocation, ArtifactService, LocalArtifactCandidate
from .execution import (
    ExecutionAllocation,
    ExecutionBundle,
    ExecutionDeadlineExceeded,
    ExecutionHandle,
    ExecutionLimits,
    Executor,
    ProviderFunctionInvocation,
)
from .runs import RunIntent, RunScope, RunService, thaw_json


_RUN_ID = re.compile(r"^[a-f0-9]{32}$")


@dataclass(frozen=True)
class ManagedActionIntent:
    """Already-authorized action plus its resolved shell-free local launch."""

    scope: RunScope
    user_id: str
    kind: str
    name: str
    request: Mapping[str, Any]
    result_protocol: str
    argv: tuple[str, ...]
    working_directory: Path
    environment: Mapping[str, str] = field(repr=False)
    dataset_ref: str = ""
    authorized_inputs: tuple[str, ...] = ()
    configuration: Mapping[str, Any] = field(default_factory=dict)
    provider: str = "local"
    compute_target: str = "local"
    billable_confirmed: bool = False

    def __post_init__(self) -> None:
        if self.scope.project_id is None:
            raise ValueError("Managed action requires a project scope")
        handler = action_handler(self.kind)
        request = handler.validate_request(self.request).value
        if not str(self.result_protocol or "").strip():
            raise ValueError("Managed action result protocol is required")
        argv = tuple(str(value) for value in self.argv)
        provider = str(self.provider or "").strip().casefold()
        compute_target = str(self.compute_target or "").strip()
        if provider != "local":
            raise ValueError("Direct managed action intents support only local execution")
        if not isinstance(self.billable_confirmed, bool) or self.billable_confirmed:
            raise ValueError("Local execution cannot carry billable-action confirmation")
        if not argv:
            raise ValueError("Managed action argv is required")
        if not compute_target:
            raise ValueError("Managed action compute target is required")
        object.__setattr__(self, "kind", handler.kind)
        object.__setattr__(self, "request", request)
        object.__setattr__(self, "result_protocol", str(self.result_protocol))
        object.__setattr__(self, "argv", argv)
        object.__setattr__(self, "working_directory", Path(self.working_directory).resolve())
        object.__setattr__(
            self,
            "environment",
            MappingProxyType({str(key): str(value) for key, value in self.environment.items()}),
        )
        object.__setattr__(
            self, "authorized_inputs", tuple(str(value) for value in self.authorized_inputs),
        )
        object.__setattr__(self, "configuration", MappingProxyType(thaw_json(
            self.configuration,
        )))
        object.__setattr__(self, "provider", provider)
        object.__setattr__(self, "compute_target", compute_target)


@dataclass(frozen=True)
class ManagedActionPlan:
    """Authorized durable intent whose process paths need a run allocation."""

    scope: RunScope
    user_id: str
    kind: str
    name: str
    request: Mapping[str, Any]
    result_protocol: str
    dataset_ref: str = ""
    authorized_inputs: tuple[str, ...] = ()
    configuration: Mapping[str, Any] = field(default_factory=dict)
    provider: str = "local"
    compute_target: str = "local"
    billable_confirmed: bool = False

    def __post_init__(self) -> None:
        if self.scope.project_id is None:
            raise ValueError("Managed action requires a project scope")
        handler = action_handler(self.kind)
        request = handler.validate_request(self.request).value
        if not str(self.result_protocol or "").strip():
            raise ValueError("Managed action result protocol is required")
        provider = str(self.provider or "").strip().casefold()
        compute_target = str(self.compute_target or "").strip()
        if provider not in {"local", "modal"}:
            raise ValueError("Managed action provider is unsupported")
        if not isinstance(self.billable_confirmed, bool):
            raise TypeError("Managed action billable confirmation must be boolean")
        if not compute_target:
            raise ValueError("Managed action compute target is required")
        if provider == "modal" and self.billable_confirmed is not True:
            raise ValueError("Modal execution requires explicit billable-action confirmation")
        if provider == "local" and self.billable_confirmed:
            raise ValueError("Local execution cannot carry billable-action confirmation")
        object.__setattr__(self, "kind", handler.kind)
        object.__setattr__(self, "request", request)
        object.__setattr__(self, "result_protocol", str(self.result_protocol))
        object.__setattr__(
            self, "authorized_inputs", tuple(str(value) for value in self.authorized_inputs),
        )
        object.__setattr__(self, "configuration", MappingProxyType(thaw_json(
            self.configuration,
        )))
        object.__setattr__(self, "provider", provider)
        object.__setattr__(self, "compute_target", compute_target)


@dataclass(frozen=True)
class BoundManagedAction:
    """Shell-free process launch resolved inside an owned run allocation."""

    argv: tuple[str, ...]
    working_directory: Path | None
    environment: Mapping[str, str] = field(repr=False)
    provider_invocation: ProviderFunctionInvocation | None = None

    def __post_init__(self) -> None:
        argv = tuple(str(value) for value in self.argv)
        if self.provider_invocation is None and not argv:
            raise ValueError("Bound managed action argv is required")
        if self.provider_invocation is not None and argv:
            raise ValueError("Bound provider action cannot include local argv")
        object.__setattr__(self, "argv", argv)
        object.__setattr__(
            self,
            "working_directory",
            None if self.working_directory is None else Path(self.working_directory).resolve(),
        )
        object.__setattr__(
            self,
            "environment",
            MappingProxyType({str(key): str(value) for key, value in self.environment.items()}),
        )


class ActionBinder(Protocol):
    """Bind private request/output paths only after durable run allocation."""

    def bind(self, allocation: ExecutionAllocation) -> BoundManagedAction: ...


@dataclass(frozen=True)
class ManagedActionExecution:
    """Ephemeral attachment between one durable run and executor handle."""

    intent: ManagedActionIntent | ManagedActionPlan
    run_id: str
    allocation: ExecutionAllocation
    handle: ExecutionHandle
    handler: ActionHandler


class ManagedActionService:
    """Coordinate standard actions without replacing Run Service terminal truth."""

    def __init__(
        self,
        runs: RunService,
        artifacts: ArtifactService,
        executor: Executor,
        state_root: str | Path,
        *,
        id_factory: Callable[[], Any] | None = None,
        deadline_seconds: float = 1_800,
    ) -> None:
        if artifacts.runs is not runs:
            raise ValueError("Managed actions require one shared RunService instance")
        self.runs = runs
        self.artifacts = artifacts
        self._executor = executor
        self.executors: dict[str, Executor] = {"local": executor}
        self.state_root = Path(state_root).expanduser().resolve()
        self.id_factory = id_factory or (lambda: uuid.uuid4().hex)
        if (
            isinstance(deadline_seconds, bool)
            or not isinstance(deadline_seconds, (int, float))
            or not 1 <= float(deadline_seconds) <= 7_200
        ):
            raise ValueError("Managed action deadline must be from 1 to 7200 seconds")
        self.deadline_seconds = float(deadline_seconds)
        self._active: dict[str, ManagedActionExecution] = {}

    @property
    def executor(self) -> Executor:
        """Compatibility access to the default local executor."""

        return self._executor

    @executor.setter
    def executor(self, value: Executor) -> None:
        self._executor = value
        if hasattr(self, "executors"):
            self.executors["local"] = value

    def register_executor(self, provider: str, executor: Executor) -> None:
        """Register one optional executor without changing durable lifecycle ownership."""

        key = str(provider or "").strip().casefold()
        if key not in {"local", "modal"}:
            raise ValueError("Managed action provider is unsupported")
        if not isinstance(executor, Executor):
            raise TypeError("Managed action executor does not satisfy its port")
        self.executors[key] = executor

    def _run_id(self) -> str:
        value = self.id_factory()
        value = value.hex if isinstance(value, uuid.UUID) else str(value)
        value = value.strip().casefold()
        if not _RUN_ID.fullmatch(value):
            raise ValueError("Managed action identity must be 32 lowercase hex characters")
        return value

    def _allocation(
        self, run_id: str, provider: str = "local", *, existing: bool = False,
    ) -> ExecutionAllocation:
        parent = self.state_root
        for index, name in enumerate(("runs", provider)):
            parent = parent / name
            if parent.is_symlink():
                raise ValueError("Managed action state cannot use symbolic links")
            parent.mkdir(mode=0o700, parents=index == 0, exist_ok=True)
            if not parent.is_dir():
                raise ValueError("Managed action state must use directories")
            os.chmod(parent, 0o700)
        resolved_parent = parent.resolve()
        if not resolved_parent.is_relative_to(self.state_root):
            raise ValueError("Managed action state escaped its installation root")
        run_root = resolved_parent / run_id
        if existing:
            if run_root.is_symlink() or not run_root.is_dir():
                raise ValueError("Managed action recovery root is unavailable")
        else:
            run_root.mkdir(mode=0o700)
        roots = tuple(run_root / name for name in ("work", "evidence", "cache"))
        for root in roots:
            if existing:
                if root.is_symlink() or not root.is_dir():
                    raise ValueError("Managed action recovery allocation is unavailable")
            else:
                root.mkdir(mode=0o700)
        return ExecutionAllocation(run_id, roots[0], roots[1], roots[2])

    def start(self, intent: ManagedActionIntent, *, on_event=None) -> ManagedActionExecution:
        """Create durable queued truth before starting one local subprocess."""

        if not isinstance(intent, ManagedActionIntent):
            raise TypeError("Managed action start requires a ManagedActionIntent")
        bound = BoundManagedAction(intent.argv, intent.working_directory, intent.environment)
        plan = ManagedActionPlan(
            intent.scope, intent.user_id, intent.kind, intent.name, intent.request,
            intent.result_protocol, intent.dataset_ref, intent.authorized_inputs,
            intent.configuration, intent.provider, intent.compute_target,
            intent.billable_confirmed,
        )
        return self._start_plan(plan, lambda _allocation: bound, on_event=on_event)

    def start_plan(
        self, plan: ManagedActionPlan, binder: ActionBinder, *, on_event=None,
    ) -> ManagedActionExecution:
        """Persist queued truth before binding request/output paths and spawning."""

        if not isinstance(plan, ManagedActionPlan):
            raise TypeError("Managed action start requires a ManagedActionPlan")
        if not hasattr(binder, "bind"):
            raise TypeError("Managed action plan requires an ActionBinder")
        return self._start_plan(plan, binder.bind, on_event=on_event)

    def _start_plan(self, intent, bind, *, on_event=None) -> ManagedActionExecution:
        run_id = self._run_id()
        allocation = self._allocation(run_id, intent.provider)
        allocation = ExecutionAllocation(
            run_id,
            allocation.work_root,
            allocation.evidence_root,
            allocation.cache_root,
            intent.authorized_inputs,
        )
        environment = {
            "MODELFORGE_RUN_ID": run_id,
            "MODELFORGE_WORK_ROOT": str(allocation.work_root),
            "MODELFORGE_EVIDENCE_ROOT": str(allocation.evidence_root),
            "MODELFORGE_CACHE_ROOT": str(allocation.cache_root),
            "PYTHONPYCACHEPREFIX": str(allocation.cache_root / "pycache"),
        }
        self.runs.create(RunIntent(
            scope=intent.scope,
            user_id=intent.user_id,
            name=intent.name,
            provider=intent.provider,
            compute_target=intent.compute_target,
            request=thaw_json(intent.request),
            configuration={
                "action_kind": intent.kind,
                "result_protocol": intent.result_protocol,
                "deadline_seconds": self.deadline_seconds,
                "billable_action_confirmed": intent.billable_confirmed,
                **thaw_json(intent.configuration),
            },
            dataset_ref=intent.dataset_ref,
            artifact_backend="local",
            artifact_prefix=f"{intent.provider}-action://{run_id}",
        ), run_id=run_id)
        self.runs.attach(run_id)
        try:
            bound = bind(allocation)
            if not isinstance(bound, BoundManagedAction):
                raise TypeError("Managed action binder returned an invalid launch")
            if intent.provider not in self.executors:
                raise RuntimeError(f"{intent.provider} executor is not configured")
            if intent.provider == "local" and bound.provider_invocation is not None:
                raise ValueError("Local managed action cannot use a provider invocation")
            if intent.provider != "local" and (
                bound.provider_invocation is None
                or bound.provider_invocation.provider != intent.provider
            ):
                raise ValueError("Provider managed action requires its matching invocation")
            handle = self.executors[intent.provider].start(
                ExecutionBundle(
                    bound.argv,
                    bound.working_directory,
                    {**dict(bound.environment), **environment},
                    allocation,
                    True,
                    True,
                    ExecutionLimits(256 * 1024, self.deadline_seconds),
                    bound.provider_invocation,
                ),
                capture_output=True,
                output_limit_bytes=256 * 1024,
                on_event=on_event,
            )
            identity = handle.identity
            backend_id = getattr(identity, "backend_id", None)
            if backend_id is None:
                backend_id = str(identity.pid)
            running = self.runs.confirm_running(
                intent.scope, run_id, backend_id=str(backend_id),
            )
            if running.get("status") != "running":
                output = handle.cancel()
                delivery = output.cancellation
                if delivery and delivery.observed_terminated:
                    self.runs.confirm_cancellation(intent.scope, run_id)
                raise RuntimeError("Managed action was cancelled before start confirmation")
        except Exception as exc:
            run = self.runs.get(intent.scope, run_id, include_artifacts=False)
            if run.get("status") not in {"completed", "failed", "cancelled"}:
                self.runs.fail(intent.scope, run_id, error=str(exc))
            shutil.rmtree(allocation.work_root.parent, ignore_errors=True)
            raise
        execution = ManagedActionExecution(
            intent, run_id, allocation, handle, action_handler(intent.kind),
        )
        self._active[run_id] = execution
        return execution

    def recover_plan(
        self, plan: ManagedActionPlan, binder: ActionBinder, run_id: str, *, on_event=None,
    ) -> ManagedActionExecution:
        """Reattach a coherent provider call to the existing durable run identity."""

        if plan.provider == "local":
            raise ValueError("Local process recovery is not supported")
        run = self.runs.get(plan.scope, run_id, include_artifacts=False)
        if run.get("status") not in {"queued", "running"}:
            raise ValueError("Only an unfinished managed run can be recovered")
        if run.get("provider") != plan.provider or run.get("compute_target") != plan.compute_target:
            raise ValueError("Recovered run target differs from its durable request")
        backend_id = str(run.get("provider_action_id") or "")
        if plan.provider == "modal" and not re.fullmatch(r"fc-[A-Za-z0-9_-]{2,200}", backend_id):
            raise ValueError("Recovered Modal run has no coherent function-call identity")
        if plan.provider not in self.executors:
            raise RuntimeError(f"{plan.provider} executor is not configured")
        allocation = self._allocation(run_id, plan.provider, existing=True)
        allocation = ExecutionAllocation(
            run_id,
            allocation.work_root,
            allocation.evidence_root,
            allocation.cache_root,
            plan.authorized_inputs,
        )
        bound = binder.bind(allocation)
        invocation = bound.provider_invocation
        if invocation is None or invocation.provider != plan.provider:
            raise ValueError("Recovered provider action requires its matching invocation")
        executor = self.executors[plan.provider]
        recover = getattr(executor, "recover", None)
        if not callable(recover):
            raise RuntimeError("Configured executor does not support recovery")
        handle = recover(
            backend_id,
            ExecutionBundle(
                (), None, {}, allocation, True, True,
                ExecutionLimits(256 * 1024, self.deadline_seconds), invocation,
            ),
            capture_output=True,
            output_limit_bytes=256 * 1024,
            on_event=on_event,
        )
        self.runs.attach(run_id)
        execution = ManagedActionExecution(
            plan, run_id, allocation, handle, action_handler(plan.kind),
        )
        self._active[run_id] = execution
        return execution

    def finish(
        self,
        execution: ManagedActionExecution,
        *,
        result_loader: Callable[[ExecutionAllocation], Mapping[str, Any]],
        artifact_loader: Callable[
            [ExecutionAllocation, Mapping[str, Any]], Sequence[LocalArtifactCandidate]
        ],
        retain_process_log: bool = False,
    ) -> dict:
        """Observe exit, validate the kind-specific result, then commit atomically."""

        if self._active.get(execution.run_id) is not execution:
            raise ValueError("Managed action execution is not attached")
        log_record = None
        try:
            try:
                output = execution.handle.wait(self.deadline_seconds)
            except ExecutionDeadlineExceeded:
                output = execution.handle.cancel(
                    interrupt_grace_seconds=0, terminate_grace_seconds=2,
                )
                if retain_process_log:
                    log_record = self._process_log(execution, output)
                return self.runs.fail(
                    execution.intent.scope,
                    execution.run_id,
                    error=f"Managed action exceeded its {self.deadline_seconds:g}-second deadline",
                    artifacts=(() if log_record is None else (log_record,)),
                )
            if retain_process_log:
                log_record = self._process_log(execution, output)
            delivery = output.cancellation
            if delivery and delivery.observed_terminated and any((
                delivery.interrupt_delivered,
                delivery.terminate_delivered,
                delivery.kill_delivered,
            )):
                return self.runs.confirm_cancellation(
                    execution.intent.scope, execution.run_id,
                    error="Managed action cancellation was observed",
                    artifacts=(() if log_record is None else (log_record,)),
                )
            if output.return_code != 0:
                return self.runs.fail(
                    execution.intent.scope,
                    execution.run_id,
                    error=f"Managed action exited with code {output.return_code}",
                    artifacts=(() if log_record is None else (log_record,)),
                )
            if output.event_error:
                return self.runs.fail(
                    execution.intent.scope,
                    execution.run_id,
                    error=f"Managed action event delivery failed: {output.event_error}",
                    artifacts=(() if log_record is None else (log_record,)),
                )
            if output.stdout_size > 256 * 1024 or output.stderr_size > 256 * 1024:
                return self.runs.fail(
                    execution.intent.scope,
                    execution.run_id,
                    error="Managed action exceeded its bounded output limit",
                    artifacts=(() if log_record is None else (log_record,)),
                )
            result = result_loader(execution.allocation)
            validated = execution.handler.validate_result(
                result, expected_protocol=execution.intent.result_protocol,
            )
            candidates = tuple(artifact_loader(execution.allocation, validated.value))
            records = (() if log_record is None else (log_record,)) + tuple(
                self.artifacts.local_record(
                    ArtifactAllocation(execution.run_id, execution.allocation.evidence_root),
                    candidate,
                )
                for candidate in candidates
            )
            return self.runs.complete(
                execution.intent.scope,
                execution.run_id,
                configuration={"result_protocol": execution.intent.result_protocol},
                artifacts=records,
            )
        except Exception as exc:
            run = self.runs.get(
                execution.intent.scope, execution.run_id, include_artifacts=False,
            )
            if run.get("status") not in {"completed", "failed", "cancelled"}:
                self.runs.fail(
                    execution.intent.scope, execution.run_id, error=str(exc),
                    artifacts=(() if log_record is None else (log_record,)),
                )
            raise
        finally:
            self._active.pop(execution.run_id, None)

    def _process_log(self, execution: ManagedActionExecution, output) -> Mapping[str, Any]:
        log_path = execution.allocation.evidence_root / "process.log"
        log_bytes = output.stdout or b""
        if output.stderr:
            log_bytes += (b"\n" if log_bytes else b"") + output.stderr
        log_path.write_bytes(log_bytes)
        return self.artifacts.local_record(
            ArtifactAllocation(execution.run_id, execution.allocation.evidence_root),
            LocalArtifactCandidate(
                "process.log", "process-log", log_path, "text/plain",
                len(log_bytes), hashlib.sha256(log_bytes).hexdigest(),
                {
                    "stdout_bytes_observed": output.stdout_size,
                    "stderr_bytes_observed": output.stderr_size,
                    "truncated": (
                        output.stdout_size > len(output.stdout or b"")
                        or output.stderr_size > len(output.stderr or b"")
                    ),
                },
            ),
        )

    def cancel(self, scope: RunScope, run_id: str) -> dict:
        """Persist intent first, then deliver and confirm only observed termination."""

        requested = self.runs.request_cancellation(scope, run_id)
        execution = self._active.get(str(run_id))
        if requested.get("status") != "running" or execution is None:
            return requested
        output = execution.handle.cancel()
        delivery = output.cancellation
        if delivery and delivery.observed_terminated and any((
            delivery.interrupt_delivered,
            delivery.terminate_delivered,
            delivery.kill_delivered,
        )):
            log_record = self._process_log(execution, output)
            return self.runs.confirm_cancellation(
                scope, run_id, error="Managed action cancellation was observed",
                artifacts=(log_record,),
            )
        return self.runs.get(scope, run_id)

    def cancel_active(self) -> tuple[dict, ...]:
        """Boundedly stop every process still owned by this coordinator."""

        results = []
        for execution in tuple(self._active.values()):
            results.append(self.cancel(execution.intent.scope, execution.run_id))
        return tuple(results)


# Compatibility name retained for existing Phase 3 consumers.
ManagedLocalActionService = ManagedActionService
