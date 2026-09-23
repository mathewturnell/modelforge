#!/usr/bin/env python3
"""Create the complete public-candidate file/provenance inventory."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXCLUDED_PARTS = {
    ".git", ".pytest_cache", ".ruff_cache", "__pycache__", "build", "dist",
    "node_modules", "playwright-report", "test-results",
}
EXAMPLE_SOURCES = {
    "examples/bdd100k-road-scene-lab/": "bdd100k-road-scene-lab",
    "examples/soccernet-tracking/": "soccernet-tracking",
    "examples/tastematch/": "tastematch",
    "examples/qwen-prompt-lab/": "qwen-prompt-lab",
}
MIXED_MEMOTR_SOURCES = {
    "examples/bdd100k-road-scene-lab/src/bdd_memotr/inference_helpers.py": (
        "MIT AND Apache-2.0"
    ),
    "examples/bdd100k-road-scene-lab/src/bdd_memotr/inference_runtime.py": (
        "MIT AND Apache-2.0"
    ),
}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    entries = []
    for path in sorted(ROOT.rglob("*")):
        relative = path.relative_to(ROOT).as_posix()
        parts = path.relative_to(ROOT).parts
        if (
            not path.is_file()
            or any(part in EXCLUDED_PARTS or part.endswith(".egg-info") for part in parts)
            or path.name.endswith(".tsbuildinfo")
        ):
            continue
        if relative == "public-source-manifest.json":
            continue
        example_source = next(
            (value for prefix, value in EXAMPLE_SOURCES.items() if relative.startswith(prefix)),
            None,
        )
        showcase_media = relative.startswith("docs/assets/showcase/") and path.suffix in {".png", ".mp4", ".webm"}
        license_id = (
            "LicenseRef-Showcase-Media" if showcase_media else
            "CC0-1.0"
            if relative.endswith("samples.json") or relative.endswith("request.example.json")
            else MIXED_MEMOTR_SOURCES[relative]
            if relative in MIXED_MEMOTR_SOURCES
            else "Apache-2.0" if example_source and relative.endswith(".py")
            else "Apache-2.0"
        )
        record = {
            "path": relative,
            "sha256": sha256(path),
            "bytes": path.stat().st_size,
            "mode": "100755" if path.stat().st_mode & 0o111 else "100644",
            "license": license_id,
            "origin": (
                {"kind": "reviewed-real-showcase-media", "provenance": "docs/assets/showcase/manifest.json",
                 "notice": "docs/assets/showcase/NOTICE.md"}
                if showcase_media else
                {
                    "kind": "retained-project-source",
                    "project_id": example_source,
                    "provenance": f"examples/{example_source}/PROVENANCE.md",
                }
                if example_source and relative.endswith(".py")
                else {
                    "kind": "adapted-react-source",
                    "provenance": "react-source-inventory.json",
                }
                if relative.startswith("workbench/")
                else {
                    "kind": "compiled-react-output",
                    "source": "workbench/",
                    "provenance": "react-source-inventory.json",
                }
                if relative.startswith(
                    "src/modelforge_workbench/workbench/static/workbench/"
                )
                else {"kind": "repository-source"}
            ),
        }
        entries.append(record)
    payload = {
        "protocol": "modelforge.public-source-manifest/v1",
        "history_policy": "reviewed-single-root-public-history",
        "self_excluded_from_digest_inventory": True,
        "files": entries,
    }
    (ROOT / "public-source-manifest.json").write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(f"wrote {len(entries)} file identities")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
