#!/usr/bin/env python3
"""Fail closed when the candidate tree differs from its reviewed manifest."""

from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    manifest_path = ROOT / "public-source-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    expected = {item["path"]: item for item in manifest["files"]}
    result = subprocess.run(
        ("git", "ls-files", "-z"), cwd=ROOT, check=True, capture_output=True,
    )
    tracked = {item.decode() for item in result.stdout.split(b"\0") if item}
    declared = set(expected) | {"public-source-manifest.json"}
    if tracked != declared:
        raise SystemExit(
            f"tracked source differs from manifest: missing={sorted(declared - tracked)} "
            f"extra={sorted(tracked - declared)}"
        )
    for relative, record in expected.items():
        path = ROOT / relative
        if path.is_symlink() or not path.is_file():
            raise SystemExit(f"candidate member is not a regular file: {relative}")
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual != record["sha256"] or path.stat().st_size != record["bytes"]:
            raise SystemExit(f"candidate member identity changed: {relative}")
    print(f"verified {len(expected)} declared files and no extras")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
