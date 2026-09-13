from __future__ import annotations

import hashlib
import json
import sys
from importlib.resources import files
from pathlib import Path

import pytest

from modelforge_workbench.alpha import AlphaWorkbench
from modelforge_workbench.application.runtime_configurations import _normalize_project


def _digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def _project(tmp_path, *, kind):
    root = tmp_path / "project"
    root.mkdir()
    if kind == "inference":
        worker = Path(str(files("modelforge_workbench.fixtures").joinpath("vision_worker.py")))
        dataset = tmp_path / "dataset"
        dataset.mkdir()
        sample = dataset / "tiny.mp4"
        sample.write_bytes(b"authored synthetic frames")
        checkpoint = tmp_path / "fixture.bin"
        checkpoint.write_bytes(b"authored checkpoint identity")
        value = {
            "protocol": "modelforge.local-runtime-configuration/v1", "id": "vision-fixture",
            "project_repository": str(root),
            "name": "Synthetic tracked-video fixture", "support_level": "conformance",
            "action": {
                "id": "inference", "kind": "inference", "interface": "inference_process",
                "display_name": "Run vision fixture", "result_protocol": "modelforge.inference-result/v1",
                "interpreter": sys.executable, "executable": str(worker),
                "working_directory": str(root),
                "arguments": ["--dataset-root", "{dataset_root}", "--artifact", "{artifact}", "--checkpoint", "{checkpoint}", "--output-dir", "{output}", "--device", "{device}", "--max-frames", "{max_frames}"],
                "environment": {}, "parameters": {"device": "cpu", "max_frames": 2},
            },
            "dataset": {"id": "clips", "name": "Synthetic clips", "root": str(dataset), "samples": [{"id": "clip-1", "path": "tiny.mp4", "split": "train", "content_type": "video/mp4", "size_bytes": sample.stat().st_size, "sha256": _digest(sample)}]},
            "bindings": {"checkpoint": {"id": "fixture", "path": str(checkpoint), "sha256": _digest(checkpoint)}},
        }
        payload = {"dataset_id": "clips", "sample_id": "clip-1"}
    else:
        worker = Path(str(files("modelforge_workbench.fixtures").joinpath("prompt_worker.py")))
        model = tmp_path / "model-revision"
        model.mkdir()
        value = {
            "protocol": "modelforge.local-runtime-configuration/v1", "id": "prompt-fixture",
            "project_repository": str(root),
            "name": "Synthetic prompt fixture", "support_level": "conformance",
            "action": {
                "id": "prompt", "kind": "prompt", "interface": "prompt_process",
                "display_name": "Run prompt fixture", "result_protocol": "modelforge.prompt-result/v1",
                "interpreter": sys.executable, "executable": str(worker), "working_directory": str(root),
                "arguments": ["--request", "{request}", "--output", "{output}"],
                "environment": {}, "parameters": {},
            },
            "bindings": {"model": {"path": str(model), "model_id": "fixture/model", "revision": "fixture-revision"}},
        }
        payload = {"messages": [{"role": "user", "content": "Authored fixture prompt"}], "generation": {"max_new_tokens": 8, "temperature": 0, "top_p": 1}}
    (root / "project.json").write_text(json.dumps({
        "schema_version": 1,
        "id": value["id"],
        "name": value["name"],
        "repository": ".",
        "runtime": {
            "protocol": "modelforge.project-runtime/v1",
            "actions": {value["action"]["id"]: {
                "kind": "executable",
                "interface": value["action"]["interface"],
                "executable": Path(value["action"]["executable"]).name,
                "result_contract": {"protocol": value["action"]["result_protocol"]},
            }},
        },
    }))
    config = tmp_path / f"{kind}.json"
    config.write_text(json.dumps(value))
    return config, value, payload


@pytest.mark.parametrize("kind", ("inference", "prompt"))
def test_registered_projects_share_durable_lifecycle_and_checked_artifacts(tmp_path, kind):
    state = tmp_path / "state"
    app = AlphaWorkbench(state)
    config, project, payload = _project(tmp_path, kind=kind)
    registered = app.register_project(config)
    assert registered["runtime_readiness"] == "ready"
    assert [item["id"] for item in app.list_projects()] == [
        project["id"], "synthetic-threshold",
    ]
    execution = app.start_project_action(project["id"], payload)
    running = app.get_run(execution.run_id, project["id"])
    assert running["status"] == "running"
    assert running["artifacts"] == []
    completed = app.finish_project_action(execution)
    assert completed["status"] == "completed"
    assert {item["kind"] for item in completed["artifacts"]} >= {"process-log", "result-envelope"}
    assert all("storage_ref" not in item for item in completed["artifacts"])
    assert completed["configuration"]["runtime_configuration_sha256"]
    assert completed["configuration"]["action_sha256"]
    assert completed["configuration"]["interpreter_sha256"]
    assert completed["configuration"]["executable_sha256"]
    assert completed["configuration"]["environment_sha256"]
    assert completed["configuration"]["deadline_seconds"] == 1800
    assert str(tmp_path) not in json.dumps(completed["configuration"])
    recovered = AlphaWorkbench(state).get_run(execution.run_id, project["id"])
    assert recovered["status"] == "completed"
    if kind == "prompt":
        assert "messages" not in recovered["request"]
        assert recovered["request"]["prompt_request_sha256"]
        assert any(item["kind"] == "assistant-text" for item in recovered["artifacts"])
    else:
        assert recovered["request"]["dataset_sample_sha256"]
        video = next(item for item in recovered["artifacts"] if item["content_type"] == "video/mp4")
        assert video["metadata"]["evidence_id"] == execution.run_id
        assert video["metadata"]["frames"] == 2
        assert video["metadata"]["fps"] == 5.0
        assert video["metadata"]["duration_seconds"] == 0.4


def test_inference_frame_bound_is_an_effective_durable_process_parameter(tmp_path):
    app = AlphaWorkbench(tmp_path / "state")
    config, project, payload = _project(tmp_path, kind="inference")
    registered = app.register_project(config)
    action = registered["actions"][0]
    assert action["options"]["max_frames"] == {
        "default": 2, "minimum": 0, "maximum": 1_000_000,
        "zero_means": "full_input",
    }

    execution = app.start_project_action(
        project["id"], {**payload, "parameters": {"max_frames": 7}},
    )
    completed = app.finish_project_action(execution)
    assert completed["request"]["max_frames"] == 7
    request = json.loads((
        tmp_path / "state" / "runs" / "local" / execution.run_id / "evidence" / "request.json"
    ).read_text(encoding="utf-8"))
    assert request["max_frames"] == 7

    with pytest.raises(ValueError, match="0 to 1000000"):
        app.start_project_action(
            project["id"], {**payload, "parameters": {"max_frames": -1}},
        )

    with pytest.raises(ValueError, match="explicit maximum from 1 to 24"):
        app.project_actions.start(project["id"], {
            "protocol": "modelforge.managed-action-request/v1",
            "execution": {"target": "modal"},
            "input": {**payload, "parameters": {"max_frames": 0}},
        })


def test_registration_preserves_virtual_environment_interpreter_invocation(tmp_path):
    interpreter_target = tmp_path / "base-python"
    interpreter_target.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    interpreter_target.chmod(0o700)
    interpreter = tmp_path / "venv-python"
    interpreter.symlink_to(interpreter_target)
    worker = tmp_path / "worker.py"
    worker.write_text("pass\n", encoding="utf-8")
    _config, project, _payload = _project(tmp_path, kind="prompt")
    project["action"]["interpreter"] = str(interpreter)
    project["action"]["executable"] = str(worker)

    normalized = _normalize_project(project)

    assert normalized["action"]["interpreter"] == str(interpreter)
    assert Path(normalized["action"]["interpreter"]).resolve() == interpreter_target


def test_dataset_sample_change_and_cross_project_lookup_fail_closed(tmp_path):
    app = AlphaWorkbench(tmp_path / "state")
    config, project, _payload = _project(tmp_path, kind="inference")
    app.register_project(config)
    sample = Path(project["dataset"]["root"]) / "tiny.mp4"
    sample.write_bytes(b"changed")
    with pytest.raises(OSError, match="changed"):
        app.datasets.resolve(project["id"], "clips", "clip-1")
    with pytest.raises(KeyError):
        app.datasets.list_samples("missing-project", "clips")


def test_binder_failure_occurs_after_durable_queued_identity(tmp_path):
    app = AlphaWorkbench(tmp_path / "state")
    config, project, payload = _project(tmp_path, kind="prompt")
    app.register_project(config)
    Path(project["bindings"]["model"]["path"]).rmdir()
    with pytest.raises(ValueError, match="unavailable"):
        app.start_project_action(project["id"], payload)
    [failed] = app.list_runs(project["id"])
    assert failed["status"] == "failed"
    assert failed["started_at"] is None


def test_project_registration_is_private_and_public_projection_redacts_paths(tmp_path):
    app = AlphaWorkbench(tmp_path / "state")
    config, project, _payload = _project(tmp_path, kind="prompt")
    public = app.register_project(config)
    assert public["id"] == project["id"]
    assert str(tmp_path) not in json.dumps(public)
    stored = app.state_root / "runtime-projects" / "prompt-fixture.json"
    assert stored.stat().st_mode & 0o777 == 0o600
    assert str(tmp_path) in stored.read_text()
    authored = app.state_root / "projects" / "prompt-fixture" / "project.json"
    assert authored.stat().st_mode & 0o777 == 0o600
    assert "interpreter" not in authored.read_text()


def test_project_and_runtime_repositories_do_not_create_roots_on_read(tmp_path):
    app = AlphaWorkbench(tmp_path / "state")
    assert app.projects.list() == ()
    assert app.runtime_configurations.list() == []
    assert not (app.state_root / "projects").exists()
    assert not (app.state_root / "runtime-projects").exists()


def test_registration_rejects_manifest_mismatch_before_allocating_catalog(tmp_path):
    app = AlphaWorkbench(tmp_path / "state")
    config, _project_value, _payload = _project(tmp_path, kind="prompt")
    value = json.loads(config.read_text())
    value["id"] = "different-project"
    config.write_text(json.dumps(value))
    with pytest.raises(ValueError, match="identity differs"):
        app.register_project(config)
    assert not (app.state_root / "projects").exists()
    assert not (app.state_root / "runtime-projects").exists()


def test_runtime_identity_cannot_be_silently_reassigned(tmp_path):
    app = AlphaWorkbench(tmp_path / "state")
    config, project, _payload = _project(tmp_path, kind="prompt")
    first = app.register_project(config)
    assert app.register_project(config) == first
    value = json.loads(config.read_text())
    value["description"] = "changed registration"
    config.write_text(json.dumps(value))
    with pytest.raises(ValueError, match="different identity"):
        app.register_project(config)
    assert app.runtime_configurations.get(project["id"])["description"] != "changed registration"


def test_binding_environment_mapping_is_generic_and_validated(tmp_path):
    app = AlphaWorkbench(tmp_path / "state")
    config, project, payload = _project(tmp_path, kind="inference")
    source = tmp_path / "source"
    source.mkdir()
    project["bindings"]["source"] = {
        "path": str(source), "revision": "source-revision",
        "environment_variable": "MODELFORGE_EXAMPLE_SOURCE_ROOT",
    }
    config.write_text(json.dumps(project))
    app.register_project(config)
    execution = app.start_project_action(project["id"], payload)
    assert execution.handle.poll() in {None, 0}
    assert app.finish_project_action(execution)["status"] == "completed"
