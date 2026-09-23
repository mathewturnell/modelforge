# Copyright (C) 2026 Mathew Turnell
# SPDX-License-Identifier: Apache-2.0
"""One owner-bound bounded MeMOTR box-head finetuning action."""

from __future__ import annotations
import contextlib
import io
import os
from pathlib import Path
import sys
import tempfile
from typing import Mapping

try:
    import modal
except ImportError:
    modal = None
from modelforge_workbench.modal_worker import asset_by_id, verified_asset, validate_request, result_envelope

APP_NAME = "modelforge-bdd100k-box-head-training"
FUNCTION_NAME = "run_box_head_training"
VOLUME_NAME = "modelforge-alpha-bdd100k-inputs"
INPUT_ROOT = "/mnt/modelforge-inputs"
REMOTE_PROJECT_ROOT = "/opt/modelforge-example"
RESOURCE_PLAN = dict(
    gpu="L40S", cpu=4.0, memory=32768, timeout=900, startup_timeout=900, retries=0, max_containers=1, min_containers=0
)


def run_box_head_training(payload: Mapping) -> dict:
    request = validate_request(
        payload, project_id="bdd100k-box-head-training", action_id="training", action_kind="training"
    )
    action = request["request"]
    if (
        action.get("workflow") != "training"
        or action.get("dataset_split") != "train"
        or action.get("evaluation_split") != "validation"
    ):
        raise ValueError("Training requires explicit non-held-out splits")
    if (
        action.get("epochs") != 1
        or isinstance(action.get("max_batches"), bool)
        or not isinstance(action.get("max_batches"), int)
        or not 1 <= action["max_batches"] <= 100
    ):
        raise ValueError("Training exceeds the fixed smoke recipe bounds")
    source = verified_asset(INPUT_ROOT, asset_by_id(request, "memotr-source"), expected_role="source")
    checkpoint = verified_asset(INPUT_ROOT, asset_by_id(request, "memotr-checkpoint"), expected_role="checkpoint")
    training = verified_asset(INPUT_ROOT, asset_by_id(request, "training-sample"), expected_role="input")
    validation = verified_asset(INPUT_ROOT, asset_by_id(request, "validation-sample"), expected_role="input")
    env = {
        "MODELFORGE_MEMOTR_SOURCE_ROOT": str(source),
        "MODELFORGE_MODEL_ARTIFACT_ID": str(action["checkpoint_id"]),
        "MODELFORGE_MODEL_ARTIFACT_SHA256": str(action["checkpoint_sha256"]),
        "MODELFORGE_MODEL_ARTIFACT_PATH": str(checkpoint),
        "MODELFORGE_NETWORK": "disabled",
    }
    previous = {key: os.environ.get(key) for key in env}
    os.environ.update(env)
    sys.path.insert(0, REMOTE_PROJECT_ROOT)
    try:
        from train_box_head import train

        with tempfile.TemporaryDirectory(prefix="modelforge-box-training-") as tmp:
            output = Path(tmp)
            capture = io.StringIO()

            class Tee:
                def write(self, text):
                    sys.__stdout__.write(text)
                    capture.write(text)

                def flush(self):
                    sys.__stdout__.flush()

            with contextlib.redirect_stdout(Tee()):
                result = train(action, training, validation, output, checkpoint)
            return result_envelope(
                request["run_id"],
                [result, output / "telemetry.jsonl", output / "box-head-delta.json"],
                stdout=capture.getvalue()[-262144:],
            )
    finally:
        for key, value in previous.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value


if modal is not None:
    app = modal.App(APP_NAME)
    volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=False)
    image = (
        modal.Image.debian_slim(python_version="3.12")
        .apt_install("ffmpeg", "libgl1", "libglib2.0-0")
        .pip_install(
            "numpy==2.2.3",
            "opencv-python-headless==4.11.0.86",
            "PyYAML==6.0.2",
            "scipy==1.15.2",
            "torch==2.6.0",
            "torchvision==0.21.0",
        )
        .add_local_python_source("modelforge_workbench", copy=True)
        .add_local_dir(str(Path(__file__).resolve().parent), remote_path=REMOTE_PROJECT_ROOT, copy=True)
    )
    run_box_head_training = app.function(image=image, volumes={INPUT_ROOT: volume}, **RESOURCE_PLAN)(
        modal.concurrent(max_inputs=1)(run_box_head_training)
    )
else:
    app = None
