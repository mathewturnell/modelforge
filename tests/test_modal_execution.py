from __future__ import annotations

import base64
import hashlib
import json
from types import SimpleNamespace

import pytest

from modelforge_workbench.alpha import ALPHA_SCOPE, AlphaWorkbench
from modelforge_workbench.execution.modal import modal_readiness


class FakeInputCancellation(BaseException):
    pass


class FakeTimeout(Exception):
    pass


class FakeRemoteError(Exception):
    pass


def _file(name: str, content: bytes) -> dict:
    return {
        "name": name,
        "content_base64": base64.b64encode(content).decode("ascii"),
        "size_bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
    }


def _result_envelope(execution_id="pending") -> dict:
    report = b'{"sample_count": 4, "synthetic": true}\n'
    result = json.dumps({
        "protocol": "modelforge.inference-result/v1",
        "kind": "table",
        "synthetic": True,
        "results": [{
            "role": "primary",
            "kind": "table",
            "path": "report.json",
            "mime_type": "application/json",
            "sha256": hashlib.sha256(report).hexdigest(),
        }],
    }).encode()
    return {
        "protocol": "modelforge.modal-execution-result/v1",
        "execution_id": execution_id,
        "return_code": 0,
        "stdout": "processed 4 synthetic samples\n",
        "stderr": "",
        "files": [_file("report.json", report), _file("result.json", result)],
    }


class FakeCall:
    def __init__(self, object_id="fc-alpha123", result=None) -> None:
        self.object_id = object_id
        self.result = result if result is not None else _result_envelope()
        self.cancelled = False
        self.on_cancel = None
        self.remote_cancellation = False
        self.pending_graph_reads = 0

    def get(self, timeout=None):
        if self.cancelled:
            if self.remote_cancellation:
                raise FakeRemoteError("Function call was cancelled by user or a failure.")
            raise FakeInputCancellation()
        if self.result is None:
            raise FakeTimeout()
        return self.result

    def cancel(self):
        if self.on_cancel:
            self.on_cancel()
        self.cancelled = True

    def get_call_graph(self):
        status = "TERMINATED" if self.cancelled and self.pending_graph_reads == 0 else "PENDING"
        if self.cancelled and self.pending_graph_reads:
            self.pending_graph_reads -= 1
        return [SimpleNamespace(
            function_call_id=self.object_id,
            status=SimpleNamespace(name=status),
        )]


def _fake_modal(call: FakeCall, events: list | None = None):
    events = events if events is not None else []

    class Function:
        @staticmethod
        def from_name(application, function, *, environment_name):
            events.append(("resolve", application, function, environment_name))
            return SimpleNamespace(spawn=lambda payload: _spawn(payload))

    def _spawn(payload):
        events.append(("spawn", payload))
        if call.result is not None:
            call.result["execution_id"] = payload["run_id"]
        return call

    class FunctionCall:
        @staticmethod
        def from_id(object_id):
            events.append(("recover", object_id))
            assert object_id == call.object_id
            return call

    class Config:
        def get(self, name):
            return {"token_id": "configured", "token_secret": "configured"}.get(name)

    return SimpleNamespace(
        __version__="1.5.fake",
        Function=Function,
        FunctionCall=FunctionCall,
        config=SimpleNamespace(Config=Config),
        exception=SimpleNamespace(
            TimeoutError=FakeTimeout,
            InputCancellation=FakeInputCancellation,
            RemoteError=FakeRemoteError,
        ),
    )


def test_modal_status_is_local_only_and_never_exposes_credentials():
    value = modal_readiness("alpha-test", modal_module=_fake_modal(FakeCall()))

    assert value == {
        "protocol": "modelforge.modal-readiness/v1",
        "provider": "modal",
        "environment": "alpha-test",
        "sdk_installed": True,
        "sdk_version": "1.5.fake",
        "credentials": "configured",
        "verification": "not_performed",
        "ready": True,
        "reasons": [],
    }
    assert "token" not in json.dumps(value).casefold()


def test_modal_example_uses_one_durable_lifecycle_and_materializes_artifacts(tmp_path):
    call = FakeCall()
    events = []
    modal = _fake_modal(call, events)
    app = AlphaWorkbench(tmp_path / "state")
    create = app.runs.create

    def observed_create(*args, **kwargs):
        events.append(("durable", kwargs.get("run_id")))
        return create(*args, **kwargs)

    app.runs.create = observed_create
    execution = app.start_example(
        executor="modal",
        modal_environment="alpha-test",
        billable_confirmed=True,
        modal_module=modal,
    )

    assert [event[0] for event in events].index("durable") < [
        event[0] for event in events
    ].index("spawn")
    assert events[0] == ("durable", execution.run_id)
    assert ("resolve", "modelforge-alpha-synthetic", "run_synthetic_threshold", "alpha-test") in events
    assert events[-1][1]["run_id"] == execution.run_id
    running = app.runs.get(ALPHA_SCOPE, execution.run_id, include_artifacts=False)
    assert running["provider"] == "modal"
    assert running["compute_target"] == "modal-cpu-0.125"
    assert running["provider_action_id"] == "fc-alpha123"
    assert running["configuration"]["billable_action_confirmed"] is True

    completed = app.finish_example(execution)

    assert completed["status"] == "completed"
    assert {item["name"] for item in completed["artifacts"]} == {
        "report.json", "result.json",
    }
    assert completed["provider"] == "modal"
    assert all("storage_ref" not in item for item in completed["artifacts"])


def test_modal_requires_billable_confirmation_before_durable_or_remote_side_effect(tmp_path):
    events = []
    app = AlphaWorkbench(tmp_path / "state")

    with pytest.raises(ValueError, match="billable-action confirmation"):
        app.start_example(
            executor="modal",
            modal_environment="alpha-test",
            modal_module=_fake_modal(FakeCall(), events),
        )

    assert events == []
    assert app.list_runs("synthetic-threshold") == []


def test_modal_cancellation_request_is_durable_before_provider_cancel(tmp_path):
    call = FakeCall(result=None)
    app = AlphaWorkbench(tmp_path / "state")
    execution = app.start_example(
        executor="modal", modal_environment="alpha-test",
        billable_confirmed=True, modal_module=_fake_modal(call),
    )

    def observe_request():
        durable = app.runs.get(ALPHA_SCOPE, execution.run_id, include_artifacts=False)
        assert durable["configuration"]["cancellation_requested_at"] is not None

    call.on_cancel = observe_request
    cancelled = app.cancel(execution.run_id)

    assert cancelled["status"] == "cancelled"
    assert cancelled["configuration"]["cancellation_confirmed_at"] is not None


def test_modal_confirms_remote_error_only_with_provider_terminated_status(tmp_path):
    call = FakeCall(result=None)
    call.remote_cancellation = True
    app = AlphaWorkbench(tmp_path / "state")
    execution = app.start_example(
        executor="modal", modal_environment="alpha-test",
        billable_confirmed=True, modal_module=_fake_modal(call),
    )

    cancelled = app.cancel(execution.run_id)

    assert cancelled["status"] == "cancelled"
    assert cancelled["configuration"]["cancellation_confirmed_at"] is not None


def test_modal_boundedly_waits_for_provider_termination_after_cancel(tmp_path):
    call = FakeCall(result=None)
    call.remote_cancellation = True
    call.pending_graph_reads = 2
    app = AlphaWorkbench(tmp_path / "state")
    execution = app.start_example(
        executor="modal", modal_environment="alpha-test",
        billable_confirmed=True, modal_module=_fake_modal(call),
    )

    cancelled = app.cancel(execution.run_id)

    assert cancelled["status"] == "cancelled"
    assert call.pending_graph_reads == 0


def test_modal_fc_call_recovers_into_same_durable_run(tmp_path):
    call = FakeCall(result=None)
    state_root = tmp_path / "state"
    first = AlphaWorkbench(state_root)
    execution = first.start_example(
        executor="modal", modal_environment="alpha-test",
        billable_confirmed=True, modal_module=_fake_modal(call),
    )
    call.result = _result_envelope(execution.run_id)
    events = []
    recovered = AlphaWorkbench(state_root)
    completed = recovered.recover_modal_example(
        execution.run_id,
        modal_environment="alpha-test",
        billable_confirmed=True,
        modal_module=_fake_modal(call, events),
    )

    assert completed["id"] == execution.run_id
    assert completed["status"] == "completed"
    assert events == [("recover", "fc-alpha123")]


def test_modal_rejects_invalid_transport_without_registering_artifacts(tmp_path):
    envelope = _result_envelope()
    envelope["files"][0]["name"] = "../escape.json"
    app = AlphaWorkbench(tmp_path / "state")
    execution = app.start_example(
        executor="modal", modal_environment="alpha-test",
        billable_confirmed=True, modal_module=_fake_modal(FakeCall(result=envelope)),
    )
    envelope["execution_id"] = execution.run_id

    with pytest.raises(ValueError, match="file name is unsafe"):
        app.finish_example(execution)

    failed = app.runs.get(ALPHA_SCOPE, execution.run_id)
    assert failed["status"] == "failed"
    assert failed["artifacts"] == []
    assert not (execution.allocation.evidence_root / "escape.json").exists()
