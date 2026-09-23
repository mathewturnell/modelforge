from __future__ import annotations

import concurrent.futures
import hashlib
import json

import pytest

from modelforge_workbench.application.annotations import AnnotationConflictError, AnnotationService
from modelforge_workbench.application.datasets import DatasetService


class Projects:
    def __init__(self, root, split="train", content_type="video/mp4"):
        self.sample = root / "clip.mp4"
        self.sample.write_bytes(b"original sample must remain immutable")
        self.value = {"id": "project", "dataset": {"id": "clips", "root": str(root), "samples": [{
            "id": "clip", "path": "clip.mp4", "size_bytes": self.sample.stat().st_size,
            "sha256": hashlib.sha256(self.sample.read_bytes()).hexdigest(), "split": split,
            "content_type": content_type,
        }]}}

    def get(self, project_id):
        if project_id != self.value["id"]:
            raise KeyError(project_id)
        return self.value


def rectangle(**changes):
    return {"id": "box-1", "frame": 2, "label": "player", "track_id": "track-7",
            "x": 0.1, "y": 0.2, "width": 0.2, "height": 0.4, **changes}


def service(tmp_path, **kwargs):
    projects = Projects(tmp_path, **kwargs)
    state = tmp_path / "state"
    state.mkdir(mode=0o700)
    return AnnotationService(state, DatasetService(projects)), projects


def test_sidecars_survive_reload_and_preserve_original_sample(tmp_path):
    annotations, projects = service(tmp_path)
    original = projects.sample.read_bytes()
    initial = annotations.get("project", "clips", "clip")
    assert initial["revision"] == 0 and initial["editable"]
    assert not annotations.root.exists()
    saved = annotations.save("project", "clips", "clip", {"expected_revision": 0, "annotations": [rectangle()]})
    assert saved["revision"] == 1
    reloaded = AnnotationService(annotations.root.parent, annotations.datasets)
    assert reloaded.get("project", "clips", "clip") == saved
    assert projects.sample.read_bytes() == original
    assert str(tmp_path) not in json.dumps(saved)
    assert annotations.root.stat().st_mode & 0o777 == 0o700
    assert next(annotations.root.glob("*.json")).stat().st_mode & 0o777 == 0o600
    with pytest.raises(AnnotationConflictError, match="reload"):
        annotations.save("project", "clips", "clip", {"expected_revision": 0, "annotations": []})
    assert annotations.save("project", "clips", "clip", {"expected_revision": 1, "annotations": []})["revision"] == 2


@pytest.mark.parametrize("split", ["test", "reserved", "heldout", "held-out", "test-public", "evaluation", "mystery"])
def test_protected_and_unknown_splits_cannot_be_annotated(tmp_path, split):
    annotations, _ = service(tmp_path, split=split)
    assert not annotations.get("project", "clips", "clip")["editable"]
    with pytest.raises(ValueError, match="cannot mutate"):
        annotations.save("project", "clips", "clip", {"expected_revision": 0, "annotations": [rectangle()]})
    assert not annotations.root.exists()


@pytest.mark.parametrize("changes", [
    {"x": -0.1}, {"x": 0.95}, {"y": 0.9}, {"width": 0}, {"height": float("nan")},
    {"x": True}, {"frame": -1}, {"frame": True}, {"frame": 1_000_001}, {"label": ""},
    {"track_id": "../../escape"}, {"id": "../escape"}, {"other": "unexpected"},
])
def test_invalid_annotations_are_rejected(tmp_path, changes):
    annotations, _ = service(tmp_path)
    with pytest.raises(ValueError):
        annotations.save("project", "clips", "clip", {"expected_revision": 0, "annotations": [rectangle(**changes)]})


def test_changed_samples_and_cross_scope_access_are_rejected(tmp_path):
    annotations, projects = service(tmp_path)
    for scope in [("project", "other", "clip"), ("other", "clips", "clip"), ("project", "clips", "other")]:
        with pytest.raises(KeyError):
            annotations.get(*scope)
    with pytest.raises(ValueError):
        annotations.get("../escape", "clips", "clip")
    projects.sample.write_bytes(b"changed")
    with pytest.raises(OSError, match="changed"):
        annotations.save("project", "clips", "clip", {"expected_revision": 0, "annotations": []})


def test_image_frames_and_duplicate_boxes_are_rejected(tmp_path):
    annotations, _ = service(tmp_path, content_type="image/png")
    with pytest.raises(ValueError, match="zero"):
        annotations.save("project", "clips", "clip", {"expected_revision": 0, "annotations": [rectangle()]})
    with pytest.raises(ValueError, match="unique"):
        annotations.save("project", "clips", "clip", {"expected_revision": 0, "annotations": [rectangle(frame=0)] * 2})


def test_sidecar_symlink_and_identity_tampering_fail_closed(tmp_path):
    annotations, _ = service(tmp_path)
    annotations.save("project", "clips", "clip", {"expected_revision": 0, "annotations": []})
    sidecar = next(annotations.root.glob("*.json"))
    value = json.loads(sidecar.read_text())
    value["sample_sha256"] = "a" * 64
    sidecar.write_text(json.dumps(value))
    with pytest.raises(ValueError, match="identity"):
        annotations.get("project", "clips", "clip")
    sidecar.unlink()
    outside = tmp_path / "outside.json"
    outside.write_text(json.dumps(value))
    sidecar.symlink_to(outside)
    with pytest.raises(OSError):
        annotations.get("project", "clips", "clip")


def test_storage_symlinks_cannot_redirect_writes(tmp_path):
    annotations, _ = service(tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()
    annotations.root.symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError, match="symbolic"):
        annotations.save("project", "clips", "clip", {"expected_revision": 0, "annotations": []})
    assert list(outside.iterdir()) == []


def test_two_service_instances_cannot_overwrite_same_revision(tmp_path):
    annotations, _ = service(tmp_path)
    other = AnnotationService(annotations.root.parent, annotations.datasets)

    def save(port):
        try:
            return port.save("project", "clips", "clip", {"expected_revision": 0, "annotations": []})["revision"]
        except AnnotationConflictError:
            return "conflict"

    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        outcomes = list(pool.map(save, [annotations, other]))
    assert sorted(outcomes, key=str) == [1, "conflict"]


def test_multi_frame_timeline_above_old_limit_survives_reload(tmp_path):
    annotations, projects = service(tmp_path)
    original = projects.sample.read_bytes()
    boxes = [rectangle(id=f"box-{index}", frame=index // 20 + 1, track_id=f"track-{index % 20}", label="tracked vehicle")
             for index in range(4000)]
    saved = annotations.save("project", "clips", "clip", {"expected_revision": 0, "annotations": boxes})
    assert len(json.dumps(saved).encode()) > 512 * 1024
    assert saved["annotations"] == boxes
    assert len({box["frame"] for box in saved["annotations"]}) == 200
    reloaded = AnnotationService(annotations.root.parent, annotations.datasets)
    assert reloaded.get("project", "clips", "clip") == saved
    with pytest.raises(AnnotationConflictError):
        reloaded.save("project", "clips", "clip", {"expected_revision": 0, "annotations": boxes})
    assert projects.sample.read_bytes() == original


def test_timeline_rectangle_count_and_storage_remain_bounded(tmp_path):
    annotations, _ = service(tmp_path)
    with pytest.raises(ValueError, match="at most 10000"):
        annotations.save("project", "clips", "clip", {"expected_revision": 0, "annotations": [rectangle()] * 10001})
    annotations.save("project", "clips", "clip", {"expected_revision": 0, "annotations": []})
    sidecar = next(annotations.root.glob("*.json"))
    sidecar.write_bytes(b" " * (4 * 1024 * 1024 + 1))
    with pytest.raises(ValueError, match="bounded"):
        annotations.get("project", "clips", "clip")
