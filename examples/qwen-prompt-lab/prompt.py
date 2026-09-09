#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""ModelForge prompt adapter for the pinned Qwen2.5-7B-Instruct release.

The heavyweight imports are deliberately lazy. Managed execution requires an
explicit local snapshot and never falls back to a network download.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Mapping, Sequence


MODEL_ID = "Qwen/Qwen2.5-7B-Instruct"
MODEL_REVISION = "a09a35458c702b33eeacc393d103063234e8bc28"
REQUEST_PROTOCOL = "modelforge.prompt-request/v1"
RESULT_PROTOCOL = "modelforge.prompt-result/v1"

MAX_MESSAGES = 64
MAX_MESSAGE_CHARS = 32_768
DEFAULT_MAX_NEW_TOKENS = 256
MAX_NEW_TOKENS = 2_048


class PromptRequestError(ValueError):
    """Raised when an LLM Lab request is outside this adapter's contract."""


def _bounded_number(
    value: Any,
    *,
    name: str,
    default: float,
    minimum: float,
    maximum: float,
) -> float:
    if value is None:
        return default
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise PromptRequestError(f"{name} must be a number")
    result = float(value)
    if not minimum <= result <= maximum:
        raise PromptRequestError(f"{name} must be between {minimum} and {maximum}")
    return result


def _text_content(content: Any) -> str:
    if isinstance(content, str):
        text = content
    elif isinstance(content, list):
        parts: list[str] = []
        for block in content:
            if not isinstance(block, Mapping) or block.get("type") != "text":
                raise PromptRequestError("Qwen2.5-7B accepts text content only")
            value = block.get("text")
            if not isinstance(value, str):
                raise PromptRequestError("text content blocks require a string 'text'")
            parts.append(value)
        text = "\n".join(parts)
    else:
        raise PromptRequestError("message content must be text")
    if len(text) > MAX_MESSAGE_CHARS:
        raise PromptRequestError(
            f"message content exceeds the {MAX_MESSAGE_CHARS}-character limit"
        )
    return text


def normalize_request(payload: Any) -> tuple[list[dict[str, str]], dict[str, Any]]:
    if not isinstance(payload, Mapping):
        raise PromptRequestError("request must be a JSON object")
    protocol = payload.get("format", payload.get("protocol"))
    if protocol != REQUEST_PROTOCOL:
        raise PromptRequestError(f"request format must be {REQUEST_PROTOCOL!r}")

    raw_messages = payload.get("messages")
    if not isinstance(raw_messages, list) or not raw_messages:
        raise PromptRequestError("request.messages must be a non-empty list")
    if len(raw_messages) > MAX_MESSAGES:
        raise PromptRequestError(f"at most {MAX_MESSAGES} messages are supported")

    messages: list[dict[str, str]] = []
    for index, item in enumerate(raw_messages):
        if not isinstance(item, Mapping):
            raise PromptRequestError(f"messages[{index}] must be an object")
        role = item.get("role")
        if role not in {"system", "user", "assistant"}:
            raise PromptRequestError(
                f"messages[{index}].role must be system, user, or assistant"
            )
        messages.append({"role": role, "content": _text_content(item.get("content"))})

    raw_generation = payload.get("generation", payload.get("parameters", {}))
    if raw_generation is None:
        raw_generation = {}
    if not isinstance(raw_generation, Mapping):
        raise PromptRequestError("generation settings must be an object")

    max_new_tokens = raw_generation.get(
        "max_new_tokens", raw_generation.get("max_tokens", DEFAULT_MAX_NEW_TOKENS)
    )
    if isinstance(max_new_tokens, bool) or not isinstance(max_new_tokens, int):
        raise PromptRequestError("max_new_tokens must be an integer")
    if not 1 <= max_new_tokens <= MAX_NEW_TOKENS:
        raise PromptRequestError(
            f"max_new_tokens must be between 1 and {MAX_NEW_TOKENS}"
        )

    temperature = _bounded_number(
        raw_generation.get("temperature"),
        name="temperature",
        default=0.7,
        minimum=0.0,
        maximum=2.0,
    )
    top_p = _bounded_number(
        raw_generation.get("top_p"),
        name="top_p",
        default=0.9,
        minimum=0.01,
        maximum=1.0,
    )
    return messages, {
        "max_new_tokens": max_new_tokens,
        "temperature": temperature,
        "top_p": top_p,
    }


def generate(
    messages: Sequence[Mapping[str, str]], generation: Mapping[str, Any]
) -> tuple[str, dict[str, int]]:
    try:
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer
    except ImportError as exc:
        raise RuntimeError(
            "Qwen runtime dependencies are missing. Install requirements.direct.txt "
            "in the Python environment used by ModelForge."
        ) from exc

    if os.environ.get("MODELFORGE_MODEL_ID") != MODEL_ID:
        raise RuntimeError("Configured model identity does not match this Qwen adapter")
    if os.environ.get("MODELFORGE_MODEL_REVISION") != MODEL_REVISION:
        raise RuntimeError("Configured model revision does not match this Qwen adapter")
    snapshot = Path(os.environ.get("MODELFORGE_MODEL_CACHE", "")).expanduser()
    if not snapshot.is_absolute() or snapshot.is_symlink() or not snapshot.is_dir():
        raise RuntimeError("An existing absolute offline Qwen snapshot is required")
    if snapshot.name != MODEL_REVISION:
        raise RuntimeError("Offline Qwen snapshot directory must use the pinned revision identity")
    tokenizer = AutoTokenizer.from_pretrained(
        str(snapshot),
        trust_remote_code=False,
        local_files_only=True,
    )
    model = AutoModelForCausalLM.from_pretrained(
        str(snapshot),
        trust_remote_code=False,
        local_files_only=True,
        torch_dtype="auto",
        device_map="auto",
        low_cpu_mem_usage=True,
    )
    model.eval()

    model_inputs = tokenizer.apply_chat_template(
        list(messages),
        add_generation_prompt=True,
        tokenize=True,
        return_dict=True,
        return_tensors="pt",
    ).to(model.device)
    prompt_tokens = int(model_inputs["input_ids"].shape[-1])
    temperature = float(generation["temperature"])
    generate_args: dict[str, Any] = {
        "max_new_tokens": int(generation["max_new_tokens"]),
        "do_sample": temperature > 0,
        "pad_token_id": tokenizer.eos_token_id,
    }
    if temperature > 0:
        generate_args.update(
            temperature=temperature,
            top_p=float(generation["top_p"]),
        )
    else:
        # Qwen's upstream generation config contains sampling defaults. Clear
        # them explicitly for deterministic requests so Transformers does not
        # warn that inactive sampling controls were supplied.
        generate_args.update(temperature=None, top_p=None, top_k=None)

    with torch.inference_mode():
        output_ids = model.generate(**model_inputs, **generate_args)
    completion_ids = output_ids[0, prompt_tokens:]
    text = tokenizer.decode(completion_ids, skip_special_tokens=True).strip()
    completion_tokens = int(completion_ids.shape[-1])
    return text, {
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "total_tokens": prompt_tokens + completion_tokens,
    }


def build_result(text: str, usage: Mapping[str, int]) -> dict[str, Any]:
    # The result contract only requires bounded assistant messages. Token usage is
    # optional, so keep the envelope minimal until ModelForge supplies an exact
    # usage-field shape rather than guessing one from an adjacent API.
    del usage
    return {
        "protocol": RESULT_PROTOCOL,
        "messages": [{"role": "assistant", "content": text}],
    }


def run(request_path: Path, output_path: Path) -> None:
    payload = json.loads(request_path.read_text(encoding="utf-8"))
    messages, generation = normalize_request(payload)
    text, usage = generate(messages, generation)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(build_result(text, usage), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args(argv)
    try:
        run(args.request, args.output)
    except (OSError, json.JSONDecodeError, PromptRequestError, RuntimeError) as exc:
        print(f"Qwen prompt failed: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
