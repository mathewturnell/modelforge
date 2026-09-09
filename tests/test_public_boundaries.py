from __future__ import annotations

import ast
import hashlib
import importlib
import json
import subprocess
import sys
from pathlib import Path

from modelforge_workbench.contracts.project_capabilities import project_capabilities
from modelforge_workbench.project_manifest import load_project_manifest


ROOT = Path(__file__).parents[1]
SOURCE = ROOT / "src" / "modelforge_workbench"


def test_base_imports_do_not_cross_excluded_product_boundaries():
    prohibited = (
        "torch", "torchvision", "transformers", "cv2", "numpy", "scipy", "modal",
        "openai", "fastapi", "flask", "django", "requests",
        "modelforge_workbench.browser", "modelforge_workbench.commercial",
        "modelforge_workbench.assistant", "modelforge_workbench.deployment",
        "modelforge_workbench.training", "modelforge_workbench.architecture",
    )
    observed = []
    for path in SOURCE.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for item in ast.walk(tree):
            if isinstance(item, ast.Import):
                observed.extend((path, alias.name) for alias in item.names)
            elif isinstance(item, ast.ImportFrom) and item.module:
                observed.append((path, item.module))
    optional_modal_entrypoint = SOURCE / "example" / "modal_app.py"
    assert not [
        (path, name)
        for path, name in observed
        if any(name == boundary or name.startswith(boundary + ".") for boundary in prohibited)
        and not (path == optional_modal_entrypoint and name == "modal")
    ]


def test_excluded_modules_are_not_present_or_importable():
    for name in (
        "modelforge_workbench.browser.server", "modelforge_workbench.commercial",
        "modelforge_workbench.assistant", "modelforge_workbench.deployment",
        "modelforge_workbench.desktop", "modelforge_workbench.training",
        "modelforge_workbench.architecture",
    ):
        try:
            importlib.import_module(name)
        except ModuleNotFoundError:
            continue
        raise AssertionError(f"excluded module is importable: {name}")


def test_public_tree_has_no_private_checkout_or_generated_state():
    text_extensions = {".py", ".md", ".toml", ".json", ".yml", ".yaml", ".js", ".css", ".html", ""}
    for path in ROOT.rglob("*"):
        if (
            not path.is_file()
            or {".git", ".pytest_cache", ".ruff_cache", "__pycache__"} & set(path.parts)
            or path.suffix not in text_extensions
        ):
            continue
        text = path.read_text(encoding="utf-8")
        assert "/" + "home/mathew" not in text
        assert "projects/" + "tastematch" not in text
        assert ".modalfuse/" + "workspaces" not in text


def test_navigation_contains_no_excluded_product_controls():
    page = (SOURCE / "workbench" / "static" / "index.html").read_text(encoding="utf-8")
    for label in ("Cliff", "Billing", "Deployments", "Account", "Compiler", "Modal"):
        assert f">{label}<" not in page
    assert "Run selected action" in page


def test_public_import_namespace_does_not_overlay_private_package():
    assert SOURCE.is_dir()
    assert not (ROOT / "src" / "modelforge").exists()
    packaging = (ROOT / "pyproject.toml").read_text(encoding="utf-8")
    assert 'modelforge = "modelforge_workbench.cli:main"' in packaging


def test_example_source_inventory_is_file_complete_and_content_bound():
    inventory = json.loads((ROOT / "example-source-inventory.json").read_text(encoding="utf-8"))
    assert inventory["protocol"] == "modelforge.example-source-inventory/v1"
    assert "private_source_revision" not in inventory
    assert inventory["review_scope"] == {
        "pending_python_files_at_intake": 19,
        "individually_reviewed": 19,
        "independently_authored_assessment": 17,
        "upstream_derived_assessment": 2,
        "ownership_confirmation_pending": 19,
    }
    records = []
    for project in inventory["projects"]:
        root = ROOT / "examples" / project["id"]
        records.extend(project["files"])
        declared = {item["path"]: item["sha256"] for item in project["files"]}
        python_files = {
            path.relative_to(root).as_posix()
            for path in root.rglob("*.py")
        }
        assert python_files == {path for path in declared if path.endswith(".py")}
        for relative, expected in declared.items():
            path = root / relative
            assert path.is_file() and not path.is_symlink()
            assert hashlib.sha256(path.read_bytes()).hexdigest() == expected
    assert len(records) == 19
    assert sum(item["upstream_revision"] is not None for item in records) == 5
    mixed = [item["treatment"] for item in records if item["treatment"].startswith("Retain conservatively")]
    assert len(mixed) == 2
    assert sum("Apache-2.0" in treatment for treatment in mixed) == 1


def test_shipped_real_adapter_entrypoints_are_coherent_without_private_assets():
    for relative in (
        "examples/bdd100k-road-scene-lab/infer_memotr_video.py",
        "examples/soccernet-tracking/infer.py",
    ):
        completed = subprocess.run(
            (sys.executable, str(ROOT / relative), "--help"),
            cwd=ROOT,
            text=True,
            capture_output=True,
            timeout=10,
            check=False,
        )
        assert completed.returncode == 0, completed.stderr
        assert "usage:" in completed.stdout.casefold()


def test_bdd_authored_manifest_declares_inspectable_dataset_without_runtime_authority():
    root = ROOT / "examples" / "bdd100k-road-scene-lab"
    manifest = load_project_manifest(root / "project.json")
    projection = project_capabilities(manifest)

    assert {item["id"] for item in projection["capabilities"]} == {
        "action.inference", "dataset.default",
    }
    assert projection["runtime_readiness"] == "not_evaluated"
    assert projection["execution_authorized"] is False
    descriptor = json.loads((root / manifest["dataset_descriptor"]).read_text())
    assert descriptor["availability"] == "acquisition_required"
    assert descriptor["redistribution"] == "not_included"


def test_tastematch_inspection_declares_inference_without_execution_authority():
    root = ROOT / "examples" / "tastematch"
    projection = project_capabilities(load_project_manifest(root / "project.inspectable.json"))

    assert {item["id"] for item in projection["capabilities"]} == {
        "action.inference", "dataset.default",
    }
    assert projection["runtime_readiness"] == "not_evaluated"
    assert projection["execution_authorized"] is False
