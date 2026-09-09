# Copyright (C) 2026 Mathew Turnell
# SPDX-License-Identifier: Apache-2.0

"""Delivery-neutral contracts for one already-prepared process execution."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from types import MappingProxyType
from typing import Any, Callable, Mapping, Protocol, runtime_checkable


class ExecutionDeadlineExceeded(TimeoutError):
    """Raised when an owned process exceeds its host-supplied deadline."""


@dataclass(frozen=True)
class ExecutionAllocation:
    """Run-owned local paths and authorized input references for managed work."""

    execution_id: str
    work_root: Path
    evidence_root: Path
    cache_root: Path
    authorized_inputs: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not str(self.execution_id or "").strip():
            raise ValueError("Execution allocation requires an identity")
        roots = tuple(Path(value).expanduser().resolve() for value in (
            self.work_root, self.evidence_root, self.cache_root,
        ))
        if len(set(roots)) != len(roots):
            raise ValueError("Execution allocation roots must be distinct")
        object.__setattr__(self, "execution_id", str(self.execution_id))
        object.__setattr__(self, "work_root", roots[0])
        object.__setattr__(self, "evidence_root", roots[1])
        object.__setattr__(self, "cache_root", roots[2])
        object.__setattr__(
            self, "authorized_inputs", tuple(str(value) for value in self.authorized_inputs),
        )


@dataclass(frozen=True)
class ExecutionEvent:
    """One bounded, ordered process stream observation."""

    sequence: int
    timestamp: datetime
    stream: str
    data: bytes = field(repr=False)


@dataclass(frozen=True)
class ProcessIdentity:
    """Ephemeral identity of one process owned by a local executor handle."""

    pid: int

    @property
    def backend_id(self) -> str:
        return str(self.pid)


@dataclass(frozen=True)
class ProviderExecutionIdentity:
    """Opaque provider-owned identity retained as durable run evidence."""

    backend_id: str

    def __post_init__(self) -> None:
        value = str(self.backend_id or "").strip()
        if not value or len(value) > 240 or any(ord(character) < 32 for character in value):
            raise ValueError("Provider execution identity is invalid")
        object.__setattr__(self, "backend_id", value)


@dataclass(frozen=True)
class ProviderFunctionInvocation:
    """Private, provider-neutral description of one fixed remote function call."""

    provider: str
    application: str
    function: str
    environment_name: str
    payload: Mapping[str, Any] = field(repr=False)

    def __post_init__(self) -> None:
        provider = str(self.provider or "").strip().casefold()
        application = str(self.application or "").strip()
        function = str(self.function or "").strip()
        environment_name = str(self.environment_name or "").strip()
        if not provider or not application or not function or not environment_name:
            raise ValueError("Provider function identity and environment are required")
        if any(
            len(value) > 200 or any(ord(character) < 32 for character in value)
            for value in (provider, application, function, environment_name)
        ):
            raise ValueError("Provider function identity is invalid")
        if not isinstance(self.payload, Mapping):
            raise TypeError("Provider function payload must be an object")
        object.__setattr__(self, "provider", provider)
        object.__setattr__(self, "application", application)
        object.__setattr__(self, "function", function)
        object.__setattr__(self, "environment_name", environment_name)
        object.__setattr__(self, "payload", MappingProxyType(dict(self.payload)))


@dataclass(frozen=True)
class CancellationDelivery:
    """Signal delivery evidence; it is not terminal cancellation truth."""

    requested: bool
    interrupt_delivered: bool
    terminate_delivered: bool
    kill_delivered: bool
    observed_terminated: bool


@dataclass(frozen=True)
class ExecutionLimits:
    """Validated process limits carried with one immutable execution bundle."""

    output_bytes: int
    deadline_seconds: float | None = None

    def __post_init__(self) -> None:
        if (
            isinstance(self.output_bytes, bool)
            or not isinstance(self.output_bytes, int)
            or self.output_bytes <= 0
        ):
            raise ValueError("Execution output limit must be a positive integer")
        if self.deadline_seconds is not None and (
            isinstance(self.deadline_seconds, bool)
            or not isinstance(self.deadline_seconds, (int, float))
            or self.deadline_seconds <= 0
        ):
            raise ValueError("Execution deadline must be a positive number")
        if self.deadline_seconds is not None:
            object.__setattr__(self, "deadline_seconds", float(self.deadline_seconds))


@dataclass(frozen=True)
class ExecutionBundle:
    """Immutable argv, working directory, and environment for one process.

    The bundle is an in-process authority produced after project action
    preparation. It is deliberately not a public DTO and does not contain a
    run identity, result contract, artifact policy, or delivery state.
    """

    argv: tuple[str, ...]
    working_directory: Path | None
    environment: Mapping[str, str] = field(repr=False)
    allocation: ExecutionAllocation | None = None
    merge_stderr: bool = False
    retain_output_tail: bool = False
    limits: ExecutionLimits | None = None
    provider_invocation: ProviderFunctionInvocation | None = None

    def __post_init__(self) -> None:
        argv = tuple(str(argument) for argument in self.argv)
        if self.provider_invocation is None and (not argv or not argv[0]):
            raise ValueError("Local execution argv must contain an executable")
        if self.provider_invocation is not None and argv:
            raise ValueError("Provider execution cannot also carry local argv")
        working_directory = (
            None if self.working_directory is None else Path(self.working_directory)
        )
        environment = MappingProxyType({
            str(key): str(value) for key, value in self.environment.items()
        })
        if any("\x00" in value for value in (*argv, *(environment.keys()), *(environment.values()))):
            raise ValueError("Execution argv and environment cannot contain NUL bytes")
        if working_directory is not None and "\x00" in str(working_directory):
            raise ValueError("Execution working directory cannot contain NUL bytes")
        if self.allocation is not None and not isinstance(self.allocation, ExecutionAllocation):
            raise TypeError("Execution allocation is invalid")
        if not isinstance(self.merge_stderr, bool):
            raise TypeError("Execution stderr policy is invalid")
        if not isinstance(self.retain_output_tail, bool):
            raise TypeError("Execution output retention policy is invalid")
        if self.limits is not None and not isinstance(self.limits, ExecutionLimits):
            raise TypeError("Execution limits are invalid")
        if self.provider_invocation is not None and not isinstance(
            self.provider_invocation, ProviderFunctionInvocation,
        ):
            raise TypeError("Provider invocation is invalid")
        object.__setattr__(self, "argv", argv)
        object.__setattr__(self, "working_directory", working_directory)
        object.__setattr__(self, "environment", environment)


@dataclass(frozen=True)
class ExecutionOutput:
    """Bounded terminal process evidence returned by an executor."""

    return_code: int
    timed_out: bool
    stdout: bytes | None = field(default=None, repr=False)
    stderr: bytes | None = field(default=None, repr=False)
    stdout_size: int = 0
    stderr_size: int = 0
    pid: int | None = None
    cancellation: CancellationDelivery | None = None
    event_error: str | None = None


@runtime_checkable
class ExecutionHandle(Protocol):
    """Opaque live process handle retained only by an execution coordinator."""

    @property
    def identity(self) -> ProcessIdentity | ProviderExecutionIdentity: ...

    def poll(self) -> int | None: ...

    def wait(self, timeout_seconds: float | None = None) -> ExecutionOutput: ...

    def cancel(
        self, *, interrupt_grace_seconds: float = 10, terminate_grace_seconds: float = 5,
    ) -> ExecutionOutput: ...


@runtime_checkable
class Executor(Protocol):
    """Port for delivery-neutral local or provider process mechanics."""

    def start(
        self,
        bundle: ExecutionBundle,
        *,
        capture_output: bool,
        output_limit_bytes: int,
        on_event: Callable[[ExecutionEvent], None] | None = None,
    ) -> ExecutionHandle: ...

    def execute(
        self,
        bundle: ExecutionBundle,
        *,
        capture_output: bool,
        timeout_seconds: float,
        output_limit_bytes: int,
    ) -> ExecutionOutput: ...


__all__ = [
    "CancellationDelivery",
    "ExecutionAllocation",
    "ExecutionBundle",
    "ExecutionDeadlineExceeded",
    "ExecutionEvent",
    "ExecutionHandle",
    "ExecutionLimits",
    "ExecutionOutput",
    "Executor",
    "ProcessIdentity",
    "ProviderExecutionIdentity",
    "ProviderFunctionInvocation",
]
