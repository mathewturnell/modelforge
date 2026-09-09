from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest


ROOT = Path(__file__).parents[1]
HELPERS = (
    ROOT / "examples" / "bdd100k-road-scene-lab" / "src"
    / "bdd_memotr" / "inference_helpers.py"
)


def _helpers():
    spec = importlib.util.spec_from_file_location("public_bdd_inference_helpers", HELPERS)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_bdd_checkpoint_load_fails_closed_without_weights_only(tmp_path):
    class LegacyTorch:
        @staticmethod
        def load(_path, *, map_location):
            del map_location
            raise AssertionError("unsafe deserialization must not be attempted")

    with pytest.raises(RuntimeError, match="weights-only"):
        _helpers().load_checkpoint(LegacyTorch, tmp_path / "checkpoint.pth")


def test_bdd_checkpoint_load_requires_safe_mode(tmp_path):
    observed = {}

    class CurrentTorch:
        @staticmethod
        def load(path, *, map_location, weights_only=False):
            observed.update(path=path, map_location=map_location, weights_only=weights_only)
            return {"model": {"weight": object()}}

    checkpoint = tmp_path / "checkpoint.pth"
    result = _helpers().load_checkpoint(CurrentTorch, checkpoint)

    assert result["model"]
    assert observed == {
        "path": checkpoint,
        "map_location": "cpu",
        "weights_only": True,
    }
