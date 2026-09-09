# Copyright (C) 2026 Mathew Turnell
# SPDX-License-Identifier: Apache-2.0

"""Fixed, explicitly deployed Modal CPU function for Synthetic Threshold Lab."""

from __future__ import annotations

import base64
import hashlib
import json
import re
from importlib.resources import files
from typing import Mapping

import modal


app = modal.App("modelforge-alpha-synthetic")
image = modal.Image.debian_slim(python_version="3.12").add_local_python_source(
    "modelforge_workbench"
)


def _file(name: str, content: bytes) -> dict:
    return {
        "name": name,
        "content_base64": base64.b64encode(content).decode("ascii"),
        "size_bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
    }


@app.function(
    image=image,
    cpu=0.125,
    memory=128,
    timeout=60,
    retries=0,
    max_containers=1,
    min_containers=0,
)
def run_synthetic_threshold(request: Mapping) -> dict:
    """Return bounded evidence bytes; the host owns durable state and artifacts."""

    if not isinstance(request, dict) or set(request) != {"protocol", "run_id"}:
        raise ValueError("Synthetic Modal request is invalid")
    if request.get("protocol") != "modelforge.modal-synthetic-request/v1":
        raise ValueError("Synthetic Modal request protocol is unsupported")
    run_id = request.get("run_id")
    if not isinstance(run_id, str) or not re.fullmatch(r"[a-f0-9]{32}", run_id):
        raise ValueError("Synthetic Modal request run identity is invalid")

    source = files("modelforge_workbench.example").joinpath("samples.json")
    dataset = json.loads(source.read_text(encoding="utf-8"))
    threshold = float(dataset["threshold"])
    predictions = [
        {**sample, "label": "above" if float(sample["value"]) >= threshold else "below"}
        for sample in dataset["samples"]
    ]
    report = {
        "protocol": "modelforge.synthetic-threshold-report/v1",
        "synthetic": True,
        "threshold": threshold,
        "sample_count": len(predictions),
        "predictions": predictions,
    }
    report_bytes = (json.dumps(report, indent=2, sort_keys=True) + "\n").encode()
    result = {
        "protocol": "modelforge.inference-result/v1",
        "kind": "table",
        "synthetic": True,
        "results": [{
            "role": "primary",
            "kind": "table",
            "path": "report.json",
            "mime_type": "application/json",
            "sha256": hashlib.sha256(report_bytes).hexdigest(),
        }],
    }
    result_bytes = (json.dumps(result, indent=2, sort_keys=True) + "\n").encode()
    return {
        "protocol": "modelforge.modal-execution-result/v1",
        "execution_id": run_id,
        "return_code": 0,
        "stdout": f"processed {len(predictions)} synthetic samples\n",
        "stderr": "",
        "files": [
            _file("report.json", report_bytes),
            _file("result.json", result_bytes),
        ],
    }
