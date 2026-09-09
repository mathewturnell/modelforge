# Copyright (C) 2026 Mathew Turnell
# SPDX-License-Identifier: Apache-2.0

"""Inspection-only declarative project-action contract.

This module deliberately has no execution adapter.  It reads bounded manifest
and source bytes and returns non-authorizing compatibility diagnostics only.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
import hashlib
import json
import math
import os
from pathlib import Path, PurePosixPath
import re
import stat
from typing import Any
import unicodedata


CONTRACT_PROTOCOL = "modelforge.project-action-contract/v1"
DIAGNOSTIC_PROTOCOL = "modelforge.project-action-diagnostic/v1"
MAX_MANIFEST_BYTES = 2 * 1024 * 1024
MAX_DECLARATION_BYTES = 256 * 1024
MAX_DEPTH = 32
MAX_NODES = 10_000
MAX_MEMBERS = 256
MAX_STRING_BYTES = 4096
MAX_SOURCE_BYTES = 16 * 1024 * 1024
MAX_SOURCE_TOTAL_BYTES = 64 * 1024 * 1024

_IDENTIFIER = re.compile(r"^[a-z][a-z0-9_.-]{0,63}$")
_TOKEN = re.compile(r"^[a-z][a-z0-9_-]{0,63}$")
_FLAG = re.compile(r"^--[a-z][a-z0-9-]{0,63}$")
_MODULE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$")
_HEX_SHA256 = re.compile(r"^[0-9a-f]{64}$")
_REVIEW_SERVICE_ID = re.compile(r"^[a-z0-9](?:[a-z0-9.-]{1,125}[a-z0-9])$")
_REVIEW_SERVICE_REVISION = re.compile(r"^[a-z0-9][a-z0-9._-]{1,159}$")
_REVIEW_PROTOCOL = re.compile(r"^[a-z][a-z0-9.-]{0,126}/v[1-9][0-9]*$")
_REVIEW_PATH = re.compile(r"^/api/[a-z0-9/-]+$")

_ACTION_KINDS = {"training", "evaluation", "inference", "prompt", "dataset_prepare", "research"}
_INPUT_KINDS = {"dataset", "artifact", "checkpoint", "request", "configuration"}
_OUTPUT_KINDS = {"dataset", "checkpoint", "configuration", "artifact", "metrics", "predictions", "report"}
_ACTION_FIELDS = {"kind", "entrypoint", "parameters", "arguments", "inputs", "outputs", "runtime", "resources", "network"}
_MESSAGES = {
    "PAC000": ("info", "declarative-compatible", "Declaration and source identity are structurally compatible for inspection only; action behavior and ML validity are not verified."),
    "PAC001": ("info", "local-only", "Add a declarative project action to inspect future sandbox compatibility."),
    "PAC002": ("warning", "sandbox-required", "Legacy provider execution remains disabled pending an isolated worker."),
    "PAC003": ("info", "managed-reviewed", "Exact operator-reviewed application binding remains a separate application surface."),
    "PAC100": ("error", "invalid", "Project manifest JSON is invalid or ambiguous."),
    "PAC101": ("error", "invalid", "Project manifest exceeds structural limits."),
    "PAC102": ("error", "invalid", "Project action protocol is unsupported."),
    "PAC103": ("error", "invalid", "Project action contains an unknown or missing field."),
    "PAC104": ("error", "invalid", "Project action identifier or scalar value is invalid."),
    "PAC105": ("error", "invalid", "Project action parameter or argument binding is invalid."),
    "PAC106": ("error", "invalid", "Project action input, output, runtime, resource, or network requirement is invalid."),
    "PAC107": ("error", "invalid", "Project action source path is invalid or unavailable."),
    "PAC108": ("error", "invalid", "Project action source identity could not be safely bound."),
    "PAC109": ("error", "invalid", "Project action canonical identity could not be produced."),
}


class _ContractError(ValueError):
    def __init__(self, code: str, location: str = "/project_actions"):
        super().__init__(code)
        self.code = code
        self.location = location


class _BoundedJsonParser:
    """Small strict JSON reader that applies limits before growing containers."""

    def __init__(self, text: str):
        self.text = text
        self.index = 0
        self.nodes = 0

    def parse(self) -> Any:
        value = self._value(1)
        self._whitespace()
        if self.index != len(self.text):
            raise _ContractError("PAC100")
        return value

    def _claim(self, depth: int) -> None:
        self.nodes += 1
        if self.nodes > MAX_NODES or depth > MAX_DEPTH:
            raise _ContractError("PAC101")

    def _whitespace(self) -> None:
        while self.index < len(self.text) and self.text[self.index] in " \t\r\n":
            self.index += 1

    def _value(self, depth: int) -> Any:
        self._whitespace()
        self._claim(depth)
        if self.index >= len(self.text):
            raise _ContractError("PAC100")
        marker = self.text[self.index]
        if marker == "{":
            return self._object(depth)
        if marker == "[":
            return self._array(depth)
        if marker == '"':
            return self._string()
        for literal, value in (("true", True), ("false", False), ("null", None)):
            if self.text.startswith(literal, self.index):
                self.index += len(literal)
                return value
        match = re.match(r"-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?", self.text[self.index:])
        if not match:
            raise _ContractError("PAC100")
        token = match.group(0)
        self.index += len(token)
        try:
            number = float(token) if any(character in token for character in ".eE") else int(token)
        except (OverflowError, ValueError):
            raise _ContractError("PAC101") from None
        if isinstance(number, float) and not math.isfinite(number):
            raise _ContractError("PAC100")
        return number

    def _string(self) -> str:
        try:
            value, self.index = json.decoder.scanstring(self.text, self.index + 1, True)
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
            raise _ContractError("PAC100") from None
        if len(value.encode("utf-8", "surrogatepass")) > MAX_STRING_BYTES:
            raise _ContractError("PAC101")
        if any(0xD800 <= ord(character) <= 0xDFFF for character in value):
            raise _ContractError("PAC104")
        return value

    def _object(self, depth: int) -> dict[str, Any]:
        self.index += 1
        result: dict[str, Any] = {}
        self._whitespace()
        if self.index < len(self.text) and self.text[self.index] == "}":
            self.index += 1
            return result
        while True:
            self._whitespace()
            if self.index >= len(self.text) or self.text[self.index] != '"':
                raise _ContractError("PAC100")
            self._claim(depth + 1)
            key = self._string()
            if key in result:
                raise _ContractError("PAC100")
            self._whitespace()
            if self.index >= len(self.text) or self.text[self.index] != ":":
                raise _ContractError("PAC100")
            self.index += 1
            if len(result) >= MAX_MEMBERS:
                raise _ContractError("PAC101")
            result[key] = self._value(depth + 1)
            self._whitespace()
            if self.index >= len(self.text):
                raise _ContractError("PAC100")
            marker = self.text[self.index]
            self.index += 1
            if marker == "}":
                return result
            if marker != ",":
                raise _ContractError("PAC100")

    def _array(self, depth: int) -> list[Any]:
        self.index += 1
        result: list[Any] = []
        self._whitespace()
        if self.index < len(self.text) and self.text[self.index] == "]":
            self.index += 1
            return result
        while True:
            if len(result) >= MAX_MEMBERS:
                raise _ContractError("PAC101")
            result.append(self._value(depth + 1))
            self._whitespace()
            if self.index >= len(self.text):
                raise _ContractError("PAC100")
            marker = self.text[self.index]
            self.index += 1
            if marker == "]":
                return result
            if marker != ",":
                raise _ContractError("PAC100")


def _load_manifest(raw: bytes) -> dict[str, Any]:
    if len(raw) > MAX_MANIFEST_BYTES:
        raise _ContractError("PAC101")
    if raw.startswith(b"\xef\xbb\xbf"):
        raise _ContractError("PAC100")
    try:
        text = raw.decode("utf-8")
        value = _BoundedJsonParser(text).parse()
    except _ContractError:
        raise
    except (UnicodeDecodeError, RecursionError, ValueError, TypeError):
        raise _ContractError("PAC100") from None
    if not isinstance(value, dict):
        raise _ContractError("PAC100")
    return value


def _nfc(value: Any) -> Any:
    if isinstance(value, str):
        return unicodedata.normalize("NFC", value)
    if isinstance(value, list):
        return [_nfc(item) for item in value]
    if isinstance(value, dict):
        return {_nfc(key): _nfc(item) for key, item in value.items()}
    return value


def _canonical(value: Any) -> bytes:
    try:
        # The closed v1 schema has no floating point values.  For that subset,
        # this is the RFC 8785/JCS UTF-8 representation.
        return json.dumps(
            _nfc(value), ensure_ascii=False, sort_keys=True, separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8")
    except (TypeError, ValueError, UnicodeError):
        raise _ContractError("PAC109") from None


def _exact(value: Any, fields: set[str], code: str = "PAC103") -> Mapping[str, Any]:
    if not isinstance(value, Mapping) or set(value) != fields:
        raise _ContractError(code)
    return value


def _identifier(value: Any, pattern: re.Pattern[str] = _IDENTIFIER) -> str:
    normalized = unicodedata.normalize("NFC", value) if isinstance(value, str) else ""
    if not pattern.fullmatch(normalized):
        raise _ContractError("PAC104")
    return normalized


def _integer(value: Any, minimum: int, maximum: int, code: str = "PAC106") -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not minimum <= value <= maximum:
        raise _ContractError(code)
    return value


def _relative_path(value: Any) -> str:
    if not isinstance(value, str) or not value or len(value.encode("utf-8")) > 512:
        raise _ContractError("PAC107")
    if "\\" in value or "\0" in value or re.match(r"^[A-Za-z]:", value):
        raise _ContractError("PAC107")
    lexical_parts = value.split("/")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in lexical_parts):
        raise _ContractError("PAC107")
    if any(
        any(unicodedata.category(character) == "Cc" for character in part)
        for part in path.parts
    ):
        raise _ContractError("PAC107")
    return unicodedata.normalize("NFC", value)


def _entrypoint(value: Any, runtime: str) -> str:
    if not isinstance(value, Mapping):
        raise _ContractError("PAC103")
    kind = value.get("type")
    if kind == "python_file" and set(value) == {"type", "path"} and runtime == "python":
        return _relative_path(value["path"])
    if kind == "executable" and set(value) == {"type", "path"} and runtime == "native":
        return _relative_path(value["path"])
    if kind == "python_module" and set(value) == {"type", "module", "source_path"} and runtime == "python":
        module = value.get("module")
        source = _relative_path(value.get("source_path"))
        if not isinstance(module, str) or not _MODULE.fullmatch(module):
            raise _ContractError("PAC104")
        expected = module.replace(".", "/")
        if source not in {f"{expected}.py", f"{expected}/__init__.py"}:
            raise _ContractError("PAC107")
        return source
    raise _ContractError("PAC103")


def _parameter(value: Any) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise _ContractError("PAC105")
    kind = value.get("type")
    if kind == "boolean" and set(value) == {"type"}:
        return {"type": "boolean"}
    if kind == "integer" and set(value) == {"type", "minimum", "maximum"}:
        minimum = _integer(value["minimum"], -10**12, 10**12, "PAC105")
        maximum = _integer(value["maximum"], -10**12, 10**12, "PAC105")
        if minimum > maximum:
            raise _ContractError("PAC105")
        return {"type": "integer", "minimum": minimum, "maximum": maximum}
    if kind == "string" and set(value) == {"type", "enum"}:
        options = value["enum"]
        if not isinstance(options, list) or not 1 <= len(options) <= 64:
            raise _ContractError("PAC105")
        normalized = [_identifier(item, _TOKEN) for item in options]
        if len(set(normalized)) != len(normalized):
            raise _ContractError("PAC105")
        return {"type": "string", "enum": normalized}
    raise _ContractError("PAC105")


def _named_kinds(value: Any, allowed: set[str]) -> list[dict[str, str]]:
    if not isinstance(value, list) or len(value) > 32:
        raise _ContractError("PAC106")
    normalized = []
    names = set()
    for item in value:
        item = _exact(item, {"name", "kind"}, "PAC106")
        name = _identifier(item["name"], _TOKEN)
        kind = item["kind"]
        if not isinstance(kind, str) or name in names or kind not in allowed:
            raise _ContractError("PAC106")
        names.add(name)
        normalized.append({"name": name, "kind": kind})
    return normalized


def _action(value: Any) -> tuple[dict[str, Any], str]:
    action = _exact(value, _ACTION_FIELDS)
    kind = action["kind"]
    runtime = action["runtime"]
    if not isinstance(kind, str) or not isinstance(runtime, str):
        raise _ContractError("PAC106")
    if kind not in _ACTION_KINDS or runtime not in {"python", "native"}:
        raise _ContractError("PAC106")
    parameters = action["parameters"]
    if not isinstance(parameters, Mapping) or len(parameters) > 64:
        raise _ContractError("PAC105")
    normalized_parameters = {}
    for name, parameter in parameters.items():
        normalized_parameters[_identifier(name)] = _parameter(parameter)
    arguments = action["arguments"]
    if not isinstance(arguments, list) or len(arguments) > 128:
        raise _ContractError("PAC105")
    normalized_arguments = []
    flags, bound = set(), set()
    for item in arguments:
        item = _exact(item, {"flag", "parameter"}, "PAC105")
        flag = _identifier(item["flag"], _FLAG)
        parameter = _identifier(item["parameter"])
        if parameter not in normalized_parameters or flag in flags or parameter in bound:
            raise _ContractError("PAC105")
        flags.add(flag)
        bound.add(parameter)
        normalized_arguments.append({"flag": flag, "parameter": parameter})
    resources = _exact(action["resources"], {"cpu_millis", "memory_mb", "timeout_seconds", "gpu_count"}, "PAC106")
    normalized_resources = {
        "cpu_millis": _integer(resources["cpu_millis"], 100, 64_000),
        "memory_mb": _integer(resources["memory_mb"], 128, 262_144),
        "timeout_seconds": _integer(resources["timeout_seconds"], 1, 86_400),
        "gpu_count": _integer(resources["gpu_count"], 0, 8),
    }
    _exact(action["network"], {"access"}, "PAC106")
    if action["network"]["access"] != "none":
        raise _ContractError("PAC106")
    source = _entrypoint(action["entrypoint"], runtime)
    return ({
        "kind": kind,
        "entrypoint": _nfc(dict(action["entrypoint"])),
        "parameters": normalized_parameters,
        "arguments": normalized_arguments,
        "inputs": _named_kinds(action["inputs"], _INPUT_KINDS),
        "outputs": _named_kinds(action["outputs"], _OUTPUT_KINDS),
        "runtime": runtime,
        "resources": normalized_resources,
        "network": {"access": "none"},
    }, source)


def _hash_source(root: Path, relative: str) -> tuple[str, int]:
    if (
        not all(hasattr(os, name) for name in ("O_DIRECTORY", "O_NOFOLLOW", "O_NONBLOCK"))
        or os.open not in os.supports_dir_fd
    ):
        raise _ContractError("PAC108")
    parts = PurePosixPath(relative).parts
    flags_directory = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    flags_file = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    descriptors = []
    try:
        current = os.open(root, flags_directory)
        descriptors.append(current)
        for part in parts[:-1]:
            current = os.open(part, flags_directory, dir_fd=current)
            descriptors.append(current)
        source = os.open(parts[-1], flags_file, dir_fd=current)
        descriptors.append(source)
        before = os.fstat(source)
        if not stat.S_ISREG(before.st_mode) or before.st_size > MAX_SOURCE_BYTES:
            raise _ContractError("PAC108")
        digest = hashlib.sha256()
        read = 0
        while True:
            block = os.read(source, 1024 * 1024)
            if not block:
                break
            read += len(block)
            if read > MAX_SOURCE_BYTES:
                raise _ContractError("PAC108")
            digest.update(block)
        after = os.fstat(source)
        if read != before.st_size or (
            before.st_dev, before.st_ino, before.st_mtime_ns,
            before.st_ctime_ns, before.st_size,
        ) != (
            after.st_dev, after.st_ino, after.st_mtime_ns,
            after.st_ctime_ns, after.st_size,
        ):
            raise _ContractError("PAC108")
        return digest.hexdigest(), read
    except _ContractError:
        raise
    except OSError:
        raise _ContractError("PAC107") from None
    finally:
        for descriptor in reversed(descriptors):
            try:
                os.close(descriptor)
            except OSError:
                pass


def _diagnostic(code: str, location: str = "/project_actions") -> dict[str, str]:
    severity, classification, message = _MESSAGES[code]
    return {"code": code, "severity": severity, "location": location, "message": message, "classification": classification}


def _legacy_surfaces(
    manifest: Mapping[str, Any], *, reviewed_application: bool,
) -> tuple[bool, bool, bool]:
    """Return local, sandbox-required, and invalid legacy surface presence."""
    execution_keys = {"executable", "entrypoint", "adapter", "containerfile", "dependency_lock"}
    local = False
    invalid = False
    stack: list[tuple[tuple[str, ...], Any]] = [((), manifest)]
    while stack:
        path, value = stack.pop()
        if isinstance(value, Mapping):
            for key, child in value.items():
                child_path = (*path, str(key))
                if child_path[0] not in {"deployment", "project_actions"}:
                    if key in execution_keys or path == ("adapters",):
                        local = True
                        if child_path == (
                            "runtime", "actions", "inference", "executable",
                        ) and child == "":
                            invalid = True
                stack.append((child_path, child))
        elif isinstance(value, list):
            stack.extend(((*path, str(index)), child) for index, child in enumerate(value))

    deployment = manifest.get("deployment")
    if not isinstance(deployment, Mapping):
        return local, "deployment" in manifest, invalid
    sandbox = any(key != "application" for key in deployment)
    application = deployment.get("application")
    if not isinstance(application, Mapping):
        sandbox = sandbox or "application" in deployment
    elif not (reviewed_application and set(application) == {"inference_binding"}):
        sandbox = sandbox or bool(application)
    return local, sandbox, invalid


def _reviewed_binding_matches(
    manifest: Mapping[str, Any], manifest_sha256: str, repository_identity: str,
    reviewed_bindings: Sequence[Mapping[str, Any]],
) -> bool:
    if not repository_identity:
        return False
    try:
        observed = manifest["deployment"]["application"]["inference_binding"]
    except (KeyError, TypeError):
        return False
    legacy_binding_fields = {
        "service_id", "service_revision", "methods", "paths",
        "request_protocol", "response_protocol",
    }
    policy_binding_fields = legacy_binding_fields | {
        "request_media_types", "max_request_bytes", "max_response_bytes",
        "timeout_seconds",
    }
    binding_shapes = {frozenset(legacy_binding_fields), frozenset(policy_binding_fields)}

    def valid_sorted_strings(value: Any, validator: Any) -> bool:
        return (
            isinstance(value, list) and bool(value)
            and all(isinstance(item, str) and validator(item) for item in value)
            and value == sorted(set(value))
        )

    def valid_binding(value: Any, fields: set[str]) -> bool:
        if not isinstance(value, Mapping) or set(value) != fields:
            return False
        if not (
            isinstance(value["service_id"], str)
            and _REVIEW_SERVICE_ID.fullmatch(value["service_id"])
            and isinstance(value["service_revision"], str)
            and _REVIEW_SERVICE_REVISION.fullmatch(value["service_revision"])
            and isinstance(value["request_protocol"], str)
            and _REVIEW_PROTOCOL.fullmatch(value["request_protocol"])
            and isinstance(value["response_protocol"], str)
            and _REVIEW_PROTOCOL.fullmatch(value["response_protocol"])
            and valid_sorted_strings(value["methods"], lambda item: item == "POST")
            and valid_sorted_strings(value["paths"], lambda item: bool(_REVIEW_PATH.fullmatch(item)))
        ):
            return False
        if fields == policy_binding_fields:
            return (
                valid_sorted_strings(
                    value["request_media_types"],
                    lambda item: item in {
                        "application/json", "application/octet-stream",
                        "image/jpeg", "image/png",
                    },
                )
                and type(value["max_request_bytes"]) is int
                and 1 <= value["max_request_bytes"] <= 4 * 1024 * 1024
                and type(value["max_response_bytes"]) is int
                and 1 <= value["max_response_bytes"] <= 8 * 1024 * 1024
                and type(value["timeout_seconds"]) is int
                and 1 <= value["timeout_seconds"] <= 300
            )
        return True

    if not isinstance(observed, Mapping) or frozenset(observed) not in binding_shapes:
        return False
    binding_fields = set(observed)
    if not valid_binding(observed, binding_fields):
        return False
    registry_records: list[tuple[Mapping[str, Any], set[str]]] = []
    for record in reviewed_bindings:
        if not isinstance(record, Mapping):
            return False
        record_binding_fields = set(record) - {
            "repository_identity", "manifest_sha256", "project_id",
        }
        if (
            frozenset(record_binding_fields) not in binding_shapes
            or set(record) != record_binding_fields | {
                "repository_identity", "manifest_sha256", "project_id",
            }
            or not isinstance(record.get("repository_identity"), str)
            or not record.get("repository_identity")
            or not isinstance(record.get("manifest_sha256"), str)
            or not _HEX_SHA256.fullmatch(record["manifest_sha256"])
            or not isinstance(record.get("project_id"), str)
            or not _TOKEN.fullmatch(record["project_id"])
            or not valid_binding(
                {key: record[key] for key in record_binding_fields},
                record_binding_fields,
            )
        ):
            return False
        registry_records.append((record, record_binding_fields))
    for record, record_binding_fields in registry_records:
        if (
            record_binding_fields == binding_fields
            and record.get("repository_identity") == repository_identity
            and record.get("manifest_sha256") == manifest_sha256
            and record.get("project_id") == manifest.get("id")
            and all(observed.get(key) == record.get(key) for key in binding_fields)
        ):
            return True
    return False


def inspect_project_actions(
    manifest_bytes: bytes,
    *,
    repository_root: str | Path,
    repository_identity: str = "",
    reviewed_bindings: Sequence[Mapping[str, Any]] = (),
) -> dict[str, Any]:
    """Inspect original manifest/source bytes without execution or mutation."""
    manifest_sha256 = hashlib.sha256(manifest_bytes).hexdigest()
    base = {
        "protocol": DIAGNOSTIC_PROTOCOL,
        "compatible": False,
        "classification": "invalid",
        "diagnostics": [],
        "manifest_sha256": manifest_sha256,
        "declaration_sha256": "",
        "source_identities": [],
        "execution_authorized": False,
        "hosted_execution_available": False,
        "side_effects_performed": [],
    }
    try:
        manifest = _load_manifest(manifest_bytes)
        declaration_present = "project_actions" in manifest
        declaration = manifest.get("project_actions")
        diagnostics = []
        reviewed = _reviewed_binding_matches(
            manifest, manifest_sha256, repository_identity, reviewed_bindings,
        )
        legacy_local, legacy_provider, legacy_invalid = _legacy_surfaces(
            manifest, reviewed_application=reviewed,
        )
        if legacy_invalid:
            raise _ContractError("PAC104", "/legacy/0")
        if not declaration_present:
            diagnostics.append(_diagnostic("PAC001"))
            if legacy_provider:
                diagnostics.append(_diagnostic("PAC002", "/legacy/0"))
            if reviewed:
                diagnostics.append(_diagnostic("PAC003", "/applications/0"))
            base["classification"] = "sandbox-required" if legacy_provider else (
                "mixed" if reviewed else "local-only"
            )
            base["diagnostics"] = sorted(diagnostics, key=lambda item: (item["code"], item["location"]))
            return base
        declaration = _exact(declaration, {"protocol", "actions"})
        if declaration["protocol"] != CONTRACT_PROTOCOL:
            raise _ContractError("PAC102")
        actions = declaration["actions"]
        if not isinstance(actions, Mapping) or not 1 <= len(actions) <= 64:
            raise _ContractError("PAC103")
        normalized_actions = {}
        sources = set()
        for index, name in enumerate(sorted(actions)):
            normalized_name = _identifier(name)
            normalized_action, source = _action(actions[name])
            normalized_actions[normalized_name] = normalized_action
            sources.add(source)
        normalized = {"protocol": CONTRACT_PROTOCOL, "actions": normalized_actions}
        canonical = _canonical(normalized)
        if len(canonical) > MAX_DECLARATION_BYTES:
            raise _ContractError("PAC101")
        identities = []
        total = 0
        root = Path(repository_root)
        for source in sorted(sources):
            digest, size = _hash_source(root, source)
            total += size
            if total > MAX_SOURCE_TOTAL_BYTES:
                raise _ContractError("PAC108")
            identities.append({"path": source, "sha256": digest})
        diagnostics.append(_diagnostic("PAC000"))
        if legacy_local:
            diagnostics.append(_diagnostic("PAC001", "/legacy/0"))
        if legacy_provider:
            diagnostics.append(_diagnostic("PAC002", "/legacy/0"))
        if reviewed:
            diagnostics.append(_diagnostic("PAC003", "/applications/0"))
        base.update({
            "compatible": True,
            "classification": "sandbox-required" if legacy_provider else (
                "mixed" if reviewed or legacy_local else "declarative-compatible"
            ),
            "diagnostics": sorted(diagnostics, key=lambda item: (item["code"], item["location"])),
            "declaration_sha256": hashlib.sha256(canonical).hexdigest(),
            "source_identities": identities,
        })
        return base
    except _ContractError as exc:
        base["diagnostics"] = [_diagnostic(exc.code, exc.location)]
        return base


def project_action_structure_compatible(declaration: Any) -> bool:
    """Validate the pure v1 declaration shape without reading source files."""
    try:
        declaration = _exact(declaration, {"protocol", "actions"})
        if declaration["protocol"] != CONTRACT_PROTOCOL:
            raise _ContractError("PAC102")
        actions = declaration["actions"]
        if not isinstance(actions, Mapping) or not 1 <= len(actions) <= 64:
            raise _ContractError("PAC103")
        normalized_actions = {}
        for name in sorted(actions):
            normalized_name = _identifier(name)
            normalized_action, _source = _action(actions[name])
            normalized_actions[normalized_name] = normalized_action
        canonical = _canonical({"protocol": CONTRACT_PROTOCOL, "actions": normalized_actions})
        if len(canonical) > MAX_DECLARATION_BYTES:
            raise _ContractError("PAC101")
        return True
    except _ContractError:
        return False


__all__ = [
    "CONTRACT_PROTOCOL", "DIAGNOSTIC_PROTOCOL", "inspect_project_actions",
    "project_action_structure_compatible",
]
