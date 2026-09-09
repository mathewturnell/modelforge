from __future__ import annotations

import base64
import hashlib

import pytest

from modelforge_workbench.modal_worker import result_envelope, validate_request, verified_asset


def _request():
    return {
        "protocol": "modelforge.modal-project-action-request/v1",
        "run_id": "a" * 32,
        "binding_sha256": "b" * 64,
        "project_id": "example", "action_id": "inference", "action_kind": "inference",
        "request": {"workflow": "inference", "action_id": "inference"},
        "assets": [],
    }


def test_worker_request_is_closed_and_action_bound():
    assert validate_request(
        _request(), project_id="example", action_id="inference", action_kind="inference",
    )["run_id"] == "a" * 32
    changed = _request()
    changed["application"] = "caller-controlled"
    with pytest.raises(ValueError, match="fields"):
        validate_request(
            changed, project_id="example", action_id="inference", action_kind="inference",
        )


def test_worker_verifies_input_bytes_beneath_fixed_mount(tmp_path):
    asset = tmp_path / "input.bin"
    asset.write_bytes(b"bound input")
    record = {
        "role": "input", "provider_path": str(asset), "verification": "sha256",
        "size_bytes": asset.stat().st_size,
        "sha256": hashlib.sha256(asset.read_bytes()).hexdigest(),
    }
    assert verified_asset(tmp_path, record, expected_role="input") == asset
    asset.write_bytes(b"changed")
    with pytest.raises(ValueError, match="changed"):
        verified_asset(tmp_path, record, expected_role="input")


def test_worker_transport_binds_every_returned_byte(tmp_path):
    path = tmp_path / "result.json"
    path.write_bytes(b"{}\n")
    envelope = result_envelope("a" * 32, [path], stdout="complete")
    [record] = envelope["files"]
    assert base64.b64decode(record["content_base64"]) == b"{}\n"
    assert record["sha256"] == hashlib.sha256(b"{}\n").hexdigest()

