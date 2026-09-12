"""Deterministic, redistributable worker for public browser conformance journeys.

No named-project dependency, upstream dataset, model, provider, or paid compute is
loaded. The outputs are authored test evidence for the shared public contracts.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path


parser = argparse.ArgumentParser()
parser.add_argument("--task", choices=("training", "inference", "prompt"), default="inference")
parser.add_argument("--request")
parser.add_argument("--output")
parser.add_argument("--dataset-root")
parser.add_argument("--artifact")
parser.add_argument("--checkpoint")
parser.add_argument("--output-dir")
parser.add_argument("--device")
parser.add_argument("--max-frames")
parser.add_argument(
    "--fixture-kind",
    choices=("bdd100k", "soccernet", "tastematch", "qwen", "vision", "table"),
    default="bdd100k",
)
args = parser.parse_args()


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def progress(stage: str, percent: int) -> None:
    print(
        "[MODELFORGE_PROGRESS] "
        + json.dumps({"stage": stage, "percent": percent}, separators=(",", ":")),
        flush=True,
    )


def result_item(path: Path, kind: str, content_type: str, *, role: str = "primary") -> dict:
    return {
        "role": role,
        "kind": kind,
        "path": path.name,
        "mime_type": content_type,
        "sha256": digest(path),
    }


def run_prompt() -> None:
    request = json.loads(Path(args.request).read_text(encoding="utf-8"))
    message = request["messages"][-1]["content"]
    print("Synthetic Qwen-shaped prompt fixture started; no model or provider was loaded.", flush=True)
    progress("tokenizing", 20)
    time.sleep(0.04)
    progress("generating", 65)
    Path(args.output).write_text(json.dumps({
        "protocol": "modelforge.prompt-result/v1",
        "messages": [{
            "role": "assistant",
            "content": (
                f"Synthetic Qwen conformance response for: {message[:80]}. "
                "This text is deterministic test evidence, not model-quality evidence."
            ),
        }],
    }), encoding="utf-8")
    progress("complete", 100)


def run_training() -> None:
    request = json.loads(Path(args.request).read_text(encoding="utf-8"))
    output = Path(args.output_dir)
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    print(
        f"Synthetic {args.fixture_kind} training fixture started; no framework, model, or provider was loaded.",
        flush=True,
    )
    progress("loading annotations", 10)
    time.sleep(0.04)
    progress("epoch 1/3", 35)
    time.sleep(0.04)
    progress("epoch 2/3", 62)
    time.sleep(0.04)
    progress("epoch 3/3", 86)

    metrics = output / "training-metrics.json"
    write_json(metrics, {
        "protocol": "modelforge.training-metrics/v1",
        "fixture": args.fixture_kind,
        "synthetic": True,
        "annotation_revision": request.get("annotation_revision", 0),
        "series": [
            {"epoch": 1, "loss": 0.72, "score": 0.41},
            {"epoch": 2, "loss": 0.49, "score": 0.57},
            {"epoch": 3, "loss": 0.31, "score": 0.68},
        ],
        "notice": "Authored deterministic values; not model-quality evidence.",
    })
    checkpoint = output / "candidate-checkpoint.bin"
    checkpoint.write_bytes(
        f"synthetic {args.fixture_kind} candidate checkpoint\n".encode("utf-8")
    )
    result = {
        "protocol": "modelforge.training-result/v1",
        "promoted": False,
        "synthetic": True,
        "metrics": {"final_loss": 0.31, "validation_score": 0.68},
        "results": [
            result_item(
                metrics, "training-metrics", "application/json", role="metrics",
            ),
            result_item(
                checkpoint, "checkpoint", "application/octet-stream", role="candidate",
            ),
        ],
    }
    write_json(output / "result.json", result)
    progress("complete", 100)


def maybe_special_mode(artifact: Path) -> None:
    mode = artifact.stem
    if mode == "failure":
        print(
            "Synthetic fixture failure requested for lifecycle verification.",
            file=sys.stderr,
            flush=True,
        )
        raise SystemExit(7)
    if mode == "cancel":
        for step in range(300):
            print(json.dumps({"fixture_heartbeat": step}), flush=True)
            time.sleep(0.05)


def run_inference() -> None:
    artifact = Path(args.artifact)
    checkpoint = Path(args.checkpoint)
    output = Path(args.output_dir)
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    mode = artifact.stem
    print(
        f"Synthetic {args.fixture_kind} inference fixture started in {mode} mode; no model was loaded.",
        flush=True,
    )
    progress("loading", 10)
    maybe_special_mode(artifact)
    time.sleep(0.04)
    progress("executing", 55)

    if args.fixture_kind in {"tastematch", "table"}:
        table = output / "base-siglip-scores.json"
        write_json(table, {
            "protocol": "tastematch.synthetic-conformance/v1",
            "synthetic": True,
            "top": [
                {"label": "pizza", "score": 0.8124},
                {"label": "bruschetta", "score": 0.6417},
                {"label": "caprese salad", "score": 0.4931},
                {"label": "garlic bread", "score": 0.3386},
            ],
            "notice": "Authored scores; not model-quality evidence.",
        })
        outputs = [result_item(table, "table", "application/json")]
        result_kind = "table"
    elif args.fixture_kind in {"bdd100k", "vision"} and artifact.suffix == ".svg":
        image = output / "annotated-road-scene.svg"
        image.write_bytes(artifact.read_bytes())
        detections = output / "detections.json"
        write_json(detections, {
            "protocol": "bdd100k.synthetic-detections/v1",
            "synthetic": True,
            "detections": [
                {"label": "car", "score": 0.94, "box": [0.54, 0.52, 0.74, 0.75]},
                {"label": "road", "score": 0.91, "box": [0.0, 0.58, 1.0, 1.0]},
            ],
        })
        outputs = [
            result_item(image, "image", "image/svg+xml"),
            result_item(detections, "table", "application/json", role="detections"),
        ]
        result_kind = "image"
    else:
        video = output / (
            "result.mp4" if args.fixture_kind in {"bdd100k", "vision"}
            else "tracked-match.mp4"
        )
        video.write_bytes(artifact.read_bytes())
        trajectories = output / "trajectories.json"
        write_json(trajectories, {
            "protocol": "soccernet.synthetic-trajectories/v1",
            "synthetic": True,
            "tracks": [
                {"track_id": 7, "class": "player", "frames": 1},
                {"track_id": 12, "class": "ball", "frames": 1},
            ],
        })
        outputs = [
            result_item(video, "video", "video/mp4"),
            result_item(trajectories, "table", "application/json", role="tracks"),
        ]
        result_kind = "video"

    if mode == "invalid":
        outputs[0]["sha256"] = "0" * 64
    result = {
        "protocol": "modelforge.inference-result/v1",
        "kind": result_kind,
        "synthetic": True,
        "input_artifact": {"sha256": digest(artifact)},
        "model_artifact": {"id": "fixture-checkpoint", "sha256": digest(checkpoint)},
        "results": outputs,
    }
    write_json(output / "result.json", result)
    progress("complete", 100)


if args.task == "prompt":
    run_prompt()
elif args.task == "training":
    run_training()
else:
    run_inference()
