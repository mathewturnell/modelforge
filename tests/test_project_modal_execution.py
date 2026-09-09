from __future__ import annotations

import base64
import hashlib
import json
import uuid
from types import SimpleNamespace

import pytest

from modelforge_workbench.alpha import AlphaWorkbench
from modelforge_workbench.application.modal_bindings import resource_plan_sha256


class FakeTimeout(Exception):
    pass


class FakeCancellation(BaseException):
    pass


class FakeCall:
    def __init__(self, events):
        self.object_id = "fc-project123"
        self.events = events
        self.result = None
        self.cancelled = False
        self.on_cancel = None

    def get(self, timeout=None):
        if self.cancelled:
            raise FakeCancellation()
        if self.result is None:
            raise FakeTimeout()
        return self.result

    def cancel(self):
        self.events.append(("cancel", self.object_id))
        if self.on_cancel:
            self.on_cancel()
        self.cancelled = True


def _modal(call, events):
    class Function:
        @staticmethod
        def from_name(application, function, *, environment_name):
            events.append(("resolve", application, function, environment_name))
            return SimpleNamespace(spawn=lambda payload: _spawn(payload))

    def _spawn(payload):
        events.append(("spawn", payload))
        return call

    class FunctionCall:
        @staticmethod
        def from_id(call_id):
            events.append(("recover", call_id))
            return call

    return SimpleNamespace(
        Function=Function,
        FunctionCall=FunctionCall,
        exception=SimpleNamespace(TimeoutError=FakeTimeout, InputCancellation=FakeCancellation),
    )


def _file(name, content):
    return {
        "name": name,
        "content_base64": base64.b64encode(content).decode(),
        "size_bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
    }


def _registered_project(tmp_path):
    project = tmp_path / "project"
    project.mkdir()
    worker = project / "worker.py"
    worker.write_text("raise SystemExit(99)\n")
    dataset = tmp_path / "dataset"
    dataset.mkdir()
    sample = dataset / "clip.mp4"
    sample.write_bytes(b"bounded-real-shaped-video")
    checkpoint = tmp_path / "checkpoint.bin"
    checkpoint.write_bytes(b"bounded-checkpoint")
    (project / "project.json").write_text(json.dumps({
        "schema_version": 1,
        "id": "project-modal-fixture",
        "name": "Project Modal fixture",
        "repository": ".",
        "runtime": {"protocol": "modelforge.project-runtime/v1", "actions": {
            "inference": {
                "kind": "executable", "interface": "inference_process",
                "executable": "worker.py",
                "result_contract": {"protocol": "modelforge.inference-result/v1"},
            },
        }},
    }))
    sample_sha = hashlib.sha256(sample.read_bytes()).hexdigest()
    checkpoint_sha = hashlib.sha256(checkpoint.read_bytes()).hexdigest()
    runtime = {
        "protocol": "modelforge.local-runtime-configuration/v1",
        "id": "project-modal-fixture",
        "project_repository": str(project),
        "name": "Project Modal fixture",
        "description": "A provider-only conformance fixture",
        "support_level": "conformance",
        "local_enabled": False,
        "action": {
            "id": "inference", "kind": "inference", "interface": "inference_process",
            "display_name": "Run provider fixture",
            "result_protocol": "modelforge.inference-result/v1",
            "arguments": [], "environment": {}, "parameters": {"max_frames": 2},
        },
        "dataset": {
            "id": "clips", "name": "Clips", "root": str(dataset),
            "samples": [{
                "id": "clip", "path": "clip.mp4", "split": "train",
                "content_type": "video/mp4", "size_bytes": sample.stat().st_size,
                "sha256": sample_sha,
            }],
        },
        "bindings": {"checkpoint": {
            "id": "checkpoint", "path": str(checkpoint),
            "size_bytes": checkpoint.stat().st_size, "sha256": checkpoint_sha,
        }},
    }
    runtime_path = tmp_path / "runtime.json"
    runtime_path.write_text(json.dumps(runtime))
    compute = {
        "target": "modal-l40s", "gpu": "L40S", "gpu_count": 1,
        "cpu_millis": 4000, "memory_mib": 32768, "timeout_seconds": 600,
        "retries": 0, "max_containers": 1, "warm_containers": 0,
    }
    transport = {
        "protocol": "modelforge.modal-execution-result/v1",
        "max_stdout_bytes": 262144, "max_stderr_bytes": 262144,
        "max_artifacts": 8, "max_artifact_bytes": 2097152,
        "max_total_artifact_bytes": 2097152,
    }
    binding = {
        "protocol": "modelforge.modal-action-binding/v1",
        "project_id": "project-modal-fixture", "action_id": "inference",
        "provider": "modal", "environment": "acceptance",
        "application": "project-modal", "function": "run_inference",
        "compute": compute, "transport": transport,
        "deployment": {
            "source_manifest_sha256": "a" * 64,
            "resource_plan_sha256": resource_plan_sha256(compute, transport),
        },
        "assets": [
            {"id": "input", "role": "input", "provider_path": "/inputs/clip.mp4", "verification": "sha256", "size_bytes": sample.stat().st_size, "sha256": sample_sha},
            {"id": "checkpoint", "role": "checkpoint", "provider_path": "/inputs/checkpoint.bin", "verification": "sha256", "size_bytes": checkpoint.stat().st_size, "sha256": checkpoint_sha},
        ],
    }
    binding_path = tmp_path / "modal.json"
    binding_path.write_text(json.dumps(binding))
    return runtime_path, binding_path, sample_sha, checkpoint_sha


def _request(binding_sha, key):
    return {
        "protocol": "modelforge.managed-action-request/v1",
        "execution": {
            "target": "modal", "idempotency_key": key,
            "binding_sha256": binding_sha, "billable_confirmed": True,
        },
        "input": {"dataset_id": "clips", "sample_id": "clip"},
    }


def test_project_modal_launch_is_durable_idempotent_redacted_and_recoverable(tmp_path):
    state = tmp_path / "state"
    runtime, binding_file, sample_sha, checkpoint_sha = _registered_project(tmp_path)
    app = AlphaWorkbench(state)
    app.register_project(runtime)
    binding = app.register_modal_action(binding_file)
    project = app.project("project-modal-fixture")
    assert project["runtime_readiness"] == "ready"
    [target] = project["execution_targets"]
    assert target["binding_sha256"] == binding["binding_sha256"]
    assert target["target"] == "modal"
    assert target["billable"] is True
    assert "provider_path" not in json.dumps(project)
    assert "application" not in json.dumps(project)

    events = []
    call = FakeCall(events)
    app._configure_modal(modal_module=_modal(call, events))
    key = str(uuid.uuid4())
    execution = app.project_actions.start(
        "project-modal-fixture", _request(binding["binding_sha256"], key),
    )
    assert not isinstance(execution, dict)
    assert [event[0] for event in events] == ["resolve", "spawn"]
    duplicate = app.project_actions.start(
        "project-modal-fixture", _request(binding["binding_sha256"], key),
    )
    assert isinstance(duplicate, dict) and duplicate["id"] == execution.run_id
    assert [event[0] for event in events] == ["resolve", "spawn"]
    assert app.shutdown() == ()
    assert not call.cancelled

    report = b"{}\n"
    result = json.dumps({
        "protocol": "modelforge.inference-result/v1", "kind": "table",
        "input_artifact": {"sha256": sample_sha},
        "model_artifact": {"sha256": checkpoint_sha},
        "results": [{
            "role": "primary", "kind": "table", "path": "predictions.json",
            "mime_type": "application/json", "sha256": hashlib.sha256(report).hexdigest(),
        }],
    }).encode()
    call.result = {
        "protocol": "modelforge.modal-execution-result/v1",
        "execution_id": execution.run_id, "return_code": 0,
        "stdout": "provider complete", "stderr": "",
        "files": [_file("predictions.json", report), _file("result.json", result)],
    }
    recovered = AlphaWorkbench(state)
    recovered._configure_modal(modal_module=_modal(call, events))
    attached = recovered.project_actions.recover_modal(
        "project-modal-fixture", execution.run_id,
    )
    completed = recovered.finish_project_action(attached)
    assert completed["status"] == "completed"
    assert completed["id"] == execution.run_id
    assert events[-1] == ("recover", "fc-project123")
    assert {item["name"] for item in completed["artifacts"]} == {
        "predictions.json", "process.log", "result.json",
    }


def test_project_modal_rejects_stale_confirmation_before_allocation(tmp_path):
    app = AlphaWorkbench(tmp_path / "state")
    runtime, binding_file, _sample_sha, _checkpoint_sha = _registered_project(tmp_path)
    app.register_project(runtime)
    app.register_modal_action(binding_file)
    with pytest.raises(ValueError, match="stale"):
        app.project_actions.start(
            "project-modal-fixture", _request("0" * 64, str(uuid.uuid4())),
        )
    assert app.list_runs("project-modal-fixture") == []


def test_unattached_modal_cancellation_recovers_same_call_and_confirms(tmp_path):
    state = tmp_path / "state"
    runtime, binding_file, _sample_sha, _checkpoint_sha = _registered_project(tmp_path)
    first = AlphaWorkbench(state)
    first.register_project(runtime)
    binding = first.register_modal_action(binding_file)
    events = []
    call = FakeCall(events)
    first._configure_modal(modal_module=_modal(call, events))
    execution = first.project_actions.start(
        "project-modal-fixture",
        _request(binding["binding_sha256"], str(uuid.uuid4())),
    )
    first.shutdown()

    restarted = AlphaWorkbench(state)
    restarted._configure_modal(modal_module=_modal(call, events))

    def requested_first():
        durable = restarted.get_run(execution.run_id, "project-modal-fixture")
        assert durable["configuration"]["cancellation_requested_at"]

    call.on_cancel = requested_first
    cancelled = restarted.cancel(execution.run_id, "project-modal-fixture")
    assert cancelled["status"] == "cancelled"
    assert cancelled["configuration"]["cancellation_confirmed_at"]
    assert ("recover", "fc-project123") in events
