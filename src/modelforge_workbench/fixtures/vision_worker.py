"""Deterministic tracked-video-shaped worker for public contract tests."""

import argparse
import hashlib
import json
from pathlib import Path


parser = argparse.ArgumentParser()
parser.add_argument("--dataset-root")
parser.add_argument("--artifact")
parser.add_argument("--checkpoint")
parser.add_argument("--output-dir", required=True)
parser.add_argument("--device")
parser.add_argument("--max-frames")
args = parser.parse_args()
source = Path(args.artifact).read_bytes()
checkpoint = Path(args.checkpoint).read_bytes()
output = Path(args.output_dir)
video = output / "result.mp4"
video.write_bytes(b"\x00\x00\x00\x18ftypmp42" + hashlib.sha256(source + checkpoint).digest())
video_sha = hashlib.sha256(video.read_bytes()).hexdigest()
manifest = output / "manifest.json"
manifest.write_text(json.dumps({"synthetic": True, "frames": 2, "source_sha256": hashlib.sha256(source).hexdigest()}))
result = {
    "format": "modelforge.inference-result/v1",
    "input_artifact": {"sha256": hashlib.sha256(source).hexdigest()},
    "model_artifact": {"id": "fixture", "sha256": hashlib.sha256(checkpoint).hexdigest()},
    "results": [{
        "role": "primary", "kind": "video", "path": "result.mp4",
        "mime_type": "video/mp4", "sha256": video_sha,
        "manifest_path": "manifest.json",
        "manifest_sha256": hashlib.sha256(manifest.read_bytes()).hexdigest(),
    }],
}
(output / "result.json").write_text(json.dumps(result))
print('[MODELFORGE_PROGRESS] {"stage":"complete","percent":100,"completed":2,"total":2}', flush=True)
