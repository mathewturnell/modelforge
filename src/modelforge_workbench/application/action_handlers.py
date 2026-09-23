"""Action-specific validation around the shared managed-run lifecycle.

These handlers validate already-authorized request and project-produced result
claims. They do not create run identities, launch processes, persist state, or
register artifacts.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Mapping

from .runs import _json_mapping, thaw_json


_ACTION_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$")
_RESERVED_SPLITS = frozenset({"test", "reserved-test", "reserved_test", "held-out", "held_out"})


@dataclass(frozen=True)
class ValidatedActionClaim:
    """Detached, immutable request or result accepted by one action handler."""

    kind: str
    value: Mapping[str, Any]

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "value",
            _json_mapping(thaw_json(self.value), f"{self.kind} action claim"),
        )

    def detached(self) -> dict[str, Any]:
        return thaw_json(self.value)


class ActionHandler:
    """Base validator for one standard action kind."""

    kind = ""
    request_workflows: frozenset[str] = frozenset()

    def validate_request(self, value: Mapping[str, Any]) -> ValidatedActionClaim:
        request = _json_mapping(thaw_json(value), f"{self.kind} request")
        action_id = str(request.get("action_id") or "")
        if not _ACTION_ID.fullmatch(action_id):
            raise ValueError(f"{self.kind.title()} request action identity is invalid")
        workflow = str(request.get("workflow") or request.get("kind") or "").casefold()
        if workflow not in self.request_workflows:
            raise ValueError(f"Request is not a {self.kind} action")
        self._validate_request(request)
        return ValidatedActionClaim(self.kind, request)

    def validate_result(
        self,
        value: Mapping[str, Any],
        *,
        expected_protocol: str,
    ) -> ValidatedActionClaim:
        result = _json_mapping(thaw_json(value), f"{self.kind} result")
        expected = str(expected_protocol or "").strip()
        if not expected:
            raise ValueError(f"{self.kind.title()} result protocol is required")
        actual = str(result.get("protocol") or result.get("format") or "").strip()
        if actual != expected:
            raise ValueError(
                f"{self.kind.title()} result protocol must be {expected}"
            )
        self._validate_result(result)
        return ValidatedActionClaim(self.kind, result)

    def _validate_request(self, _value: Mapping[str, Any]) -> None:
        return

    def _validate_result(self, _value: Mapping[str, Any]) -> None:
        return


class TrainingActionHandler(ActionHandler):
    kind = "training"
    request_workflows = frozenset({"training"})

    def _validate_request(self, value: Mapping[str, Any]) -> None:
        for name in ("split", "dataset_split", "evaluation_split"):
            split = str(value.get(name) or "").strip().casefold()
            if split in _RESERVED_SPLITS:
                raise ValueError("Managed training cannot access a reserved test split")
        for name in ("promote", "promotion", "self_promote", "promoted_checkpoint"):
            if value.get(name) not in (None, False, "", {}):
                raise ValueError("Managed training cannot promote its own result")

    def _validate_result(self, value: Mapping[str, Any]) -> None:
        if value.get("promoted") is True or value.get("promotion") not in (None, False, "", {}):
            raise ValueError("Managed training result cannot claim promotion")


        if value.get("protocol") == "modelforge.training-result/v1":
            results = value.get("results")
            if not isinstance(results, tuple) or not 1 <= len(results) <= 8:
                raise ValueError("Training result requires bounded checkpoint artifacts")
            for item in results:
                if not isinstance(item, Mapping) or item.get("kind") != "checkpoint":
                    raise ValueError("Training result must declare checkpoint artifacts")
                path = str(item.get("path") or "")
                if path in {"", ".", "..", "result.json", "telemetry.jsonl"} or "/" in path or "\\" in path:
                    raise ValueError("Training checkpoint path must be a filename")
                if not re.fullmatch(r"[a-f0-9]{64}", str(item.get("sha256") or "")):
                    raise ValueError("Training checkpoint digest is required")
            telemetry = value.get("telemetry")
            if not isinstance(telemetry, Mapping) or telemetry.get("path") != "telemetry.jsonl" or not re.fullmatch(r"[a-f0-9]{64}", str(telemetry.get("sha256") or "")):
                raise ValueError("Training result requires digest-bound scalar telemetry")
            if value.get("candidate_status") != "unpromoted":
                raise ValueError("Training checkpoint must remain an unpromoted candidate")


class EvaluationActionHandler(ActionHandler):
    kind = "evaluation"
    request_workflows = frozenset({"evaluation"})

    def _validate_request(self, value: Mapping[str, Any]) -> None:
        split = str(value.get("split") or value.get("evaluation_split") or "").strip()
        candidate = (
            value.get("candidate_identity")
            or value.get("checkpoint_sha256")
            or value.get("model_artifact")
        )
        if not split:
            raise ValueError("Managed evaluation requires an explicit split")
        if not candidate:
            raise ValueError("Managed evaluation requires a bound candidate identity")


class InferenceActionHandler(ActionHandler):
    kind = "inference"
    request_workflows = frozenset({"inference"})

    def _validate_result(self, value: Mapping[str, Any]) -> None:
        kind = str(value.get("kind") or "").strip().casefold()
        if kind and kind not in {"video", "image", "text", "table", "scene_3d", "artifact"}:
            raise ValueError("Inference result kind is unsupported")
        results = value.get("results")
        if not isinstance(results, tuple) or not 1 <= len(results) <= 32:
            raise ValueError("Inference result requires a bounded artifact list")
        for result in results:
            if not isinstance(result, Mapping):
                raise ValueError("Inference result artifact must be an object")
            path = str(result.get("path") or "")
            digest = str(result.get("sha256") or "").casefold()
            if not path or "/" in path or "\\" in path or not re.fullmatch(r"[a-f0-9]{64}", digest):
                raise ValueError("Inference result artifact identity is invalid")
        for name in ("input_artifact", "model_artifact"):
            identity = value.get(name)
            if identity is None:
                continue
            if not isinstance(identity, Mapping) or not re.fullmatch(
                r"[a-f0-9]{64}", str(identity.get("sha256") or "").casefold(),
            ):
                raise ValueError(f"Inference {name.replace('_', ' ')} identity is invalid")


class PromptActionHandler(ActionHandler):
    kind = "prompt"
    request_workflows = frozenset({"prompt"})

    def _validate_request(self, value: Mapping[str, Any]) -> None:
        if "prompt_request_sha256" in value:
            digest = str(value.get("prompt_request_sha256") or "").casefold()
            count = value.get("message_count")
            if not re.fullmatch(r"[a-f0-9]{64}", digest):
                raise ValueError("Prompt request digest is invalid")
            if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= 64:
                raise ValueError("Prompt request message count is invalid")
            return
        if "protocol" not in value and "messages" not in value:
            # Retained Phase 3 compatibility for already-authorized legacy
            # prompt intents. Registered alpha projects use the strict branch.
            return
        if value.get("protocol") != "modelforge.prompt-request/v1":
            raise ValueError("Prompt request protocol is unsupported")
        messages = value.get("messages")
        if not isinstance(messages, tuple) or not 1 <= len(messages) <= 64:
            raise ValueError("Prompt request requires from 1 to 64 messages")
        for message in messages:
            if not isinstance(message, Mapping) or message.get("role") not in {
                "system", "user", "assistant",
            }:
                raise ValueError("Prompt request message role is invalid")
            content = message.get("content")
            if not isinstance(content, str) or len(content) > 32_768:
                raise ValueError("Prompt request message content is invalid or too large")
        generation = value.get("generation") or {}
        if not isinstance(generation, Mapping):
            raise ValueError("Prompt generation settings must be an object")
        tokens = generation.get("max_new_tokens", 256)
        if isinstance(tokens, bool) or not isinstance(tokens, int) or not 1 <= tokens <= 2_048:
            raise ValueError("Prompt max_new_tokens must be from 1 to 2048")
        for name, lower, upper in (("temperature", 0.0, 2.0), ("top_p", 0.01, 1.0)):
            number = generation.get(name, 0.7 if name == "temperature" else 0.9)
            if isinstance(number, bool) or not isinstance(number, (int, float)) or not lower <= number <= upper:
                raise ValueError(f"Prompt {name} is outside its supported range")

    def _validate_result(self, value: Mapping[str, Any]) -> None:
        messages = value.get("messages")
        if not isinstance(messages, tuple) or not 1 <= len(messages) <= 64:
            raise ValueError("Prompt result requires an assistant message")
        for message in messages:
            if not isinstance(message, Mapping):
                raise ValueError("Prompt result message must be an object")
            if message.get("role") != "assistant":
                raise ValueError("Prompt result may contain only assistant messages")
            content = message.get("content")
            if (
                not isinstance(content, str)
                or not content.strip()
                or len(content) > 131_072
            ):
                raise ValueError("Prompt result message content is invalid or too large")


class DatasetActionHandler(ActionHandler):
    kind = "dataset"
    request_workflows = frozenset(
        {"dataset", "dataset_preparation", "dataset_transformation"}
    )

    def _validate_result(self, value: Mapping[str, Any]) -> None:
        if not any(value.get(name) for name in ("dataset_ref", "descriptor", "artifacts")):
            raise ValueError("Dataset result requires a dataset reference, descriptor, or artifact")


STANDARD_ACTION_HANDLERS: Mapping[str, ActionHandler] = MappingProxyType({
    handler.kind: handler
    for handler in (
        TrainingActionHandler(),
        EvaluationActionHandler(),
        InferenceActionHandler(),
        PromptActionHandler(),
        DatasetActionHandler(),
    )
})


def action_handler(kind: str) -> ActionHandler:
    """Return the fixed handler for a standard managed action kind."""

    try:
        return STANDARD_ACTION_HANDLERS[str(kind or "").strip().casefold()]
    except KeyError as exc:
        raise ValueError("Managed action kind is unsupported") from exc
