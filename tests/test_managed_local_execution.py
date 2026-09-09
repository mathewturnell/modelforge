from __future__ import annotations

import hashlib
import json
import os
import sqlite3
import sys
import threading
from pathlib import Path

import pytest

from modelforge_workbench.application.action_handlers import action_handler
from modelforge_workbench.application.artifacts import ArtifactService, LocalArtifactCandidate
from modelforge_workbench.application.managed_execution import (
    ManagedActionIntent,
    ManagedLocalActionService,
)
from modelforge_workbench.application.runs import RunScope, RunService
from modelforge_workbench.execution.local import LocalExecutor
from modelforge_workbench.infrastructure.local_artifacts import LocalFilesystemArtifactIO
from modelforge_workbench.infrastructure.sqlite_runs import SQLiteRunRepository


def _service(tmp_path, *, identities=None, deadline_seconds=1800):
    runs = RunService(SQLiteRunRepository(tmp_path / "jobs.sqlite3"))
    artifacts = ArtifactService(runs, LocalFilesystemArtifactIO())
    values = iter(identities or ["a" * 32, "b" * 32, "c" * 32, "d" * 32, "e" * 32])
    return ManagedLocalActionService(
        runs, artifacts, LocalExecutor(), tmp_path / "state", id_factory=lambda: next(values),
        deadline_seconds=deadline_seconds,
    )


def _script(tmp_path, source):
    path = tmp_path / f"worker-{len(list(tmp_path.glob('worker-*')))}.py"
    path.write_text(source, encoding="utf-8")
    return path


def _intent(tmp_path, kind, protocol, *, script=None, request=None):
    script = script or _script(tmp_path, "")
    base_requests = {
        "training": {"workflow": "training", "action_id": "fit", "dataset_split": "train"},
        "evaluation": {
            "workflow": "evaluation", "action_id": "score", "split": "test",
            "checkpoint_sha256": "1" * 64,
        },
        "inference": {"workflow": "inference", "action_id": "predict"},
        "prompt": {"workflow": "prompt", "action_id": "chat"},
        "dataset": {"workflow": "dataset_preparation", "action_id": "prepare"},
    }
    return ManagedActionIntent(
        RunScope("tenant-a", "project-a"),
        "user-a",
        kind,
        f"{kind} fixture",
        request or base_requests[kind],
        protocol,
        (sys.executable, str(script), kind, protocol),
        tmp_path,
        {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
        authorized_inputs=("owned-fixture",),
    )


def _result_for(kind, protocol):
    values = {
        "training": {"protocol": protocol, "checkpoint": "candidate.bin"},
        "evaluation": {"protocol": protocol, "metrics": {"score": 1.0}},
        "inference": {
            "format": protocol,
            "kind": "artifact",
            "results": [{"path": "artifact.bin", "sha256": hashlib.sha256(b"owned").hexdigest()}],
        },
        "prompt": {
            "protocol": protocol,
            "messages": [{"role": "assistant", "content": "offline"}],
        },
        "dataset": {"protocol": protocol, "dataset_ref": "owned-fixture"},
    }
    return values[kind]


def _fixture_script(tmp_path, *, return_code=0, malformed=False, outside=False):
    return _script(
        tmp_path,
        "import json, os, pathlib, sys\n"
        "kind, protocol = sys.argv[1:]\n"
        "root = pathlib.Path(os.environ['MODELFORGE_EVIDENCE_ROOT'])\n"
        + (
            "(root / 'result.json').write_text('{bad')\n"
            if malformed else
            "result = {\n"
            " 'training': {'protocol': protocol, 'checkpoint': 'candidate.bin'},\n"
            " 'evaluation': {'protocol': protocol, 'metrics': {'score': 1.0}},\n"
            " 'inference': {'format': protocol, 'kind': 'artifact', 'results': "
            "[{'path': 'artifact.bin', 'sha256': __import__('hashlib').sha256(b'owned').hexdigest()}]},\n"
            " 'prompt': {'protocol': protocol, 'messages': [{'role': 'assistant', 'content': 'offline'}]},\n"
            " 'dataset': {'protocol': protocol, 'dataset_ref': 'owned-fixture'},\n"
            "}[kind]\n"
            "(root / 'result.json').write_text(json.dumps(result))\n"
        )
        + (
            "pathlib.Path(os.environ['MODELFORGE_WORK_ROOT']).joinpath('artifact.bin').write_bytes(b'owned')\n"
            if outside else
            "(root / 'artifact.bin').write_bytes(b'owned')\n"
        )
        + f"raise SystemExit({return_code})\n",
    )


def _load_result(allocation):
    return json.loads((allocation.evidence_root / "result.json").read_text(encoding="utf-8"))


def _load_artifacts(allocation, _result):
    path = allocation.evidence_root / "artifact.bin"
    payload = path.read_bytes()
    return [LocalArtifactCandidate(
        "artifact.bin", "result", path, "application/octet-stream",
        len(payload), hashlib.sha256(payload).hexdigest(),
    )]


@pytest.mark.parametrize(
    ("kind", "protocol"),
    (
        ("training", "fixture.training/v1"),
        ("evaluation", "fixture.evaluation/v1"),
        ("inference", "modelforge.inference-result/v1"),
        ("prompt", "modelforge.prompt-result/v1"),
        ("dataset", "modelforge.dataset-build/v1"),
    ),
)
def test_all_standard_action_shapes_use_one_real_managed_process_path(
    tmp_path, kind, protocol,
):
    service = _service(tmp_path)
    intent = _intent(tmp_path, kind, protocol, script=_fixture_script(tmp_path))

    execution = service.start(intent)
    queued_before_spawn = execution.run_id == execution.allocation.execution_id
    completed = service.finish(
        execution, result_loader=_load_result, artifact_loader=_load_artifacts,
    )

    assert queued_before_spawn
    assert completed["status"] == "completed"
    assert completed["request"]["action_id"] == intent.request["action_id"]
    assert len(completed["artifacts"]) == 1
    assert "local-action://" in completed["artifact_prefix"]


def test_nonzero_exit_wins_over_plausible_result(tmp_path):
    service = _service(tmp_path)
    execution = service.start(_intent(
        tmp_path, "inference", "modelforge.inference-result/v1",
        script=_fixture_script(tmp_path, return_code=7),
    ))

    failed = service.finish(
        execution, result_loader=_load_result, artifact_loader=_load_artifacts,
    )

    assert failed["status"] == "failed"
    assert failed["artifacts"] == []
    assert "code 7" in failed["error"]


@pytest.mark.parametrize("mode", ("missing", "malformed", "outside"))
def test_result_and_artifact_failures_never_create_success(tmp_path, mode):
    service = _service(tmp_path)
    script = (
        _script(tmp_path, "raise SystemExit(0)\n")
        if mode == "missing" else _fixture_script(
            tmp_path, malformed=mode == "malformed", outside=mode == "outside",
        )
    )
    execution = service.start(_intent(
        tmp_path, "inference", "modelforge.inference-result/v1", script=script,
    ))

    with pytest.raises((FileNotFoundError, json.JSONDecodeError, ValueError)):
        service.finish(
            execution, result_loader=_load_result, artifact_loader=_load_artifacts,
        )

    failed = service.runs.get(execution.intent.scope, execution.run_id)
    assert failed["status"] == "failed"
    assert failed["artifacts"] == []


def test_wrong_result_protocol_fails_the_durable_run(tmp_path):
    service = _service(tmp_path)
    execution = service.start(_intent(
        tmp_path, "prompt", "modelforge.prompt-result/v1",
        script=_fixture_script(tmp_path),
    ))

    def wrong_protocol(allocation):
        result = _load_result(allocation)
        result["protocol"] = "example.wrong-result/v1"
        return result

    with pytest.raises(ValueError, match="protocol"):
        service.finish(
            execution, result_loader=wrong_protocol, artifact_loader=_load_artifacts,
        )

    failed = service.runs.get(execution.intent.scope, execution.run_id)
    assert failed["status"] == "failed"
    assert failed["artifacts"] == []


def test_finalization_failure_rolls_back_artifacts_then_records_failure(tmp_path):
    service = _service(tmp_path)
    execution = service.start(_intent(
        tmp_path, "dataset", "modelforge.dataset-build/v1",
        script=_fixture_script(tmp_path),
    ))
    second = execution.allocation.evidence_root / "second.bin"
    second.write_bytes(b"second")

    def two_artifacts(allocation, result):
        candidates = list(_load_artifacts(allocation, result))
        candidates.append(LocalArtifactCandidate(
            "second.bin", "result", second, "application/octet-stream",
            second.stat().st_size, hashlib.sha256(second.read_bytes()).hexdigest(),
        ))
        return candidates

    store = service.runs.repository
    with sqlite3.connect(store.path) as connection:
        connection.execute(
            "CREATE TRIGGER fail_second_managed_artifact "
            "BEFORE INSERT ON artifacts "
            "WHEN (SELECT COUNT(*) FROM artifacts WHERE run_id = NEW.run_id) >= 1 "
            "BEGIN SELECT RAISE(ABORT, 'controlled managed finalization failure'); END"
        )

    with pytest.raises(sqlite3.IntegrityError, match="controlled managed finalization failure"):
        service.finish(
            execution, result_loader=_load_result, artifact_loader=two_artifacts,
        )

    failed = service.runs.get(execution.intent.scope, execution.run_id)
    assert failed["status"] == "failed"
    assert failed["artifacts"] == []


def test_spawn_failure_retains_failed_durable_identity(tmp_path):
    service = _service(tmp_path)
    intent = _intent(
        tmp_path, "prompt", "modelforge.prompt-result/v1",
        script=tmp_path / "missing.py",
    )
    intent = ManagedActionIntent(
        intent.scope, intent.user_id, intent.kind, intent.name, intent.request,
        intent.result_protocol, (str(tmp_path / "missing-executable"),),
        intent.working_directory, intent.environment,
    )

    with pytest.raises(FileNotFoundError):
        service.start(intent)

    [failed] = service.runs.list(intent.scope)
    assert failed["status"] == "failed"
    assert failed["started_at"] is None


def test_real_cancellation_persists_request_then_observed_confirmation(tmp_path):
    if os.name != "posix":
        pytest.skip("signal acknowledgement fixture is POSIX-specific")
    service = _service(tmp_path)
    slow = _script(
        tmp_path,
        "import signal, sys, time\n"
        "signal.signal(signal.SIGINT, lambda *_: sys.exit(0))\n"
        "print('ready', flush=True)\n"
        "time.sleep(30)\n",
    )
    output_observed = threading.Event()
    execution = service.start(
        _intent(tmp_path, "prompt", "modelforge.prompt-result/v1", script=slow),
        on_event=lambda _event: output_observed.set(),
    )
    assert output_observed.wait(timeout=3)

    cancelled = service.cancel(execution.intent.scope, execution.run_id)

    assert cancelled["status"] == "cancelled"
    assert cancelled["configuration"]["cancellation_requested_at"]
    assert cancelled["configuration"]["cancellation_confirmed_at"]
    assert {item["kind"] for item in cancelled["artifacts"]} == {"process-log"}
    log = cancelled["artifacts"][0]
    opened = service.artifacts.open_local(
        execution.intent.scope, execution.run_id, log["id"],
    )
    with opened.stream:
        assert b"ready" in opened.stream.read()
    reopened = service.runs.get(execution.intent.scope, execution.run_id)
    assert reopened["status"] == "cancelled"
    assert reopened["artifacts"] == cancelled["artifacts"]
    Path(reopened["artifacts"][0]["storage_ref"]).write_bytes(b"tampered")
    with pytest.raises(OSError, match="changed"):
        service.artifacts.open_local(
            execution.intent.scope, execution.run_id, log["id"],
        )


def test_prompt_echo_result_fails_without_registering_the_result_envelope(tmp_path):
    service = _service(tmp_path)
    script = _script(
        tmp_path,
        "import json, os, pathlib\n"
        "root = pathlib.Path(os.environ['MODELFORGE_EVIDENCE_ROOT'])\n"
        "(root / 'result.json').write_text(json.dumps({\n"
        "  'protocol': 'modelforge.prompt-result/v1',\n"
        "  'messages': [\n"
        "    {'role': 'user', 'content': 'echoed prompt'},\n"
        "    {'role': 'assistant', 'content': 'answer'},\n"
        "  ],\n"
        "}))\n",
    )
    execution = service.start(_intent(
        tmp_path, "prompt", "modelforge.prompt-result/v1", script=script,
    ))

    with pytest.raises(ValueError, match="only assistant"):
        service.finish(
            execution,
            result_loader=_load_result,
            artifact_loader=_load_artifacts,
            retain_process_log=True,
        )

    failed = service.runs.get(execution.intent.scope, execution.run_id)
    assert failed["status"] == "failed"
    assert {item["kind"] for item in failed["artifacts"]} == {"process-log"}


def test_success_already_observed_before_cancel_acknowledgement_remains_success(tmp_path):
    service = _service(tmp_path)
    execution = service.start(_intent(
        tmp_path, "prompt", "modelforge.prompt-result/v1",
        script=_fixture_script(tmp_path),
    ))
    assert execution.handle.wait(5).return_code == 0

    requested = service.cancel(execution.intent.scope, execution.run_id)
    completed = service.finish(
        execution, result_loader=_load_result, artifact_loader=_load_artifacts,
    )

    assert requested["status"] == "running"
    assert requested["configuration"]["cancellation_requested_at"]
    assert completed["status"] == "completed"
    assert "cancellation_confirmed_at" not in completed["configuration"]


def test_managed_output_overflow_is_failure_even_with_valid_result(tmp_path):
    service = _service(tmp_path)
    source = _fixture_script(tmp_path).read_text(encoding="utf-8")
    flood = _script(tmp_path, "print('x' * 300000)\n" + source)
    execution = service.start(_intent(
        tmp_path, "dataset", "modelforge.dataset-build/v1", script=flood,
    ))

    failed = service.finish(
        execution, result_loader=_load_result, artifact_loader=_load_artifacts,
    )

    assert failed["status"] == "failed"
    assert "output limit" in failed["error"]
    assert failed["artifacts"] == []


def test_event_callback_failure_is_a_managed_failure(tmp_path):
    service = _service(tmp_path)

    def reject(_event):
        raise RuntimeError("controlled event projection failure")

    fixture = _fixture_script(tmp_path)
    noisy_fixture = _script(
        tmp_path, "print('event', flush=True)\n" + fixture.read_text(encoding="utf-8"),
    )
    execution = service.start(
        _intent(
            tmp_path, "dataset", "modelforge.dataset-build/v1",
            script=noisy_fixture,
        ),
        on_event=reject,
    )
    failed = service.finish(
        execution, result_loader=_load_result, artifact_loader=_load_artifacts,
    )

    assert failed["status"] == "failed"
    assert "event delivery failed" in failed["error"]
    assert failed["artifacts"] == []


def test_managed_deadline_stops_process_group_and_records_failed_evidence(tmp_path):
    service = _service(tmp_path, deadline_seconds=1)
    slow = _script(
        tmp_path,
        "import time\nprint('started', flush=True)\ntime.sleep(30)\n",
    )
    execution = service.start(_intent(
        tmp_path, "prompt", "modelforge.prompt-result/v1", script=slow,
    ))

    failed = service.finish(
        execution, result_loader=_load_result, artifact_loader=_load_artifacts,
        retain_process_log=True,
    )

    assert failed["status"] == "failed"
    assert "deadline" in failed["error"]
    assert execution.handle.poll() is not None
    assert [item["kind"] for item in failed["artifacts"]] == ["process-log"]


def test_completed_run_reopens_with_identical_artifact_identity(tmp_path):
    service = _service(tmp_path)
    execution = service.start(_intent(
        tmp_path, "dataset", "modelforge.dataset-build/v1",
        script=_fixture_script(tmp_path),
    ))
    completed = service.finish(
        execution, result_loader=_load_result, artifact_loader=_load_artifacts,
    )
    reopened_runs = RunService(SQLiteRunRepository(tmp_path / "jobs.sqlite3"))

    reopened = reopened_runs.get(execution.intent.scope, execution.run_id)

    assert reopened["status"] == "completed"
    assert reopened["artifacts"][0]["sha256"] == completed["artifacts"][0]["sha256"]


def test_handler_layer_imports_no_delivery_storage_provider_project_or_ml_modules():
    assert action_handler("prompt").kind == "prompt"
    source = (
        Path(__file__).parents[1]
        / "src" / "modelforge_workbench" / "application" / "managed_execution.py"
    )
    text = source.read_text(encoding="utf-8")
    for forbidden in ("browser", "subprocess", "torch", "transformers", "modal"):
        assert f"import {forbidden}" not in text
