from __future__ import annotations

import builtins
import io
import importlib.util
import json
import sys
import tarfile
import types
from dataclasses import dataclass
from pathlib import Path

import pytest

from modelforge_workbench.application.modal_bindings import resource_plan_sha256
from modelforge_workbench.contracts.project_capabilities import project_capabilities
from modelforge_workbench.project_manifest import load_project_manifest


ROOT = Path(__file__).parents[1]
EXAMPLES = ROOT / "examples"
TRANSPORT = {
    "protocol": "modelforge.modal-execution-result/v1",
    "max_stdout_bytes": 262_144,
    "max_stderr_bytes": 262_144,
    "max_artifacts": 8,
    "max_artifact_bytes": 2_097_152,
    "max_total_artifact_bytes": 2_097_152,
}
EXPECTED = {
    "bdd100k-road-scene-lab": {
        "app": "modelforge-alpha-bdd100k-inference",
        "function": "run_bdd100k_inference",
        "volume": "modelforge-alpha-bdd100k-inputs",
        "gpu": "L40S", "cpu": 4.0, "memory": 32_768, "timeout": 1_200,
    },
    "soccernet-tracking": {
        "app": "modelforge-alpha-soccernet-inference",
        "function": "run_soccernet_inference",
        "volume": "modelforge-alpha-soccernet-inputs",
        "gpu": "L40S", "cpu": 8.0, "memory": 32_768, "timeout": 3_000,
    },
    "tastematch": {
        "app": "modelforge-alpha-tastematch-inference",
        "function": "run_tastematch_inference",
        "volume": "modelforge-alpha-tastematch-inputs",
        "gpu": "L4", "cpu": 2.0, "memory": 16_384, "timeout": 900,
    },
    "qwen-prompt-lab": {
        "app": "modelforge-alpha-qwen-prompt",
        "function": "run_qwen_prompt",
        "volume": "modelforge-alpha-qwen-inputs",
        "gpu": "L40S", "cpu": 2.0, "memory": 32_768, "timeout": 1_200,
    },
}


def _import(example_id: str, *, modal_module=None):
    name = f"_modelforge_test_{example_id.replace('-', '_')}_{id(modal_module)}"
    path = EXAMPLES / example_id / "modal_app.py"
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    if modal_module is not None:
        sys.modules["modal"] = modal_module
    try:
        spec.loader.exec_module(module)
    finally:
        if modal_module is not None:
            sys.modules.pop("modal", None)
    return module


class _FakeImage:
    def __init__(self, calls):
        self.calls = calls

    @classmethod
    def debian_slim(cls, *, python_version):
        instance = cls([("debian_slim", (python_version,), {})])
        return instance

    def __getattr__(self, name):
        def call(*args, **kwargs):
            self.calls.append((name, args, kwargs))
            return self

        return call


@dataclass
class _FakeVolume:
    name: str
    create_if_missing: bool

    @classmethod
    def from_name(cls, name, *, create_if_missing):
        return cls(name, create_if_missing)


class _FakeApp:
    def __init__(self, name):
        self.name = name
        self.functions = []

    def function(self, **kwargs):
        def decorate(function):
            self.functions.append((function.__name__, kwargs, function))
            return function

        return decorate


def _fake_modal():
    value = types.ModuleType("modal")
    value.App = _FakeApp
    value.Image = _FakeImage
    value.Volume = _FakeVolume

    def concurrent(*, max_inputs):
        def decorate(function):
            function._modal_max_inputs = max_inputs
            return function

        return decorate

    value.concurrent = concurrent
    return value


@pytest.mark.parametrize("example_id", EXPECTED)
def test_modal_entrypoints_are_import_safe_without_the_optional_sdk(monkeypatch, example_id):
    original = builtins.__import__

    def blocked(name, *args, **kwargs):
        if name == "modal":
            raise ImportError("provider SDK deliberately unavailable")
        return original(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", blocked)
    module = _import(example_id)

    assert module.modal is None
    assert module.app is None
    assert callable(getattr(module, EXPECTED[example_id]["function"]))


@pytest.mark.parametrize("example_id", EXPECTED)
def test_fixed_modal_apps_use_one_existing_volume_and_one_serial_container(example_id):
    module = _import(example_id, modal_module=_fake_modal())
    expected = EXPECTED[example_id]

    assert module.APP_NAME == expected["app"]
    assert module.FUNCTION_NAME == expected["function"]
    assert module.app.name == expected["app"]
    assert module.input_volume == _FakeVolume(expected["volume"], False)
    assert len(module.app.functions) == 1
    function_name, options, function = module.app.functions[0]
    assert function_name == expected["function"]
    assert options["volumes"] == {module.INPUT_ROOT: module.input_volume}
    assert options["gpu"] == expected["gpu"]
    assert options["cpu"] == expected["cpu"]
    assert options["memory"] == expected["memory"]
    assert options["timeout"] == expected["timeout"]
    assert options["retries"] == 0
    assert options["max_containers"] == 1
    assert options["min_containers"] == 0
    assert function._modal_max_inputs == 1
    calls = module.image.calls
    assert any(
        name == "add_local_python_source"
        and args == ("modelforge_workbench",)
        and kwargs == {"copy": True}
        for name, args, kwargs in calls
    )
    assert any(name == "add_local_dir" and kwargs.get("remote_path") == module.REMOTE_PROJECT_ROOT for name, _, kwargs in calls)


@pytest.mark.parametrize("example_id", EXPECTED)
def test_modal_binding_templates_match_fixed_deployments_and_resource_identity(example_id):
    template = json.loads((EXAMPLES / example_id / "project.modal.template.json").read_text())
    expected = EXPECTED[example_id]

    assert template["protocol"] == "modelforge.modal-action-binding/v1"
    assert template["project_id"] == example_id
    assert template["application"] == expected["app"]
    assert template["function"] == expected["function"]
    assert template["compute"] == {
        "target": f"modal-{expected['gpu'].casefold()}",
        "gpu": expected["gpu"],
        "gpu_count": 1,
        "cpu_millis": int(expected["cpu"] * 1_000),
        "memory_mib": expected["memory"],
        "timeout_seconds": expected["timeout"],
        "retries": 0,
        "max_containers": 1,
        "warm_containers": 0,
    }
    assert template["transport"] == TRANSPORT
    assert template["deployment"]["resource_plan_sha256"] == resource_plan_sha256(
        template["compute"], template["transport"],
    )
    assert all(str(asset["provider_path"]).startswith("/mnt/modelforge-inputs/") for asset in template["assets"])
    assert "training" not in json.dumps(template).casefold()


@pytest.mark.parametrize("example_id", ("soccernet-tracking", "tastematch"))
def test_new_modal_only_projects_author_inference_without_training(example_id):
    manifest = load_project_manifest(EXAMPLES / example_id / "project.json")
    inspectable = load_project_manifest(EXAMPLES / example_id / "project.inspectable.json")
    capabilities = project_capabilities(manifest)
    projection = {item["id"]: item for item in capabilities["capabilities"]}
    runtime = json.loads((EXAMPLES / example_id / "project.local.template.json").read_text())

    assert manifest == inspectable
    assert set(projection) >= {"action.inference"}
    assert "action.training" not in projection
    assert projection["action.inference"]["support"] == "supported"
    assert runtime["local_enabled"] is False
    assert runtime["action"]["id"] == "inference"
    assert runtime["action"]["kind"] == "inference"


def test_qwen_provider_bound_is_stricter_than_the_general_prompt_contract():
    module = _import("qwen-prompt-lab", modal_module=_fake_modal())
    payload = {
        "protocol": "modelforge.modal-project-action-request/v1",
        "run_id": "a" * 32,
        "binding_sha256": "b" * 64,
        "project_id": "qwen-prompt-lab",
        "action_id": "prompt",
        "action_kind": "prompt",
        "request": {
            "protocol": "modelforge.prompt-request/v1",
            "workflow": "prompt",
            "action_id": "prompt",
            "messages": [{"role": "user", "content": "bounded"}] * 5,
            "generation": {"max_new_tokens": 64},
        },
        "assets": [],
    }
    with pytest.raises(ValueError, match="one to four"):
        module._execute(payload)


def test_soccernet_clean_upstream_staging_copies_only_the_bounded_prefix(tmp_path, monkeypatch):
    source_root = EXAMPLES / "soccernet-tracking" / "src"
    monkeypatch.syspath_prepend(str(source_root))
    from soccernet_motr.infer import _stage_upstream_sequence
    from soccernet_motr.mot import load_sequence

    sequence_root = tmp_path / "source" / "SNMOT-060"
    images = sequence_root / "img1"
    images.mkdir(parents=True)
    (sequence_root / "seqinfo.ini").write_text(
        "[Sequence]\nname=SNMOT-060\nimDir=img1\nimExt=.jpg\n"
        "imWidth=2\nimHeight=2\nseqLength=30\nframeRate=25\n",
        encoding="utf-8",
    )
    for frame in range(1, 31):
        (images / f"{frame:06d}.jpg").write_bytes(f"frame-{frame}".encode())
    sequence = load_sequence(sequence_root, require_gt=False)
    staged = tmp_path / "output" / "SNMOT-060"

    _stage_upstream_sequence(sequence, staged, 24)

    assert not staged.is_symlink()
    assert len(list((staged / "img1").glob("*.jpg"))) == 24
    assert not (staged / "img1" / "000025.jpg").exists()
    assert "seqLength=24" in (staged / "seqinfo.ini").read_text(encoding="utf-8")
    with pytest.raises(ValueError, match="one to 24"):
        _stage_upstream_sequence(sequence, tmp_path / "too-many", 25)


def test_soccernet_installs_inference_only_reference_attention_without_upstream_patch(monkeypatch):
    source_root = EXAMPLES / "soccernet-tracking" / "src"
    monkeypatch.syspath_prepend(str(source_root))
    from soccernet_motr.infer import _install_reference_msda

    calls = []
    implementation = types.SimpleNamespace(
        ms_deform_attn_core_pytorch=lambda *args: calls.append(args) or "reference-result",
    )
    monkeypatch.setitem(sys.modules, "models.ops.functions.ms_deform_attn_func", implementation)
    _install_reference_msda()
    shim = sys.modules["MultiScaleDeformableAttention"]

    assert shim.ms_deform_attn_forward(1, 2, 3, 4, 5, 6) == "reference-result"
    assert calls == [(1, 2, 4, 5)]
    with pytest.raises(RuntimeError, match="inference-only"):
        shim.ms_deform_attn_backward()


def test_soccernet_guards_pinned_upstream_float_version_parser(monkeypatch):
    source_root = EXAMPLES / "soccernet-tracking" / "src"
    monkeypatch.syspath_prepend(str(source_root))
    from soccernet_motr.infer import _guard_legacy_torchvision_version_parser

    fake = types.SimpleNamespace(__version__="0.21.0")
    monkeypatch.setitem(sys.modules, "torchvision", fake)
    module, original = _guard_legacy_torchvision_version_parser()

    assert module is fake
    assert original == "0.21.0"
    assert module.__version__ == "1.0.0-modelforge-compat"


def test_soccernet_legacy_load_opt_out_is_limited_to_verified_checkpoint(tmp_path, monkeypatch):
    source_root = EXAMPLES / "soccernet-tracking" / "src"
    monkeypatch.syspath_prepend(str(source_root))
    from soccernet_motr.infer import _guard_verified_checkpoint_load

    calls = []
    fake = types.SimpleNamespace(
        load=lambda source, *args, **kwargs: calls.append((source, args, kwargs)) or "loaded",
    )
    checkpoint = tmp_path / "checkpoint.pth"
    other = tmp_path / "other.pth"
    checkpoint.touch()
    other.touch()
    original = _guard_verified_checkpoint_load(fake, checkpoint)

    assert fake.load(checkpoint, map_location="cpu") == "loaded"
    assert calls[-1][2] == {"map_location": "cpu", "weights_only": False}
    assert fake.load(other, map_location="cpu") == "loaded"
    assert calls[-1][2] == {"map_location": "cpu"}
    assert fake.load(checkpoint, weights_only=True) == "loaded"
    assert calls[-1][2] == {"weights_only": True}
    assert original is not fake.load


def test_soccernet_explicit_registered_train_sequence_does_not_require_test_split(tmp_path, monkeypatch):
    source_root = EXAMPLES / "soccernet-tracking" / "src"
    monkeypatch.syspath_prepend(str(source_root))
    from soccernet_motr import infer as module

    images = tmp_path / "MOT17-SoccerNet" / "images"
    sequence = images / "train" / "SNMOT-060"
    sequence.mkdir(parents=True)
    (tmp_path / "adapter_report.json").write_text(json.dumps({
        "format": "soccernet-to-motr-adapter/v1",
        "synthetic": False,
        "sequences": [{"split": "train", "sequence": "SNMOT-060"}],
    }), encoding="utf-8")
    sentinel = object()
    monkeypatch.setattr(module, "load_sequence", lambda *args, **kwargs: sentinel)

    assert module._official_sequence(tmp_path, 0, sequence) is sentinel


def test_soccernet_modal_dataset_archive_is_exact_and_rejects_links(tmp_path):
    module = _import("soccernet-tracking", modal_module=_fake_modal())
    archive = tmp_path / "bounded.tar"
    report = json.dumps({
        "format": "soccernet-to-motr-adapter/v1",
        "synthetic": False,
        "sequences": [{"split": "train", "sequence": "SNMOT-060"}],
    }).encode()
    seqinfo = (
        "[Sequence]\nname=SNMOT-060\nimDir=img1\nimExt=.jpg\n"
        "imWidth=2\nimHeight=2\nseqLength=24\nframeRate=25\n"
    ).encode()
    with tarfile.open(archive, "w") as target:
        for name, content in (
            ("adapter_report.json", report),
            ("MOT17-SoccerNet/images/train/SNMOT-060/seqinfo.ini", seqinfo),
            *((
                f"MOT17-SoccerNet/images/train/SNMOT-060/img1/{frame:06d}.jpg",
                f"frame-{frame}".encode(),
            ) for frame in range(1, 25)),
        ):
            info = tarfile.TarInfo(name)
            info.size = len(content)
            target.addfile(info, io.BytesIO(content))
    destination = module._extract_bounded_dataset(
        archive, tmp_path / "dataset", split="train", sequence="SNMOT-060",
    )
    assert len(list(destination.rglob("*.jpg"))) == 24

    unsafe = tmp_path / "unsafe.tar"
    with tarfile.open(unsafe, "w") as target:
        link = tarfile.TarInfo("MOT17-SoccerNet/images/train/SNMOT-060/img1/000001.jpg")
        link.type = tarfile.SYMTYPE
        link.linkname = "/etc/passwd"
        target.addfile(link)
    with pytest.raises(ValueError, match="unexpected entry"):
        module._extract_bounded_dataset(
            unsafe, tmp_path / "unsafe", split="train", sequence="SNMOT-060",
        )


def test_soccernet_modal_result_binds_selected_input_identity(tmp_path):
    module = _import("soccernet-tracking", modal_module=_fake_modal())
    result = tmp_path / "result.json"
    result.write_text(json.dumps({
        "format": "modelforge.inference-result/v1",
        "model_artifact": {"sha256": "b" * 64},
        "results": [],
    }), encoding="utf-8")

    value = module._bind_input_identity(result, "a" * 64)

    assert value["input_artifact"] == {"sha256": "a" * 64}
    assert json.loads(result.read_text(encoding="utf-8")) == value


def test_tastematch_modal_path_is_explicitly_base_model_only():
    module = _import("tastematch")
    source = (EXAMPLES / "tastematch" / "modal_app.py").read_text(encoding="utf-8")

    assert len(module.FOOD101_CLASSES) == 101
    assert len(set(module.FOOD101_CLASSES)) == 101
    assert "pinned-base-siglip-no-adapter" in source
    assert "SiglipEngine(" not in source
