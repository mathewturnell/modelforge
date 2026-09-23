"""Exercise restored services through the authenticated loopback HTTP boundary."""
from __future__ import annotations

import hashlib
import http.client
import json
import threading

import pytest

from modelforge_workbench.alpha import AlphaWorkbench
from modelforge_workbench.workbench.server import _Server
from test_real_project_services import _project

_TOKEN = "restored-services-test-token"
_ANNOTATIONS = "/api/v1/projects/vision-fixture/datasets/clips/samples/clip-1/annotations"
_MODEL = "/api/v1/projects/vision-fixture/model"
_BOX = {"id": "box-1", "frame": 0, "label": "vehicle", "track_id": "track-1",
        "x": 0.1, "y": 0.1, "width": 0.2, "height": 0.3}


def _request(server, method, route, *, payload=None, token=_TOKEN, headers=None):
    request_headers = {"Host": f"127.0.0.1:{server.server_address[1]}", **(headers or {})}
    if token is not None:
        request_headers["Authorization"] = f"Bearer {token}"
    body = None if payload is None else json.dumps(payload).encode()
    if body is not None:
        request_headers["Content-Type"] = "application/json"
    connection = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=5)
    try:
        connection.request(method, route, body=body, headers=request_headers)
        response = connection.getresponse()
        return response.status, dict(response.headers), json.loads(response.read())
    finally:
        connection.close()


@pytest.fixture
def workbench(tmp_path):
    config, project, _ = _project(tmp_path, kind="inference")
    descriptor_path = tmp_path / "private-model-description.json"
    descriptor_path.write_text(json.dumps({
        "protocol": "modelforge.model-descriptor/v1", "model_id": "fixture-model", "name": "Fixture model",
        "checkpoint": {"sha256": project["bindings"]["checkpoint"]["sha256"]},
        "nodes": [{"id": "encoder", "label": "Image encoder", "kind": "encoder", "parameter_count": 42},
                  {"id": "head", "label": "Tracking head", "kind": "head"}],
        "edges": [{"source": "encoder", "target": "head"}],
    }))
    project["bindings"]["model_descriptor"] = {
        "path": str(descriptor_path), "sha256": hashlib.sha256(descriptor_path.read_bytes()).hexdigest(),
    }
    project["dataset"]["samples"].append({**project["dataset"]["samples"][0], "id": "test-clip", "split": "test"})
    config.write_text(json.dumps(project))
    app = AlphaWorkbench(tmp_path / "state")
    app.register_project(config)
    server = _Server(("127.0.0.1", 0), app, _TOKEN)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server, project, descriptor_path
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def test_restored_feature_projection_and_model_graph_are_checked_and_redacted(workbench, tmp_path):
    server, project, _ = workbench
    status, _, listing = _request(server, "GET", "/api/v1/projects")
    assert status == 200
    registered = next(item for item in listing["projects"] if item["id"] == project["id"])
    assert registered["features"]["annotation"] is True
    assert registered["features"]["model_inspection"] is True
    assert registered["features"]["training"] is False
    status, headers, graph = _request(server, "GET", _MODEL)
    assert status == 200
    assert graph["nodes"][0]["parameter_count"] == 42
    assert graph["evidence_kind"] == "owner-authored-structural-descriptor"
    assert str(tmp_path) not in json.dumps(graph)
    assert "Content-Security-Policy" in headers
    assert "Access-Control-Allow-Origin" not in headers


def test_annotation_http_save_reload_conflict_and_sample_immutability(workbench):
    server, _, _ = workbench
    status, _, initial = _request(server, "GET", _ANNOTATIONS)
    assert status == 200 and initial["editable"] and initial["revision"] == 0
    sample = server.app.datasets.resolve("vision-fixture", "clips", "clip-1")
    original = sample.path.read_bytes()
    status, _, saved = _request(server, "POST", _ANNOTATIONS, payload={"expected_revision": 0, "annotations": [_BOX]})
    assert status == 200 and saved["revision"] == 1
    assert saved["annotations"] == [_BOX]
    assert _request(server, "GET", _ANNOTATIONS)[2] == saved
    # Recover from the same owner state, without a process-local annotation cache.
    reloaded = AlphaWorkbench(server.app.state_root)
    assert reloaded.annotations.get("vision-fixture", "clips", "clip-1") == saved
    status, _, error = _request(server, "POST", _ANNOTATIONS, payload={"expected_revision": 0, "annotations": []})
    assert status == 409 and "reload" in error["error"]
    assert _request(server, "GET", _ANNOTATIONS)[2] == saved
    assert sample.path.read_bytes() == original


@pytest.mark.parametrize("route", [_ANNOTATIONS, _MODEL])
def test_restored_reads_require_bearer_authentication_and_loopback_host(workbench, route):
    server, _, _ = workbench
    assert _request(server, "GET", route, token=None)[0] == 401
    assert _request(server, "GET", route, token="wrong-token")[0] == 401
    assert _request(server, "GET", route, headers={"Host": "example.invalid"})[0] == 400


def test_annotation_mutations_retain_authentication_and_origin_boundary(workbench):
    server, _, _ = workbench
    payload = {"expected_revision": 0, "annotations": [_BOX]}
    assert _request(server, "POST", _ANNOTATIONS, token=None, payload=payload)[0] == 401
    assert _request(server, "POST", _ANNOTATIONS, token="wrong-token", payload=payload)[0] == 401
    assert _request(server, "POST", _ANNOTATIONS, payload=payload,
                    headers={"Origin": "https://untrusted.invalid"})[0] == 403
    assert _request(server, "GET", _ANNOTATIONS)[2]["revision"] == 0
    assert not server.app.annotations.root.exists()
    status, _, _ = _request(server, "POST", _ANNOTATIONS, payload=payload,
                            headers={"Origin": f"http://127.0.0.1:{server.server_address[1]}"})
    assert status == 200


def test_test_split_cannot_be_annotated_through_http(workbench):
    server, _, _ = workbench
    protected = _ANNOTATIONS.replace("clip-1", "test-clip")
    status, _, initial = _request(server, "GET", protected)
    assert status == 200 and not initial["editable"]
    status, _, error = _request(server, "POST", protected, payload={"expected_revision": 0, "annotations": [_BOX]})
    assert status == 400 and "cannot mutate" in error["error"]
    assert _request(server, "GET", protected)[2]["revision"] == 0
    assert not server.app.annotations.root.exists()


def test_unavailable_model_errors_do_not_disclose_bound_paths(workbench, tmp_path):
    server, _, descriptor = workbench
    descriptor.unlink()
    status, _, error = _request(server, "GET", _MODEL)
    assert status == 400
    assert str(tmp_path) not in json.dumps(error)
    assert descriptor.name not in json.dumps(error)
    assert _request(server, "GET", _MODEL.replace("vision-fixture", "other-project"))[0] == 400


def test_missing_sample_errors_do_not_disclose_dataset_paths(workbench, tmp_path):
    server, _, _ = workbench
    sample = server.app.datasets.resolve("vision-fixture", "clips", "clip-1")
    sample.path.unlink()
    for method in ("GET", "POST"):
        status, _, error = _request(server, method, _ANNOTATIONS,
                                    payload={"expected_revision": 0, "annotations": []} if method == "POST" else None)
        assert status == 400
        assert str(tmp_path) not in json.dumps(error)
        assert sample.path.name not in json.dumps(error)


def test_invalid_annotation_payload_and_cross_project_reference_fail_closed(workbench):
    server, _, _ = workbench
    status, _, _ = _request(server, "POST", _ANNOTATIONS,
                            payload={"expected_revision": 0, "annotations": [{**_BOX, "width": 1.1}]})
    assert status == 400
    assert _request(server, "GET", _ANNOTATIONS.replace("vision-fixture", "other-project"))[0] == 400
    assert _request(server, "GET", _ANNOTATIONS)[2]["revision"] == 0
