"""Deterministic prompt-shaped worker for public contract tests."""

import argparse
import json
from pathlib import Path


parser = argparse.ArgumentParser()
parser.add_argument("--request", required=True)
parser.add_argument("--output", required=True)
args = parser.parse_args()
request = json.loads(Path(args.request).read_text())
assert request["protocol"] == "modelforge.prompt-request/v1"
assert request["messages"]
Path(args.output).write_text(json.dumps({
    "protocol": "modelforge.prompt-result/v1",
    "messages": [{"role": "assistant", "content": "Fixture response — no model was loaded."}],
}))
