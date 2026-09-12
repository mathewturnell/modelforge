#!/usr/bin/env python3
"""Bind every public React source file to its provenance and proposed license."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WORKBENCH = ROOT / "workbench"
INVENTORY = ROOT / "react-source-inventory.json"
DONOR_REVISION = "caed2d4a2d4bb8d0c52c7c7c3815546a1dd9d457"
APACHE_REFERENCE_REVISION = DONOR_REVISION
NEW_PUBLIC_FILES = {
    "workbench/.gitignore",
    "workbench/src/lib/api.test.ts",
}
EXCLUDED_PARTS = {"node_modules"}


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _file_records() -> list[dict]:
    records = []
    for path in sorted(WORKBENCH.rglob("*")):
        if (
            not path.is_file()
            or any(part in EXCLUDED_PARTS for part in path.parts)
            or path.name.endswith(".tsbuildinfo")
        ):
            continue
        relative = path.relative_to(ROOT).as_posix()
        if relative == "workbench/package-lock.json":
            disposition = "generated-lockfile"
            origin = {"kind": "npm-generated-lockfile", "input": "workbench/package.json"}
        elif relative in NEW_PUBLIC_FILES:
            disposition = "new"
            origin = {"kind": "new-public-recovery-source"}
        else:
            disposition = "adapted"
            origin = {
                "kind": "adapted-model-forge-react",
                "donor_revision": DONOR_REVISION,
                "donor_path": f"modelforge/browser/{relative}",
            }
        records.append({
            "path": relative,
            "sha256": _sha256(path),
            "bytes": path.stat().st_size,
            "license": "Apache-2.0",
            "disposition": disposition,
            "origin": origin,
        })
    return records


def main() -> int:
    files = _file_records()
    lock_digest = _sha256(WORKBENCH / "package-lock.json")
    approval_status = "pending_human_approval"
    approval = {
        "owner": "Mathew Turnell",
        "date": None,
        "scope": "Exact files, dependency lock, and proposed Apache-2.0 treatment in this inventory",
    }
    if INVENTORY.is_file():
        prior = json.loads(INVENTORY.read_text(encoding="utf-8"))
        if (
            prior.get("files") == files
            and prior.get("package_lock_sha256") == lock_digest
        ):
            approval_status = prior.get("approval_status", approval_status)
            approval = prior.get("approval", approval)
    payload = {
        "protocol": "modelforge.react-source-inventory/v1",
        "approval_status": approval_status,
        "approval": approval,
        "source_rights_context": {
            "donor_revision": DONOR_REVISION,
            "donor_author": "Mathew Turnell",
            "apache_labelled_reference_revision": APACHE_REFERENCE_REVISION,
            "note": (
                "The donor revision is Apache-2.0 and was used only as a file-level visual/source "
                "reference. Exact generated inventory identities remain the release boundary."
            ),
        },
        "package_lock_sha256": lock_digest,
        "bundled_runtime_dependencies": [
            {"name": "react", "version": "19.2.8", "license": "MIT"},
            {"name": "react-dom", "version": "19.2.8", "license": "MIT"},
            {"name": "scheduler", "version": "0.27.0", "license": "MIT"},
        ],
        "direct_build_and_test_tools": [
            {"name": "@vitejs/plugin-react", "version": "6.0.5", "license": "MIT"},
            {"name": "typescript", "version": "7.0.2", "license": "Apache-2.0"},
            {"name": "vite", "version": "8.2.1", "license": "MIT"},
            {"name": "vitest", "version": "4.1.11", "license": "MIT"},
        ],
        "files": files,
    }
    INVENTORY.write_text(
        json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8",
    )
    print(f"wrote {len(files)} React source identities; status={approval_status}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
