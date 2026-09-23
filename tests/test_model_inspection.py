from __future__ import annotations

import hashlib
import json

import pytest

from modelforge_workbench.application.model_inspection import ModelInspectionService


class Projects:
    def __init__(self, value):
        self.value = value

    def get(self, project_id):
        if project_id != "project":
            raise KeyError(project_id)
        return self.value


def descriptor():
    return {
        "protocol": "modelforge.model-descriptor/v1", "model_id": "example/model", "name": "Vision tracker",
        "checkpoint": {"sha256": "a" * 64},
        "nodes": [{"id": "backbone", "label": "Backbone", "kind": "encoder", "parameter_count": 123},
                  {"id": "head", "label": "Tracking head", "kind": "decoder"}],
        "edges": [{"source": "backbone", "target": "head"}],
    }


def service(tmp_path, value=None):
    path = tmp_path / "model.json"
    path.write_text(json.dumps(descriptor() if value is None else value))
    projects = Projects({"id": "project", "bindings": {
        "model_descriptor": {"path": str(path), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()},
        "checkpoint": {"sha256": "a" * 64, "path": str(tmp_path / "unsafe-checkpoint.pkl")},
    }})
    return ModelInspectionService(projects), path


def test_inspection_uses_only_checked_json_and_redacts_paths(tmp_path):
    inspection, path = service(tmp_path)
    # There is deliberately no readable checkpoint: inspection never opens it.
    result = inspection.get("project")
    assert result["nodes"] == descriptor()["nodes"]
    assert result["descriptor_sha256"] == hashlib.sha256(path.read_bytes()).hexdigest()
    assert result["evidence_kind"] == "owner-authored-structural-descriptor"
    assert str(tmp_path) not in json.dumps(result)
    with pytest.raises(KeyError):
        inspection.get("another-project")


def test_revision_bound_model_is_supported(tmp_path):
    value = descriptor()
    value["checkpoint"] = {"revision": "commit-123"}
    inspection, _ = service(tmp_path, value)
    inspection.projects.value["bindings"]["model"] = {"revision": "commit-123"}
    assert inspection.get("project")["checkpoint"] == {"revision": "commit-123"}


def test_descriptor_tampering_and_checkpoint_mismatch_fail_closed(tmp_path):
    inspection, path = service(tmp_path)
    inspection.projects.value["bindings"]["checkpoint"]["sha256"] = "b" * 64
    with pytest.raises(ValueError, match="checkpoint identity"):
        inspection.get("project")
    path.write_text("{}")
    with pytest.raises(ValueError, match="changed"):
        inspection.get("project")


@pytest.mark.parametrize("mutation", [
    lambda v: v.update(protocol="pickle"),
    lambda v: v.update(import_module="torch"),
    lambda v: v.update(checkpoint={"path": "/tmp/unsafe.pkl"}),
    lambda v: v.update(nodes=[]),
    lambda v: v["nodes"].append(v["nodes"][0]),
    lambda v: v["nodes"][0].update(parameter_count=True),
    lambda v: v["nodes"][0].update(parameter_count=-1),
    lambda v: v["nodes"][0].update(python_class="arbitrary.project.Class"),
    lambda v: v["edges"][0].update(source="absent"),
    lambda v: v["edges"][0].update(target="backbone"),
    lambda v: v["edges"].append(v["edges"][0]),
])
def test_invalid_graphs_and_executable_metadata_are_rejected(tmp_path, mutation):
    value = descriptor()
    mutation(value)
    inspection, _ = service(tmp_path, value)
    with pytest.raises(ValueError):
        inspection.get("project")


def test_symlink_descriptor_cannot_redirect_read(tmp_path):
    inspection, path = service(tmp_path)
    other = tmp_path / "other.json"
    path.rename(other)
    path.symlink_to(other)
    with pytest.raises(ValueError, match="symbolic"):
        inspection.get("project")


def test_descriptor_is_bounded_and_owner_binding_is_required(tmp_path):
    inspection, path = service(tmp_path)
    path.write_bytes(b" " * (512 * 1024 + 1))
    with pytest.raises(ValueError, match="bounded"):
        inspection.get("project")
    inspection.projects.value["bindings"].pop("model_descriptor")
    with pytest.raises(KeyError, match="not configured"):
        inspection.get("project")


def rich_descriptor():
    value = descriptor()
    value.update(
        description="A checked owner-authored model description.",
        sources=[{"id": "upstream", "name": "Declared upstream", "revision": "commit-123",
                  "node_ids": ["backbone", "head"]}],
        brief={"description": "Architecture summary", "rationale": ["Declared model choice"],
               "key_aspects": ["Encoded visual features"], "goals": ["Track objects"], "modifications": []},
    )
    value["nodes"][0].update(type="convolutional_backbone", category="encoder", detail="[B, 3, H, W]",
                             summary="Multi-scale visual features", config={"levels": 3, "frozen": True,
                                                                           "ratio": 0.5, "optional": None},
                             groups=[{"label": "Scales", "items": [{"label": "P3", "value": "1/8"}]}])
    return value


def test_checked_display_metadata_is_preserved_without_opening_source_or_checkpoint(tmp_path):
    value = rich_descriptor()
    inspection, _ = service(tmp_path, value)
    result = inspection.get("project")
    for key in ("nodes", "sources", "brief", "description"):
        assert result[key] == value[key]
    assert not (tmp_path / "unsafe-checkpoint.pkl").exists()


@pytest.mark.parametrize("mutation", [
    lambda v: v.update(description="x" * 2001),
    lambda v: v["nodes"][0].update(category="javascript"),
    lambda v: v["nodes"][0].update(category=[]),
    lambda v: v["nodes"][0].update(config={"nested": {"call": "execute"}}),
    lambda v: v["nodes"][0].update(config={"values": []}),
    lambda v: v["nodes"][0].update(config={"overflow": 10**400}),
    lambda v: v["nodes"][0].update(config={"overflow": float("inf")}),
    lambda v: v["nodes"][0].update(config={"overflow": float("nan")}),
    lambda v: v["nodes"][0].update(config={str(i): i for i in range(33)}),
    lambda v: v["nodes"][0].update(groups=[{"label": "g", "items": [], "html": "<script>"}]),
    lambda v: v["nodes"][0].update(groups=[{"label": "g", "items": []}]),
    lambda v: v["nodes"][0].update(groups=[{"label": "g", "items": [{"label": "i", "value": {}}]}]),
    lambda v: v["sources"][0].update(path="/private/model"),
    lambda v: v["sources"][0].update(node_ids=["unknown"]),
    lambda v: v["sources"][0].update(node_ids=["backbone", "backbone"]),
    lambda v: v["sources"].append(v["sources"][0]),
    lambda v: v.update(brief={"html": "<script>"}),
    lambda v: v.update(brief={"goals": ["ok", {"call": "execute"}]}),
    lambda v: v.update(brief={"rationale": ["x"] * 33}),
])
def test_unbounded_or_executable_display_metadata_fails_closed(tmp_path, mutation):
    value = rich_descriptor()
    mutation(value)
    inspection, _ = service(tmp_path, value)
    with pytest.raises(ValueError):
        inspection.get("project")
