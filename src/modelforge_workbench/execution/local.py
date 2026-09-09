# Copyright (C) 2026 Mathew Turnell
# SPDX-License-Identifier: Apache-2.0

"""Shell-free local process execution with bounded output and group shutdown."""

from __future__ import annotations

import os
import signal
import subprocess
import threading
import time
from datetime import datetime, timezone
from typing import IO, Any

from ..application.execution import (
    CancellationDelivery,
    ExecutionBundle,
    ExecutionDeadlineExceeded,
    ExecutionEvent,
    ExecutionOutput,
    ProcessIdentity,
)


_DRAIN_CHUNK_BYTES = 64 * 1024
_STOP_WAIT_SECONDS = 2


class LocalExecutor:
    """Execute an immutable bundle without owning run or result truth."""

    def start(
        self,
        bundle: ExecutionBundle,
        *,
        capture_output: bool,
        output_limit_bytes: int,
        on_event=None,
    ):
        if not isinstance(bundle, ExecutionBundle):
            raise TypeError("Local execution requires an ExecutionBundle")
        if bundle.provider_invocation is not None:
            raise ValueError("Local execution cannot start a provider invocation")
        if isinstance(output_limit_bytes, bool) or not isinstance(output_limit_bytes, int) \
                or output_limit_bytes <= 0:
            raise ValueError("Local execution output limit must be a positive integer")
        if bundle.limits is not None and bundle.limits.output_bytes != output_limit_bytes:
            raise ValueError("Local execution output limit differs from its bundle")
        process = subprocess.Popen(
            bundle.argv,
            cwd=bundle.working_directory,
            env=dict(bundle.environment),
            stdout=subprocess.PIPE if capture_output else None,
            stderr=(
                subprocess.STDOUT
                if capture_output and bundle.merge_stderr
                else subprocess.PIPE if capture_output else None
            ),
            start_new_session=os.name == "posix",
        )
        return LocalExecutionHandle(
            process,
            capture_output=capture_output,
            output_limit_bytes=output_limit_bytes,
            on_event=on_event,
            merge_stderr=bundle.merge_stderr,
            retain_output_tail=bundle.retain_output_tail,
        )

    def execute(
        self,
        bundle: ExecutionBundle,
        *,
        capture_output: bool,
        timeout_seconds: float,
        output_limit_bytes: int,
    ) -> ExecutionOutput:
        if bundle.limits is not None:
            if bundle.limits.output_bytes != output_limit_bytes:
                raise ValueError("Local execution output limit differs from its bundle")
            if (
                bundle.limits.deadline_seconds is not None
                and bundle.limits.deadline_seconds != float(timeout_seconds)
            ):
                raise ValueError("Local execution deadline differs from its bundle")
        handle = self.start(
            bundle,
            capture_output=capture_output,
            output_limit_bytes=output_limit_bytes,
        )
        try:
            return handle.wait(timeout_seconds)
        except ExecutionDeadlineExceeded:
            output = handle.cancel(
                interrupt_grace_seconds=0,
                terminate_grace_seconds=_STOP_WAIT_SECONDS,
            )
            return ExecutionOutput(
                **{
                    **output.__dict__,
                    "timed_out": True,
                }
            )


class LocalExecutionHandle:
    """Opaque process-group handle with concurrent bounded stream drains."""

    def __init__(
        self,
        process,
        *,
        capture_output: bool,
        output_limit_bytes: int,
        on_event,
        merge_stderr: bool,
        retain_output_tail: bool,
    ) -> None:
        self._process = process
        self._capture_output = capture_output
        self._output_limit_bytes = output_limit_bytes
        self._on_event = on_event
        self._retain_output_tail = retain_output_tail
        self._buffers = {"stdout": bytearray(), "stderr": bytearray()}
        self._sizes = {"stdout": 0, "stderr": 0}
        self._sequence = 0
        self._event_lock = threading.Lock()
        self._wait_lock = threading.Lock()
        self._drains = []
        self._event_error = None
        self._cancellation = CancellationDelivery(False, False, False, False, False)
        if capture_output:
            streams = [("stdout", getattr(process, "stdout", None))]
            if not merge_stderr:
                streams.append(("stderr", getattr(process, "stderr", None)))
            for name, stream in streams:
                if stream is None:  # pragma: no cover - guarded by subprocess.PIPE.
                    continue
                thread = threading.Thread(
                    target=self._drain,
                    args=(name, stream),
                    daemon=True,
                )
                thread.start()
                self._drains.append(thread)

    @property
    def identity(self) -> ProcessIdentity:
        return ProcessIdentity(self._process.pid)

    def poll(self) -> int | None:
        return self._process.poll()

    def _drain(self, name: str, stream: IO[bytes]) -> None:
        read = getattr(stream, "read1", stream.read)
        while True:
            chunk = read(_DRAIN_CHUNK_BYTES)
            if not chunk:
                break
            event = None
            with self._event_lock:
                previous_size = self._sizes[name]
                self._sizes[name] += len(chunk)
                remaining = self._output_limit_bytes - len(self._buffers[name])
                if self._retain_output_tail:
                    self._buffers[name].extend(chunk)
                    if len(self._buffers[name]) > self._output_limit_bytes:
                        del self._buffers[name][:-self._output_limit_bytes]
                elif remaining > 0:
                    self._buffers[name].extend(chunk[:remaining])
                event_remaining = max(0, self._output_limit_bytes - previous_size)
                if event_remaining:
                    self._sequence += 1
                    event = ExecutionEvent(
                        self._sequence,
                        datetime.now(timezone.utc),
                        name,
                        bytes(chunk[:event_remaining]),
                    )
                if self._on_event is not None and event is not None:
                    try:
                        self._on_event(event)
                    except Exception as exc:  # The drain must continue to avoid pipe deadlock.
                        if self._event_error is None:
                            self._event_error = (
                                f"{type(exc).__name__}: {exc}"[:2_000]
                            )

    def wait(self, timeout_seconds: float | None = None) -> ExecutionOutput:
        try:
            with self._wait_lock:
                return_code = self._process.wait(timeout=timeout_seconds)
        except subprocess.TimeoutExpired as exc:
            raise ExecutionDeadlineExceeded("Local process exceeded its deadline") from exc
        self._join_drains()
        if self._cancellation.requested:
            self._cancellation = CancellationDelivery(
                True,
                self._cancellation.interrupt_delivered,
                self._cancellation.terminate_delivered,
                self._cancellation.kill_delivered,
                not _owned_process_group_alive(self._process),
            )
        return self._output(return_code)

    def cancel(
        self, *, interrupt_grace_seconds: float = 10, terminate_grace_seconds: float = 5,
    ) -> ExecutionOutput:
        interrupt_delivered = False
        terminate_delivered = False
        kill_delivered = False
        if self.poll() is None or _owned_process_group_alive(self._process):
            interrupt_delivered = _signal_process(self._process, interrupt=True)
        self._cancellation = CancellationDelivery(
            True,
            interrupt_delivered,
            False,
            False,
            not _owned_process_group_alive(self._process),
        )
        _wait_for_owned_process_group(
            self._process, max(0, float(interrupt_grace_seconds)),
        )
        if _owned_process_group_alive(self._process):
            terminate_delivered = _signal_process(self._process)
            self._cancellation = CancellationDelivery(
                True,
                interrupt_delivered,
                terminate_delivered,
                False,
                not _owned_process_group_alive(self._process),
            )
            _wait_for_owned_process_group(
                self._process, max(0, float(terminate_grace_seconds)),
            )
        if _owned_process_group_alive(self._process):
            kill_delivered = _kill_process(self._process)
            self._cancellation = CancellationDelivery(
                True,
                interrupt_delivered,
                terminate_delivered,
                kill_delivered,
                not _owned_process_group_alive(self._process),
            )
            _wait_for_owned_process_group(self._process, _STOP_WAIT_SECONDS)
        output = self.wait(_STOP_WAIT_SECONDS)
        self._cancellation = CancellationDelivery(
            True,
            interrupt_delivered,
            terminate_delivered,
            kill_delivered,
            not _owned_process_group_alive(self._process),
        )
        return ExecutionOutput(**{**output.__dict__, "cancellation": self._cancellation})

    def _join_drains(self) -> None:
        for thread in self._drains:
            join = getattr(thread, "join", None)
            if join is not None:
                join(timeout=_STOP_WAIT_SECONDS)

    def _output(self, return_code: int) -> ExecutionOutput:
        return ExecutionOutput(
            return_code=return_code,
            timed_out=False,
            stdout=bytes(self._buffers["stdout"]) if self._capture_output else None,
            stderr=bytes(self._buffers["stderr"]) if self._capture_output else None,
            stdout_size=self._sizes["stdout"],
            stderr_size=self._sizes["stderr"],
            pid=self._process.pid,
            cancellation=self._cancellation,
            event_error=self._event_error,
        )


def _signal_process(process: subprocess.Popen[Any], *, interrupt: bool = False) -> bool:
    try:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGINT if interrupt else signal.SIGTERM)
        elif interrupt:
            process.send_signal(signal.CTRL_BREAK_EVENT)
        else:
            process.terminate()
        return True
    except (OSError, ProcessLookupError):
        return False


def _owned_process_group_alive(process: subprocess.Popen[Any]) -> bool:
    if os.name != "posix":
        return process.poll() is None
    try:
        os.killpg(process.pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def _wait_for_owned_process_group(
    process: subprocess.Popen[Any], timeout_seconds: float,
) -> bool:
    deadline = time.monotonic() + max(0, timeout_seconds)
    while _owned_process_group_alive(process):
        process.poll()
        if time.monotonic() >= deadline:
            return False
        time.sleep(min(0.02, max(0, deadline - time.monotonic())))
    process.poll()
    return True


def _kill_process(process: subprocess.Popen[Any]) -> bool:
    try:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGKILL)
        else:
            process.kill()
        return True
    except (OSError, ProcessLookupError):
        return False


__all__ = ["LocalExecutor"]
