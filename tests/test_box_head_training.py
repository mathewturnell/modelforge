"""Project recipe constraints and Modal boundaries without paid computation."""

import importlib.util
import json
import sys
from pathlib import Path
import types
import pytest

ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = ROOT / "examples/bdd100k-road-scene-lab"


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_modal_training_resources_no_import_time_call(monkeypatch):
    from test_example_modal_apps import _FakeImage, _FakeVolume, _FakeApp

    fake = types.SimpleNamespace(
        Image=_FakeImage, Volume=_FakeVolume, App=_FakeApp, concurrent=lambda **kw: lambda f: f
    )
    monkeypatch.setitem(sys.modules, "modal", fake)
    module = load("box_training_modal", EXAMPLE / "modal_training.py")
    assert module.app.name == "modelforge-bdd100k-box-head-training"
    [(name, resources, function)] = module.app.functions
    assert name == "run_box_head_training"
    assert (
        resources["timeout"] == 900
        and resources["retries"] == 0
        and resources["max_containers"] == 1
        and resources["min_containers"] == 0
    )
    assert resources["gpu"] == "L40S"
    assert module.volume.create_if_missing is False
    for split in ("test", "held_out"):
        payload = dict(
            protocol="modelforge.modal-project-action-request/v1",
            run_id="a" * 32,
            binding_sha256="b" * 64,
            project_id="bdd100k-box-head-training",
            action_id="training",
            action_kind="training",
            assets=[],
            request=dict(
                workflow="training", dataset_split=split, evaluation_split="validation", epochs=1, max_batches=20
            ),
        )
        with pytest.raises(ValueError, match="splits"):
            function(payload)
    payload["request"]["dataset_split"] = "train"
    payload["request"]["max_batches"] = 101
    with pytest.raises(ValueError, match="bounds"):
        function(payload)


def test_delta_rejects_wrong_parent_before_tensor_loading(tmp_path):
    module = load("box_adaptation", EXAMPLE / "src/bdd_memotr/adaptation.py")
    path = tmp_path / "delta.json"
    path.write_text(json.dumps(dict(protocol="modelforge.memotr-box-head-delta/v1", parent_sha256="b" * 64)))
    with pytest.raises(ValueError, match="parent"):
        module.apply_delta(None, None, path, "a" * 64)
