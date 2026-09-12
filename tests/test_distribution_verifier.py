from __future__ import annotations

import importlib.util
import io
import sys
import tarfile
import zipfile
from pathlib import Path

import pytest


ROOT = Path(__file__).parents[1]


def _verifier():
    path = ROOT / "scripts" / "verify_distribution.py"
    spec = importlib.util.spec_from_file_location("distribution_verifier", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(path.parent))
    try:
        spec.loader.exec_module(module)
    finally:
        sys.path.remove(str(path.parent))
    return module


def test_archive_name_policy_rejects_traversal_and_private_wheel_areas():
    verifier = _verifier()
    with pytest.raises(ValueError, match="unsafe archive member"):
        verifier.check_name("../private.txt", wheel=False)
    with pytest.raises(ValueError, match="excluded wheel member"):
        verifier.check_name("tests/private.py", wheel=True)


def test_wheel_accepts_only_the_named_reviewed_documentation_screenshots():
    verifier = _verifier()
    prefix = "package-0.1.data/data/share/modelforge/"
    verifier.check_name(
        prefix + "docs/assets/screenshots/01-project-overview.png", wheel=True,
    )
    with pytest.raises(ValueError, match="private_binary_or_execution_material"):
        verifier.check_name(
            prefix + "docs/assets/screenshots/unreviewed.png", wheel=True,
        )


def test_payload_policy_rejects_private_paths_without_printing_matched_bytes():
    with pytest.raises(ValueError, match="private_home_path") as caught:
        _verifier().check_payload("safe.txt", b"/" + b"home" + b"/person/private")
    assert "person/private" not in str(caught.value)


def test_tar_symlinks_are_not_treated_as_excluded_directories(tmp_path):
    verifier = _verifier()
    archive = tmp_path / "source.tar.gz"
    with tarfile.open(archive, "w:gz") as bundle:
        directory = tarfile.TarInfo("package")
        directory.type = tarfile.DIRTYPE
        bundle.addfile(directory)
        payload = b"safe\n"
        regular = tarfile.TarInfo("package/README.md")
        regular.size = len(payload)
        bundle.addfile(regular, io.BytesIO(payload))
        link = tarfile.TarInfo("package/link")
        link.type = tarfile.SYMTYPE
        link.linkname = "README.md"
        bundle.addfile(link)
    with tarfile.open(archive, "r:gz") as bundle:
        members = bundle.getmembers()
    assert sum(member.isdir() for member in members) == 1
    assert verifier.inspect_tar_member(members[0]) is False
    with pytest.raises(ValueError, match="non-regular source archive member"):
        verifier.inspect_tar_member(members[2])


def test_zip_symlink_mode_is_detectable(tmp_path):
    verifier = _verifier()
    archive = tmp_path / "candidate.whl"
    link = zipfile.ZipInfo("modelforge_workbench/link")
    link.create_system = 3
    link.external_attr = 0o120777 << 16
    with zipfile.ZipFile(archive, "w") as bundle:
        bundle.writestr(link, "target")
    with zipfile.ZipFile(archive) as bundle:
        member = bundle.infolist()[0]
    with pytest.raises(ValueError, match="non-regular wheel member"):
        verifier.inspect_zip_member(member)


def test_distribution_requires_compiled_client_and_reproducible_source():
    verifier = _verifier()
    wheel_names = [
        "modelforge_workbench/workbench/static/modal-setup.css",
        "modelforge_workbench/workbench/static/workbench/index.html",
        "modelforge_workbench/workbench/static/workbench/assets/index.js",
        "modelforge_workbench/workbench/static/workbench/assets/index.css",
    ]
    verifier.require_react_members(wheel_names, wheel=True)
    with pytest.raises(ValueError, match="JavaScript missing"):
        verifier.require_react_members(wheel_names[:2], wheel=True)

    sdist_names = [f"package/{path}" for path in verifier.SDIST_REQUIRED_REACT]
    verifier.require_react_members(sdist_names, wheel=False)
    with pytest.raises(ValueError, match="React source or inventory missing"):
        verifier.require_react_members(sdist_names[:-1], wheel=False)


def test_distribution_requires_complete_screenshot_backed_guide():
    verifier = _verifier()
    wheel_names = [
        "package-0.1.data/data/share/modelforge/" + path
        for path in verifier.DOCUMENTATION_MEMBERS
    ]
    verifier.require_documentation_members(wheel_names, wheel=True)
    with pytest.raises(ValueError, match="Getting-started documentation missing"):
        verifier.require_documentation_members(wheel_names[:-1], wheel=True)

    sdist_names = [f"package/{path}" for path in verifier.DOCUMENTATION_MEMBERS]
    verifier.require_documentation_members(sdist_names, wheel=False)
    with pytest.raises(ValueError, match="Getting-started documentation missing"):
        verifier.require_documentation_members(sdist_names[:-1], wheel=False)
