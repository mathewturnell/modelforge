from __future__ import annotations

import copy
import json

import pytest

from modelforge_workbench.application.modal_bindings import (
    FileModalActionBindingRepository,
    ModalActionBindingService,
    modal_action_binding_sha256,
    normalize_modal_action_binding,
    resource_plan_sha256,
)


def _binding() -> dict:
    compute = {
        "target": "modal-l4",
        "gpu": "L4",
        "gpu_count": 1,
        "cpu_millis": 1_000,
        "memory_mib": 4_096,
        "timeout_seconds": 600,
        "retries": 0,
        "max_containers": 1,
        "warm_containers": 0,
    }
    transport = {
        "protocol": "modelforge.modal-execution-result/v1",
        "max_stdout_bytes": 262_144,
        "max_stderr_bytes": 262_144,
        "max_artifacts": 8,
        "max_artifact_bytes": 2_097_152,
        "max_total_artifact_bytes": 2_097_152,
    }
    return {
        "protocol": "modelforge.modal-action-binding/v1",
        "project_id": "qwen-prompt-lab",
        "action_id": "prompt",
        "provider": "modal",
        "environment": "modelforge-alpha-acceptance-20260909",
        "application": "modelforge-alpha-qwen-prompt",
        "function": "run_prompt",
        "compute": compute,
        "transport": transport,
        "deployment": {
            "source_manifest_sha256": "a" * 64,
            "resource_plan_sha256": resource_plan_sha256(compute, transport),
        },
        "assets": [
            {
                "id": "model",
                "role": "model",
                "provider_path": "/models/qwen",
                "verification": "revision",
                "revision": "a09a35458c702b33eeacc393d103063234e8bc28",
            },
            {
                "id": "request-fixture",
                "role": "input",
                "provider_path": "/inputs/request.json",
                "verification": "sha256",
                "sha256": "b" * 64,
                "size_bytes": 93,
            },
        ],
    }


class _Catalog:
    def __init__(self, *, support: str = "supported", registered: bool = True) -> None:
        self.support = support
        self.registered = registered

    def capabilities(self, project_id):
        if not self.registered or project_id != "qwen-prompt-lab":
            raise KeyError(project_id)
        return {
            "capabilities": [{
                "id": "action.prompt",
                "category": "action",
                "kind": "prompt",
                "declared": True,
                "support": self.support,
            }],
        }


def _set(value: dict, path: tuple[str | int, ...], replacement) -> None:
    current = value
    for part in path[:-1]:
        current = current[part]
    current[path[-1]] = replacement


def test_normalizes_gpu_and_cpu_only_bindings_and_binds_every_field():
    gpu = normalize_modal_action_binding(_binding())
    cpu_value = _binding()
    cpu_value["compute"]["target"] = "modal-cpu"
    cpu_value["compute"]["gpu"] = None
    cpu_value["compute"]["gpu_count"] = 0
    cpu_value["deployment"]["resource_plan_sha256"] = resource_plan_sha256(
        cpu_value["compute"], cpu_value["transport"],
    )
    cpu = normalize_modal_action_binding(cpu_value)

    assert gpu["compute"]["gpu"] == "L4"
    assert cpu["compute"]["gpu"] is None
    assert modal_action_binding_sha256(gpu) != modal_action_binding_sha256(cpu)
    changed = copy.deepcopy(gpu)
    changed["assets"][0]["provider_path"] = "/models/qwen-other"
    assert modal_action_binding_sha256(gpu) != modal_action_binding_sha256(changed)


def test_binding_identity_is_canonical_across_mapping_order():
    value = normalize_modal_action_binding(_binding())
    reordered = {key: value[key] for key in reversed(value)}
    reordered["compute"] = {
        key: value["compute"][key] for key in reversed(value["compute"])
    }

    assert modal_action_binding_sha256(value) == modal_action_binding_sha256(reordered)


@pytest.mark.parametrize(
    ("path", "replacement", "message"),
    (
        (("protocol",), "modelforge.modal-action-binding/v2", "protocol"),
        (("provider",), "other", "provider"),
        (("project_id",), "bad project", "Project identifier"),
        (("action_id",), "", "Action identifier"),
        (("environment",), "/unsafe", "environment identifier"),
        (("application",), "-invalid", "application identifier"),
        (("function",), "bad/function", "function identifier"),
        (("compute", "gpu_count"), 0, "same optional GPU"),
        (("compute", "cpu_millis"), True, "integer"),
        (("compute", "memory_mib"), 0, "integer"),
        (("compute", "timeout_seconds"), 7_201, "integer"),
        (("compute", "retries"), 1, "integer"),
        (("compute", "max_containers"), 2, "integer"),
        (("compute", "warm_containers"), 1, "integer"),
        (("transport", "protocol"), "other", "protocol"),
        (("transport", "max_stdout_bytes"), 262_145, "integer"),
        (("transport", "max_artifacts"), 9, "integer"),
        (("transport", "max_artifact_bytes"), 2_097_153, "integer"),
        (("transport", "max_total_artifact_bytes"), 1, "cannot exceed"),
        (("deployment", "source_manifest_sha256"), "ABC", "SHA-256"),
        (("deployment", "resource_plan_sha256"), "c" * 64, "does not match"),
        (("assets", 0, "role"), "unknown", "role"),
        (("assets", 0, "provider_path"), "models/qwen", "absolute"),
        (("assets", 0, "provider_path"), "/models/../secret", "cannot contain"),
        (("assets", 0, "provider_path"), "/models//qwen", "canonical"),
        (("assets", 0, "provider_path"), "//models/qwen", "one absolute"),
        (("assets", 0, "revision"), "main", "immutable"),
        (("assets", 1, "sha256"), "B" * 64, "SHA-256"),
        (("assets", 1, "size_bytes"), -1, "integer"),
    ),
)
def test_closed_contract_rejects_invalid_scalar_and_bound_cases(path, replacement, message):
    value = _binding()
    _set(value, path, replacement)
    with pytest.raises(ValueError, match=message):
        normalize_modal_action_binding(value)


@pytest.mark.parametrize(
    "mutate",
    (
        lambda value: value.update({"credential": "forbidden"}),
        lambda value: value.pop("provider"),
        lambda value: value["compute"].update({"price": 1}),
        lambda value: value["transport"].update({"volume": "private"}),
        lambda value: value["deployment"].update({"image": "mutable"}),
        lambda value: value["assets"][0].update({"sha256": "c" * 64}),
        lambda value: value["assets"][1].update({"revision": "immutable"}),
    ),
)
def test_closed_contract_rejects_missing_extra_and_mixed_variant_fields(mutate):
    value = _binding()
    mutate(value)
    with pytest.raises(ValueError):
        normalize_modal_action_binding(value)


def test_asset_inventory_is_bounded_and_ids_are_unique():
    duplicate = _binding()
    duplicate["assets"][1]["id"] = "model"
    with pytest.raises(ValueError, match="unique"):
        normalize_modal_action_binding(duplicate)

    too_many = _binding()
    too_many["assets"] = [
        {
            "id": f"asset-{index}", "role": "input", "provider_path": f"/inputs/{index}",
            "verification": "sha256", "sha256": "c" * 64, "size_bytes": 0,
        }
        for index in range(17)
    ]
    with pytest.raises(ValueError, match="at most 16"):
        normalize_modal_action_binding(too_many)

    malformed = _binding()
    malformed["assets"][0]["verification"] = []
    with pytest.raises(ValueError, match="verification"):
        normalize_modal_action_binding(malformed)


def test_repository_is_owner_only_immutable_and_does_not_create_on_read(tmp_path):
    repository = FileModalActionBindingRepository(tmp_path / "state")
    assert repository.list() == []
    assert not repository.root.exists()

    normalized = repository.put(_binding())
    assert repository.root.stat().st_mode & 0o777 == 0o700
    [stored] = list(repository.root.glob("*.json"))
    assert stored.stat().st_mode & 0o777 == 0o600
    assert "qwen-prompt-lab" not in stored.name
    assert repository.get("qwen-prompt-lab", "prompt") == normalized
    assert repository.put(_binding()) == normalized

    changed = _binding()
    changed["application"] = "another-application"
    with pytest.raises(ValueError, match="different identity"):
        repository.put(changed)


def test_repository_fails_closed_for_wrong_mode_symlink_and_corrupt_records(tmp_path):
    repository = FileModalActionBindingRepository(tmp_path / "state")
    repository.put(_binding())
    [stored] = list(repository.root.glob("*.json"))
    stored.chmod(0o644)
    with pytest.raises(KeyError, match="not registered"):
        repository.get("qwen-prompt-lab", "prompt")
    assert repository.list() == []

    state = tmp_path / "symlink-state"
    state.mkdir()
    private_target = tmp_path / "elsewhere"
    private_target.mkdir()
    (state / "modal-actions").symlink_to(private_target, target_is_directory=True)
    with pytest.raises(ValueError, match="symbolic link"):
        FileModalActionBindingRepository(state).put(_binding())


def test_service_requires_registered_statically_supported_authored_action(tmp_path):
    source = tmp_path / "binding.json"
    source.write_text(json.dumps(_binding()), encoding="utf-8")

    missing = ModalActionBindingService(
        FileModalActionBindingRepository(tmp_path / "missing"),
        _Catalog(registered=False),
    )
    with pytest.raises(ValueError, match="not registered"):
        missing.register_file(source)
    assert not missing.repository.root.exists()

    unsupported = ModalActionBindingService(
        FileModalActionBindingRepository(tmp_path / "unsupported"),
        _Catalog(support="unsupported"),
    )
    with pytest.raises(ValueError, match="statically supported"):
        unsupported.register_file(source)
    assert not unsupported.repository.root.exists()

    mismatch_value = _binding()
    mismatch_value["action_id"] = "inference"
    mismatch_source = tmp_path / "mismatch.json"
    mismatch_source.write_text(json.dumps(mismatch_value), encoding="utf-8")
    mismatch = ModalActionBindingService(
        FileModalActionBindingRepository(tmp_path / "mismatch"), _Catalog(),
    )
    with pytest.raises(ValueError, match="one authored action"):
        mismatch.register_file(mismatch_source)
    assert not mismatch.repository.root.exists()


def test_public_projection_discloses_resources_and_redacts_private_provider_details(tmp_path):
    source = tmp_path / "binding.json"
    source.write_text(json.dumps(_binding()), encoding="utf-8")
    service = ModalActionBindingService(
        FileModalActionBindingRepository(tmp_path / "state"), _Catalog(),
    )
    public = service.register_file(source)
    encoded = json.dumps(public, sort_keys=True)

    assert public["binding_sha256"] == modal_action_binding_sha256(_binding())
    assert public["billable"] is True
    assert public["resource_disclosure"] == "declared_unreconciled"
    assert public["provider_readiness"] == "not_evaluated"
    assert public["compute"]["timeout_seconds"] == 600
    for private in (
        "modelforge-alpha-qwen-prompt", "run_prompt", "/models/qwen",
        "/inputs/request.json", "source_manifest_sha256", "assets",
    ):
        assert private not in encoded


def test_service_skips_binding_if_authored_support_is_later_removed(tmp_path):
    source = tmp_path / "binding.json"
    source.write_text(json.dumps(_binding()), encoding="utf-8")
    catalog = _Catalog()
    service = ModalActionBindingService(
        FileModalActionBindingRepository(tmp_path / "state"), catalog,
    )
    service.register_file(source)
    catalog.support = "unsupported"

    assert service.list() == []
    with pytest.raises(ValueError, match="statically supported"):
        service.get("qwen-prompt-lab", "prompt")
