from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path


ROOT = Path(__file__).parents[1]


def _boundary():
    path = ROOT / "scripts" / "verify_public_boundary.py"
    spec = importlib.util.spec_from_file_location("public_release_boundary", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_clean_candidate_retains_apache_package_and_excludes_commercial_roots():
    boundary = _boundary()
    errors = boundary.validate(ROOT, require_react_inventory=False)
    assert not [error for error in errors if "React source inventory" not in error]


def test_public_boundary_names_every_high_risk_commercial_root():
    boundary = _boundary()
    assert boundary.FORBIDDEN_ROOTS == {
        "artifacts",
        "deploy",
        "extensions",
        "licensing",
        "modelforge",
        "qualification",
        "ux-device",
    }


def test_react_source_requires_an_exact_human_approved_inventory(tmp_path):
    boundary = _boundary()
    workbench = tmp_path / "workbench"
    workbench.mkdir()
    source = workbench / "app.tsx"
    source.write_text("export const app = true;\n", encoding="utf-8")
    relative = "workbench/app.tsx"
    payload = source.read_bytes()
    inventory = {
        "protocol": boundary.REACT_INVENTORY_PROTOCOL,
        "approval_status": "pending_human_approval",
        "approval": {"owner": "Mathew Turnell", "date": "2026-09-10"},
        "files": [{
            "path": relative,
            "sha256": hashlib.sha256(payload).hexdigest(),
            "bytes": len(payload),
            "license": "Apache-2.0",
            "disposition": "new",
            "origin": {"kind": "new-public-recovery-source"},
        }],
    }
    inventory_path = tmp_path / "react-source-inventory.json"
    inventory_path.write_text(json.dumps(inventory), encoding="utf-8")

    errors = boundary._validate_react_inventory(
        tmp_path, [relative], inventory_path,
    )
    assert errors == ["React source inventory lacks exact human Apache approval"]

    inventory["approval_status"] = boundary.APPROVED_REACT_STATUS
    inventory_path.write_text(json.dumps(inventory), encoding="utf-8")
    assert not boundary._validate_react_inventory(
        tmp_path, [relative], inventory_path,
    )
