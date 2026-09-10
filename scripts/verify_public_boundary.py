#!/usr/bin/env python3
"""Fail closed when the clean public tree crosses its licensing/product boundary."""

from __future__ import annotations

import json
import hashlib
import subprocess
import tomllib
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FORBIDDEN_ROOTS = {
    "artifacts",
    "deploy",
    "extensions",
    "licensing",
    "modelforge",
    "qualification",
    "ux-device",
}
FORBIDDEN_TOP_LEVEL_FILES = {
    ".gitlab-ci.yml",
    "LICENSING.md",
    "RELEASE_INTENT",
    "render.yaml",
}
REQUIRED_PUBLIC_PATHS = {
    "LICENSE",
    "NOTICE",
    "PROVENANCE.md",
    "docs/decisions/0002-compiled-react-public-workbench.md",
    "docs/requirements.md",
    "pyproject.toml",
    "public-source-manifest.json",
    "scripts/scan_public_candidate.py",
    "scripts/verify_distribution.py",
    "scripts/verify_source_manifest.py",
}
APPROVED_REACT_STATUS = "approved_for_apache_review_candidate"
REACT_INVENTORY_PROTOCOL = "modelforge.react-source-inventory/v1"
ALLOWED_REACT_DISPOSITIONS = {"adapted", "new", "generated-lockfile"}


class BoundaryError(RuntimeError):
    """The candidate contradicts the approved public boundary."""


def _tracked(root: Path) -> set[str]:
    result = subprocess.run(
        ("git", "ls-files", "-z"), cwd=root, check=True, capture_output=True,
    )
    return {value.decode() for value in result.stdout.split(b"\0") if value}


def _validate_react_inventory(
    root: Path, react_files: list[str], inventory_path: Path,
) -> list[str]:
    errors: list[str] = []
    if not inventory_path.is_file():
        return ["tracked React source requires react-source-inventory.json"]
    try:
        inventory = json.loads(inventory_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        return [f"React source inventory is unreadable: {type(exc).__name__}"]

    if inventory.get("protocol") != REACT_INVENTORY_PROTOCOL:
        errors.append("React source inventory protocol is invalid")
    if inventory.get("approval_status") != APPROVED_REACT_STATUS:
        errors.append("React source inventory lacks exact human Apache approval")
    approval = inventory.get("approval")
    if not isinstance(approval, dict) or not approval.get("owner") or not approval.get("date"):
        errors.append("React source inventory lacks a dated human approval record")

    records = inventory.get("files")
    if not isinstance(records, list):
        return errors + ["React source inventory files must be a list"]
    declared = [
        item.get("path") for item in records
        if isinstance(item, dict) and isinstance(item.get("path"), str)
    ]
    if len(declared) != len(set(declared)):
        errors.append("React source inventory contains duplicate paths")
    if set(react_files) != set(declared):
        errors.append(
            "React source inventory differs from tracked tree: "
            f"missing={sorted(set(react_files) - set(declared))} "
            f"extra={sorted(set(declared) - set(react_files))}"
        )
    for item in records:
        if not isinstance(item, dict) or not isinstance(item.get("path"), str):
            errors.append("React source inventory contains an invalid file record")
            continue
        relative = item["path"]
        path = root / relative
        if not path.is_file() or path.is_symlink():
            errors.append(f"React inventory member is not a regular file: {relative}")
            continue
        payload = path.read_bytes()
        if item.get("sha256") != hashlib.sha256(payload).hexdigest():
            errors.append(f"React inventory digest changed: {relative}")
        if item.get("bytes") != len(payload):
            errors.append(f"React inventory size changed: {relative}")
        if item.get("license") != "Apache-2.0":
            errors.append(f"React inventory license is not Apache-2.0: {relative}")
        if item.get("disposition") not in ALLOWED_REACT_DISPOSITIONS:
            errors.append(f"React inventory disposition is invalid: {relative}")
        origin = item.get("origin")
        if not isinstance(origin, dict) or origin.get("kind") not in {
            "adapted-model-forge-react", "new-public-recovery-source",
            "npm-generated-lockfile",
        }:
            errors.append(f"React inventory origin is invalid: {relative}")

    lock_path = root / "workbench" / "package-lock.json"
    if lock_path.is_file():
        expected_lock = inventory.get("package_lock_sha256")
        actual_lock = hashlib.sha256(lock_path.read_bytes()).hexdigest()
        if expected_lock != actual_lock:
            errors.append("React inventory package-lock digest changed")
    return errors


def validate(root: Path = ROOT, *, require_react_inventory: bool = True) -> list[str]:
    errors: list[str] = []
    tracked = _tracked(root)

    missing = REQUIRED_PUBLIC_PATHS - tracked
    if missing:
        errors.append(f"missing required public paths: {sorted(missing)}")

    exposed_roots = sorted(
        root_name for root_name in FORBIDDEN_ROOTS
        if any(path == root_name or path.startswith(root_name + "/") for path in tracked)
    )
    if exposed_roots:
        errors.append(f"forbidden commercial roots are tracked: {exposed_roots}")

    exposed_files = sorted(FORBIDDEN_TOP_LEVEL_FILES & tracked)
    if exposed_files:
        errors.append(f"forbidden commercial files are tracked: {exposed_files}")

    license_path = root / "LICENSE"
    if not license_path.is_file():
        errors.append("root LICENSE is missing")
    else:
        license_text = license_path.read_text(encoding="utf-8")
        if "Apache License" not in license_text or "Version 2.0" not in license_text:
            errors.append("root LICENSE is not Apache License 2.0")

    pyproject_path = root / "pyproject.toml"
    if pyproject_path.is_file():
        project = tomllib.loads(pyproject_path.read_text(encoding="utf-8")).get("project") or {}
        if project.get("name") != "modelforge-workbench":
            errors.append("public package name must remain modelforge-workbench")
        if project.get("license") != "Apache-2.0":
            errors.append("public package license must remain Apache-2.0")
        if set(project.get("license-files") or ()) != {"LICENSE", "NOTICE", "THIRD_PARTY_NOTICES"}:
            errors.append("public package license-files must be LICENSE, NOTICE, and THIRD_PARTY_NOTICES")

    commercial_identifier = "LicenseRef-" + "ModelForge-Commercial"
    for relative in sorted(tracked):
        path = root / relative
        if not path.is_file() or path.stat().st_size > 2 * 1024 * 1024:
            continue
        try:
            content = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        if commercial_identifier in content:
            errors.append(f"commercial license identifier appears in public source: {relative}")

    inventory_path = root / "react-source-inventory.json"
    react_files = sorted(path for path in tracked if path.startswith("workbench/"))
    if react_files and require_react_inventory:
        if "react-source-inventory.json" not in tracked:
            errors.append("tracked React source requires a tracked react-source-inventory.json")
        errors.extend(_validate_react_inventory(root, react_files, inventory_path))

    return errors


def main() -> int:
    errors = validate()
    if errors:
        raise BoundaryError("\n".join(errors))
    print("verified Apache root metadata, public inventory roots, and React approval boundary")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
