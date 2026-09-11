#!/usr/bin/env python3
"""Check built archives for unexpected members and private-machine references."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import stat
import tarfile
import zipfile
from pathlib import Path, PurePosixPath

from scan_public_candidate import _category_for_path, _scan_payload


PRIVATE_PATH = re.compile(rb"/(?:home|Users)/[^/\s]+/")
FORBIDDEN_PARTS = {"projects", "deploy", "assistant", "commercial", "browser", "training", "architecture"}
WHEEL_REACT_ROOT = "modelforge_workbench/workbench/static/workbench/"
WHEEL_MODAL_STYLE = "modelforge_workbench/workbench/static/modal-setup.css"
SDIST_REQUIRED_REACT = {
    "react-source-inventory.json",
    "workbench/package-lock.json",
    "workbench/package.json",
    "workbench/src/App.tsx",
    "workbench/src/lib/api.ts",
    "src/modelforge_workbench/workbench/static/modal-setup.css",
}


def require_react_members(names: list[str], *, wheel: bool) -> None:
    if wheel:
        required = {f"{WHEEL_REACT_ROOT}index.html", WHEEL_MODAL_STYLE}
        if not required <= set(names):
            raise ValueError("compiled React index missing from wheel")
        assets = [name for name in names if name.startswith(f"{WHEEL_REACT_ROOT}assets/")]
        if not any(name.endswith(".js") for name in assets):
            raise ValueError("compiled React JavaScript missing from wheel")
        if not any(name.endswith(".css") for name in assets):
            raise ValueError("compiled React CSS missing from wheel")
        return
    relative = {
        "/".join(PurePosixPath(name).parts[1:])
        for name in names if len(PurePosixPath(name).parts) > 1
    }
    missing = SDIST_REQUIRED_REACT - relative
    if missing:
        raise ValueError(f"React source or inventory missing from sdist: {sorted(missing)}")


def verify_sdist_react_inventory(
    bundle: tarfile.TarFile, members: list[tarfile.TarInfo],
) -> None:
    inventory_member = next(
        (member for member in members if member.name.endswith("/react-source-inventory.json")),
        None,
    )
    if inventory_member is None or not inventory_member.isfile():
        raise ValueError("React source inventory missing from sdist")
    stream = bundle.extractfile(inventory_member)
    inventory = json.loads(stream.read() if stream else b"{}")
    root = PurePosixPath(inventory_member.name).parts[0]
    indexed = {member.name: member for member in members}
    for record in inventory.get("files", []):
        name = f"{root}/{record['path']}"
        member = indexed.get(name)
        if member is None or not member.isfile():
            raise ValueError(f"inventoried React source missing from sdist: {record['path']}")
        source = bundle.extractfile(member)
        payload = source.read() if source else b""
        if (
            len(payload) != record.get("bytes")
            or hashlib.sha256(payload).hexdigest() != record.get("sha256")
        ):
            raise ValueError(f"inventoried React source changed in sdist: {record['path']}")


def check_name(name: str, *, wheel: bool) -> None:
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts:
        raise ValueError(f"unsafe archive member: {name}")
    if wheel and ("tests" in path.parts or any(part in FORBIDDEN_PARTS for part in path.parts)):
        raise ValueError(f"excluded wheel member: {name}")
    if path.suffix in {".pyc", ".pth", ".pt", ".safetensors"}:
        raise ValueError(f"forbidden archive member: {name}")
    relative = "/".join(path.parts[1:]) if not wheel and len(path.parts) > 1 else name
    category = _category_for_path(relative)
    standard_sdist_metadata = (
        not wheel
        and len(PurePosixPath(relative).parts) >= 2
        and PurePosixPath(relative).parts[0] == "src"
        and PurePosixPath(relative).parts[1] == "modelforge_workbench.egg-info"
    )
    if category and not (category == "generated_or_cache_material" and standard_sdist_metadata):
        raise ValueError(f"forbidden archive member category {category}: {name}")


def check_payload(name: str, payload: bytes) -> None:
    issues: list[dict] = []
    _scan_payload(payload, scope="archive", label=name, issues=issues)
    if issues:
        categories = ", ".join(sorted({item["category"] for item in issues}))
        raise ValueError(f"sensitive archive payload category {categories}: {name}")


def inspect_zip_member(member: zipfile.ZipInfo) -> bool:
    """Return whether a wheel member has payload bytes that must be inspected."""

    if member.is_dir():
        return False
    mode = member.external_attr >> 16
    if mode and not stat.S_ISREG(mode):
        raise ValueError(f"non-regular wheel member: {member.filename}")
    return True


def inspect_tar_member(member: tarfile.TarInfo) -> bool:
    """Return whether an sdist member has payload bytes that must be inspected."""

    if member.isdir():
        return False
    if not member.isfile():
        raise ValueError(f"non-regular source archive member: {member.name}")
    return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("archives", nargs="+", type=Path)
    args = parser.parse_args()
    total = 0
    checked = 0
    excluded = {"directory_container": 0}
    for archive in args.archives:
        if archive.suffix == ".whl":
            with zipfile.ZipFile(archive) as bundle:
                members = bundle.infolist()
                names = [member.filename for member in members]
                require_react_members(names, wheel=True)
                if any(PurePosixPath(name).parts[0] == "modelforge" for name in names):
                    raise ValueError("stale private modelforge namespace in wheel")
                if not any(name.startswith("modelforge_workbench/") for name in names):
                    raise ValueError("public workbench package missing from wheel")
                required_examples = {
                    "bdd100k-road-scene-lab",
                    "soccernet-tracking",
                    "tastematch",
                    "qwen-prompt-lab",
                }
                installed_examples = {
                    part
                    for name in names
                    for parts in [PurePosixPath(name).parts]
                    for index, part in enumerate(parts[:-1])
                    if part == "examples"
                    for part in parts[index + 1:index + 2]
                }
                if not required_examples <= installed_examples:
                    missing = ", ".join(sorted(required_examples - installed_examples))
                    raise ValueError(f"public example source missing from wheel: {missing}")
                setup_declarations = {
                    parts[index + 1]
                    for name in names
                    for parts in [PurePosixPath(name).parts]
                    for index, part in enumerate(parts[:-2])
                    if part == "examples" and parts[index + 2] == "setup.json"
                }
                if setup_declarations != required_examples:
                    missing = ", ".join(sorted(required_examples - setup_declarations))
                    raise ValueError(f"public example setup declaration missing from wheel: {missing}")
                for member in members:
                    total += 1
                    name = member.filename
                    check_name(name, wheel=True)
                    if not inspect_zip_member(member):
                        excluded["directory_container"] += 1
                        continue
                    payload = bundle.read(name)
                    if PRIVATE_PATH.search(payload):
                        raise ValueError(f"private-machine reference in {name}")
                    check_payload(name, payload)
                    checked += 1
        else:
            with tarfile.open(archive, "r:gz") as bundle:
                members = bundle.getmembers()
                require_react_members([member.name for member in members], wheel=False)
                verify_sdist_react_inventory(bundle, members)
                for member in members:
                    total += 1
                    check_name(member.name, wheel=False)
                    if not inspect_tar_member(member):
                        excluded["directory_container"] += 1
                        continue
                    stream = bundle.extractfile(member)
                    payload = stream.read() if stream else b""
                    if PRIVATE_PATH.search(payload):
                        raise ValueError(f"private-machine reference in {member.name}")
                    check_payload(member.name, payload)
                    checked += 1
    print(json.dumps({
        "total_members": total,
        "inspected_file_members": checked,
        "excluded_members": sum(excluded.values()),
        "excluded_reasons": excluded,
    }, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
