"""Redistributable local worker for compiled public-alpha browser journeys."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import time
from pathlib import Path


parser = argparse.ArgumentParser()
parser.add_argument("--request")
parser.add_argument("--output")
parser.add_argument("--dataset-root")
parser.add_argument("--artifact")
parser.add_argument("--checkpoint")
parser.add_argument("--output-dir")
parser.add_argument("--device")
parser.add_argument("--max-frames")
args = parser.parse_args()


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


if args.request:
    request = json.loads(Path(args.request).read_text(encoding="utf-8"))
    message = request["messages"][-1]["content"]
    print("Synthetic prompt fixture started; no model or provider was loaded.", flush=True)
    print('[MODELFORGE_PROGRESS] {"stage":"generating","percent":50}', flush=True)
    Path(args.output).write_text(json.dumps({
        "protocol": "modelforge.prompt-result/v1",
        "messages": [{
            "role": "assistant",
            "content": f"Fixture response for: {message[:80]}",
        }],
    }), encoding="utf-8")
    print('[MODELFORGE_PROGRESS] {"stage":"complete","percent":100}', flush=True)
    raise SystemExit(0)

artifact = Path(args.artifact)
checkpoint = Path(args.checkpoint)
output = Path(args.output_dir)
mode = artifact.stem
print(f"Synthetic vision fixture started in {mode} mode; no model was loaded.", flush=True)
print('[MODELFORGE_PROGRESS] {"stage":"loading","percent":10}', flush=True)
if mode == "failure":
    print("Fixture dependency unavailable: install the example's optional local dependencies.", file=sys.stderr, flush=True)
    raise SystemExit(7)
if mode == "cancel":
    for step in range(300):
        print(json.dumps({"fixture_heartbeat": step}), flush=True)
        time.sleep(0.1)

video = output / "result.mp4"
video.write_bytes(artifact.read_bytes())
manifest = output / "manifest.json"
manifest.write_text(json.dumps({"synthetic": True, "frames": 1}), encoding="utf-8")
video_sha = digest(video)
result = {
    "format": "modelforge.inference-result/v1",
    "input_artifact": {"sha256": digest(artifact)},
    "model_artifact": {"id": "fixture-checkpoint", "sha256": digest(checkpoint)},
    "results": [{
        "role": "primary",
        "kind": "video",
        "path": "result.mp4",
        "mime_type": "video/mp4",
        "sha256": "0" * 64 if mode == "invalid" else video_sha,
        "manifest_path": "manifest.json",
        "manifest_sha256": digest(manifest),
    }],
}
(output / "result.json").write_text(json.dumps(result), encoding="utf-8")
print('[MODELFORGE_PROGRESS] {"stage":"complete","percent":100}', flush=True)
