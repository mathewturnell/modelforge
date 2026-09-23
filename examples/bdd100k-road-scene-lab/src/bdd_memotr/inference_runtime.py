# SPDX-License-Identifier: MIT AND Apache-2.0
"""MeMOTR submission flow adapted to a bounded ModelForge inference action.

The model/tracker/post-processing flow follows MeMOTR revision
``eb7a177b9cbcb89742ec69b2545ab3af2ea31a80``. ModelForge added selected-video
input, frame bounds, progress, evidence, and typed result integration. See the
adjacent ``PROVENANCE.md`` and repository ``THIRD_PARTY_NOTICES``. Upstream
material is under the reproduced MIT terms; ModelForge-authored changes remain
licensed under Apache-2.0 by the confirmed publishing rights holder.
"""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

from .contract import validate_contract
from .mapping import NATIVE_CLASSES, map_native_predictions
from .inference_helpers import install_msda_import_stub, load_checkpoint, patch_reference_msda


RESULT_FORMAT = "modelforge.inference-result/v1"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _output_directory(value: str) -> Path:
    declared = Path(value)
    if not declared.is_absolute() or declared.is_symlink():
        raise ValueError("ModelForge output directory must be an existing absolute directory")
    output = declared.resolve()
    if not output.is_dir():
        raise ValueError("ModelForge output directory does not exist")
    return output


def _selected_video(dataset_root: str, artifact: str) -> Path:
    dataset = Path(dataset_root).expanduser().resolve()
    if not dataset.is_dir() or dataset.is_symlink():
        raise ValueError("Selected inference dataset is unavailable")
    video = Path(artifact).expanduser().resolve()
    if (
        not video.is_file()
        or video.is_symlink()
        or not video.is_relative_to(dataset)
        or video.suffix.casefold() != ".mp4"
    ):
        raise ValueError("Selected inference target must be a regular MP4 in the selected dataset")
    return video


def _cuda_device(torch, requested: str):
    value = str(requested or "auto").strip().casefold()
    if value in {"auto", "gpu", "cuda"}:
        value = "cuda"
    elif value.isdigit():
        value = f"cuda:{value}"
    if not value.startswith("cuda") or not torch.cuda.is_available():
        raise RuntimeError("Official MeMOTR selected-video inference requires a CUDA device")
    return torch.device(value)


def _load_model(requested_device: str, checkpoint_path: Path):
    try:
        import torch
        import yaml
    except ImportError as exc:  # pragma: no cover - managed environment evidence
        raise RuntimeError(f"MeMOTR managed dependency is unavailable: {exc}") from exc

    contract = validate_contract(hash_bytes=True)
    registered_checkpoint = Path(contract["artifact"]["runtime_path"]).resolve()
    if checkpoint_path.resolve() != registered_checkpoint:
        raise ValueError("Selected checkpoint is not the registered MeMOTR artifact")
    device = _cuda_device(torch, requested_device)

    source_root = Path(contract["source"]["runtime_root"]).resolve()
    if not source_root.is_dir():
        raise ValueError("Pinned MeMOTR source root is unavailable")
    if str(source_root) not in sys.path:
        sys.path.insert(0, str(source_root))
    install_msda_import_stub()

    from models import build_model
    import models.backbone as backbone_module
    from models.runtime_tracker import RuntimeTracker
    from models.utils import get_model
    from structures.track_instances import TrackInstances
    from utils.box_ops import box_cxcywh_to_xyxy
    from utils.nested_tensor import tensor_list_to_nested_tensor

    patch_reference_msda(torch)
    upstream_resnet50 = backbone_module.resnet50

    def offline_resnet50(*_args, **kwargs):
        kwargs["weights"] = None
        return upstream_resnet50(**kwargs)

    backbone_module.resnet50 = offline_resnet50
    config = yaml.safe_load((source_root / "configs/train_bdd100k.yaml").read_text())
    config.update(
        {
            "AVAILABLE_GPUS": "0",
            "DEVICE": str(device),
            "USE_DISTRIBUTED": False,
            "USE_CHECKPOINT": False,
            "VISUALIZE": False,
            "DATASET": "BDD100K",
        }
    )
    checkpoint = load_checkpoint(torch, checkpoint_path)
    model = build_model(config=config)
    load_result = model.load_state_dict(checkpoint["model"], strict=True)
    if load_result.missing_keys or load_result.unexpected_keys:
        raise ValueError("Official MeMOTR checkpoint did not load strictly")
    delta_path = os.environ.get("MODELFORGE_MEMOTR_DELTA_PATH", "")
    if delta_path:
        from .adaptation import apply_delta
        apply_delta(torch, model, Path(delta_path), _sha256(checkpoint_path))
    model.to(device).eval()

    thresholds = contract["postprocessing"]
    tracker = RuntimeTracker(
        det_score_thresh=thresholds["det_score_threshold"],
        track_score_thresh=thresholds["track_score_threshold"],
        miss_tolerance=thresholds["miss_tolerance_frames"],
        use_motion=False,
        use_dab=True,
    )
    tracks = [TrackInstances(hidden_dim=get_model(model).hidden_dim, num_classes=8, use_dab=True).to(device)]
    helpers = {
        "get_model": get_model,
        "box_cxcywh_to_xyxy": box_cxcywh_to_xyxy,
        "tensor_list_to_nested_tensor": tensor_list_to_nested_tensor,
    }
    return torch, contract, device, model, tracker, tracks, helpers


def _preprocess(torch, bgr_frame, device):
    import cv2

    height, width = bgr_frame.shape[:2]
    rgb = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
    tensor = torch.from_numpy(rgb.copy()).permute(2, 0, 1).float().div_(255.0)
    scale = 800.0 / min(height, width)
    if max(height, width) * scale > 1536:
        scale = 1536.0 / max(height, width)
    target_height, target_width = int(height * scale), int(width * scale)
    tensor = torch.nn.functional.interpolate(
        tensor[None], size=(target_height, target_width), mode="bilinear", align_corners=False
    )[0]
    mean = torch.tensor([0.485, 0.456, 0.406], dtype=tensor.dtype)[:, None, None]
    std = torch.tensor([0.229, 0.224, 0.225], dtype=tensor.dtype)[:, None, None]
    return ((tensor - mean) / std).to(device)


def _track_color(track_id: str) -> tuple[int, int, int]:
    digest = hashlib.sha256(str(track_id).encode("utf-8")).digest()
    return tuple(80 + int(channel) % 176 for channel in digest[:3])


def _draw_predictions(frame, rows: list[dict]) -> None:
    import cv2

    height, width = frame.shape[:2]
    for row in rows:
        x, y, box_width, box_height = row["bbox"]
        x1 = max(0, min(width - 1, int(round(x))))
        y1 = max(0, min(height - 1, int(round(y))))
        x2 = max(0, min(width - 1, int(round(x + box_width))))
        y2 = max(0, min(height - 1, int(round(y + box_height))))
        if x2 <= x1 or y2 <= y1:
            continue
        color = _track_color(row["track_id"])
        label = f"{row['native_class']} ID {row['track_id']} {row['score']:.2f}"
        cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2, cv2.LINE_AA)
        (text_width, text_height), baseline = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.45, 1)
        text_top = max(0, y1 - text_height - baseline - 4)
        cv2.rectangle(
            frame,
            (x1, text_top),
            (min(width - 1, x1 + text_width + 6), y1),
            color,
            thickness=-1,
        )
        cv2.putText(
            frame,
            label,
            (x1 + 3, max(text_height + 1, y1 - baseline - 2)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.45,
            (15, 15, 15),
            1,
            cv2.LINE_AA,
        )


def _start_encoder(output: Path, width: int, height: int, fps: float):
    command = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "bgr24",
        "-s:v",
        f"{width}x{height}",
        "-r",
        f"{fps:.8f}",
        "-i",
        "pipe:0",
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        str(output),
    ]
    return subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def run_selected_video(
    dataset_root: str,
    artifact: str,
    checkpoint: str,
    output_directory: str,
    requested_device: str = "auto",
    max_frames: int = 0,
) -> Path:
    import cv2
    import torch as imported_torch

    output = _output_directory(output_directory)
    source_video = _selected_video(dataset_root, artifact)
    checkpoint_path = Path(checkpoint).expanduser().resolve()
    torch, contract, device, model, tracker, tracks, helpers = _load_model(requested_device, checkpoint_path)
    if torch is not imported_torch:
        raise RuntimeError("MeMOTR runtime loaded an inconsistent PyTorch module")

    capture = cv2.VideoCapture(str(source_video))
    if not capture.isOpened():
        raise ValueError("Selected MP4 could not be decoded")
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    fps = float(capture.get(cv2.CAP_PROP_FPS))
    total = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    if max_frames < 0:
        capture.release()
        raise ValueError("Maximum frame count cannot be negative")
    if max_frames:
        total = min(total, max_frames) if total else max_frames
    if width <= 0 or height <= 0:
        capture.release()
        raise ValueError("Selected MP4 has invalid dimensions")
    if fps <= 0:
        fps = 5.0

    video_path = output / "result.mp4"
    manifest_path = output / "manifest.json"
    envelope_path = output / "result.json"
    encoder = _start_encoder(video_path, width, height, fps)
    if encoder.stdin is None or encoder.stderr is None:  # pragma: no cover - Popen contract
        capture.release()
        raise RuntimeError("Could not start the MP4 encoder")

    thresholds = contract["postprocessing"]
    frame_records: list[dict] = []
    frame_number = 0
    torch.backends.cuda.matmul.allow_tf32 = False
    torch.backends.cudnn.allow_tf32 = False
    try:
        with torch.inference_mode():
            while True:
                decoded, bgr_frame = capture.read()
                if not decoded:
                    break
                frame_number += 1
                image = _preprocess(torch, bgr_frame, device)
                nested = helpers["tensor_list_to_nested_tensor"]([image]).to(device)
                outputs = model(frame=nested, tracks=tracks)
                previous_tracks, new_tracks = tracker.update(model_outputs=outputs, tracks=tracks)
                tracks = helpers["get_model"](model).postprocess_single_frame(previous_tracks, new_tracks, None)
                current = tracks[0].to(torch.device("cpu"))
                native_rows = []
                if len(current):
                    scores, labels = current.scores.max(dim=-1)
                    xyxy = helpers["box_cxcywh_to_xyxy"](current.boxes)
                    xyxy = xyxy * torch.tensor([width, height, width, height], dtype=xyxy.dtype)
                    for index in range(len(current)):
                        x1, y1, x2, y2 = xyxy[index].tolist()
                        box_width, box_height = x2 - x1, y2 - y1
                        native_index = int(labels[index].item())
                        score = float(scores[index].item())
                        if score <= thresholds["result_score_threshold"]:
                            continue
                        if box_width * box_height <= thresholds["minimum_area_pixels"]:
                            continue
                        native_rows.append(
                            {
                                "track_id": str(int(current.ids[index].item())),
                                "bbox": [x1, y1, box_width, box_height],
                                "score": score,
                                "native_class_index": native_index,
                                "native_class": NATIVE_CLASSES[native_index],
                            }
                        )
                mapped = map_native_predictions(native_rows)
                frame_records.append(
                    {
                        "frame_index": frame_number - 1,
                        "timestamp_seconds": (frame_number - 1) / fps,
                        "predictions": mapped,
                    }
                )
                _draw_predictions(bgr_frame, mapped)
                encoder.stdin.write(bgr_frame.tobytes())
                if frame_number == 1 or frame_number % 10 == 0 or (total and frame_number == total):
                    percent = min(99.0, 100.0 * frame_number / total) if total else 0.0
                    print(
                        "[MODELFORGE_PROGRESS] "
                        + json.dumps(
                            {
                                "stage": "inference",
                                "completed": frame_number,
                                "total": total,
                                "percent": round(percent, 2),
                            }
                        ),
                        flush=True,
                    )
                if max_frames and frame_number >= max_frames:
                    break
        if frame_number == 0:
            raise ValueError("Selected MP4 contains no decodable frames")
        encoder.stdin.close()
        encoder_error = encoder.stderr.read().decode("utf-8", errors="replace").strip()
        return_code = encoder.wait()
        if return_code != 0:
            raise RuntimeError(f"MP4 encoder failed: {encoder_error or return_code}")
    except Exception:
        if encoder.poll() is None:
            encoder.terminate()
            encoder.wait(timeout=10)
        video_path.unlink(missing_ok=True)
        raise
    finally:
        capture.release()

    source_sha = _sha256(source_video)
    source_relative = source_video.relative_to(Path(dataset_root).expanduser().resolve()).as_posix()
    prediction_evidence = {
        "format": "modelforge.mot-predictions/v1",
        "source_video": source_video.name,
        "source_artifact_path": source_relative,
        "source_artifact_sha256": source_sha,
        "source_video_sha256": source_sha,
        "frames": frame_number,
        "fps": fps,
        "native_classes": list(NATIVE_CLASSES),
        "compatibility_mapping": contract["compatibility_mapping"],
        "frame_records": frame_records,
    }
    predictions_sha = hashlib.sha256(
        json.dumps(prediction_evidence, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    video_sha = _sha256(video_path)
    artifact_id = os.environ.get("MODELFORGE_MODEL_ARTIFACT_ID", contract["artifact"]["registry_id"])
    checkpoint_sha = os.environ.get("MODELFORGE_MODEL_ARTIFACT_SHA256", contract["artifact"]["sha256"]).casefold()
    if artifact_id != contract["artifact"]["registry_id"] or checkpoint_sha != contract["artifact"]["sha256"]:
        raise ValueError("ModelForge selected a model artifact that does not match the MeMOTR contract")

    manifest = {
        "format": "modelforge.inference-manifest/v1",
        "artifact_id": artifact_id,
        "source_checkpoint_sha256": checkpoint_sha,
        "source_predictions_sha256": predictions_sha,
        "source_video": source_video.name,
        "source_artifact_path": source_relative,
        "source_artifact_sha256": source_sha,
        "source_video_sha256": source_sha,
        "video_sha256": video_sha,
        "frames": frame_number,
        "fps": fps,
        "duration_seconds": frame_number / fps,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "prediction_evidence": prediction_evidence,
    }
    delta_path = os.environ.get("MODELFORGE_MEMOTR_DELTA_PATH", "")
    if delta_path:
        manifest["adaptation_sha256"] = _sha256(Path(delta_path))
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    envelope = {
        "format": RESULT_FORMAT,
        "reuse_existing": False,
        "input_artifact": {
            "path": source_relative,
            "sha256": source_sha,
        },
        "model_artifact": {"id": artifact_id, "sha256": checkpoint_sha},
        "results": [
            {
                "role": "primary",
                "kind": "video",
                "path": video_path.name,
                "mime_type": "video/mp4",
                "sha256": video_sha,
                "manifest_path": manifest_path.name,
                "manifest_sha256": _sha256(manifest_path),
                "frames": frame_number,
                "fps": fps,
                "duration_seconds": frame_number / fps,
            }
        ],
    }
    if delta_path:
        envelope["adaptation_artifact"] = {"sha256": _sha256(Path(delta_path)), "parent_sha256": checkpoint_sha}
    temporary = output / ".result.json.tmp"
    temporary.write_text(json.dumps(envelope, indent=2) + "\n", encoding="utf-8")
    temporary.replace(envelope_path)
    print(
        "[MODELFORGE_PROGRESS] "
        + json.dumps(
            {
                "stage": "complete",
                "completed": frame_number,
                "total": frame_number,
                "percent": 100.0,
                "result": envelope_path.name,
            }
        ),
        flush=True,
    )
    return envelope_path
