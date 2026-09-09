# Copyright (C) 2026 Mathew Turnell
# SPDX-License-Identifier: LicenseRef-ModelForge-Pending

"""Fixed Modal deployment for bounded Qwen2.5-7B prompt execution."""

from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Mapping

try:
    import modal
except ImportError:  # pragma: no cover - exercised by the no-SDK subprocess test
    modal = None

from modelforge_workbench.modal_worker import (
    asset_by_id,
    result_envelope,
    validate_request,
    verified_asset,
)


APP_NAME = "modelforge-alpha-qwen-prompt"
FUNCTION_NAME = "run_qwen_prompt"
VOLUME_NAME = "modelforge-alpha-qwen-inputs"
INPUT_ROOT = "/mnt/modelforge-inputs"
REMOTE_PROJECT_ROOT = "/opt/modelforge-example"
RESOURCE_PLAN = {
    "gpu": "L40S",
    "cpu": 2.0,
    "memory": 32_768,
    "timeout": 1_200,
    "startup_timeout": 1_200,
    "retries": 0,
    "max_containers": 1,
    "min_containers": 0,
}
MAX_MESSAGES = 4
MAX_PROMPT_BYTES = 8 * 1024
MAX_NEW_TOKENS = 64


def _execute(payload: Mapping) -> dict:
    request = validate_request(
        payload,
        project_id="qwen-prompt-lab",
        action_id="prompt",
        action_kind="prompt",
    )
    action = request["request"]
    if action.get("workflow") != "prompt" or action.get("action_id") != "prompt":
        raise ValueError("Qwen Modal request is not the authored prompt action")
    messages = action.get("messages")
    generation = action.get("generation") or {}
    if not isinstance(messages, list) or not 1 <= len(messages) <= MAX_MESSAGES:
        raise ValueError("Qwen Modal requests require from one to four messages")
    if any(not isinstance(item, Mapping) for item in messages):
        raise ValueError("Qwen Modal messages must be objects")
    if sum(len(str(item.get("content") or "").encode("utf-8")) for item in messages) > MAX_PROMPT_BYTES:
        raise ValueError("Qwen Modal prompt content exceeds 8 KiB")
    tokens = generation.get("max_new_tokens", 64) if isinstance(generation, Mapping) else None
    if (
        not isinstance(generation, Mapping)
        or isinstance(tokens, bool)
        or not isinstance(tokens, int)
        or not 1 <= tokens <= MAX_NEW_TOKENS
    ):
        raise ValueError("Qwen Modal completion is limited to 64 new tokens")

    model_asset = asset_by_id(request, "qwen-model")
    model = verified_asset(INPUT_ROOT, model_asset, expected_role="model")
    project_root = Path(REMOTE_PROJECT_ROOT)
    sys.path.insert(0, str(project_root))
    import prompt as prompt_adapter

    normalized_messages, normalized_generation = prompt_adapter.normalize_request(action)
    if len(normalized_messages) > MAX_MESSAGES or normalized_generation["max_new_tokens"] > MAX_NEW_TOKENS:
        raise ValueError("Normalized Qwen request exceeds the Modal acceptance bound")
    environment = {
        "MODELFORGE_MODEL_ID": prompt_adapter.MODEL_ID,
        "MODELFORGE_MODEL_REVISION": prompt_adapter.MODEL_REVISION,
        "MODELFORGE_MODEL_CACHE": str(model),
        "HF_HUB_OFFLINE": "1",
        "TRANSFORMERS_OFFLINE": "1",
        "MODELFORGE_NETWORK": "disabled",
    }
    prior = {name: os.environ.get(name) for name in environment}
    os.environ.update(environment)
    try:
        text, usage = prompt_adapter.generate(normalized_messages, normalized_generation)
        result = prompt_adapter.build_result(text, usage)
        with tempfile.TemporaryDirectory(prefix="modelforge-qwen-") as temporary:
            result_path = Path(temporary) / "result.json"
            result_path.write_text(
                json.dumps(result, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            return result_envelope(request["run_id"], [result_path])
    finally:
        for name, value in prior.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


def run_qwen_prompt(request: Mapping) -> dict:
    return _execute(request)


if modal is not None:
    _project_root = Path(__file__).resolve().parent
    app = modal.App(APP_NAME)
    input_volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=False)
    image = (
        modal.Image.debian_slim(python_version="3.12")
        .pip_install(
            "accelerate==1.3.0",
            "Pillow==11.1.0",
            "safetensors==0.5.2",
            "torch==2.6.0",
            "transformers==4.48.3",
        )
        .add_local_python_source("modelforge_workbench", copy=True)
        .add_local_dir(str(_project_root), remote_path=REMOTE_PROJECT_ROOT, copy=True)
    )
    run_qwen_prompt = app.function(
        image=image,
        volumes={INPUT_ROOT: input_volume},
        **RESOURCE_PLAN,
    )(modal.concurrent(max_inputs=1)(run_qwen_prompt))
else:
    app = image = input_volume = None


__all__ = ["app", "run_qwen_prompt"]
