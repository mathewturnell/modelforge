from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import types
from pathlib import Path

from .mot import MotRow, discover_sequences, load_sequence, parse_mot_rows, write_mot_rows
from .tracker import SmokeTrackQueryModel, detect_components


COLORS = ((255, 70, 70), (70, 130, 255), (255, 215, 60), (255, 255, 255), (255, 100, 220))
RESULT_FORMAT = "modelforge.inference-result/v1"
MANIFEST_FORMAT = "soccernet-motr-inference-manifest/v1"
SHA256_PATTERN = re.compile(r"[0-9a-f]{64}")


def _install_reference_msda() -> None:
    """Use upstream MOTR's checked-in PyTorch inference kernel without modifying it."""

    module = types.ModuleType("MultiScaleDeformableAttention")

    def forward(value, spatial_shapes, _level_start, locations, weights, _step):
        implementation = sys.modules.get("models.ops.functions.ms_deform_attn_func")
        if implementation is None:
            raise RuntimeError("MOTR reference deformable-attention module is unavailable")
        return implementation.ms_deform_attn_core_pytorch(
            value, spatial_shapes, locations, weights,
        )

    def backward(*_args):
        raise RuntimeError("MOTR reference deformable attention is inference-only")

    module.ms_deform_attn_forward = forward
    module.ms_deform_attn_backward = backward
    sys.modules["MultiScaleDeformableAttention"] = module


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _regular_output_file(output: Path, relative_path: object, label: str) -> Path:
    if not isinstance(relative_path, str) or not relative_path or Path(relative_path).is_absolute():
        raise ValueError(f"{label} must be a non-empty path relative to the result directory")
    root = output.resolve()
    candidate = output / relative_path
    resolved = candidate.resolve()
    if not resolved.is_relative_to(root) or candidate.is_symlink() or not candidate.is_file():
        raise ValueError(f"{label} is missing, is a symlink, or escapes the result directory")
    return candidate


def _selected_model_artifact(checkpoint_path: Path, artifact_id: str | None, artifact_sha256: str | None) -> tuple[str, str]:
    artifact_id = artifact_id or os.environ.get("MODELFORGE_MODEL_ARTIFACT_ID")
    artifact_sha256 = artifact_sha256 or os.environ.get("MODELFORGE_MODEL_ARTIFACT_SHA256")
    if not artifact_id:
        raise ValueError("MODELFORGE_MODEL_ARTIFACT_ID is required")
    if not artifact_sha256 or SHA256_PATTERN.fullmatch(artifact_sha256) is None:
        raise ValueError("MODELFORGE_MODEL_ARTIFACT_SHA256 must be a lowercase 64-character SHA-256")
    actual_sha256 = _sha256(checkpoint_path)
    if actual_sha256 != artifact_sha256:
        raise ValueError("Selected checkpoint SHA-256 does not match MODELFORGE_MODEL_ARTIFACT_SHA256")
    return artifact_id, artifact_sha256


def validate_existing_result(result_path: Path) -> Path:
    payload = json.loads(result_path.read_text(encoding="utf-8"))
    if payload.get("format") != RESULT_FORMAT:
        raise ValueError(f"Unsupported inference result protocol: {result_path}")
    model_artifact = payload.get("model_artifact")
    if not isinstance(model_artifact, dict) or not model_artifact.get("id"):
        raise ValueError("Inference result is missing the selected model artifact id")
    checkpoint_sha256 = model_artifact.get("sha256")
    if not isinstance(checkpoint_sha256, str) or SHA256_PATTERN.fullmatch(checkpoint_sha256) is None:
        raise ValueError("Inference result has an invalid model artifact SHA-256")
    results = payload.get("results")
    if not isinstance(results, list) or len(results) != 1:
        raise ValueError("Inference result must contain exactly one result")
    primary = results[0]
    if primary.get("role") != "primary" or primary.get("kind") != "video" or primary.get("mime_type") != "video/mp4":
        raise ValueError("Inference result must contain one primary MP4 video")
    artifact = _regular_output_file(result_path.parent, primary.get("path"), "Primary video")
    if _sha256(artifact) != primary.get("sha256"):
        raise ValueError("Primary artifact SHA-256 does not match result.json")
    manifest_path = _regular_output_file(result_path.parent, primary.get("manifest_path"), "Primary video manifest")
    if _sha256(manifest_path) != primary.get("manifest_sha256"):
        raise ValueError("Manifest SHA-256 does not match result.json")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    expected_bindings = {
        "artifact_id": model_artifact["id"],
        "source_checkpoint_sha256": checkpoint_sha256,
        "video_sha256": primary["sha256"],
    }
    for key, expected in expected_bindings.items():
        if manifest.get(key) != expected:
            raise ValueError(f"Manifest {key} does not match result.json")
    predictions_sha256 = manifest.get("source_predictions_sha256")
    if not isinstance(predictions_sha256, str) or SHA256_PATTERN.fullmatch(predictions_sha256) is None:
        raise ValueError("Manifest has an invalid source predictions SHA-256")
    predictions = manifest.get("predictions")
    if not isinstance(predictions, dict) or predictions.get("sha256") != predictions_sha256:
        raise ValueError("Manifest prediction evidence does not match its source predictions SHA-256")
    predictions_path = _regular_output_file(result_path.parent, predictions.get("path"), "Source predictions")
    if _sha256(predictions_path) != predictions_sha256:
        raise ValueError("Source predictions SHA-256 does not match the manifest")
    return result_path


def write_inference_result(
    output: Path,
    checkpoint_path: Path,
    primary_video: Path,
    predictions_path: Path,
    *,
    model_artifact_id: str | None = None,
    model_artifact_sha256: str | None = None,
    frames: int | None = None,
    fps: float | None = None,
) -> Path:
    model_artifact_id, model_artifact_sha256 = _selected_model_artifact(
        checkpoint_path, model_artifact_id, model_artifact_sha256
    )
    root = output.resolve()
    video_resolved = primary_video.resolve()
    predictions_resolved = predictions_path.resolve()
    if (
        not video_resolved.is_relative_to(root)
        or primary_video.is_symlink()
        or not primary_video.is_file()
    ):
        raise ValueError("Primary video must be a regular non-symlink file beneath the output directory")
    if (
        not predictions_resolved.is_relative_to(root)
        or predictions_path.is_symlink()
        or not predictions_path.is_file()
    ):
        raise ValueError("Source predictions must be a regular non-symlink file beneath the output directory")
    video_relative = video_resolved.relative_to(root).as_posix()
    predictions_relative = predictions_resolved.relative_to(root).as_posix()
    video_sha256 = _sha256(primary_video)
    predictions_sha256 = _sha256(predictions_path)
    manifest = {
        "format": MANIFEST_FORMAT,
        "artifact_id": model_artifact_id,
        "source_checkpoint_sha256": model_artifact_sha256,
        "source_predictions_sha256": predictions_sha256,
        "video_sha256": video_sha256,
        "predictions": {
            "path": predictions_relative,
            "sha256": predictions_sha256,
        },
    }
    manifest_path = primary_video.with_suffix(".manifest.json")
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    manifest_relative = manifest_path.resolve().relative_to(root).as_posix()
    primary_result = {
        "role": "primary",
        "kind": "video",
        "path": video_relative,
        "mime_type": "video/mp4",
        "sha256": video_sha256,
        "manifest_path": manifest_relative,
        "manifest_sha256": _sha256(manifest_path),
    }
    if frames is not None and fps is not None:
        if frames <= 0 or fps <= 0:
            raise ValueError("Video frames and FPS must be positive")
        primary_result.update({
            "frames": frames,
            "fps": fps,
            "duration_seconds": frames / fps,
        })
    result = {
        "format": RESULT_FORMAT,
        "model_artifact": {
            "id": model_artifact_id,
            "sha256": model_artifact_sha256,
        },
        "results": [primary_result],
    }
    result_path = output / "result.json"
    result_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    return result_path


def _render(sequence, predictions: list[MotRow], target: Path) -> None:
    from PIL import Image, ImageDraw

    rows_by_frame: dict[int, list[MotRow]] = {}
    for row in predictions:
        rows_by_frame.setdefault(row.frame, []).append(row)
    frame_dir = target.parent / "rendered_frames"
    if frame_dir.exists():
        shutil.rmtree(frame_dir)
    frame_dir.mkdir(parents=True)
    max_frames = max(0, int(os.environ.get("MODELFORGE_MAX_FRAMES", "0") or 0))
    final_frame = min(sequence.length, max_frames) if max_frames else sequence.length
    for frame in range(1, final_frame + 1):
        with Image.open(sequence.image_path(frame)).convert("RGB") as image:
            draw = ImageDraw.Draw(image)
            for row in rows_by_frame.get(frame, []):
                color = COLORS[(row.track_id - 1) % len(COLORS)]
                draw.rectangle((row.x, row.y, row.x + row.width, row.y + row.height), outline=color, width=2)
                draw.text((row.x + 1, max(0, row.y - 10)), f"q{row.track_id}", fill=color)
            image.save(frame_dir / f"{frame:06d}.png")
    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-framerate", str(sequence.frame_rate),
        "-i", str(frame_dir / "%06d.png"), "-c:v", "libx264",
    ]
    output_width = max(0, int(os.environ.get("MODELFORGE_OUTPUT_MAX_WIDTH", "0") or 0))
    if output_width:
        command.extend(("-vf", f"scale=min({output_width}\\,iw):-2"))
    command.extend((
        "-crf", os.environ.get("MODELFORGE_FFMPEG_CRF", "23"),
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(target),
    ))
    subprocess.run(command, check=True)


def _stage_upstream_sequence(sequence, staging_sequence: Path, max_frames: int) -> None:
    """Expose either a bounded copy or the complete sequence to clean upstream MOTR."""

    if staging_sequence.exists() or staging_sequence.is_symlink():
        if staging_sequence.is_symlink() or staging_sequence.is_file():
            staging_sequence.unlink()
        else:
            shutil.rmtree(staging_sequence)
    if not max_frames:
        staging_sequence.symlink_to(sequence.root, target_is_directory=True)
        return
    if not 1 <= max_frames <= min(sequence.length, 24):
        raise ValueError("Cloud MOTR inference requires a bound from one to 24 existing frames")
    image_dir = staging_sequence / sequence.image_dir.name
    image_dir.mkdir(parents=True)
    for frame in range(1, max_frames + 1):
        source = sequence.image_path(frame)
        if source.is_symlink() or not source.is_file():
            raise ValueError("SoccerNet staged input contains an unsafe frame")
        shutil.copyfile(source, image_dir / source.name)
    seqinfo = (sequence.root / "seqinfo.ini").read_text(encoding="utf-8")
    seqinfo, replacements = re.subn(
        r"(?im)^seqLength\s*=\s*\d+\s*$",
        f"seqLength={max_frames}",
        seqinfo,
    )
    if replacements != 1:
        raise ValueError("SoccerNet seqinfo.ini must declare exactly one sequence length")
    (staging_sequence / "seqinfo.ini").write_text(seqinfo, encoding="utf-8")


def build_upstream_submit_arguments(
    dataset: Path, checkpoint_path: Path, output: Path, sequence_name: str,
) -> list[str]:
    """Build the pinned MOTR configuration used by the official inference adapter."""
    staging_root = output / ".upstream-input"
    return [
        "--meta_arch", "motr", "--dataset_file", "e2e_joint",
        "--with_box_refine", "--lr_drop", "100", "--lr", "2e-4",
        "--lr_backbone", "2e-5", "--pretrained", str(checkpoint_path),
        "--output_dir", str(output / "upstream"), "--batch_size", "1",
        "--sample_mode", "random_interval", "--sample_interval", "10",
        "--sampler_steps", "50", "90", "150",
        "--sampler_lengths", "2", "3", "4", "5", "--update_query_pos",
        "--merger_dropout", "0", "--dropout", "0", "--random_drop", "0.1",
        "--fp_ratio", "0.3", "--query_interaction_layer", "QIM",
        "--extra_track_attn", "--resume", str(checkpoint_path),
        "--mot_path", str(staging_root), "--exp_name", "predictions",
        "--device", "cuda",
    ]


def _official_sequence(dataset: Path, sample_index: int, sequence_path: Path | None = None):
    report = dataset / "adapter_report.json"
    images_root = dataset / "MOT17-SoccerNet" / "images"
    test_root = images_root / "test"
    if not report.is_file() or not test_root.is_dir():
        raise ValueError(
            "A non-smoke checkpoint requires the selected official SoccerNet MOTR adapter"
        )
    evidence = json.loads(report.read_text(encoding="utf-8"))
    if evidence.get("format") != "soccernet-to-motr-adapter/v1" or evidence.get("synthetic") is not False:
        raise ValueError("Official MOTR inference refuses synthetic or unverified dataset evidence")
    if sequence_path is not None:
        unresolved = sequence_path.expanduser()
        selected = unresolved.resolve()
        if unresolved.is_symlink() or not selected.is_dir() or not selected.is_relative_to(images_root.resolve()):
            raise ValueError("Selected sequence must be a regular directory in the official SoccerNet image splits")
        relative = selected.relative_to(images_root.resolve())
        registered = {
            (str(item.get("split") or ""), str(item.get("sequence") or ""))
            for item in evidence.get("sequences", []) if isinstance(item, dict)
        }
        if len(relative.parts) != 2 or tuple(relative.parts) not in registered:
            raise ValueError("Selected sequence is not registered by the official SoccerNet adapter")
        return load_sequence(selected, require_gt=False, invalid_box_policy="drop")
    sequences = discover_sequences(test_root, require_gt=False)
    if not 0 <= sample_index < len(sequences):
        raise ValueError(f"Sample index must be between 0 and {len(sequences) - 1}")
    return sequences[sample_index]


def _run_upstream_motr(
    dataset: Path, checkpoint_path: Path, output: Path, sample_index: int,
    sequence_path: Path | None = None,
) -> tuple[Path, Path, int, float]:
    """Run one real official sequence through the pinned upstream MOTR implementation."""
    try:
        import torch
    except ImportError as exc:
        raise RuntimeError("Official MOTR inference requires the project CUDA environment") from exc
    if not torch.cuda.is_available():
        raise RuntimeError(
            "Official MOTR inference requires CUDA. Choose Cloud GPU or a CUDA workstation; "
            "the smoke tracker will not be substituted."
        )
    sequence = _official_sequence(dataset, sample_index, sequence_path)
    project = Path(__file__).resolve().parents[2]
    upstream = Path(os.environ.get("MODELFORGE_MOTR_SOURCE_ROOT", project / "vendor" / "MOTR")).resolve()
    if not (upstream / "submit.py").is_file():
        raise RuntimeError("The pinned upstream MOTR source is missing from vendor/MOTR")
    output.mkdir(parents=True, exist_ok=True)
    staging_sequence = output / ".upstream-input" / "MOT17" / "images" / "test" / sequence.name
    staging_sequence.parent.mkdir(parents=True, exist_ok=True)
    max_frames = max(0, int(os.environ.get("MODELFORGE_MAX_FRAMES", "0") or 0))
    _stage_upstream_sequence(sequence, staging_sequence, max_frames)
    arguments = build_upstream_submit_arguments(dataset, checkpoint_path, output, sequence.name)
    original_path = list(sys.path)
    sys.path.insert(0, str(upstream))
    try:
        _install_reference_msda()
        from main import get_args_parser
        from models import build_model
        from submit import Detector
        from util.tool import load_model

        args = get_args_parser().parse_args(arguments)
        model, _, _ = build_model(args)
        model = load_model(model, str(checkpoint_path))
        model.eval()
        model = model.cuda()
        Detector(args, model=model, seq_num=sequence.name).detect()
    finally:
        sys.path[:] = original_path
    upstream_predictions = output / "upstream" / "predictions" / f"{sequence.name}.txt"
    if not upstream_predictions.is_file():
        raise RuntimeError("Pinned upstream MOTR exited without sequence predictions")
    predictions_path = output / f"{sequence.name}.txt"
    shutil.copy2(upstream_predictions, predictions_path)
    primary_video = output / f"{sequence.name}.mp4"
    _render(sequence, parse_mot_rows(predictions_path), primary_video)
    processed_frames = min(sequence.length, max_frames) if max_frames else sequence.length
    return primary_video, predictions_path, processed_frames, float(sequence.frame_rate)


def infer(
    dataset: Path,
    checkpoint_path: Path,
    output: Path,
    split: str,
    execution_target: str,
    *,
    sample_index: int = 0,
    sequence_path: Path | None = None,
    model_artifact_id: str | None = None,
    model_artifact_sha256: str | None = None,
) -> Path:
    model_artifact_id, model_artifact_sha256 = _selected_model_artifact(
        checkpoint_path, model_artifact_id, model_artifact_sha256
    )
    checkpoint = None
    try:
        loaded = json.loads(checkpoint_path.read_text(encoding="utf-8"))
        checkpoint = loaded if isinstance(loaded, dict) else None
    except (UnicodeDecodeError, json.JSONDecodeError):
        checkpoint = None
    if checkpoint is None or checkpoint.get("format") != "soccernet-motr-smoke-checkpoint/v1":
        primary_video, predictions_path, frames, fps = _run_upstream_motr(
            dataset, checkpoint_path, output, sample_index, sequence_path,
        )
        return write_inference_result(
            output, checkpoint_path, primary_video, predictions_path,
            model_artifact_id=model_artifact_id,
            model_artifact_sha256=model_artifact_sha256,
            frames=frames,
            fps=fps,
        )
    if (dataset / "adapter_report.json").is_file():
        raise ValueError(
            "A smoke checkpoint cannot run against the official dataset; train or select a real MOTR checkpoint"
        )
    sequences = discover_sequences(dataset, split, require_gt=False)
    output.mkdir(parents=True, exist_ok=True)
    all_results: list[dict] = []
    primary_video: Path | None = None
    for sequence in sequences:
        model = SmokeTrackQueryModel([tuple(value) for value in checkpoint["color_prototypes"]], checkpoint["color_threshold"])
        predictions: list[MotRow] = []
        for frame in range(1, sequence.length + 1):
            detections = detect_components(sequence.image_path(frame), model.prototypes, model.threshold)
            for query in model.update(detections):
                detection = query.detection
                predictions.append(MotRow(frame, query.track_id, detection.x, detection.y, detection.width, detection.height, detection.score))
        track_file = output / f"{sequence.name}.txt"
        write_mot_rows(track_file, predictions)
        video = output / f"{sequence.name}.mp4"
        _render(sequence, predictions, video)
        primary_video = primary_video or video
        all_results.append({"sequence": sequence.name, "frames": sequence.length, "predictions": len(predictions), "tracks": len({row.track_id for row in predictions}), "mot_result": track_file.name, "video": video.name})
    assert primary_video is not None
    primary_sequence = all_results[0]
    predictions_path = output / primary_sequence["mot_result"]
    return write_inference_result(
        output,
        checkpoint_path,
        primary_video,
        predictions_path,
        model_artifact_id=model_artifact_id,
        model_artifact_sha256=model_artifact_sha256,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run pinned MOTR inference and emit a native video artifact")
    parser.add_argument("--dataset", type=Path, default=Path("datasets/smoke"))
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--split", default="val")
    parser.add_argument("--sample-index", type=int, default=0)
    parser.add_argument("--sequence-path", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--reuse-existing", action="store_true", help="Validate an existing native result instead of rerunning inference")
    parser.add_argument("--execution-target", choices=("local", "cloud"), default=os.environ.get("MODELFORGE_EXECUTION_TARGET", "local"))
    args = parser.parse_args(argv)
    existing = args.output / "result.json"
    result = validate_existing_result(existing) if args.reuse_existing and existing.is_file() else infer(
        args.dataset,
        args.checkpoint,
        args.output,
        args.split,
        args.execution_target,
        sample_index=args.sample_index,
        sequence_path=args.sequence_path,
    )
    print(result)
    return 0
