"""Live logs observe an existing FunctionCall without provider or lifecycle authority."""
from __future__ import annotations

import asyncio
import threading
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from modelforge_workbench.execution.modal import ModalExecutionHandle
from test_modal_execution import FakeCall, _fake_modal


class Logs:
    def __init__(self, entries=(), *, failure=None):
        self.entries = entries
        self.failure = failure
        self.started = threading.Event()
        self.closed = threading.Event()
        self.consumed = 0
        self.stream = SimpleNamespace(aio=self._stream)

    async def _stream(self):
        self.started.set()
        try:
            if self.failure:
                raise self.failure
            for entry in self.entries:
                self.consumed += 1
                yield entry
            await asyncio.Event().wait()
        finally:
            self.closed.set()


def entry(message, source="stdout"):
    return SimpleNamespace(message=message, source=source, timestamp=datetime.now(timezone.utc))


def handle(tmp_path, logs=None, *, callback=None, limit=1024, capture=True):
    call = FakeCall()
    call.result = None
    if logs is not None:
        call.logs = logs
    bundle = SimpleNamespace(
        allocation=SimpleNamespace(execution_id="execution-1", evidence_root=tmp_path),
        limits=SimpleNamespace(deadline_seconds=10),
    )
    result = ModalExecutionHandle(
        _fake_modal(call), call, bundle,
        capture_output=capture, output_limit_bytes=limit, on_event=callback,
    )
    return result, call


def complete(call, **changes):
    call.result = {
        "protocol": "modelforge.modal-execution-result/v1", "execution_id": "execution-1",
        "return_code": 0, "stdout": "authoritative final stdout\n", "stderr": "", "files": [], **changes,
    }


def test_live_logs_arrive_before_completion_and_final_envelope_is_not_replayed(tmp_path):
    logs = Logs([entry("training started\n"), entry('[MODELFORGE_TELEMETRY] {"step":1,"value":0.4}\n')])
    events = []
    received = threading.Event()

    def observe(event):
        events.append(event)
        if len(events) == 2:
            received.set()

    execution, call = handle(tmp_path, logs, callback=observe)
    try:
        assert received.wait(2)
        assert execution.poll() is None
        assert [event.sequence for event in events] == [1, 2]
        assert events[1].data.startswith(b"[MODELFORGE_TELEMETRY]")
        assert not logs.closed.is_set()
        complete(call)
        output = execution.wait()
        assert output.stdout == b"authoritative final stdout\n"
        assert logs.closed.wait(2)
        assert not execution._log_thread.is_alive()
        assert len(events) == 2
    finally:
        execution._stop_live_logs()


def test_live_stream_is_closed_on_cancellation(tmp_path):
    logs = Logs()
    events = []
    execution, call = handle(tmp_path, logs, callback=events.append)
    assert logs.started.wait(2)
    output = execution.cancel()
    assert call.cancelled
    assert output.cancellation.observed_terminated
    assert logs.closed.wait(2)
    assert not execution._log_thread.is_alive()
    assert events == []


def test_live_stream_is_closed_even_when_terminal_envelope_is_invalid(tmp_path):
    logs = Logs()
    execution, call = handle(tmp_path, logs, callback=lambda event: None)
    assert logs.started.wait(2)
    complete(call, protocol="invalid")
    with pytest.raises(ValueError, match="protocol"):
        execution.wait()
    assert logs.closed.wait(2)


def test_live_observation_bytes_are_bounded_across_streams(tmp_path):
    logs = Logs([entry("a" * 24), entry("b" * 24, "stderr"), entry("not consumed")])
    events = []
    execution, call = handle(tmp_path, logs, callback=events.append, limit=32)
    assert logs.closed.wait(2)
    assert sum(len(event.data) for event in events) == 32
    assert [event.stream for event in events] == ["stdout", "stderr"]
    assert logs.consumed == 2
    complete(call, stdout="final")
    assert execution.wait().stdout == b"final"
    assert sum(len(event.data) for event in events) == 32


def test_live_observation_caps_entry_count_and_ignores_system_logs(tmp_path):
    logs = Logs([entry("system", "system")] + [entry("x") for _ in range(3000)])
    events = []
    execution, call = handle(tmp_path, logs, callback=events.append, limit=5000)
    assert logs.closed.wait(2)
    assert logs.consumed == 2048
    assert len(events) == 2047
    assert all(event.stream == "stdout" for event in events)
    complete(call)
    execution.wait()


def test_missing_logs_or_failed_observation_retains_terminal_event_fallback(tmp_path):
    for logs in (None, Logs(failure=RuntimeError("optional logs unavailable"))):
        events = []
        execution, call = handle(tmp_path, logs, callback=events.append)
        if logs is not None:
            assert logs.closed.wait(2)
        complete(call)
        output = execution.wait()
        assert output.event_error is None
        assert [event.data for event in events] == [output.stdout]


def test_failed_event_callback_is_bounded_and_not_silently_ignored(tmp_path):
    logs = Logs([entry("first"), entry("second")])

    def fail(event):
        raise ValueError("projection failed")

    execution, call = handle(tmp_path, logs, callback=fail)
    assert logs.closed.wait(2)
    complete(call)
    output = execution.wait()
    assert output.event_error == "ValueError: projection failed"
    assert logs.consumed == 1


def test_disabled_capture_never_opens_live_log_stream(tmp_path):
    logs = Logs([entry("private")])
    execution, call = handle(tmp_path, logs, callback=lambda event: None, capture=False)
    assert execution._log_thread is None
    assert not logs.started.is_set()
    complete(call)
    assert execution.wait().stdout is None


def test_optional_logs_property_failure_does_not_block_execution(tmp_path):
    class UnavailableLogsCall(FakeCall):
        @property
        def logs(self):
            raise RuntimeError("SDK logs unsupported")

    call = UnavailableLogsCall()
    events = []
    execution = ModalExecutionHandle(
        _fake_modal(call), call,
        SimpleNamespace(allocation=SimpleNamespace(execution_id="execution-1", evidence_root=tmp_path), limits=None),
        capture_output=True, output_limit_bytes=1024, on_event=events.append,
    )
    complete(call)
    assert execution.wait().return_code == 0
    assert len(events) == 1
