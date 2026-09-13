from __future__ import annotations

import http.client
import json
import stat
import threading

import pytest

from modelforge_workbench.alpha import AlphaWorkbench
from modelforge_workbench.application.workspace_presentations import system_metrics
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


def test_local_project_assistant_is_durable_read_only_and_idempotent(tmp_path):
    state = tmp_path / "state"
    app = AlphaWorkbench(state)
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

    assert first == repeated
    assert first["status"] == "completed"
    assert first["result"]["provider"] == "local_evidence"
    assert first["result"]["changes"] == []
    assert "registered sample" in first["result"]["answer"]
    restarted = AlphaWorkbench(state)
    history = restarted.assistant_history(value["id"])
    assert history["active_session_id"] == first["session_id"]
    assert [message["role"] for message in history["sessions"][0]["messages"]] == [
        "user", "assistant",
    ]
    stored = state / "assistant" / f"{value['id']}.json"
    assert stat.S_IMODE(stored.stat().st_mode) == 0o600


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
