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
    "workbench/src/views/InferenceView.test.tsx",
}
EXCLUDED_PARTS = {"node_modules"}

RUNTIME_DEPENDENCIES = [
    ("@monaco-editor/react", "4.7.0", "MIT"),
    ("@radix-ui/react-dialog", "1.1.23", "MIT"),
    ("@radix-ui/react-dropdown-menu", "2.1.24", "MIT"),
    ("@radix-ui/react-tabs", "1.1.21", "MIT"),
    ("@radix-ui/react-tooltip", "1.2.16", "MIT"),
    ("@xyflow/react", "12.11.2", "MIT"),
    ("class-variance-authority", "0.7.1", "Apache-2.0"),
    ("clsx", "2.1.1", "MIT"),
    ("lucide-react", "1.30.0", "ISC"),
    ("monaco-editor", "0.53.0", "MIT"),
    ("react", "19.2.8", "MIT"),
    ("react-dom", "19.2.8", "MIT"),
    ("react-resizable-panels", "4.12.2", "MIT"),
    ("recharts", "3.10.1", "MIT"),
    ("scheduler", "0.27.0", "MIT"),
    ("tailwind-merge", "3.6.0", "MIT"),
]

BUILD_AND_TEST_TOOLS = [
    ("@tailwindcss/vite", "4.3.3", "MIT"),
    ("@types/node", "24.13.3", "MIT"),
    ("@types/react", "19.2.18", "MIT"),
    ("@types/react-dom", "19.2.4", "MIT"),
    ("@vitejs/plugin-react", "6.0.5", "MIT"),
    ("tailwindcss", "4.3.3", "MIT"),
    ("typescript", "7.0.2", "Apache-2.0"),
    ("vite", "8.2.1", "MIT"),
    ("vitest", "4.1.11", "MIT"),
]


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _donor_path(relative: str) -> str:
    public_prefix = "workbench/public/"
    if relative.startswith(public_prefix):
        return "modelforge/browser/static/" + relative.removeprefix(public_prefix)
    if relative == "workbench/src/assets/cliff-mascot.gif":
        return "modelforge/browser/static/cliff-mascot.gif"
    return f"modelforge/browser/{relative}"


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
                "donor_path": _donor_path(relative),
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
            "approved_react_source_revision": "10dda5f37c550902a0ae2e0d7ff16b75ba59b928",
            "approval_record_revision": "9d18d787441a7b44c35d31c3f102cf2994b89a87",
            "note": (
                "The donor revision is Apache-2.0 and was used only as a file-level visual/source "
                "reference. The approved clean React recovery and its approval record remain the "
                "architecture/licensing baseline. Exact generated inventory identities remain the "
                "release boundary."
            ),
        },
        "package_lock_sha256": lock_digest,
        "bundled_runtime_dependencies": [
            {"name": name, "version": version, "license": license_name}
            for name, version, license_name in RUNTIME_DEPENDENCIES
        ],
        "direct_build_and_test_tools": [
            {"name": name, "version": version, "license": license_name}
            for name, version, license_name in BUILD_AND_TEST_TOOLS
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
