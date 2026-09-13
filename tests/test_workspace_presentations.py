from __future__ import annotations

import http.client
import json
import stat
import threading
import time

import pytest

from modelforge_workbench.alpha import AlphaWorkbench
from modelforge_workbench.application.codex_app_server import CodexAppServerError
from modelforge_workbench.application.workspace_presentations import system_metrics
from modelforge_workbench.application.project_assistant import LocalProjectAssistantService
from modelforge_workbench.workbench.server import _Server
from test_annotations_and_training import _registered_multi_action_project


def test_workspace_projects_current_services_without_exposing_host_paths(tmp_path):
    app = AlphaWorkbench(tmp_path / "state")
    config, value = _registered_multi_action_project(tmp_path)
    project = app.register_project(config)
    repository = tmp_path / "project"
    (repository / ".env").write_text("SECRET=excluded\n", encoding="utf-8")
    (repository / "visible.py").write_text("answer = 42\n", encoding="utf-8")

    overview = app.project_overview(project["id"])
    tree = app.project_source(project["id"])
    source = app.project_source_file(project["id"], "visible.py")
    architecture = app.project_architecture(project["id"])

    assert overview["title"] == project["name"]
    assert "visible.py" in {item["name"] for item in tree["entries"]}
    assert ".env" not in {item["name"] for item in tree["entries"]}
    assert source["content"] == "answer = 42\n"
    assert str(repository) not in json.dumps({"overview": overview, "tree": tree, "architecture": architecture})
    assert architecture["validation"] == {
        "valid": True, "errors": [], "mode": "safe_registration_projection",
    }
    assert {item["type"] for item in architecture["architecture"]["nodes"]} == {
        "project_inference_adapter", "project_training_adapter",
    }
    with pytest.raises(ValueError, match="relative"):
        app.project_source_file(project["id"], "/etc/passwd")
    with pytest.raises(ValueError, match="excluded"):
        app.project_source_file(project["id"], ".env")


class _FakeCodexAppServer:
    installed = True

    def __init__(self, *, complete=True):
        self.listeners = {}
        self.requests = []
        self.next_listener = 1
        self.complete = complete

    def account(self):
        return {"account": {"type": "chatgpt", "email": "owner@example.test", "planType": "pro"}}

    def begin_chatgpt_login(self):
        return {"login_id": "login-1", "auth_url": "https://auth.openai.com/login"}

    def add_listener(self, listener):
        identity = self.next_listener
        self.next_listener += 1
        self.listeners[identity] = listener
        return identity

    def remove_listener(self, identity):
        self.listeners.pop(identity, None)

    def request(self, method, params=None, **_kwargs):
        self.requests.append((method, params or {}))
        if method == "thread/start":
            return {"thread": {"id": "thread-1"}}
        if method == "thread/resume":
            return {"thread": {"id": str(params["threadId"])}}
        if method == "turn/start":
            turn_id = "turn-1"
            if self.complete:
                for listener in tuple(self.listeners.values()):
                    listener({
                        "method": "item/reasoning/summaryTextDelta",
                        "params": {"threadId": "thread-1", "turnId": turn_id,
                                   "itemId": "reason-1", "delta": "Inspecting registered evidence."},
                    })
                    listener({
                        "method": "turn/completed",
                        "params": {"threadId": "thread-1", "turn": {
                            "id": turn_id, "status": "completed", "items": [{
                                "id": "answer-1", "type": "agentMessage", "phase": "final_answer",
                                "text": "This answer came from the authenticated Codex provider.",
                            }],
                        }},
                    })
            return {"turn": {"id": turn_id, "status": "inProgress", "items": []}}
        if method == "turn/interrupt":
            for listener in tuple(self.listeners.values()):
                listener({
                    "method": "turn/completed",
                    "params": {"threadId": "thread-1", "turn": {
                        "id": "turn-1", "status": "interrupted", "items": [],
                    }},
                })
            return {}
        raise AssertionError(method)

    def close(self):
        return None


def test_project_assistant_rejects_non_openai_login_and_redacts_provider_failures(tmp_path):
    provider = _FakeCodexAppServer()
    provider.begin_chatgpt_login = lambda: {
        "login_id": "hostile", "auth_url": "https://example.test/collect",
    }
    service = LocalProjectAssistantService(tmp_path / "state", provider=provider)
    with pytest.raises(RuntimeError, match="invalid ChatGPT sign-in destination"):
        service.begin_login()

    def failed_account():
        raise CodexAppServerError(
            f"token=provider-secret failed below {tmp_path}/private/provider.json"
        )

    provider.account = failed_account
    status = service.status()
    serialized = json.dumps(status)
    assert status["state"] == "error"
    assert "provider-secret" not in serialized
    assert str(tmp_path) not in serialized
    assert "<redacted>" in serialized and "<absolute-path>" in serialized


def test_project_assistant_uses_codex_and_is_durable_read_only_and_idempotent(tmp_path):
    state = tmp_path / "state"
    app = AlphaWorkbench(state)
    provider = _FakeCodexAppServer()
    app.assistant = LocalProjectAssistantService(state, provider=provider)
    config, value = _registered_multi_action_project(tmp_path)
    app.register_project(config)

    first = app.start_assistant(
        value["id"], session_id=None, request_id="request-1",
        message="Explain the dataset and annotations",
    )
    repeated = app.start_assistant(
        value["id"], session_id=None, request_id="request-1",
        message="Explain the dataset and annotations",
    )

    deadline = time.monotonic() + 2
    completed = first
    while completed["status"] not in {"completed", "failed"} and time.monotonic() < deadline:
        time.sleep(.01)
        completed = app.assistant_run(
            value["id"], first["session_id"], first["id"], first["request_id"],
        )
    repeated = app.start_assistant(
        value["id"], session_id=None, request_id="request-1",
        message="Explain the dataset and annotations",
    )

    assert repeated["id"] == first["id"]
    assert completed["status"] == "completed"
    assert completed["result"]["provider"] == "Codex"
    assert completed["result"]["changes"] == []
    assert "authenticated Codex provider" in completed["result"]["answer"]
    thread_request = next(params for method, params in provider.requests if method == "thread/start")
    turn_request = next(params for method, params in provider.requests if method == "turn/start")
    assert thread_request["sandbox"] == "read-only"
    assert thread_request["approvalPolicy"] == "never"
    assert turn_request["input"] == [{"type": "text", "text": "Explain the dataset and annotations"}]
    assert str(tmp_path / "project") not in json.dumps(completed)
    restarted = AlphaWorkbench(state)
    history = restarted.assistant_history(value["id"])
    assert history["active_session_id"] == completed["session_id"]
    assert [message["role"] for message in history["sessions"][0]["messages"]] == [
        "user", "assistant",
    ]
    stored = state / "assistant" / f"{value['id']}.json"
    assert stat.S_IMODE(stored.stat().st_mode) == 0o600
    assert "_provider_thread_id" not in json.dumps(history)


def test_project_assistant_cancels_the_exact_codex_turn(tmp_path):
    state = tmp_path / "state"
    app = AlphaWorkbench(state)
    provider = _FakeCodexAppServer(complete=False)
    app.assistant = LocalProjectAssistantService(state, provider=provider)
    config, value = _registered_multi_action_project(tmp_path)
    app.register_project(config)

    run = app.start_assistant(
        value["id"], session_id=None, request_id="cancel-request",
        message="Inspect this project until stopped",
    )
    deadline = time.monotonic() + 2
    while run["status"] == "queued" and time.monotonic() < deadline:
        time.sleep(.01)
        run = app.assistant_run(
            value["id"], run["session_id"], run["id"], run["request_id"],
        )
    app.cancel_assistant_run(
        value["id"], run["session_id"], run["id"], run["request_id"],
    )
    while run["status"] not in {"cancelled", "failed"} and time.monotonic() < deadline:
        time.sleep(.01)
        run = app.assistant_run(
            value["id"], run["session_id"], run["id"], run["request_id"],
        )

    assert run["status"] == "cancelled"
    assert any(method == "turn/interrupt" for method, _params in provider.requests)


def test_project_owned_architecture_descriptor_replaces_generic_action_projection(tmp_path):
    app = AlphaWorkbench(tmp_path / "state")
    config, value = _registered_multi_action_project(tmp_path)
    root = tmp_path / "project"
    descriptor = {
        "protocol": "modelforge.project-architecture-presentation/v1",
        "architecture": {
            "model": {"name": "Reviewed tracker"},
            "metadata": {"model_sources": [{
                "id": "upstream", "name": "Reviewed upstream", "provider": "GitHub",
                "url": "https://example.test/model", "revision": "abc123", "role": "source",
            }]},
            "inputs": [{"id": "frames", "type": "video_frames"}],
            "nodes": [{"id": "backbone", "type": "resnet50_backbone", "input": "frames"}],
            "outputs": [{"id": "tracks", "type": "tracking_result", "input": "backbone"}],
        },
    }
    (root / "architecture.inspectable.json").write_text(json.dumps(descriptor), encoding="utf-8")
    manifest = json.loads((root / "project.json").read_text(encoding="utf-8"))
    manifest["architecture_descriptor"] = "architecture.inspectable.json"
    (root / "project.json").write_text(json.dumps(manifest), encoding="utf-8")
    app.register_project(config)

    architecture = app.project_architecture(value["id"])

    assert architecture["validation"]["mode"] == "reviewed_project_descriptor"
    assert architecture["architecture"]["model"]["name"] == "Reviewed tracker"
    assert architecture["architecture"]["nodes"][0]["type"] == "resnet50_backbone"
    assert str(tmp_path) not in json.dumps(architecture)


def _request(server, method, path, token=None, cookie=None, body=None):
    connection = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=5)
    headers = {"Host": f"127.0.0.1:{server.server_address[1]}"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if cookie:
        headers["Cookie"] = cookie
    payload = None
    if body is not None:
        payload = json.dumps(body).encode()
        headers.update({"Content-Type": "application/json", "Content-Length": str(len(payload))})
    connection.request(method, path, body=payload, headers=headers)
    response = connection.getresponse()
    raw = response.read()
    result = response.status, dict(response.getheaders()), raw
    connection.close()
    return result


def test_workspace_routes_issue_httponly_session_for_authenticated_media(tmp_path):
    token = "workspace-session"
    app = AlphaWorkbench(tmp_path / "state")
    app.assistant = LocalProjectAssistantService(
        tmp_path / "state", provider=_FakeCodexAppServer(),
    )
    config, value = _registered_multi_action_project(tmp_path)
    app.register_project(config)
    server = _Server(("127.0.0.1", 0), app, token)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    prefix = f"/api/v1/projects/{value['id']}"
    try:
        status, headers, raw = _request(server, "GET", f"{prefix}/overview", token=token)
        assert status == 200 and json.loads(raw)["title"] == "Multi-action fixture"
        cookie = headers["Set-Cookie"]
        assert cookie.startswith(f"modelforge_session={token};")
        assert "HttpOnly" in cookie and "SameSite=Strict" in cookie
        cookie_header = cookie.split(";", 1)[0]

        status, _, raw = _request(server, "GET", "/api/v1/assistant/status", cookie=cookie_header)
        account_status = json.loads(raw)
        assert status == 200 and account_status["codex_connected"] is True
        assert account_status["account"] == {
            "type": "chatgpt", "plan_type": "pro", "email": "owner@example.test",
        }
        assert "token" not in json.dumps(account_status).casefold()
        status, _, raw = _request(
            server, "POST", "/api/v1/assistant/account/login",
            token=token, body={},
        )
        assert status == 200
        assert json.loads(raw)["auth_url"] == "https://auth.openai.com/login"

        status, _, raw = _request(server, "GET", f"{prefix}/source?path=", cookie=cookie_header)
        assert status == 200 and json.loads(raw)["tooling"]["read_only"] is True
        status, _, raw = _request(server, "GET", f"{prefix}/architecture", cookie=cookie_header)
        assert status == 200 and json.loads(raw)["available"] is True
        status, _, raw = _request(server, "GET", "/api/v1/system/metrics", cookie=cookie_header)
        assert status == 200 and "cpu" in json.loads(raw)
        status, _, _ = _request(
            server, "GET",
            f"{prefix}/datasets/samples/samples/train-1/content?access_token={token}",
        )
        assert status == 401
        status, _, raw = _request(
            server, "GET", f"{prefix}/datasets/samples/samples/train-1/content",
            cookie=cookie_header,
        )
        assert status == 200 and raw == b"bounded training sample\n"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


def test_system_metrics_projection_is_bounded():
    metrics = system_metrics({"state": "unconfigured"})
    assert 0 <= metrics["cpu"]["percent"] <= 100
    assert 0 <= metrics["memory"]["percent"] <= 100
    assert metrics["cloud"]["dispatch_ready"] is False
