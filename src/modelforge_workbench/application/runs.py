"""Delivery-neutral application ownership for durable managed runs."""

from __future__ import annotations

import json
import re
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from types import MappingProxyType
from typing import Any, Callable, Mapping, Protocol, Sequence


_IDENTITY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$")
_TERMINAL = frozenset({"completed", "failed", "cancelled"})


def _valid_identity(value: str, label: str) -> str:
    value = str(value or "")
    if not _IDENTITY.fullmatch(value):
        raise ValueError(f"Run {label} identity is invalid")
    return value


def _freeze_json(value: Any) -> Any:
    if isinstance(value, Mapping):
        return MappingProxyType({str(key): _freeze_json(item) for key, item in value.items()})
    if isinstance(value, (list, tuple)):
        return tuple(_freeze_json(item) for item in value)
    return value


def _json_mapping(value: Mapping[str, Any] | None, label: str) -> Mapping[str, Any]:
    try:
        normalized = json.loads(json.dumps(dict(value or {}), allow_nan=False))
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label} must contain JSON values") from exc
    if not isinstance(normalized, dict):
        raise ValueError(f"{label} must be an object")
    return _freeze_json(normalized)


def thaw_json(value: Any) -> Any:
    """Return a detached mutable JSON value for a persistence adapter."""

    if isinstance(value, Mapping):
        return {str(key): thaw_json(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return [thaw_json(item) for item in value]
    return value


@dataclass(frozen=True)
class RunScope:
    """Immutable organization scope, optionally narrowed to one project."""

    organization_id: str
    project_id: str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(
            self, "organization_id", _valid_identity(self.organization_id, "organization"),
        )
        if self.project_id is not None:
            object.__setattr__(
                self, "project_id", _valid_identity(self.project_id, "project"),
            )


@dataclass(frozen=True)
class RunIntent:
    """Action-neutral, already-authorized intent for one durable run."""

    scope: RunScope
    user_id: str
    name: str
    provider: str
    compute_target: str
    request: Mapping[str, Any]
    configuration: Mapping[str, Any] = field(default_factory=dict)
    dataset_ref: str = ""
    artifact_backend: str | None = None
    artifact_prefix: str | None = None

    def __post_init__(self) -> None:
        if self.scope.project_id is None:
            raise ValueError("Run creation requires a project scope")
        object.__setattr__(self, "user_id", _valid_identity(self.user_id, "user"))
        if not str(self.name or "").strip():
            raise ValueError("Run name is required")
        if not str(self.provider or "").strip() or not str(self.compute_target or "").strip():
            raise ValueError("Run provider and compute target are required")
        object.__setattr__(self, "name", str(self.name)[:240])
        object.__setattr__(self, "provider", str(self.provider))
        object.__setattr__(self, "compute_target", str(self.compute_target))
        object.__setattr__(self, "dataset_ref", str(self.dataset_ref or ""))
        request = _json_mapping(self.request, "Run request")
        _valid_identity(str(request.get("action_id") or ""), "action")
        object.__setattr__(self, "request", request)
        object.__setattr__(
            self, "configuration", _json_mapping(self.configuration, "Run configuration"),
        )


@dataclass(frozen=True)
class RunTransition:
    """One compare-and-transition request for the persistence adapter."""

    allowed_from: frozenset[str]
    status: str | None = None
    configuration_patch: Mapping[str, Any] = field(default_factory=dict)
    forbidden_configuration_keys: frozenset[str] = field(default_factory=frozenset)
    metrics: Mapping[str, Any] | None = None
    backend_id: str | None = None
    error: str | None = None
    artifacts: tuple[Mapping[str, Any], ...] = ()


class RunRepository(Protocol):
    """Persistence port containing only current application use cases."""

    def create(self, intent: RunIntent, *, run_id: str | None = None) -> dict: ...

    def get(
        self, scope: RunScope, run_id: str, *, include_artifacts: bool = True,
    ) -> dict: ...

    def list(self, scope: RunScope, *, limit: int = 100) -> list[dict]: ...

    def transition(
        self, scope: RunScope, run_id: str, change: RunTransition,
    ) -> bool: ...


class RunService:
    """Own durable run identity, transitions, cancellation, and reconciliation."""

    def __init__(
        self,
        repository: RunRepository,
        *,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        self.repository = repository
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        self._lock = threading.RLock()
        self._attached: set[str] = set()

    def _timestamp(self) -> str:
        value = self.clock()
        if not isinstance(value, datetime):
            raise TypeError("Run clock must return a datetime")
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat()

    def create(self, intent: RunIntent, *, run_id: str | None = None) -> dict:
        if not isinstance(intent, RunIntent):
            raise TypeError("Run creation requires a RunIntent")
        return self.repository.create(intent, run_id=run_id)

    def get(
        self, scope: RunScope, run_id: str, *, include_artifacts: bool = True,
    ) -> dict:
        return self.repository.get(
            scope, str(run_id), include_artifacts=include_artifacts,
        )

    def list(self, scope: RunScope, *, limit: int = 100) -> list[dict]:
        return self.repository.list(scope, limit=limit)

    def attach(self, run_id: str) -> None:
        with self._lock:
            self._attached.add(str(run_id))

    def detach(self, run_id: str) -> None:
        with self._lock:
            self._attached.discard(str(run_id))

    def is_attached(self, run_id: str) -> bool:
        with self._lock:
            return str(run_id) in self._attached

    def confirm_running(self, scope: RunScope, run_id: str, *, backend_id: str) -> dict:
        self.get(scope, run_id, include_artifacts=False)
        applied = self.repository.transition(scope, run_id, RunTransition(
            allowed_from=frozenset({"queued"}), status="running",
            backend_id=str(backend_id),
            forbidden_configuration_keys=frozenset({"cancellation_requested_at"}),
        ))
        run = self.get(scope, run_id)
        if not applied and run.get("status") not in _TERMINAL:
            if (
                run.get("status") == "queued"
                and (run.get("configuration") or {}).get("cancellation_requested_at")
            ):
                return run
            raise RuntimeError("Run could not confirm its backend start")
        if run.get("status") in _TERMINAL:
            self.detach(run_id)
        return run

    def request_cancellation(self, scope: RunScope, run_id: str) -> dict:
        self.get(scope, run_id, include_artifacts=False)
        self.repository.transition(scope, run_id, RunTransition(
            allowed_from=frozenset({"queued", "running"}),
            configuration_patch={"cancellation_requested_at": self._timestamp()},
            forbidden_configuration_keys=frozenset({"cancellation_requested_at"}),
        ))
        return self.get(scope, run_id)

    def confirm_cancellation(
        self,
        scope: RunScope,
        run_id: str,
        *,
        error: str = "Run cancellation was confirmed",
        artifacts: Sequence[Mapping[str, Any]] = (),
    ) -> dict:
        run = self.request_cancellation(scope, run_id)
        if run.get("status") in _TERMINAL:
            self.detach(run_id)
            return run
        artifact_records = tuple(dict(artifact) for artifact in artifacts)
        for artifact in artifact_records:
            metadata = artifact.get("metadata")
            if (
                not isinstance(metadata, Mapping)
                or str(metadata.get("evidence_id") or "") != str(run_id)
            ):
                raise ValueError("Run artifact is not bound to this run allocation")
        applied = self.repository.transition(scope, run_id, RunTransition(
            allowed_from=frozenset({"queued", "running"}), status="cancelled",
            configuration_patch={"cancellation_confirmed_at": self._timestamp()},
            error=str(error)[:2_000],
            artifacts=artifact_records,
        ))
        run = self.get(scope, run_id)
        if not applied and run.get("status") not in _TERMINAL:
            raise RuntimeError("Run cancellation could not be confirmed")
        self.detach(run_id)
        return run

    def fail(
        self, scope: RunScope, run_id: str, *, error: str,
        artifacts: Sequence[Mapping[str, Any]] = (),
    ) -> dict:
        self.get(scope, run_id, include_artifacts=False)
        artifact_records = tuple(dict(artifact) for artifact in artifacts)
        for artifact in artifact_records:
            metadata = artifact.get("metadata")
            if not isinstance(metadata, Mapping) or str(metadata.get("evidence_id") or "") != str(run_id):
                raise ValueError("Run artifact is not bound to this run allocation")
        applied = self.repository.transition(scope, run_id, RunTransition(
            allowed_from=frozenset({"queued", "running"}), status="failed",
            error=str(error or "Run failed")[:2_000], artifacts=artifact_records,
        ))
        run = self.get(scope, run_id)
        if not applied and run.get("status") not in _TERMINAL:
            raise RuntimeError("Run failure could not be recorded")
        if run.get("status") in _TERMINAL:
            self.detach(run_id)
        return run

    def complete(
        self,
        scope: RunScope,
        run_id: str,
        *,
        configuration: Mapping[str, Any] | None = None,
        metrics: Mapping[str, Any] | None = None,
        artifacts: Sequence[Mapping[str, Any]] = (),
    ) -> dict:
        """Atomically commit artifacts and success unless a terminal outcome won first."""

        self.get(scope, run_id, include_artifacts=False)
        artifact_records = tuple(dict(artifact) for artifact in artifacts)
        for artifact in artifact_records:
            metadata = artifact.get("metadata")
            evidence_id = (
                metadata.get("evidence_id") if isinstance(metadata, Mapping) else None
            )
            if str(evidence_id or "") != str(run_id):
                raise ValueError("Run artifact is not bound to this run allocation")
        applied = self.repository.transition(scope, run_id, RunTransition(
            allowed_from=frozenset({"running"}), status="completed",
            configuration_patch=dict(configuration or {}),
            metrics=dict(metrics or {}),
            artifacts=artifact_records,
        ))
        run = self.get(scope, run_id)
        if not applied and run.get("status") not in _TERMINAL:
            raise RuntimeError("Run completion could not be committed")
        if run.get("status") in _TERMINAL:
            self.detach(run_id)
        return run

    def reconcile_vanished(
        self,
        scope: RunScope,
        *,
        limit: int = 100,
        accepts: Callable[[Mapping[str, Any]], bool],
        is_process_alive: Callable[[Mapping[str, Any]], bool | None],
        error: str,
    ) -> list[dict]:
        """Fail accepted, unattached local rows only when liveness is false."""

        changed = []
        for run in self.list(scope, limit=limit):
            run_id = str(run.get("id") or "")
            if (
                run.get("provider") != "local"
                or run.get("status") != "running"
                or not accepts(run)
                or self.is_attached(run_id)
                or is_process_alive(run) is not False
            ):
                continue
            applied = self.repository.transition(scope, run_id, RunTransition(
                allowed_from=frozenset({"running"}), status="failed",
                error=str(error)[:2_000],
            ))
            if applied:
                changed.append(self.get(scope, run_id))
        return changed
