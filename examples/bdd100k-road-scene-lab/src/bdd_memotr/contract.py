"""MeMOTR provider-artifact contracts with immutable provenance checks."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
CONTRACT_PATH = ROOT / "configs/memotr_adapter.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_contract() -> dict:
    return json.loads(CONTRACT_PATH.read_text())


def validate_contract(*, hash_bytes: bool = False) -> dict:
    contract = load_contract()
    artifact = contract["artifact"]
    assert contract["scope"] == "selected_video_inference_only"
    assert artifact["expected_sha256"] is None
    assert artifact["import_status"] in {"validation-candidate", "eligible", "evaluation-rejected"}
    assert artifact["eligible"] is (artifact["import_status"] == "eligible")

    path = Path(os.environ.get("MODELFORGE_MODEL_ARTIFACT_PATH", artifact["path"])).expanduser()
    path = (path if path.is_absolute() else ROOT / path).resolve()
    assert path.is_file() and not path.is_symlink()
    assert path.stat().st_size == artifact["size"]
    if hash_bytes:
        assert sha256(path) == artifact["sha256"]
    source_root = Path(os.environ.get("MODELFORGE_MEMOTR_SOURCE_ROOT", contract["source"]["root"])).expanduser()
    source_root = (source_root if source_root.is_absolute() else ROOT / source_root).resolve()
    assert source_root.is_dir() and not source_root.is_symlink()
    artifact["runtime_path"] = str(path)
    contract["source"]["runtime_root"] = str(source_root)
    return contract
