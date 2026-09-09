from __future__ import annotations

import os
import signal
import sys
import threading
import time
from pathlib import Path

import pytest

from modelforge_workbench.application.execution import (
    ExecutionAllocation,
    ExecutionBundle,
    ExecutionDeadlineExceeded,
    ExecutionLimits,
)
from modelforge_workbench.execution.local import LocalExecutor


def _bundle(tmp_path: Path, source: str, *arguments: str) -> ExecutionBundle:
    script = tmp_path / "worker.py"
    script.write_text(source, encoding="utf-8")
    allocation = ExecutionAllocation(
        "run-a",
        tmp_path / "work",
        tmp_path / "evidence",
        tmp_path / "cache",
        ("fixture-input",),
    )
    for root in (allocation.work_root, allocation.evidence_root, allocation.cache_root):
        root.mkdir()
    return ExecutionBundle(
        (sys.executable, str(script), *arguments),
        tmp_path,
        {**os.environ, "MODELFORGE_FIXTURE": "offline"},
        allocation,
    )


def test_managed_start_returns_opaque_identity_and_ordered_stream_events(tmp_path):
    events = []
    handle = LocalExecutor().start(
        _bundle(
            tmp_path,
            "import os, sys\n"
            "print(os.environ['MODELFORGE_FIXTURE'], flush=True)\n"
            "print('diagnostic', file=sys.stderr, flush=True)\n",
        ),
        capture_output=True,
        output_limit_bytes=1024,
        on_event=events.append,
    )

    assert handle.identity.pid > 0
    output = handle.wait(5)

    assert output.return_code == 0
    assert output.pid == handle.identity.pid
    assert output.stdout == b"offline\n"
    assert output.stderr == b"diagnostic\n"
    assert [event.sequence for event in events] == list(range(1, len(events) + 1))
    assert {event.stream for event in events} == {"stdout", "stderr"}
    assert all(event.timestamp.tzinfo is not None for event in events)


def test_bundle_rejects_shell_like_nul_values_before_spawn(tmp_path):
    with pytest.raises(ValueError, match="NUL"):
        ExecutionBundle((sys.executable, "bad\x00argument"), tmp_path, {})
    with pytest.raises(ValueError, match="NUL"):
        ExecutionBundle((sys.executable,), tmp_path, {"VALUE": "bad\x00value"})


def test_bundle_limits_are_validated_and_cannot_drift_at_execution(tmp_path):
    with pytest.raises(ValueError, match="output limit"):
        ExecutionLimits(0)
    with pytest.raises(ValueError, match="deadline"):
        ExecutionLimits(1, 0)
    bundle = ExecutionBundle(
        (sys.executable, "-c", "pass"), tmp_path, {},
        limits=ExecutionLimits(128, 5),
    )
    with pytest.raises(ValueError, match="output limit differs"):
        LocalExecutor().execute(
            bundle, capture_output=True, timeout_seconds=5, output_limit_bytes=64,
        )
    with pytest.raises(ValueError, match="deadline differs"):
        LocalExecutor().execute(
            bundle, capture_output=True, timeout_seconds=4, output_limit_bytes=128,
        )


def test_spawn_failure_has_no_process_handle(tmp_path):
    with pytest.raises(FileNotFoundError):
        LocalExecutor().start(
            ExecutionBundle((str(tmp_path / "missing"),), tmp_path, {}),
            capture_output=True,
            output_limit_bytes=1024,
        )


def test_explicit_cancel_observes_owned_process_group_termination(tmp_path):
    if os.name != "posix":
        pytest.skip("process-group evidence is POSIX-specific")
    child = tmp_path / "child.py"
    child.write_text(
        "import signal, sys, time\n"
        "signal.signal(signal.SIGINT, lambda *_: sys.exit(0))\n"
        "open(sys.argv[1], 'w').write('ready')\n"
        "time.sleep(30)\n",
        encoding="utf-8",
    )
    ready = tmp_path / "ready"
    bundle = _bundle(
        tmp_path,
        "import subprocess, sys, time\n"
        "subprocess.Popen([sys.executable, sys.argv[1], sys.argv[2]])\n"
        "while not __import__('pathlib').Path(sys.argv[2]).exists(): time.sleep(.01)\n"
        "time.sleep(30)\n",
        str(child),
        str(ready),
    )
    handle = LocalExecutor().start(
        bundle, capture_output=True, output_limit_bytes=1024,
    )
    deadline = time.monotonic() + 3
    while not ready.exists() and time.monotonic() < deadline:
        time.sleep(0.01)
    assert ready.exists()

    output = handle.cancel(interrupt_grace_seconds=1, terminate_grace_seconds=1)

    assert output.cancellation is not None
    assert output.cancellation.requested is True
    assert output.cancellation.interrupt_delivered is True
    assert output.cancellation.observed_terminated is True
    assert handle.poll() is not None
    with pytest.raises(ProcessLookupError):
        os.kill(handle.identity.pid, 0)


def test_cancel_escalates_until_descendant_process_group_is_gone(tmp_path):
    if os.name != "posix":
        pytest.skip("process-group evidence is POSIX-specific")
    child = tmp_path / "stubborn_child.py"
    child.write_text(
        "import os, signal, sys, time\n"
        "signal.signal(signal.SIGINT, signal.SIG_IGN)\n"
        "signal.signal(signal.SIGTERM, signal.SIG_IGN)\n"
        "open(sys.argv[1], 'w').write(str(os.getpid()))\n"
        "time.sleep(30)\n",
        encoding="utf-8",
    )
    ready = tmp_path / "stubborn-ready"
    bundle = _bundle(
        tmp_path,
        "import subprocess, sys, time\n"
        "subprocess.Popen([sys.executable, sys.argv[1], sys.argv[2]])\n"
        "while not __import__('pathlib').Path(sys.argv[2]).exists(): time.sleep(.01)\n"
        "time.sleep(30)\n",
        str(child),
        str(ready),
    )
    handle = LocalExecutor().start(
        bundle, capture_output=True, output_limit_bytes=1024,
    )
    try:
        deadline = time.monotonic() + 3
        while not ready.exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        assert ready.exists()

        output = handle.cancel(
            interrupt_grace_seconds=0.1,
            terminate_grace_seconds=0.1,
        )

        assert output.cancellation is not None
        assert output.cancellation.requested is True
        assert output.cancellation.interrupt_delivered is True
        assert output.cancellation.terminate_delivered is True
        assert output.cancellation.kill_delivered is True
        assert output.cancellation.observed_terminated is True
        assert handle.poll() is not None
        with pytest.raises(ProcessLookupError):
            os.killpg(handle.identity.pid, 0)
    finally:
        try:
            os.killpg(handle.identity.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass


def test_wait_timeout_is_observation_until_coordinator_requests_cancel(tmp_path):
    handle = LocalExecutor().start(
        _bundle(tmp_path, "import time\ntime.sleep(30)\n"),
        capture_output=True,
        output_limit_bytes=1024,
    )
    with pytest.raises(ExecutionDeadlineExceeded):
        handle.wait(0.01)
    assert handle.poll() is None
    output = handle.cancel(interrupt_grace_seconds=0.1, terminate_grace_seconds=0.1)
    assert output.cancellation is not None
    assert output.cancellation.observed_terminated is True


def test_structured_event_capture_stops_at_each_stream_limit(tmp_path):
    events = []
    handle = LocalExecutor().start(
        _bundle(
            tmp_path,
            "import sys\n"
            "print('o' * 5000)\n"
            "print('e' * 5000, file=sys.stderr)\n",
        ),
        capture_output=True,
        output_limit_bytes=128,
        on_event=events.append,
    )

    output = handle.wait(5)

    assert output.stdout_size > 128
    assert output.stderr_size > 128
    assert sum(len(event.data) for event in events if event.stream == "stdout") == 128
    assert sum(len(event.data) for event in events if event.stream == "stderr") == 128


def test_complete_line_is_delivered_while_the_process_is_still_running(tmp_path):
    observed = threading.Event()
    events = []

    def receive(event):
        events.append(event)
        observed.set()

    handle = LocalExecutor().start(
        _bundle(
            tmp_path,
            "import time\nprint('live-progress', flush=True)\ntime.sleep(30)\n",
        ),
        capture_output=True,
        output_limit_bytes=1024,
        on_event=receive,
    )

    assert observed.wait(2), "a flushed process line was buffered until process exit"
    assert handle.poll() is None
    assert b"live-progress" in b"".join(event.data for event in events)
    handle.cancel(interrupt_grace_seconds=0.1, terminate_grace_seconds=0.1)


def test_callback_failure_is_retained_without_abandoning_stream_drain(tmp_path):
    def reject(_event):
        raise RuntimeError("controlled callback failure")

    handle = LocalExecutor().start(
        _bundle(tmp_path, "print('x' * 300000)\n"),
        capture_output=True,
        output_limit_bytes=1024,
        on_event=reject,
    )

    output = handle.wait(5)

    assert output.return_code == 0
    assert output.stdout_size > 1024
    assert output.event_error == "RuntimeError: controlled callback failure"


def test_cross_stream_callbacks_are_delivered_in_sequence_order(tmp_path):
    first_started = threading.Event()
    release_first = threading.Event()
    observed = []

    def receive(event):
        if event.sequence == 1:
            first_started.set()
            assert release_first.wait(2)
        observed.append(event.sequence)

    handle = LocalExecutor().start(
        _bundle(
            tmp_path,
            "import sys, time\n"
            "print('stdout', flush=True)\n"
            "print('stderr', file=sys.stderr, flush=True)\n"
            "time.sleep(.1)\n",
        ),
        capture_output=True,
        output_limit_bytes=1024,
        on_event=receive,
    )

    assert first_started.wait(2)
    time.sleep(0.05)
    assert observed == []
    release_first.set()
    output = handle.wait(5)

    assert output.event_error is None
    assert observed == sorted(observed) == [1, 2]
