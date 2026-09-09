# Copyright (C) 2026 Mathew Turnell
# SPDX-License-Identifier: Apache-2.0

"""Optional Modal execution adapter for owner-authorized function calls."""

from __future__ import annotations

import base64
import binascii
import hashlib
import importlib
import json
import os
import re
import stat
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Mapping

from ..application.execution import (
    CancellationDelivery,
    ExecutionBundle,
    ExecutionDeadlineExceeded,
    ExecutionEvent,
    ExecutionOutput,
    ProviderExecutionIdentity,
)


MODAL_APP_NAME = "modelforge-alpha-synthetic"
MODAL_FUNCTION_NAME = "run_synthetic_threshold"
MODAL_TRANSPORT_PROTOCOL = "modelforge.modal-execution-result/v1"
_CALL_ID = re.compile(r"^fc-[A-Za-z0-9_-]{2,200}$")
_PROVIDER_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_FILE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$")
_MAX_TRANSPORT_BYTES = 3 * 1024 * 1024
_MAX_ARTIFACT_BYTES = 2 * 1024 * 1024
_MAX_ARTIFACT_COUNT = 8


def _load_modal(modal_module=None):
    if modal_module is not None:
        return modal_module
    try:
        return importlib.import_module("modal")
    except ImportError as exc:
        raise RuntimeError(
            "Modal support is not installed; install modelforge-workbench[modal]"
        ) from exc


def modal_readiness(environment_name: str, *, modal_module=None) -> dict:
    """Inspect local SDK/credential readiness without contacting Modal."""

    environment = str(environment_name or "").strip()
    if not environment:
        raise ValueError("Modal environment name is required")
    try:
        modal = _load_modal(modal_module)
    except RuntimeError:
        return {
            "protocol": "modelforge.modal-readiness/v1",
            "provider": "modal",
            "environment": environment,
            "sdk_installed": False,
            "sdk_version": None,
            "credentials": "not_configured",
            "verification": "not_performed",
            "ready": False,
            "reasons": ["Install the optional Modal dependency"],
        }

    configured = False
    try:
        config = modal.config.Config()
        configured = bool(config.get("token_id") and config.get("token_secret"))
    except Exception:
        configured = bool(
            os.environ.get("MODAL_TOKEN_ID") and os.environ.get("MODAL_TOKEN_SECRET")
        )
    reasons = [] if configured else ["Configure a Modal token with the Modal SDK"]
    return {
        "protocol": "modelforge.modal-readiness/v1",
        "provider": "modal",
        "environment": environment,
        "sdk_installed": True,
        "sdk_version": str(getattr(modal, "__version__", "unknown")),
        "credentials": "configured" if configured else "not_configured",
        "verification": "not_performed",
        "ready": configured,
        "reasons": reasons,
    }


class ModalExecutor:
    """Submit and recover a validated owner-authorized Modal function call.

    Provider locators are resolved by the application binding service. This
    adapter deliberately validates their shape but does not make authorization
    decisions from project-authored or browser-controlled data.
    """

    def __init__(self, *, modal_module=None) -> None:
        self._modal_module = modal_module

    @property
    def modal(self):
        return _load_modal(self._modal_module)

    def _validate_bundle(self, bundle: ExecutionBundle, output_limit_bytes: int):
        if not isinstance(bundle, ExecutionBundle):
            raise TypeError("Modal execution requires an ExecutionBundle")
        invocation = bundle.provider_invocation
        if invocation is None or invocation.provider != "modal":
            raise ValueError("Modal execution requires a Modal provider invocation")
        if not _PROVIDER_NAME.fullmatch(invocation.application):
            raise ValueError("Modal application identity is invalid")
        if not _PROVIDER_NAME.fullmatch(invocation.function):
            raise ValueError("Modal function identity is invalid")
        if not _PROVIDER_NAME.fullmatch(invocation.environment_name):
            raise ValueError("Modal environment identity is invalid")
        if bundle.allocation is None:
            raise ValueError("Modal execution requires an owned run allocation")
        if output_limit_bytes <= 0:
            raise ValueError("Modal output limit must be positive")
        if bundle.limits is not None and bundle.limits.output_bytes != output_limit_bytes:
            raise ValueError("Modal output limit differs from its bundle")
        return invocation

    def start(
        self, bundle: ExecutionBundle, *, capture_output: bool,
        output_limit_bytes: int, on_event=None,
    ):
        invocation = self._validate_bundle(bundle, output_limit_bytes)
        function = self.modal.Function.from_name(
            invocation.application,
            invocation.function,
            environment_name=invocation.environment_name,
        )
        call = function.spawn(dict(invocation.payload))
        call_id = str(getattr(call, "object_id", ""))
        if not _CALL_ID.fullmatch(call_id):
            raise RuntimeError("Modal returned an invalid function-call identity")
        return ModalExecutionHandle(
            self.modal, call, bundle, capture_output=capture_output,
            output_limit_bytes=output_limit_bytes, on_event=on_event,
        )

    def recover(
        self, backend_id: str, bundle: ExecutionBundle, *, capture_output: bool,
        output_limit_bytes: int, on_event=None,
    ):
        self._validate_bundle(bundle, output_limit_bytes)
        if not _CALL_ID.fullmatch(str(backend_id or "")):
            raise ValueError("Modal recovery requires a valid function-call identity")
        call = self.modal.FunctionCall.from_id(str(backend_id))
        return ModalExecutionHandle(
            self.modal, call, bundle, capture_output=capture_output,
            output_limit_bytes=output_limit_bytes, on_event=on_event,
        )

    def execute(
        self, bundle: ExecutionBundle, *, capture_output: bool,
        timeout_seconds: float, output_limit_bytes: int,
    ) -> ExecutionOutput:
        handle = self.start(
            bundle, capture_output=capture_output,
            output_limit_bytes=output_limit_bytes,
        )
        try:
            return handle.wait(timeout_seconds)
        except ExecutionDeadlineExceeded:
            output = handle.cancel(interrupt_grace_seconds=0, terminate_grace_seconds=0)
            return ExecutionOutput(**{**output.__dict__, "timed_out": True})


class ModalExecutionHandle:
    """Opaque Modal FunctionCall handle; durable truth remains in Run Service."""

    def __init__(
        self, modal, call, bundle, *, capture_output: bool,
        output_limit_bytes: int, on_event,
    ) -> None:
        self._modal = modal
        self._call = call
        self._bundle = bundle
        self._capture_output = capture_output
        self._output_limit_bytes = output_limit_bytes
        self._on_event = on_event
        self._output: ExecutionOutput | None = None
        self._cancellation_requested = False

    @property
    def identity(self) -> ProviderExecutionIdentity:
        return ProviderExecutionIdentity(str(self._call.object_id))

    def _is_timeout(self, exc: BaseException) -> bool:
        timeout_type = getattr(getattr(self._modal, "exception", object()), "TimeoutError", None)
        return isinstance(exc, TimeoutError) or (
            isinstance(timeout_type, type) and isinstance(exc, timeout_type)
        )

    def _is_cancelled(self, exc: BaseException) -> bool:
        cancellation_type = getattr(
            getattr(self._modal, "exception", object()), "InputCancellation", None,
        )
        if isinstance(cancellation_type, type) and isinstance(exc, cancellation_type):
            return True
        remote_error = getattr(
            getattr(self._modal, "exception", object()), "RemoteError", None,
        )
        return (
            self._cancellation_requested
            and
            isinstance(remote_error, type)
            and isinstance(exc, remote_error)
            and self._provider_reports_terminated()
        )

    def _provider_reports_terminated(self) -> bool:
        """Confirm the root provider input was terminated after cancellation."""

        call_id = str(getattr(self._call, "object_id", ""))
        for attempt in range(6):
            try:
                graph = self._call.get_call_graph()
            except BaseException:
                return False
            for item in graph:
                if str(getattr(item, "function_call_id", "")) != call_id:
                    continue
                status = getattr(getattr(item, "status", None), "name", "")
                if status == "TERMINATED":
                    return True
                if status not in {"PENDING", "RUNNING"}:
                    return False
            if attempt < 5:
                time.sleep(0.5)
        return False

    def poll(self) -> int | None:
        if self._output is not None:
            return self._output.return_code
        try:
            self._output = self._collect(timeout_seconds=0)
        except ExecutionDeadlineExceeded:
            return None
        return self._output.return_code

    def wait(self, timeout_seconds: float | None = None) -> ExecutionOutput:
        if self._output is None:
            self._output = self._collect(timeout_seconds=timeout_seconds)
        return self._output

    def cancel(
        self, *, interrupt_grace_seconds: float = 10, terminate_grace_seconds: float = 5,
    ) -> ExecutionOutput:
        del interrupt_grace_seconds, terminate_grace_seconds
        if self._output is not None:
            return ExecutionOutput(**{
                **self._output.__dict__,
                "cancellation": CancellationDelivery(True, False, False, False, False),
            })
        self._cancellation_requested = True
        self._call.cancel()
        try:
            output = self._collect(timeout_seconds=5)
        except ExecutionDeadlineExceeded:
            return ExecutionOutput(
                return_code=1, timed_out=False,
                cancellation=CancellationDelivery(True, False, True, False, False),
            )
        except BaseException as exc:
            if not self._is_cancelled(exc):
                raise
            output = ExecutionOutput(
                return_code=-15, timed_out=False,
                cancellation=CancellationDelivery(True, False, True, False, True),
            )
        else:
            if not (output.cancellation and output.cancellation.observed_terminated):
                output = ExecutionOutput(**{
                    **output.__dict__,
                    "cancellation": CancellationDelivery(True, False, True, False, False),
                })
        self._output = output
        return output

    def _collect(self, *, timeout_seconds: float | None) -> ExecutionOutput:
        try:
            envelope = self._call.get(timeout=timeout_seconds)
        except BaseException as exc:
            if self._is_timeout(exc):
                raise ExecutionDeadlineExceeded("Modal function call is still running") from exc
            if self._is_cancelled(exc):
                return ExecutionOutput(
                    return_code=-15, timed_out=False,
                    cancellation=CancellationDelivery(True, False, True, False, True),
                )
            raise
        return self._materialize(envelope)

    def _materialize(self, envelope: Any) -> ExecutionOutput:
        if not isinstance(envelope, Mapping):
            raise ValueError("Modal execution result must be an object")
        encoded = json.dumps(envelope, sort_keys=True, separators=(",", ":")).encode()
        if len(encoded) > _MAX_TRANSPORT_BYTES:
            raise ValueError("Modal execution result exceeded its transport bound")
        if envelope.get("protocol") != MODAL_TRANSPORT_PROTOCOL:
            raise ValueError("Modal execution result protocol is unsupported")
        if set(envelope) != {
            "protocol", "execution_id", "return_code", "stdout", "stderr", "files",
        }:
            raise ValueError("Modal execution result contains unexpected fields")
        if envelope.get("execution_id") != self._bundle.allocation.execution_id:
            raise ValueError("Modal execution result belongs to a different run allocation")
        return_code = envelope.get("return_code")
        if isinstance(return_code, bool) or not isinstance(return_code, int) or not -255 <= return_code <= 255:
            raise ValueError("Modal execution return code is invalid")
        stdout = self._bounded_text(envelope.get("stdout"), "stdout")
        stderr = self._bounded_text(envelope.get("stderr"), "stderr")
        files = envelope.get("files")
        if not isinstance(files, list) or len(files) > _MAX_ARTIFACT_COUNT:
            raise ValueError("Modal execution file inventory is invalid")
        created: list[Path] = []
        total = 0
        try:
            for item in files:
                path, size, was_created = self._materialize_file(item)
                if was_created:
                    created.append(path)
                total += size
                if total > _MAX_ARTIFACT_BYTES:
                    raise ValueError("Modal execution files exceeded their materialization bound")
        except Exception:
            for path in created:
                path.unlink(missing_ok=True)
            raise
        event_error = None
        if self._capture_output and self._on_event is not None:
            sequence = 0
            for stream, value in (("stdout", stdout), ("stderr", stderr)):
                if not value:
                    continue
                sequence += 1
                try:
                    self._on_event(ExecutionEvent(
                        sequence, datetime.now(timezone.utc), stream,
                        value[:self._output_limit_bytes],
                    ))
                except Exception as exc:
                    event_error = f"{type(exc).__name__}: {exc}"[:2_000]
                    break
        return ExecutionOutput(
            return_code=return_code,
            timed_out=False,
            stdout=stdout[:self._output_limit_bytes] if self._capture_output else None,
            stderr=stderr[:self._output_limit_bytes] if self._capture_output else None,
            stdout_size=len(stdout),
            stderr_size=len(stderr),
            event_error=event_error,
        )

    def _bounded_text(self, value: Any, field: str) -> bytes:
        if not isinstance(value, str):
            raise ValueError(f"Modal execution {field} must be text")
        data = value.encode("utf-8")
        if len(data) > self._output_limit_bytes:
            raise ValueError(f"Modal execution {field} exceeded its output bound")
        return data

    def _materialize_file(self, item: Any) -> tuple[Path, int, bool]:
        if not isinstance(item, Mapping) or set(item) != {
            "name", "content_base64", "size_bytes", "sha256",
        }:
            raise ValueError("Modal execution file entry is invalid")
        name = str(item.get("name") or "")
        if not _FILE_NAME.fullmatch(name) or name in {".", ".."}:
            raise ValueError("Modal execution file name is unsafe")
        try:
            content = base64.b64decode(item.get("content_base64"), validate=True)
        except (binascii.Error, TypeError, ValueError) as exc:
            raise ValueError("Modal execution file encoding is invalid") from exc
        expected_size = item.get("size_bytes")
        expected_digest = str(item.get("sha256") or "")
        if expected_size != len(content) or hashlib.sha256(content).hexdigest() != expected_digest:
            raise ValueError("Modal execution file identity is invalid")
        if len(content) > _MAX_ARTIFACT_BYTES:
            raise ValueError("Modal execution file exceeded its materialization bound")
        root = self._bundle.allocation.evidence_root
        root_descriptor = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            try:
                descriptor = os.open(
                    name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600,
                    dir_fd=root_descriptor,
                )
            except FileExistsError:
                existing = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=root_descriptor)
                try:
                    existing_stat = os.fstat(existing)
                    existing_bytes = b""
                    while len(existing_bytes) <= _MAX_ARTIFACT_BYTES:
                        chunk = os.read(existing, 64 * 1024)
                        if not chunk:
                            break
                        existing_bytes += chunk
                    if (
                        not stat.S_ISREG(existing_stat.st_mode)
                        or existing_stat.st_size != len(content)
                        or existing_bytes != content
                    ):
                        raise ValueError("Existing Modal execution output has a different identity")
                    return root / name, len(content), False
                finally:
                    os.close(existing)
        finally:
            os.close(root_descriptor)
        try:
            written = 0
            while written < len(content):
                written += os.write(descriptor, content[written:])
            os.fsync(descriptor)
            if not stat.S_ISREG(os.fstat(descriptor).st_mode):
                raise ValueError("Modal execution output is not a regular file")
        except Exception:
            (root / name).unlink(missing_ok=True)
            raise
        finally:
            os.close(descriptor)
        return root / name, len(content), True


__all__ = [
    "MODAL_APP_NAME",
    "MODAL_FUNCTION_NAME",
    "MODAL_TRANSPORT_PROTOCOL",
    "ModalExecutor",
    "modal_readiness",
]
