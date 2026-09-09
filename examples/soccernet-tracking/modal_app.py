# Copyright (C) 2026 Mathew Turnell
# SPDX-License-Identifier: LicenseRef-ModelForge-Pending

"""Fixed Modal deployment for bounded clean-upstream SoccerNet MOTR inference."""

from __future__ import annotations

import contextlib
import io
import json
import os
import re
import sys
import tarfile
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


APP_NAME = "modelforge-alpha-soccernet-inference"
FUNCTION_NAME = "run_soccernet_inference"
VOLUME_NAME = "modelforge-alpha-soccernet-inputs"
INPUT_ROOT = "/mnt/modelforge-inputs"
REMOTE_PROJECT_ROOT = "/opt/modelforge-example"
RESOURCE_PLAN = {
    "gpu": "L40S",
    "cpu": 8.0,
    "memory": 32_768,
    "timeout": 3_000,
    "startup_timeout": 1_800,
    "retries": 0,
    "max_containers": 1,
    "min_containers": 0,
}
MAX_FRAMES = 24
MAX_ARCHIVE_BYTES = 512 * 1024 * 1024
MAX_EXPANDED_BYTES = 512 * 1024 * 1024
MAX_ARCHIVE_MEMBERS = 64
_SEQUENCE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def _extract_bounded_dataset(archive: Path, destination: Path, *, split: str, sequence: str) -> Path:
    """Extract one content-bound 24-frame adapter tree without tar traversal."""

    if archive.stat().st_size > MAX_ARCHIVE_BYTES:
        raise ValueError("SoccerNet staged dataset archive exceeds 512 MiB")
    prefix = Path("MOT17-SoccerNet") / "images" / split / sequence
    allowed_metadata = {Path("adapter_report.json"), prefix / "seqinfo.ini"}
    allowed_frames = {
        prefix / "img1" / f"{frame:06d}{extension}"
        for frame in range(1, MAX_FRAMES + 1)
        for extension in (".jpg", ".jpeg", ".png")
    }
    seen_metadata: set[Path] = set()
    seen_frame_numbers: set[int] = set()
    seen_paths: set[Path] = set()
    total = 0
    with tarfile.open(archive, "r:*") as source:
        members = source.getmembers()
        if len(members) > MAX_ARCHIVE_MEMBERS:
            raise ValueError("SoccerNet staged dataset archive contains too many entries")
        for member in members:
            relative = Path(member.name)
            if relative.is_absolute() or ".." in relative.parts or relative.as_posix() != member.name.rstrip("/"):
                raise ValueError("SoccerNet staged dataset archive contains an unsafe path")
            if member.isdir():
                continue
            if not member.isfile() or relative not in allowed_metadata | allowed_frames:
                raise ValueError("SoccerNet staged dataset archive contains an unexpected entry")
            if relative in seen_paths:
                raise ValueError("SoccerNet staged dataset archive contains a duplicate entry")
            seen_paths.add(relative)
            total += member.size
            if member.size < 0 or total > MAX_EXPANDED_BYTES:
                raise ValueError("SoccerNet staged dataset archive exceeds its expanded byte bound")
            extracted = source.extractfile(member)
            if extracted is None:
                raise ValueError("SoccerNet staged dataset archive entry is unreadable")
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open("wb") as output:
                while chunk := extracted.read(1024 * 1024):
                    output.write(chunk)
            if relative in allowed_metadata:
                seen_metadata.add(relative)
            elif relative.parent == prefix / "img1":
                seen_frame_numbers.add(int(relative.stem))
    if seen_metadata != allowed_metadata or seen_frame_numbers != set(range(1, MAX_FRAMES + 1)):
        raise ValueError("SoccerNet staged dataset must contain its report, seqinfo, and exactly 24 frames")
    return destination


def _execute(payload: Mapping) -> dict:
    request = validate_request(
        payload,
        project_id="soccernet-tracking",
        action_id="inference",
        action_kind="inference",
    )
    action = request["request"]
    if (
        action.get("workflow") != "inference"
        or action.get("action_id") != "inference"
        or action.get("max_frames") != MAX_FRAMES
    ):
        raise ValueError("SoccerNet Modal inference is fixed to 24 staged frames")
    selection_asset = asset_by_id(request, "selected-sequence")
    dataset_asset = asset_by_id(request, "soccernet-dataset")
    checkpoint_asset = asset_by_id(request, "motr-checkpoint")
    source_asset = asset_by_id(request, "motr-source")
    if (
        selection_asset.get("sha256") != action.get("dataset_sample_sha256")
        or checkpoint_asset.get("sha256") != action.get("checkpoint_sha256")
        or checkpoint_asset.get("role") != "checkpoint"
    ):
        raise ValueError("SoccerNet request identities differ from its staged assets")
    selection_path = verified_asset(INPUT_ROOT, selection_asset, expected_role="input")
    dataset_archive = verified_asset(INPUT_ROOT, dataset_asset, expected_role="dataset")
    checkpoint = verified_asset(INPUT_ROOT, checkpoint_asset, expected_role="checkpoint")
    source = verified_asset(INPUT_ROOT, source_asset, expected_role="source")
    if selection_path.stat().st_size > 64 * 1024:
        raise ValueError("SoccerNet sequence selection is too large")
    selection = json.loads(selection_path.read_text(encoding="utf-8"))
    if not isinstance(selection, dict) or set(selection) != {"protocol", "split", "sequence", "max_frames"}:
        raise ValueError("SoccerNet sequence selection fields are invalid")
    if selection.get("protocol") != "modelforge.soccernet-sequence-selection/v1":
        raise ValueError("SoccerNet sequence selection protocol is unsupported")
    split, sequence_name = selection.get("split"), selection.get("sequence")
    if split != "train" or not isinstance(sequence_name, str) or not _SEQUENCE.fullmatch(sequence_name):
        raise ValueError("SoccerNet sequence selection identity is invalid")
    if selection.get("max_frames") != MAX_FRAMES or action.get("dataset_split") != split:
        raise ValueError("SoccerNet sequence selection differs from the durable request")
    project_root = Path(REMOTE_PROJECT_ROOT)
    sys.path.insert(0, str(project_root / "src"))
    from soccernet_motr.infer import infer

    environment = {
        "MODELFORGE_MODEL_ARTIFACT_ID": str(action.get("checkpoint_id") or "motr-checkpoint"),
        "MODELFORGE_MODEL_ARTIFACT_SHA256": str(checkpoint_asset["sha256"]),
        "MODELFORGE_MOTR_SOURCE_ROOT": str(source),
        "MODELFORGE_MAX_FRAMES": str(MAX_FRAMES),
        "MODELFORGE_OUTPUT_MAX_WIDTH": "640",
        "MODELFORGE_FFMPEG_CRF": "32",
        "MODELFORGE_EXECUTION_TARGET": "cloud",
        "MODELFORGE_NETWORK": "disabled",
    }
    prior = {name: os.environ.get(name) for name in environment}
    os.environ.update(environment)
    try:
        with tempfile.TemporaryDirectory(prefix="modelforge-soccernet-") as temporary:
            output = Path(temporary)
            dataset = _extract_bounded_dataset(
                dataset_archive,
                output / "dataset",
                split=split,
                sequence=sequence_name,
            )
            sequence = (dataset / "MOT17-SoccerNet" / "images" / split / sequence_name).resolve()
            captured = io.StringIO()
            with contextlib.redirect_stdout(captured):
                result = infer(
                    dataset,
                    checkpoint,
                    output,
                    split,
                    "cloud",
                    sequence_path=sequence,
                    model_artifact_id=str(action.get("checkpoint_id") or "motr-checkpoint"),
                    model_artifact_sha256=str(checkpoint_asset["sha256"]),
                )
            value = json.loads(result.read_text(encoding="utf-8"))
            primary = value["results"][0]
            manifest = output / primary["manifest_path"]
            manifest_value = json.loads(manifest.read_text(encoding="utf-8"))
            predictions = output / manifest_value["predictions"]["path"]
            files = [result, output / primary["path"], manifest, predictions]
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


def run_soccernet_inference(request: Mapping) -> dict:
    return _execute(request)


if modal is not None:
    _project_root = Path(__file__).resolve().parent
    app = modal.App(APP_NAME)
    input_volume = modal.Volume.from_name(VOLUME_NAME, create_if_missing=False)
    image = (
        modal.Image.debian_slim(python_version="3.12")
        .apt_install("build-essential", "ffmpeg", "git", "libgl1", "libglib2.0-0")
        .pip_install(
            "numpy==2.2.3",
            "opencv-python-headless==4.11.0.86",
            "Pillow==11.1.0",
            "scipy==1.15.2",
            "torch==2.6.0",
            "torchvision==0.21.0",
        )
        .add_local_python_source("modelforge_workbench")
        .add_local_dir(str(_project_root), remote_path=REMOTE_PROJECT_ROOT, copy=True)
    )
    run_soccernet_inference = app.function(
        image=image,
        volumes={INPUT_ROOT: input_volume},
        **RESOURCE_PLAN,
    )(modal.concurrent(max_inputs=1)(run_soccernet_inference))
else:
    app = image = input_volume = None


__all__ = ["app", "run_soccernet_inference"]
