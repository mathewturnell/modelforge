from __future__ import annotations

import hashlib
import http.client
import json
import stat
import sys
import threading
from pathlib import Path

import pytest

from modelforge_workbench.alpha import AlphaWorkbench
from modelforge_workbench.application.annotations import AnnotationConflictError
from modelforge_workbench.workbench.server import _Server


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _registered_multi_action_project(tmp_path: Path) -> tuple[Path, dict]:
    project_root = tmp_path / "project"
    project_root.mkdir()
    dataset_root = tmp_path / "dataset"
    dataset_root.mkdir()
    train = dataset_root / "train.txt"
    held_out = dataset_root / "test.txt"
    train.write_text("bounded training sample\n", encoding="utf-8")
    held_out.write_text("held-out sample\n", encoding="utf-8")
    worker = project_root / "training_worker.py"
    worker.write_text(
        """import argparse, hashlib, json
from pathlib import Path
p = argparse.ArgumentParser()
p.add_argument('--request', required=True)
p.add_argument('--output-dir', required=True)
a = p.parse_args()
request = json.loads(Path(a.request).read_text())
root = Path(a.output_dir)
metrics = root / 'metrics.json'
metrics.write_text(json.dumps({'loss': [0.8, 0.3], 'epochs': 2}) + '\\n')
result = {
    'protocol': 'modelforge.training-result/v1',
    'dataset_manifest_sha256': request['dataset_manifest_sha256'],
    'promoted': False,
    'results': [{
        'role': 'metrics', 'kind': 'training-metrics', 'path': 'metrics.json',
        'mime_type': 'application/json',
        'sha256': hashlib.sha256(metrics.read_bytes()).hexdigest(),
    }],
}
(root / 'result.json').write_text(json.dumps(result) + '\\n')
""",
        encoding="utf-8",
    )
    inference = project_root / "inference_worker.py"
    inference.write_text("raise SystemExit(99)\n", encoding="utf-8")
    actions = {
        "inference": {
            "kind": "executable", "interface": "inference_process",
            "executable": inference.name,
            "result_contract": {"protocol": "modelforge.inference-result/v1"},
        },
        "training": {
            "kind": "executable", "interface": "training_process",
            "executable": worker.name,
            "result_contract": {"protocol": "modelforge.training-result/v1"},
        },
    }
    (project_root / "project.json").write_text(json.dumps({
        "schema_version": 1,
        "id": "multi-action-fixture",
        "name": "Multi-action fixture",
        "repository": ".",
        "runtime": {"protocol": "modelforge.project-runtime/v1", "actions": actions},
    }), encoding="utf-8")
    primary = {
        "id": "inference", "kind": "inference", "interface": "inference_process",
        "display_name": "Run inference", "result_protocol": "modelforge.inference-result/v1",
        "interpreter": sys.executable, "executable": str(inference),
        "working_directory": str(project_root), "arguments": [],
        "environment": {}, "parameters": {},
    }
    training = {
        "id": "training", "kind": "training", "interface": "training_process",
        "display_name": "Train model", "result_protocol": "modelforge.training-result/v1",
        "interpreter": sys.executable, "executable": str(worker),
        "working_directory": str(project_root),
        "arguments": ["--request", "{request}", "--output-dir", "{output}"],
        "environment": {}, "parameters": {},
    }
    value = {
        "protocol": "modelforge.local-runtime-configuration/v1",
        "id": "multi-action-fixture",
        "project_repository": str(project_root),
        "name": "Multi-action fixture",
        "action": primary,
        "actions": [training],
        "dataset": {
            "id": "samples", "name": "Samples", "root": str(dataset_root),
            "samples": [
                {"id": "train-1", "path": train.name, "split": "train", "content_type": "text/plain", "size_bytes": train.stat().st_size, "sha256": _sha(train)},
                {"id": "test-1", "path": held_out.name, "split": "held-out", "content_type": "text/plain", "size_bytes": held_out.stat().st_size, "sha256": _sha(held_out)},
            ],
        },
        "bindings": {},
    }
    config = tmp_path / "runtime.json"
    config.write_text(json.dumps(value), encoding="utf-8")
    return config, value


def test_authored_action_id_selects_training_through_managed_lifecycle(tmp_path):
    app = AlphaWorkbench(tmp_path / "state")
    config, value = _registered_multi_action_project(tmp_path)
    public = app.register_project(config)

    assert [item["id"] for item in public["actions"]] == ["inference", "training"]
    sample = app.get_annotation(value["id"], "samples", "train-1")
    saved = app.save_annotation(value["id"], "samples", "train-1", {
        "sample_sha256": sample["sample_sha256"], "expected_revision": 0,
        "labels": ["reviewed"], "note": "Training input reviewed", "boxes": [],
    })
    execution = app.start_project_action(
        value["id"], {
            "dataset_id": "samples", "dataset_split": "train", "epochs": 2,
            "annotation_revision": saved["revision"],
        },
        action_id="training",
    )
    completed = app.finish_project_action(execution)

    assert completed["request"]["workflow"] == "training"
    assert completed["request"]["action_id"] == "training"
    assert completed["request"]["dataset_sample_count"] == 1
    assert completed["request"]["annotation_revision"] == 1
    assert len(completed["request"]["annotation_manifest_sha256"]) == 64
    assert completed["request"]["parameters"] == {"epochs": 2}
    assert completed["configuration"]["result_protocol"] == "modelforge.training-result/v1"
    assert {item["kind"] for item in completed["artifacts"]} >= {
        "process-log", "result-envelope", "training-metrics",
    }
    with pytest.raises(ValueError, match="not registered"):
        app.start_project_action(value["id"], {}, action_id="invented")


def test_annotation_is_sample_bound_private_optimistic_and_never_mutates_source(tmp_path):
    app = AlphaWorkbench(tmp_path / "state")
    config, value = _registered_multi_action_project(tmp_path)
    app.register_project(config)
    source = Path(value["dataset"]["root"]) / "train.txt"
    original = source.read_bytes()

    empty = app.get_annotation(value["id"], "samples", "train-1")
    assert empty == {
        "protocol": "modelforge.annotation/v1",
        "project_id": value["id"], "dataset_id": "samples", "sample_id": "train-1",
        "sample_sha256": _sha(source), "revision": 0, "labels": [], "note": "", "boxes": [],
    }
    saved = app.save_annotation(value["id"], "samples", "train-1", {
        "sample_sha256": empty["sample_sha256"], "expected_revision": 0,
        "labels": ["vehicle", "pedestrian"], "note": "Checked frame",
        "boxes": [{"id": "vehicle-1", "label": "vehicle", "x": .1, "y": .2, "width": .3, "height": .4}],
    })
    assert saved["revision"] == 1
    assert app.get_annotation(value["id"], "samples", "train-1") == saved
    assert source.read_bytes() == original
    stored = app.state_root / "annotations" / value["id"] / "samples" / "train-1.json"
    assert stat.S_IMODE(stored.stat().st_mode) == 0o600

    with pytest.raises(AnnotationConflictError, match="current revision is 1"):
        app.save_annotation(value["id"], "samples", "train-1", {
            "sample_sha256": empty["sample_sha256"], "expected_revision": 0,
            "labels": [], "note": "stale", "boxes": [],
        })
    with pytest.raises(ValueError, match="held-out"):
        app.save_annotation(value["id"], "samples", "test-1", {
            "sample_sha256": value["dataset"]["samples"][1]["sha256"],
            "expected_revision": 0, "labels": [], "note": "", "boxes": [],
        })
    with pytest.raises(ValueError, match="inside"):
        app.save_annotation(value["id"], "samples", "train-1", {
            "sample_sha256": empty["sample_sha256"], "expected_revision": 1,
            "labels": [], "note": "", "boxes": [
                {"id": "bad", "label": "bad", "x": .9, "y": 0, "width": .2, "height": .2},
            ],
        })


def _request(server: _Server, method: str, path: str, token: str, body=None):
    connection = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=5)
    headers = {
        "Host": f"127.0.0.1:{server.server_address[1]}",
        "Authorization": f"Bearer {token}",
    }
    payload = None
    if body is not None:
        payload = json.dumps(body).encode()
        headers.update({"Content-Type": "application/json", "Content-Length": str(len(payload))})
    connection.request(method, path, body=payload, headers=headers)
    response = connection.getresponse()
    result = response.status, json.loads(response.read())
    connection.close()
    return result


def test_annotation_get_post_routes_and_conflict_status(tmp_path):
    token = "annotation-session"
    app = AlphaWorkbench(tmp_path / "state")
    config, value = _registered_multi_action_project(tmp_path)
    app.register_project(config)
    server = _Server(("127.0.0.1", 0), app, token)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    path = "/api/v1/projects/multi-action-fixture/datasets/samples/samples/train-1/annotations"
    try:
        status, empty = _request(server, "GET", path, token)
        assert status == 200 and empty["revision"] == 0
        body = {
            "sample_sha256": value["dataset"]["samples"][0]["sha256"],
            "expected_revision": 0, "labels": ["person"], "note": "reviewed", "boxes": [],
        }
        status, saved = _request(server, "POST", path, token, body)
        assert status == 200 and saved["revision"] == 1
        status, conflict = _request(server, "POST", path, token, body)
        assert status == 409 and "current revision is 1" in conflict["error"]
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)
