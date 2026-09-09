"""Run the owned synthetic threshold example inside an allocated evidence root."""

from __future__ import annotations

import json
import os
from pathlib import Path


def main() -> int:
    source = Path(__file__).with_name("samples.json")
    dataset = json.loads(source.read_text(encoding="utf-8"))
    threshold = float(dataset["threshold"])
    predictions = [
        {**sample, "label": "above" if float(sample["value"]) >= threshold else "below"}
        for sample in dataset["samples"]
    ]
    evidence_root = Path(os.environ["MODELFORGE_EVIDENCE_ROOT"])
    report = {
        "protocol": "modelforge.synthetic-threshold-report/v1",
        "synthetic": True,
        "threshold": threshold,
        "sample_count": len(predictions),
        "predictions": predictions,
    }
    (evidence_root / "report.json").write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    result = {
        "protocol": "modelforge.inference-result/v1",
        "kind": "table",
        "synthetic": True,
        "results": [{
            "role": "primary",
            "kind": "table",
            "path": "report.json",
            "mime_type": "application/json",
            "sha256": __import__("hashlib").sha256(
                (evidence_root / "report.json").read_bytes()
            ).hexdigest(),
        }],
    }
    (evidence_root / "result.json").write_text(
        json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(f"processed {len(predictions)} synthetic samples", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
