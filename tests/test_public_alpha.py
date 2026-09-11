from __future__ import annotations

import hashlib
import http.client
import json
import os
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

from modelforge_workbench.alpha import ALPHA_SCOPE, AlphaWorkbench, _LiveEventProjection
from modelforge_workbench.application.execution import ExecutionEvent
from modelforge_workbench.application.managed_execution import ManagedActionIntent
from modelforge_workbench.application.runs import RunIntent, RunScope
from modelforge_workbench.workbench.server import _Server


def test_capability_projection_is_static_and_non_authorizing():
    value = AlphaWorkbench.capabilities()
    assert value["project_id"] == "synthetic-threshold"
    assert value["runtime_readiness"] == "not_evaluated"
    assert value["execution_authorized"] is False
    assert value["provider_authorized"] is False
    assert {item["id"] for item in value["capabilities"]} == {
        "action.inference", "dataset.default",
    }


def test_example_creates_durable_success_and_checked_artifacts(tmp_path):
    root = tmp_path / "private-state"
    app = AlphaWorkbench(root)
    assert root.stat().st_mode & 0o777 == 0o700
    assert (root / "runs.sqlite3").stat().st_mode & 0o777 == 0o600
    execution = app.start_example()
    running = app.get_run(execution.run_id)
    assert running["status"] == "running"
    assert running["artifacts"] == []

    completed = app.finish_example(execution)
    assert completed["status"] == "completed"
    assert (root / "runs").stat().st_mode & 0o777 == 0o700
    assert (root / "runs" / "local").stat().st_mode & 0o777 == 0o700
    assert (root / "runs" / "local" / completed["id"]).stat().st_mode & 0o777 == 0o700
    assert completed["request"]["synthetic"] is True
    assert {item["name"] for item in completed["artifacts"]} == {"report.json", "result.json"}
    assert all("storage_ref" not in item for item in completed["artifacts"])

    reopened = AlphaWorkbench(root).get_run(execution.run_id)
    assert reopened == completed
    report = next(item for item in reopened["artifacts"] if item["name"] == "report.json")
    opened = app.open_artifact(execution.run_id, report["id"])
    with opened.stream:
        payload = opened.stream.read()
    assert hashlib.sha256(payload).hexdigest() == report["sha256"]
    assert json.loads(payload)["sample_count"] == 4


def test_scope_and_tamper_fail_closed(tmp_path):
    app = AlphaWorkbench(tmp_path)
    completed = app.run_example()
    report = next(item for item in completed["artifacts"] if item["name"] == "report.json")
    with pytest.raises(KeyError):
        app.runs.get(RunScope("another-org", "synthetic-threshold"), completed["id"])

    private = app.runs.get(ALPHA_SCOPE, completed["id"])
    storage = next(item for item in private["artifacts"] if item["id"] == report["id"])["storage_ref"]
    Path(storage).write_text("changed", encoding="utf-8")
    with pytest.raises(OSError, match="changed"):
        app.open_artifact(completed["id"], report["id"])


def test_state_root_rejects_symlinks_without_touching_target(tmp_path):
    target = tmp_path / "existing-target"
    target.mkdir(mode=0o700)
    before = target.stat().st_mode & 0o777
    link = tmp_path / "linked-state"
    link.symlink_to(target, target_is_directory=True)

    with pytest.raises(ValueError, match="symbolic links"):
        AlphaWorkbench(link)

    assert target.stat().st_mode & 0o777 == before
    assert list(target.iterdir()) == []


def test_existing_permissive_state_root_is_not_silently_chmodded(tmp_path):
    root = tmp_path / "permissive-state"
    root.mkdir(mode=0o755)
    os.chmod(root, 0o755)

    with pytest.raises(ValueError, match="mode 0700"):
        AlphaWorkbench(root)

    assert root.stat().st_mode & 0o777 == 0o755
    assert list(root.iterdir()) == []


def test_example_child_uses_installed_package_without_ambient_import_paths(
    tmp_path, monkeypatch,
):
    poison = tmp_path / "poison"
    (poison / "modelforge").mkdir(parents=True)
    (poison / "modelforge" / "__init__.py").write_text(
        "raise RuntimeError('ambient import path was used')\n", encoding="utf-8",
    )
    outside = tmp_path / "outside-source-checkout"
    outside.mkdir()
    monkeypatch.setenv("PYTHONPATH", str(poison))
    monkeypatch.syspath_prepend(str(poison))
    monkeypatch.chdir(outside)

    class RecordingExecutor:
        bundle = None

        def start(self, bundle, **_kwargs):
            self.bundle = bundle
            return SimpleNamespace(identity=SimpleNamespace(pid=12345))

    app = AlphaWorkbench(tmp_path / "private-state")
    executor = RecordingExecutor()
    app.actions.executor = executor

    app.start_example()

    assert executor.bundle is not None
    assert executor.bundle.argv[:2] == (sys.executable, "-I")
    worker = Path(executor.bundle.argv[2])
    assert worker.name == "worker.py"
    assert worker.parent.name == "example"
    assert worker.is_file()
    assert executor.bundle.working_directory == app.state_root
    assert "PYTHONPATH" not in executor.bundle.environment
    assert str(poison) not in executor.bundle.environment.values()
    assert executor.bundle.environment["PYTHONSAFEPATH"] == "1"


def test_react_client_retains_per_tab_auth_and_checked_blob_boundaries():
    root = Path(__file__).parents[1] / "workbench"
    api = (root / "src" / "lib" / "api.ts").read_text(encoding="utf-8")
    app = (root / "src" / "App.tsx").read_text(encoding="utf-8")

    assert "storage.setItem(TOKEN_KEY, fragmentToken)" in api
    assert "storage.getItem(TOKEN_KEY)" in api
    assert "localStorage" not in api + app
    assert api.index("storage.setItem") < api.index("browserHistory.replaceState")
    assert "authenticatedBlob" in api
    assert "if (!response.ok) throw await responseError(response)" in api
    assert "link.download = value.name" in app
    assert "link.click()" in app
    assert "URL.revokeObjectURL" in app
    assert "sampleGuard.current.isCurrent(request)" in app
    assert "artifactGuard.current.isCurrent(request)" in app
    assert 'aria-label={artifact.kind === "assistant-text"' in app
    assert 'value.kind === "table"' in app
    assert "tableProjection" in app
    assert "next.project_id !== expectedProject" in app
    assert 'runtime_observation?.state === "unavailable"' in app
    assert '`${run.status} · unavailable`' in app
    index = (root / "index.html").read_text(encoding="utf-8")
    assert '<link rel="icon" href="data:," />' in index
    styles = (root / "src" / "styles.css").read_text(encoding="utf-8")
    assert "word-break:break-all" in styles
    assert 'grid-template-areas:"title" "rail" "tabs" "work" "inspector" "status"' in styles


def test_live_projection_preserves_split_utf8_and_split_progress_lines():
    live = {}
    projection = _LiveEventProjection(lambda: live)
    timestamp = datetime.now(timezone.utc)
    encoded = "café\n[MODELFORGE_PROGRESS] {\"stage\":\"half\",\"percent\":50}\n".encode()
    split = encoded.index(b"\xc3") + 1
    pieces = (encoded[:split], encoded[split:24], encoded[24:])
    for sequence, piece in enumerate(pieces, 1):
        projection(ExecutionEvent(sequence, timestamp, "stdout", piece))
    assert "café" in live["log_tail"]
    assert "�" not in live["log_tail"]
    assert live["progress"] == {"stage": "half", "percent": 50}


def test_restarted_workbench_marks_unattached_unfinished_run_unavailable(tmp_path):
    app = AlphaWorkbench(tmp_path)
    run = app.runs.create(RunIntent(
        ALPHA_SCOPE,
        "local-user",
        "Interrupted local action",
        "local",
        "local",
        {"workflow": "inference", "action_id": "inference"},
    ), run_id="f" * 32)
    app.runs.attach(run["id"])
    app.runs.confirm_running(ALPHA_SCOPE, run["id"], backend_id="12345")
    assert app.get_run(run["id"])["runtime_observation"] == {
        "state": "current", "stale": False, "reason": None,
    }

    recovered = AlphaWorkbench(tmp_path).get_run(run["id"])

    assert recovered["status"] == "running"
    assert recovered["runtime_observation"]["state"] == "unavailable"
    assert recovered["runtime_observation"]["stale"] is True
    assert "No live executor handle" in recovered["runtime_observation"]["reason"]


def test_existing_unowned_nonempty_state_root_is_not_used(tmp_path):
    root = tmp_path / "unrelated"
    root.mkdir(mode=0o700)
    sentinel = root / "keep.txt"
    sentinel.write_text("preserve", encoding="utf-8")

    with pytest.raises(ValueError, match="not an owned alpha state root"):
        AlphaWorkbench(root)

    assert sentinel.read_text(encoding="utf-8") == "preserve"
    assert {item.name for item in root.iterdir()} == {"keep.txt"}


def test_state_root_rejects_symlinked_parent_without_touching_target(tmp_path):
    target = tmp_path / "parent-target"
    target.mkdir(mode=0o700)
    link = tmp_path / "parent-link"
    link.symlink_to(target, target_is_directory=True)

    with pytest.raises(ValueError, match="symbolic links"):
        AlphaWorkbench(link / "child")

    assert list(target.iterdir()) == []


def test_state_root_rejects_broad_directory():
    with pytest.raises(ValueError, match="broad system or home"):
        AlphaWorkbench(Path("/tmp"))


def test_database_symlink_is_rejected_without_touching_target(tmp_path):
    root = tmp_path / "state"
    app = AlphaWorkbench(root)
    app.runs.repository.path.unlink()
    target = tmp_path / "unrelated.sqlite3"
    target.write_bytes(b"preserve")
    os.chmod(target, 0o600)
    (root / "runs.sqlite3").symlink_to(target)

    with pytest.raises(ValueError, match="cannot be a symbolic link"):
        AlphaWorkbench(root)

    assert target.read_bytes() == b"preserve"


def _request(server, method, path, *, token=None, headers=None):
    connection = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=5)
    request_headers = {"Host": f"127.0.0.1:{server.server_address[1]}", **(headers or {})}
    if token:
        request_headers["Authorization"] = f"Bearer {token}"
    connection.request(method, path, headers=request_headers)
    response = connection.getresponse()
    body = response.read()
    connection.close()
    return response.status, response.headers, body


def test_loopback_api_runs_and_recovers_same_artifact(tmp_path):
    token = "test-session-token"
    app = AlphaWorkbench(tmp_path)
    server = _Server(("127.0.0.1", 0), app, token)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        assert _request(server, "GET", "/api/v1/ready")[0] == 200
        assert _request(server, "GET", "/api/v1/runs")[0] == 401
        status, headers, _body = _request(server, "GET", "/")
        assert status == 200
        assert headers["Content-Security-Policy"]
        assert "media-src 'self' blob:" in headers["Content-Security-Policy"]
        status, headers, body = _request(server, "GET", "/modal-setup.css")
        assert status == 200
        assert headers["Content-Type"] == "text/css; charset=utf-8"
        assert b"main.guide" in body

        status, _headers, body = _request(server, "POST", "/api/v1/example-runs", token=token)
        assert status == 202
        run_id = json.loads(body)["id"]
        for _ in range(100):
            status, _headers, body = _request(server, "GET", f"/api/v1/runs/{run_id}", token=token)
            run = json.loads(body)
            if run["status"] not in {"queued", "running"}:
                break
            time.sleep(0.03)
        assert status == 200
        assert run["status"] == "completed"
        artifact = next(item for item in run["artifacts"] if item["name"] == "report.json")
        status, headers, partial = _request(
            server, "GET", f"/api/v1/runs/{run_id}/artifacts/{artifact['id']}",
            token=token, headers={"Range": "bytes=0-15"},
        )
        assert status == 206
        assert headers["Accept-Ranges"] == "bytes"
        assert len(partial) == 16
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)

    recovered = AlphaWorkbench(tmp_path).get_run(run_id)
    assert recovered["status"] == "completed"
    assert recovered["artifacts"][0]["sha256"]


def test_server_close_cancels_owned_process_and_registers_its_log(tmp_path):
    app = AlphaWorkbench(tmp_path)
    worker = tmp_path / "slow-worker.py"
    worker.write_text(
        "import signal, sys, time\n"
        "signal.signal(signal.SIGINT, lambda *_: sys.exit(0))\n"
        "print('ready', flush=True)\n"
        "time.sleep(30)\n",
        encoding="utf-8",
    )
    execution = app.actions.start(ManagedActionIntent(
        ALPHA_SCOPE,
        "local-user",
        "prompt",
        "Graceful shutdown fixture",
        {"workflow": "prompt", "action_id": "prompt"},
        "modelforge.prompt-result/v1",
        (sys.executable, str(worker)),
        tmp_path,
        {**os.environ, "PYTHONDONTWRITEBYTECODE": "1"},
    ))
    server = _Server(("127.0.0.1", 0), app, "test-session-token")

    server.server_close()

    cancelled = app.get_run(execution.run_id)
    assert cancelled["status"] == "cancelled"
    assert cancelled["configuration"]["cancellation_confirmed_at"]
    assert {item["kind"] for item in cancelled["artifacts"]} == {"process-log"}


def test_cross_origin_mutation_and_invalid_host_are_rejected(tmp_path):
    token = "test-session-token"
    server = _Server(("127.0.0.1", 0), AlphaWorkbench(tmp_path), token)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        assert _request(
            server, "POST", "/api/v1/example-runs", token=token,
            headers={"Origin": "https://attacker.invalid"},
        )[0] == 403
        connection = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=5)
        connection.request("GET", "/api/v1/ready", headers={"Host": "attacker.invalid"})
        response = connection.getresponse()
        response.read()
        connection.close()
        assert response.status == 400
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)
