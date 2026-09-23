"""No-model tests for the bounded current SoccerNet local-selection adapter."""
import copy
import importlib.util
from pathlib import Path

import pytest


spec = importlib.util.spec_from_file_location(
    "soccernet_local_selection",
    Path(__file__).parents[1] / "examples/soccernet-tracking/infer_selected.py",
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


@pytest.fixture
def selection(tmp_path):
    source = tmp_path / "source"
    prefix = Path("MOT17-SoccerNet/images/train/SNMOT-060")
    paths = [Path("adapter_report.json"), prefix / "seqinfo.ini"]
    paths += [prefix / "img1" / f"{index:06d}.jpg" for index in (1, 2)]
    for relative in paths:
        path = source / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"owned test bytes")
    (source / prefix / "seqinfo.ini").write_text(
        "[Sequence]\nname=SNMOT-060\nimDir=img1\nimExt=.jpg\nseqLength=750\n"
    )
    value = {
        "protocol": "modelforge.soccernet-local-selection/v1", "split": "train",
        "sequence": "SNMOT-060", "max_frames": 2,
        "files": [{"path": str(path), "sha256": module.sha256(source / path),
                   "size_bytes": (source / path).stat().st_size} for path in paths],
    }
    return source, value, tmp_path / "output"


def test_selection_materializes_exact_bound_without_altering_original(selection):
    source, value, output = selection
    result = module.stage_selection(value, source, output, 2)
    assert sorted(path.name for path in (result / "img1").iterdir()) == ["000001.jpg", "000002.jpg"]
    assert "seqlength = 2" in (result / "seqinfo.ini").read_text()
    assert "seqLength=750" in (source / "MOT17-SoccerNet/images/train/SNMOT-060/seqinfo.ini").read_text()


def test_selection_rejects_content_changes_before_execution(selection):
    source, value, output = selection
    (source / value["files"][-1]["path"]).write_bytes(b"changed")
    with pytest.raises(ValueError, match="bytes changed"):
        module.stage_selection(value, source, output, 2)


@pytest.mark.parametrize("change", ["escape", "duplicate", "missing"])
def test_selection_rejects_nonexact_file_inventory(selection, change):
    source, value, output = selection
    altered = copy.deepcopy(value)
    if change == "escape":
        altered["files"][-1]["path"] = "../outside.jpg"
    elif change == "duplicate":
        altered["files"][-1] = altered["files"][-2]
    else:
        altered["files"].pop()
    with pytest.raises(ValueError, match="inventory|every frame"):
        module.stage_selection(altered, source, output, 2)


def test_selection_rejects_mismatched_frame_admission(selection):
    source, value, output = selection
    with pytest.raises(ValueError, match="explicit local bound"):
        module.stage_selection(value, source, output, 125)


def test_selection_rejects_symlinked_input(selection):
    source, value, output = selection
    frame = source / value["files"][-1]["path"]
    frame.unlink()
    frame.symlink_to(source / value["files"][-2]["path"])
    with pytest.raises(ValueError, match="regular file"):
        module.stage_selection(value, source, output, 2)


def test_selection_rejects_metadata_that_redirects_frame_reads(selection):
    source, value, output = selection
    metadata = source / value["files"][1]["path"]
    metadata.write_text(metadata.read_text().replace("imDir=img1", "imDir=../../../../.."))
    value["files"][1].update(sha256=module.sha256(metadata), size_bytes=metadata.stat().st_size)
    with pytest.raises(ValueError, match="metadata differs"):
        module.stage_selection(value, source, output, 2)


def test_local_loader_disables_worker_sockets_without_changing_batch_or_sample_order():
    calls = []
    def loader(*args, **kwargs):
        calls.append((args, kwargs))
        return "loader"
    wrapped = module.serial_inference_loader(loader)
    dataset = object()
    assert wrapped(dataset, 1, num_workers=2, shuffle=False) == "loader"
    assert calls == [((dataset, 1), {"num_workers": 0, "shuffle": False})]


def test_local_loader_handles_positional_workers_and_worker_only_options():
    calls = []
    def loader(*args, **kwargs):
        calls.append((args, kwargs))
    wrapped = module.serial_inference_loader(loader)
    wrapped("dataset", 1, False, None, None, 2, persistent_workers=True, prefetch_factor=2)
    assert calls == [(("dataset", 1, False, None, None, 0),
                      {"persistent_workers": False, "prefetch_factor": None})]
