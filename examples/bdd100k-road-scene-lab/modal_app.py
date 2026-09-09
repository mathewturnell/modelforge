# Copyright (C) 2026 Mathew Turnell
# SPDX-License-Identifier: LicenseRef-ModelForge-Pending

"""Fixed Modal deployment for bounded BDD100K selected-video inference."""

from __future__ import annotations

import contextlib
import io
import os
import sys
import tempfile
from pathlib import Path
from typing import Mapping

try:  # Modal is an explicit deployment extra, never an ordinary-test dependency.
    import modal
except ImportError:  # pragma: no cover - exercised by the no-SDK subprocess test
    modal = None

from modelforge_workbench.modal_worker import (
    asset_by_id,
    result_envelope,
    validate_request,
    verified_asset,
)


APP_NAME = "modelforge-alpha-bdd100k-inference"
FUNCTION_NAME = "run_bdd100k_inference"
VOLUME_NAME = "modelforge-alpha-bdd100k-inputs"
INPUT_ROOT = "/mnt/modelforge-inputs"
REMOTE_PROJECT_ROOT = "/opt/modelforge-example"
RESOURCE_PLAN = {
    "gpu": "L40S",
    "cpu": 4.0,
    "memory": 32_768,
    "timeout": 1_200,
    "startup_timeout": 1_200,
    "retries": 0,
    "max_containers": 1,
    "min_containers": 0,
}


def _execute(payload: Mapping) -> dict:
    request = validate_request(
        payload,
        project_id="bdd100k-road-scene-lab",
        action_id="inference",
        action_kind="inference",
    )
    action = request["request"]
    if (
        action.get("workflow") != "inference"
        or action.get("action_id") != "inference"
        or action.get("dataset_split") != "train"
        or action.get("max_frames") != 2
        or action.get("device") not in {"auto", "0", "cuda", "cuda:0"}
    ):
        raise ValueError("BDD100K Modal inference is fixed to two training-split CUDA frames")

    video_asset = asset_by_id(request, "selected-video")
    checkpoint_asset = asset_by_id(request, "memotr-checkpoint")
    source_asset = asset_by_id(request, "memotr-source")
    if (
        video_asset.get("sha256") != action.get("dataset_sample_sha256")
        or checkpoint_asset.get("sha256") != action.get("checkpoint_sha256")
        or checkpoint_asset.get("role") != "checkpoint"
    ):
        raise ValueError("BDD100K request identities differ from its staged assets")
    video = verified_asset(INPUT_ROOT, video_asset, expected_role="input")
    checkpoint = verified_asset(INPUT_ROOT, checkpoint_asset, expected_role="checkpoint")
    source = verified_asset(INPUT_ROOT, source_asset, expected_role="source")

    project_root = Path(REMOTE_PROJECT_ROOT)
    sys.path.insert(0, str(project_root / "src"))
    from bdd_memotr.inference_runtime import run_selected_video

    environment = {
        "MODELFORGE_MODEL_ARTIFACT_ID": str(action.get("checkpoint_id") or "memotr-checkpoint"),
        "MODELFORGE_MODEL_ARTIFACT_SHA256": str(checkpoint_asset["sha256"]),
        "MODELFORGE_MODEL_ARTIFACT_PATH": str(checkpoint),
        "MODELFORGE_MEMOTR_SOURCE_ROOT": str(source),
        "HF_HUB_OFFLINE": "1",
        "TRANSFORMERS_OFFLINE": "1",
        "MODELFORGE_NETWORK": "disabled",
    }
    prior = {name: os.environ.get(name) for name in environment}
    os.environ.update(environment)
    try:
        with tempfile.TemporaryDirectory(prefix="modelforge-bdd100k-") as temporary:
            output = Path(temporary)
            captured = io.StringIO()
            with contextlib.redirect_stdout(captured):
                result = run_selected_video(
                    dataset_root=str(video.parent),
                    artifact=str(video),
                    checkpoint=str(checkpoint),
                    output_directory=str(output),
                    requested_device="cuda:0",
                    max_frames=2,
                )
            value = __import__("json").loads(result.read_text(encoding="utf-8"))
            primary = value["results"][0]
            files = [result, output / primary["path"], output / primary["manifest_path"]]
            return result_envelope(
                request["run_id"],
                files,
                stdout=captured.getvalue()[-262_144:],
            )
    finally:
        for name, value in prior.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


def run_bdd100k_inference(request: Mapping) -> dict:
    return _execute(request)


if modal is not None:
    _project_root = Path(__file__).resolve().parent
    app = modal.App(APP_NAME)
    input_volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=False)
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
        .add_local_dir(str(_project_root), remote_path=REMOTE_PROJECT_ROOT, copy=True)
    )
    run_bdd100k_inference = app.function(
        image=image,
        volumes={INPUT_ROOT: input_volume},
        **RESOURCE_PLAN,
    )(modal.concurrent(max_inputs=1)(run_bdd100k_inference))
else:  # import-safe source inspection without the optional provider SDK
    app = image = input_volume = None


__all__ = ["app", "run_bdd100k_inference"]
