# Copyright (C) 2026 Mathew Turnell
# SPDX-License-Identifier: Apache-2.0

"""Pure validation shared by v1 runtime inspection and legacy execution."""

from __future__ import annotations

from collections.abc import Mapping
import re
from typing import Any


DATASET_BUILD_PROTOCOL = "modelforge.dataset-build/v1"
INFERENCE_RESULT_PROTOCOL = "modelforge.inference-result/v1"
PROMPT_RESULT_PROTOCOL = "modelforge.prompt-result/v1"
GENERATIVE_PROMPT_RESULT_PROTOCOL = "modelforge.generative-prompt-result/v1"
_ENVIRONMENT_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_FORBIDDEN_PROJECT_ENVIRONMENT = {
    "BASH_ENV", "DOCKER_CONFIG", "DOCKER_CONTEXT", "DOCKER_HOST", "ENV", "GIT_CONFIG",
    "HOME", "LD_AUDIT", "LD_LIBRARY_PATH", "LD_PRELOAD", "MODELFORGE_DOCKER_BINARY",
    "MODELFORGE_RUNTIME_MODE", "MODELFORGE_UNTRUSTED_BASE_IMAGE", "PATH",
    "PYTHONBREAKPOINT", "PYTHONHOME", "PYTHONINSPECT", "PYTHONPATH", "PYTHONSTARTUP",
    "SHELLOPTS", "SSH_AUTH_SOCK", "VIRTUAL_ENV",
}
_INFERENCE_TARGET_KINDS = {"artifact", "sequence"}
_ACTION_INTERFACES = {
    "inference": {"process", "inference_process", "web_application"},
    "training": {"process", "training_process"},
    "evaluation": {"process", "evaluation_process"},
    "prompt": {"prompt_process", "generative_prompt_process"},
    "research_candidate_inference": {"process"},
    "research_candidate_training": {"training_process"},
}


class ProjectRuntimeError(ValueError):
    """Raised when a project does not satisfy the executable contract."""


def _action_interfaces(action: str) -> set[str]:
    return _ACTION_INTERFACES.get(action, {"process", "training_process"})


def _web_application_consumes_selected_input(
    arguments: list[str],
    environment: Mapping[str, str],
    target_contract: Mapping[str, Any] | None,
) -> bool:
    templates = [*arguments, *environment.values()]
    consumes_template = any(
        re.search(
            r"\{(?:dataset|dataset_root|dataset_descriptor|artifact|artifact_path|"
            r"target|target_path|target_kind)\??\}",
            str(item),
        )
        for item in templates
    )
    return consumes_template or bool(
        isinstance(target_contract, Mapping) and str(target_contract.get("argument") or "").strip()
    )


def _inference_result_contract(value: Any, *, interface: str) -> dict[str, Any] | None:
    if value is None and interface != "inference_process":
        return None
    if interface != "inference_process":
        raise ProjectRuntimeError(
            "An inference result contract requires the inference_process interface"
        )
    if not isinstance(value, Mapping):
        raise ProjectRuntimeError(
            "Project inference_process must declare a result_contract object"
        )
    protocol = str(value.get("protocol") or value.get("format") or "").strip()
    if protocol != INFERENCE_RESULT_PROTOCOL:
        raise ProjectRuntimeError(
            f"Project inference result contract must use {INFERENCE_RESULT_PROTOCOL!r}"
        )
    reuse_existing = value.get("reuse_existing", False)
    if not isinstance(reuse_existing, bool):
        raise ProjectRuntimeError("Inference result reuse_existing must be a boolean")
    return {
        "protocol": INFERENCE_RESULT_PROTOCOL,
        "reuse_existing": reuse_existing,
        "primary_kind": "video",
    }


def _inference_target_contract(value: Any) -> dict[str, Any]:
    if value is None:
        return {"kinds": ["artifact"], "argument": ""}
    if not isinstance(value, Mapping):
        raise ProjectRuntimeError("Inference target_contract must be an object")
    kinds = value.get("kinds", ["artifact"])
    if isinstance(kinds, (str, bytes)) or not isinstance(kinds, (list, tuple)):
        raise ProjectRuntimeError("Inference target_contract kinds must be a list")
    normalized_kinds = list(dict.fromkeys(str(item).strip().casefold() for item in kinds))
    if not normalized_kinds or any(item not in _INFERENCE_TARGET_KINDS for item in normalized_kinds):
        choices = ", ".join(sorted(_INFERENCE_TARGET_KINDS))
        raise ProjectRuntimeError(f"Inference target kinds must contain only: {choices}")
    argument = str(value.get("argument") or "").strip()
    if argument and not re.fullmatch(r"--[A-Za-z0-9][A-Za-z0-9-]*", argument):
        raise ProjectRuntimeError("Inference target argument must be a long command-line option")
    return {"kinds": normalized_kinds, "argument": argument}


def normalize_legacy_executable_action(
    value: Mapping[str, Any], *, allow_empty: bool, action: str = "inference",
) -> dict[str, Any]:
    """Normalize the static v1 executable declaration without preparing it."""
    executable = str(value.get("executable") or "").strip()
    working_directory = str(value.get("working_directory") or "").strip()
    arguments = value.get("arguments", [])
    environment = value.get("environment", {})
    sample_index_argument = str(value.get("sample_index_argument") or "").strip()
    dataset_mode = str(value.get("dataset_mode") or "root").strip().casefold()
    interface = str(value.get("interface") or "process").strip().casefold()
    if not allow_empty and not executable:
        raise ProjectRuntimeError(f"Configure the project {action} executable first")
    if isinstance(arguments, (str, bytes)) or not isinstance(arguments, (list, tuple)):
        raise ProjectRuntimeError("Project executable arguments must be a list")
    if len(arguments) > 256 or any(len(str(item)) > 4096 for item in arguments):
        raise ProjectRuntimeError("Project executable arguments exceed the safe configuration limit")
    if not isinstance(environment, Mapping) or len(environment) > 128:
        raise ProjectRuntimeError("Project executable environment must be a key/value object")
    if sample_index_argument and not re.fullmatch(r"--[A-Za-z0-9][A-Za-z0-9-]*", sample_index_argument):
        raise ProjectRuntimeError("Sample index argument must be a long command-line option")
    if dataset_mode not in {"root", "descriptor"}:
        raise ProjectRuntimeError("Project dataset mode must be root or descriptor")
    allowed_interfaces = _action_interfaces(action)
    if interface not in allowed_interfaces:
        choices = " or ".join(sorted(allowed_interfaces))
        raise ProjectRuntimeError(f"Project {action} executable interface must be {choices}")
    result_contract = (
        _inference_result_contract(value.get("result_contract"), interface=interface)
        if action == "inference"
        else None
    )
    if action == "prompt":
        prompt_contract = value.get("result_contract")
        expected_prompt_protocol = (
            GENERATIVE_PROMPT_RESULT_PROTOCOL
            if interface == "generative_prompt_process"
            else PROMPT_RESULT_PROTOCOL
        )
        if (
            not isinstance(prompt_contract, Mapping)
            or str(prompt_contract.get("protocol") or "") != expected_prompt_protocol
        ):
            raise ProjectRuntimeError(
                f"Project {interface} must declare result protocol {expected_prompt_protocol!r}"
            )
        result_contract = {"protocol": expected_prompt_protocol}
    target_contract = _inference_target_contract(value.get("target_contract")) if action == "inference" else None
    dataset_build_protocols = (
        value.get("dataset_build_protocols", []) if interface == "training_process" else []
    )
    if (
        isinstance(dataset_build_protocols, (str, bytes))
        or not isinstance(dataset_build_protocols, (list, tuple))
        or len(dataset_build_protocols) > 8
        or any(str(item) != DATASET_BUILD_PROTOCOL for item in dataset_build_protocols)
    ):
        raise ProjectRuntimeError(
            f"Project training dataset_build_protocols may contain only {DATASET_BUILD_PROTOCOL!r}"
        )
    fixed_by_default = bool(
        action == "inference"
        and (
            (result_contract is not None and result_contract["reuse_existing"])
            or (
                interface == "web_application"
                and not _web_application_consumes_selected_input(
                    [str(item) for item in arguments],
                    {str(name): str(item) for name, item in environment.items()},
                    target_contract,
                )
            )
        )
    )
    dataset_binding = str(
        value.get("dataset_binding") or ("fixed" if fixed_by_default else "selected")
    ).strip().casefold()
    if dataset_binding not in {"selected", "fixed"}:
        raise ProjectRuntimeError("Project dataset binding must be selected or fixed")
    normalized_environment = {}
    for name, item in environment.items():
        name = str(name)
        if not _ENVIRONMENT_NAME.fullmatch(name):
            raise ProjectRuntimeError(f"Invalid environment variable name: {name!r}")
        if (
            name in _FORBIDDEN_PROJECT_ENVIRONMENT
            or name.startswith(("CONDA_", "DOCKER_", "MODELFORGE_SANDBOX_", "PYTHONPATH"))
        ):
            raise ProjectRuntimeError(
                f"Project runtime environment cannot override interpreter activation: {name!r}"
            )
        normalized_environment[name] = str(item)
    normalized = {
        "kind": "executable",
        "interface": interface,
        "display_name": str(value.get("display_name") or f"Project {action} executable"),
        "executable": executable,
        "working_directory": working_directory,
        "arguments": [str(item) for item in arguments],
        "environment": normalized_environment,
        "sample_index_argument": sample_index_argument,
        "dataset_mode": dataset_mode,
        "dataset_binding": dataset_binding,
    }
    if result_contract is not None:
        normalized["result_contract"] = result_contract
    if target_contract is not None:
        normalized["target_contract"] = target_contract
    if dataset_build_protocols:
        normalized["dataset_build_protocols"] = [DATASET_BUILD_PROTOCOL]
    return normalized


def validate_legacy_inspection_runtime(project: Mapping[str, Any]) -> list[str]:
    """Preserve the old project.inspect action names and static errors."""
    runtime = project.get("runtime")
    declaration = dict(runtime) if isinstance(runtime, Mapping) else {}
    actions_value = declaration.get("actions")
    actions = dict(actions_value) if isinstance(actions_value, Mapping) else {}
    inference_value = actions.get("inference")
    inference = dict(inference_value) if isinstance(inference_value, Mapping) else {}
    kind = str(inference.get("kind") or ("python_module" if inference.get("module") else "executable"))
    if kind == "executable":
        defaults = {
            "kind": "executable",
            "interface": "process",
            "display_name": "Project inference executable",
            "executable": "",
            "working_directory": "",
            "arguments": [],
            "environment": {},
            "dataset_mode": "root",
            **inference,
        }
        if "dataset_binding" not in inference:
            defaults.pop("dataset_binding", None)
        normalize_legacy_executable_action(defaults, allow_empty=True)
    actions["inference"] = inference
    return sorted(str(action) for action in actions)


__all__ = [
    "DATASET_BUILD_PROTOCOL",
    "GENERATIVE_PROMPT_RESULT_PROTOCOL",
    "INFERENCE_RESULT_PROTOCOL",
    "PROMPT_RESULT_PROTOCOL",
    "ProjectRuntimeError",
    "normalize_legacy_executable_action",
    "validate_legacy_inspection_runtime",
]
