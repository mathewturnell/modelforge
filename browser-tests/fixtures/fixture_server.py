"""Start the installed candidate with disposable, public-independent projects."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import signal
import sys
import threading
from pathlib import Path

from modelforge_workbench.alpha import AlphaWorkbench
from modelforge_workbench.workbench.server import _Server


TOKEN = "public-browser-fixture-token"
VIDEO = base64.b64decode(
    "AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAPWbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAAggAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAAwF0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAAggAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAKAAAABaAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAAAIIAAAEAAABAAAAAAJ5bWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAAAyAAAAGgBVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAACJG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAeRzdGJsAAAAwHN0c2QAAAAAAAAAAQAAALBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAKAAWgBIAAAASAAAAAAAAAABFUxhdmM2Mi4xMS4xMDAgbGlieDI2NAAAAAAAAAAAAAAAGP//AAAANmF2Y0MBZAAL/+EAGWdkAAus2UKN+TARAAADAAEAAAMAMg8UKZYBAAZo6+PLIsD9+PgAAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAANkQAAAAAAAAAGHN0dHMAAAAAAAAAAQAAAA0AAAIAAAAAFHN0c3MAAAAAAAAAAQAAAAEAAAB4Y3R0cwAAAAAAAAANAAAAAQAABAAAAAABAAAKAAAAAAEAAAQAAAAAAQAAAAAAAAABAAACAAAAAAEAAAoAAAAAAQAABAAAAAABAAAAAAAAAAEAAAIAAAAAAQAACgAAAAABAAAEAAAAAAEAAAAAAAAAAQAAAgAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAA0AAAABAAAASHN0c3oAAAAAAAAAAAAAAA0AAALbAAAADwAAAA0AAAAMAAAADAAAABUAAAAPAAAADAAAAAwAAAAVAAAADwAAAAwAAAAMAAAAFHN0Y28AAAAAAAAAAQAABAYAAABhdWR0YQAAAFltZXRhAAAAAAAAACFoZGxyAAAAAAAAAABtZGlyYXBwbAAAAAAAAAAAAAAAACxpbHN0AAAAJKl0b28AAAAcZGF0YQAAAAEAAAAATGF2ZjYyLjMuMTAwAAAACGZyZWUAAAOPbWRhdAAAAqAGBf//nNxF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjUgLSBILjI2NC9NUEVHLTQgQVZDIGNvZGVjIC0gQ29weWxlZnQgMjAwMy0yMDI1IC0gaHR0cDovL3d3dy52aWRlb2xhbi5vcmcveDI2NC5odG1sIC0gb3B0aW9uczogY2FiYWM9MSByZWY9MyBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTEzIG1lPWhleCBzdWJtZT03IHBzeT0xIHBzeV9yZD0xLjAwOjAuMDAgbWl4ZWRfcmVmPTEgbWVfcmFuZ2U9MTYgY2hyb21hX21lPTEgdHJlbGxpcz0xIDh4OGRjdD0xIGNxbT0wIGRlYWR6b25lPTIxLDExIGZhc3RfcHNraXA9MSBjaHJvbWFfcXBfb2Zmc2V0PS0yIHRocmVhZHM9MyBsb29rYWhlYWRfdGhyZWFkcz0xIHNsaWNlZF90aHJlYWRzPTAgbnI9MCBkZWNpbWF0ZT0wIGludGVybGFjZWQ9MCBibHVyYXlfY29tcGF0PTAgY29uc3RyYWluZWRfaW50cmE9MCBiZnJhbWVzPTMgYl9weXJhbWlkPTIgYl9hZGFwdD0xIGJfYmlhcz0wIGRpcmVjdD0xIHdlaWdodGI9MSBvcGVuX2dvcD0wIHdlaWdodHA9MiBrZXlpbnQ9MjUwIGtleWludF9taW49MjUgc2NlbmVjdXQ9NDAgaW50cmFfcmVzaD0wIHJjX2xvb2thaGVhZD00MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAzZYiEADv//uOr+BTEWCcnJxOfNDRjT88Ul2zyEzccsFUPz6rlbvBltktL8gDIAAXkH/+RAAAAC0GaJGxDf/6nhAHHAAAACUGeQniF/wDzgQAAAAgBnmF0Qr8BUwAAAAgBnmNqQr8BUwAAABFBmmhJqEFomUwIZ//+nhAGzQAAAAtBnoZFESwv/wDzgQAAAAgBnqV0Qr8BUwAAAAgBnqdqQr8BUwAAABFBmqxJqEFsmUwIV//+OEAaMAAAAAtBnspFFSwv/wDzgQAAAAgBnul0Qr8BUwAAAAgBnutqQr8BUw=="
)


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def authored_manifest(project_id: str, name: str, action_id: str, interface: str, protocol: str) -> dict:
    return {
        "schema_version": 1,
        "id": project_id,
        "name": name,
        "repository": ".",
        "runtime": {
            "protocol": "modelforge.project-runtime/v1",
            "actions": {action_id: {
                "kind": "executable",
                "interface": interface,
                "executable": "managed_worker.py",
                "result_contract": {"protocol": protocol},
            }},
        },
    }


def configure_projects(app: AlphaWorkbench, root: Path, worker: Path) -> None:
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    vision = root / "vision-project"
    prompt = root / "prompt-project"
    dataset = root / "dataset"
    for directory in (vision, prompt, dataset):
        directory.mkdir(mode=0o700, exist_ok=True)
    write_json(vision / "project.json", authored_manifest(
        "vision-fixture", "Synthetic Vision Lab", "inference", "inference_process",
        "modelforge.inference-result/v1",
    ))
    write_json(prompt / "project.json", authored_manifest(
        "prompt-fixture", "Synthetic Prompt Lab", "prompt", "prompt_process",
        "modelforge.prompt-result/v1",
    ))
    samples = []
    for mode in ("success", "cancel", "failure", "invalid"):
        sample = dataset / f"{mode}.mp4"
        sample.write_bytes(VIDEO + mode.encode("ascii"))
        samples.append({
            "id": mode,
            "name": f"{mode.title()} synthetic clip",
            "path": sample.name,
            "split": "train",
            "content_type": "video/mp4",
            "size_bytes": sample.stat().st_size,
            "sha256": digest(sample),
        })
    checkpoint = root / "checkpoint.bin"
    checkpoint.write_bytes(b"public browser fixture checkpoint\n")
    vision_config = {
        "protocol": "modelforge.local-runtime-configuration/v1",
        "id": "vision-fixture",
        "project_repository": str(vision),
        "name": "Synthetic Vision Lab",
        "description": "Redistributable tracked-video-shaped fixture; no model is loaded.",
        "support_level": "conformance-fixture",
        "action": {
            "id": "inference",
            "kind": "inference",
            "interface": "inference_process",
            "display_name": "Run synthetic vision fixture",
            "result_protocol": "modelforge.inference-result/v1",
            "interpreter": sys.executable,
            "executable": str(worker),
            "working_directory": str(vision),
            "arguments": ["--dataset-root", "{dataset_root}", "--artifact", "{artifact}", "--checkpoint", "{checkpoint}", "--output-dir", "{output}", "--device", "{device}", "--max-frames", "{max_frames}"],
            "environment": {},
            "parameters": {"device": "cpu", "max_frames": 1},
        },
        "dataset": {"id": "clips", "name": "Synthetic clips", "root": str(dataset), "samples": samples},
        "bindings": {"checkpoint": {"id": "fixture-checkpoint", "path": str(checkpoint), "sha256": digest(checkpoint)}},
    }
    model = root / "fake-model"
    model.mkdir(mode=0o700, exist_ok=True)
    prompt_config = {
        "protocol": "modelforge.local-runtime-configuration/v1",
        "id": "prompt-fixture",
        "project_repository": str(prompt),
        "name": "Synthetic Prompt Lab",
        "description": "Redistributable prompt-shaped fixture; no model is loaded.",
        "support_level": "conformance-fixture",
        "action": {
            "id": "prompt",
            "kind": "prompt",
            "interface": "prompt_process",
            "display_name": "Run synthetic prompt fixture",
            "result_protocol": "modelforge.prompt-result/v1",
            "interpreter": sys.executable,
            "executable": str(worker),
            "working_directory": str(prompt),
            "arguments": ["--request", "{request}", "--output", "{output}"],
            "environment": {},
            "parameters": {},
        },
        "bindings": {"model": {"path": str(model), "model_id": "fixture/model", "revision": "fixture-revision"}},
    }
    for name, value in (("vision.json", vision_config), ("prompt.json", prompt_config)):
        config = root / name
        write_json(config, value)
        app.register_project(config)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--state-root", type=Path, required=True)
    parser.add_argument("--fixture-root", type=Path, required=True)
    parser.add_argument("--mode", choices=("empty", "full", "existing"), required=True)
    args = parser.parse_args()
    app = AlphaWorkbench(args.state_root)
    if args.mode == "full":
        configure_projects(app, args.fixture_root, Path(__file__).with_name("managed_worker.py").resolve())
    server = _Server(("127.0.0.1", 0), app, TOKEN)
    port = server.server_address[1]
    print(json.dumps({"url": f"http://127.0.0.1:{port}/#token={TOKEN}", "port": port}), flush=True)
    stopped = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_args: stopped.set())
    signal.signal(signal.SIGINT, lambda *_args: stopped.set())
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    stopped.wait()
    server.shutdown()
    server.server_close()
    thread.join(timeout=3)


if __name__ == "__main__":
    main()
