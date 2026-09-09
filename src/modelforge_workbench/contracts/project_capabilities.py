# Copyright (C) 2026 Mathew Turnell
# SPDX-License-Identifier: Apache-2.0

"""Static, non-authorizing project capability projection.

The checked-in JSON Schema is the authoritative wire definition.  This module
interprets that schema for output validation and contains only the v1
compatibility translation needed for inspection.  It never imports or prepares
project code.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from importlib.resources import files
import json
import re
from typing import Any

from ..project_action_contract import project_action_structure_compatible
from .legacy_runtime import ProjectRuntimeError, normalize_legacy_executable_action
from .project_manifest import ProjectManifestCompatibilityError


PROJECT_CAPABILITIES_PROTOCOL = "modelforge.project-capabilities/v1"
_IDENTIFIER = re.compile(r"^[a-z][a-z0-9_.-]{0,63}$")
_KNOWN_KINDS = {
    "dataset_prepare",
    "evaluation",
    "inference",
    "prompt",
    "research",
    "training",
}
_INTERFACES = {
    "evaluation_process": "evaluation",
    "inference_process": "inference",
    "prompt_process": "prompt",
    "training_process": "training",
}
_RUNTIME_PROTOCOLS = {
    "modelforge.project-runtime/v1": False,
    "modalfuse.project-runtime/v1": True,
    "modalforge.project-runtime/v1": True,
}


def project_capabilities_schema() -> dict[str, Any]:
    """Load the authoritative packaged JSON Schema without optional libraries."""
    resource = files("modelforge_workbench.schemas").joinpath("project-capabilities-v1.schema.json")
    return json.loads(resource.read_text(encoding="utf-8"))


def _matches_type(value: Any, expected: str) -> bool:
    if expected == "object":
        return isinstance(value, Mapping)
    if expected == "array":
        return isinstance(value, list)
    if expected == "string":
        return isinstance(value, str)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    return False


def _validate_schema(value: Any, schema: Mapping[str, Any], location: str = "$") -> None:
    """Interpret the closed JSON-Schema subset used by this contract."""
    if "const" in schema and value != schema["const"]:
        raise ValueError(f"Capability projection violates its schema at {location}")
    if "enum" in schema and value not in schema["enum"]:
        raise ValueError(f"Capability projection violates its schema at {location}")
    expected = schema.get("type")
    if expected and not _matches_type(value, str(expected)):
        raise ValueError(f"Capability projection violates its schema at {location}")
    if isinstance(value, Mapping):
        properties = schema.get("properties") or {}
        required = schema.get("required") or []
        if any(name not in value for name in required):
            raise ValueError(f"Capability projection violates its schema at {location}")
        if schema.get("additionalProperties") is False and any(
            name not in properties for name in value
        ):
            raise ValueError(f"Capability projection violates its schema at {location}")
        for name, item in value.items():
            if name in properties:
                _validate_schema(item, properties[name], f"{location}.{name}")
    elif isinstance(value, list):
        if len(value) > int(schema.get("maxItems", len(value))):
            raise ValueError(f"Capability projection violates its schema at {location}")
        if schema.get("uniqueItems") and len({json.dumps(item, sort_keys=True) for item in value}) != len(value):
            raise ValueError(f"Capability projection violates its schema at {location}")
        item_schema = schema.get("items")
        if isinstance(item_schema, Mapping):
            for index, item in enumerate(value):
                _validate_schema(item, item_schema, f"{location}[{index}]")
    elif isinstance(value, str):
        length = len(value)
        if length < int(schema.get("minLength", 0)):
            raise ValueError(f"Capability projection violates its schema at {location}")
        if length > int(schema.get("maxLength", length)):
            raise ValueError(f"Capability projection violates its schema at {location}")
        pattern = schema.get("pattern")
        if pattern and re.fullmatch(str(pattern), value) is None:
            raise ValueError(f"Capability projection violates its schema at {location}")


def validate_project_capabilities(value: Mapping[str, Any]) -> dict[str, Any]:
    """Validate and return a detached projection using the canonical schema."""
    detached = json.loads(json.dumps(value, allow_nan=False))
    _validate_schema(detached, project_capabilities_schema())
    return detached


def _diagnostic(code: str, severity: str, location: str) -> dict[str, str]:
    return {"code": code, "severity": severity, "location": location}


def _capability(
    capability_id: str,
    category: str,
    kind: str,
    support: str,
    source: str,
    compatibility: str,
    *,
    unresolved_fields: Sequence[str] = (),
    diagnostics: Sequence[Mapping[str, str]] = (),
) -> dict[str, Any]:
    return {
        "id": capability_id,
        "category": category,
        "kind": kind,
        "declared": True,
        "support": support,
        "source": source,
        "compatibility": compatibility,
        "unresolved_fields": sorted(set(unresolved_fields)),
        "diagnostics": [dict(item) for item in diagnostics],
    }


def _runtime_capabilities(
    project: Mapping[str, Any], diagnostics: list[dict[str, str]],
) -> list[dict[str, Any]]:
    runtime = project.get("runtime")
    if runtime is None:
        return []
    if not isinstance(runtime, Mapping):
        diagnostics.append(_diagnostic("runtime_declaration_malformed", "error", "runtime"))
        return []
    protocol = runtime.get("protocol")
    if protocol is None:
        diagnostics.append(_diagnostic("runtime_protocol_defaulted_v1", "warning", "runtime.protocol"))
        protocol_known = True
    else:
        protocol_known = isinstance(protocol, str) and protocol in _RUNTIME_PROTOCOLS
        if protocol_known and _RUNTIME_PROTOCOLS[str(protocol)]:
            diagnostics.append(_diagnostic("legacy_runtime_protocol_alias", "warning", "runtime.protocol"))
        elif not protocol_known:
            diagnostics.append(_diagnostic("runtime_protocol_unknown", "warning", "runtime.protocol"))
    actions = runtime.get("actions")
    if actions is None:
        return []
    if not isinstance(actions, Mapping):
        diagnostics.append(_diagnostic("runtime_actions_malformed", "error", "runtime.actions"))
        return []
    result: list[dict[str, Any]] = []
    for index, (raw_id, raw_action) in enumerate(sorted(actions.items(), key=lambda item: str(item[0]))):
        location = f"runtime.actions[{index}]"
        action_id = str(raw_id)
        if not _IDENTIFIER.fullmatch(action_id):
            diagnostics.append(_diagnostic("runtime_action_id_invalid", "error", location))
            continue
        if not isinstance(raw_action, Mapping):
            result.append(_capability(
                f"action.{action_id}", "action", action_id, "unknown", location,
                "unresolved", unresolved_fields=("action_declaration",),
                diagnostics=(_diagnostic("runtime_action_malformed", "error", location),),
            ))
            continue
        interface = raw_action.get("interface")
        expected_kind = (
            action_id
            if interface == "process"
            else _INTERFACES.get(str(interface)) if isinstance(interface, str) else None
        )
        item_diagnostics: list[dict[str, str]] = []
        unresolved_fields: tuple[str, ...] = ("execution_configuration",)
        if not protocol_known:
            support = "unknown"
            compatibility = "unresolved"
            item_diagnostics.append(_diagnostic("runtime_protocol_unknown", "warning", location))
        elif interface == "web_application":
            support = "unsupported"
            compatibility = "legacy_runtime_v1"
            item_diagnostics.append(_diagnostic("legacy_web_application_not_statically_translatable", "warning", location))
        elif expected_kind is None:
            support = "unknown"
            compatibility = "unresolved"
            item_diagnostics.append(_diagnostic("runtime_interface_unknown", "warning", location))
        elif action_id != expected_kind:
            support = "unsupported"
            compatibility = "legacy_runtime_v1"
            item_diagnostics.append(_diagnostic("runtime_action_interface_mismatch", "error", location))
        else:
            compatibility = "legacy_runtime_v1"
            try:
                normalize_legacy_executable_action(
                    raw_action, allow_empty=True, action=action_id,
                )
            except ProjectRuntimeError as exc:
                support = "unsupported"
                field = (
                    "result_contract"
                    if "result_contract" in str(exc) or "result protocol" in str(exc)
                    else "execution_configuration"
                )
                unresolved_fields = (field,)
                item_diagnostics.append(_diagnostic(
                    "legacy_runtime_action_invalid", "error", f"{location}.{field}",
                ))
            else:
                support = "supported"
        result.append(_capability(
            f"action.{action_id}", "action", action_id, support, location,
            compatibility, unresolved_fields=unresolved_fields,
            diagnostics=item_diagnostics,
        ))
    return result


def _declarative_capabilities(
    project: Mapping[str, Any], diagnostics: list[dict[str, str]],
) -> list[dict[str, Any]]:
    declaration = project.get("project_actions")
    if declaration is None:
        return []
    if not isinstance(declaration, Mapping):
        diagnostics.append(_diagnostic("project_actions_malformed", "error", "project_actions"))
        return []
    if declaration.get("protocol") != "modelforge.project-action-contract/v1":
        diagnostics.append(_diagnostic("project_actions_protocol_unknown", "warning", "project_actions.protocol"))
        known_protocol = False
    else:
        known_protocol = True
    structure_compatible = known_protocol and project_action_structure_compatible(declaration)
    actions = declaration.get("actions")
    if not isinstance(actions, Mapping):
        diagnostics.append(_diagnostic("project_actions_actions_malformed", "error", "project_actions.actions"))
        return []
    result: list[dict[str, Any]] = []
    for index, (raw_id, raw_action) in enumerate(sorted(actions.items(), key=lambda item: str(item[0]))):
        location = f"project_actions.actions[{index}]"
        action_id = str(raw_id)
        if not _IDENTIFIER.fullmatch(action_id):
            diagnostics.append(_diagnostic("project_action_id_invalid", "error", location))
            continue
        kind = str(raw_action.get("kind") or "") if isinstance(raw_action, Mapping) else ""
        if structure_compatible and kind in _KNOWN_KINDS:
            support = "supported"
            item_diagnostics = []
        elif known_protocol:
            support = "unsupported"
            item_diagnostics = [
                _diagnostic("project_actions_structure_invalid", "error", location)
            ]
        else:
            support = "unknown"
            item_diagnostics = [
                _diagnostic("project_action_kind_unknown", "warning", location)
            ]
        result.append(_capability(
            f"action.{action_id}", "action", kind or action_id, support, location,
            "declarative_v1" if support == "supported" else "unresolved",
            diagnostics=item_diagnostics,
        ))
    return result


def project_capabilities(project: Mapping[str, Any]) -> dict[str, Any]:
    """Project authored declarations into a bounded static capability view.

    Recognition is not runtime readiness and grants no execution or provider
    authority.  Legacy builder-owned values are never imported to fill gaps.
    """
    project_id = project.get("id")
    if not isinstance(project_id, str) or not project_id.strip():
        raise ProjectManifestCompatibilityError("Project manifest id must be a non-empty string")
    diagnostics: list[dict[str, str]] = []
    capabilities = _declarative_capabilities(project, diagnostics)
    declared_action_ids = {item["id"] for item in capabilities}
    for item in _runtime_capabilities(project, diagnostics):
        if item["id"] not in declared_action_ids:
            capabilities.append(item)
            declared_action_ids.add(item["id"])
        else:
            diagnostics.append(_diagnostic(
                "duplicate_action_declarations", "warning", item["source"],
            ))

    adapters = project.get("adapters")
    if isinstance(adapters, Mapping) and "training_command" in adapters and "action.training" not in declared_action_ids:
        location = "adapters.training_command"
        capabilities.append(_capability(
            "action.training", "action", "training", "unsupported", location,
            "legacy_adapter_v1", unresolved_fields=(location,),
            diagnostics=(_diagnostic("legacy_builder_not_statically_translatable", "warning", location),),
        ))
    elif adapters is not None and not isinstance(adapters, Mapping):
        diagnostics.append(_diagnostic("adapters_declaration_malformed", "error", "adapters"))

    for field, category, kind in (
        ("dataset_descriptor", "dataset", "descriptor"),
        ("architecture_descriptor", "model", "descriptor"),
    ):
        value = project.get(field)
        if isinstance(value, str) and value.strip():
            capabilities.append(_capability(
                f"{category}.default", category, kind, "supported", field,
                "manifest_v1",
            ))
        elif value is not None:
            diagnostics.append(_diagnostic(f"{field}_malformed", "error", field))

    if "dataset.default" not in {item["id"] for item in capabilities}:
        for field in ("default_dataset", "dataset_source"):
            value = project.get(field)
            if isinstance(value, str) and value.strip():
                capabilities.append(_capability(
                    "dataset.default", "dataset", "reference", "supported", field,
                    "manifest_v1", diagnostics=(
                        _diagnostic("legacy_dataset_reference", "warning", field),
                    ),
                ))
                break
            if value is not None:
                diagnostics.append(_diagnostic(f"{field}_malformed", "error", field))

    model_artifacts = project.get("model_artifacts")
    if (
        "model.default" not in {item["id"] for item in capabilities}
        and isinstance(model_artifacts, list)
        and model_artifacts
    ):
        capabilities.append(_capability(
            "model.default", "model", "artifact", "supported", "model_artifacts",
            "manifest_v1", diagnostics=(
                _diagnostic("legacy_model_artifacts", "warning", "model_artifacts"),
            ),
        ))
    elif model_artifacts is not None and not isinstance(model_artifacts, list):
        diagnostics.append(_diagnostic("model_artifacts_malformed", "error", "model_artifacts"))

    projection = {
        "protocol": PROJECT_CAPABILITIES_PROTOCOL,
        "project_id": project_id,
        "manifest_schema_version": int(project.get("schema_version", 1)),
        "support_scope": "static_inspection",
        "runtime_readiness": "not_evaluated",
        "execution_authorized": False,
        "provider_authorized": False,
        "capabilities": sorted(capabilities, key=lambda item: (item["category"], item["id"])),
        "diagnostics": diagnostics,
    }
    return validate_project_capabilities(projection)


__all__ = [
    "PROJECT_CAPABILITIES_PROTOCOL",
    "project_capabilities",
    "project_capabilities_schema",
    "validate_project_capabilities",
]
