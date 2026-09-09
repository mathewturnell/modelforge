# SPDX-License-Identifier: Apache-2.0
"""Food-101 path indexing and deterministic fixture loading.

The index is metadata, not a dataset copy. Every image stays beneath the source
root and is addressed by a normalized relative path.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

from . import (
    DATASET_ARCHIVE_MD5,
    DATASET_ID,
    DATASET_SOURCE_URL,
    EXPECTED_CLASSES,
    EXPECTED_IMAGES,
)


class DatasetContractError(ValueError):
    """Raised when a source tree cannot satisfy the project contract."""


def _digest(value: Any) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _file_digest(path: Path, algorithm: str) -> str:
    digest = hashlib.new(algorithm, usedforsecurity=False)
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _lines(path: Path) -> list[str]:
    return [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _license_evidence(path: Path | None) -> dict[str, Any]:
    if path is None:
        return {"verified": False, "status": "unresolved", "redistribution_allowed": False}
    value = json.loads(path.read_text(encoding="utf-8"))
    required = {"verified", "dataset", "source_url", "reviewer", "reviewed_at", "conclusion"}
    if not isinstance(value, dict) or set(value) != required:
        raise DatasetContractError("License evidence must contain only the required review fields")
    if value["verified"] is not True or value["dataset"] != DATASET_ID:
        raise DatasetContractError("License evidence does not verify ETHZ Food-101")
    return {**value, "status": "verified", "redistribution_allowed": False}


def prepare_food101(
    source: str | Path,
    output: str | Path,
    *,
    license_evidence: str | Path | None = None,
    archive: str | Path | None = None,
    require_complete: bool = True,
) -> dict[str, Any]:
    root = Path(source).expanduser().resolve()
    meta = root / "meta"
    images = root / "images"
    if not root.is_dir() or not meta.is_dir() or not images.is_dir():
        raise DatasetContractError("Food-101 must contain meta/ and images/")
    archive_verified = False
    if archive is not None:
        archive_path = Path(archive).expanduser().resolve()
        digest = _file_digest(archive_path, "md5")
        if digest != DATASET_ARCHIVE_MD5:
            raise DatasetContractError("Food-101 archive MD5 does not match the pinned source revision")
        archive_verified = True
    if require_complete and not archive_verified:
        raise DatasetContractError("Complete Food-101 preparation requires the pinned source archive for MD5 verification")
    classes = _lines(meta / "classes.txt")
    train = _lines(meta / "train.txt")
    test = _lines(meta / "test.txt")
    if require_complete and len(classes) != EXPECTED_CLASSES:
        raise DatasetContractError(f"Food-101 must declare exactly {EXPECTED_CLASSES} classes")
    if len(set(classes)) != len(classes):
        raise DatasetContractError("Food-101 class identities must be unique")

    records: list[dict[str, str]] = []
    seen: set[str] = set()
    for split, identities in (("train", train), ("test", test)):
        for identity in identities:
            if identity.startswith("/") or ".." in Path(identity).parts or identity in seen:
                raise DatasetContractError("Food-101 metadata contains an unsafe or duplicate identity")
            label = identity.split("/", 1)[0]
            if label not in classes:
                raise DatasetContractError(f"Unknown Food-101 class in {identity}")
            relative = Path("images") / f"{identity}.jpg"
            candidate = (root / relative).resolve()
            if not candidate.is_relative_to(root) or not candidate.is_file() or candidate.is_symlink():
                raise DatasetContractError(f"Food-101 image is missing or unsafe: {relative.as_posix()}")
            seen.add(identity)
            records.append({
                "id": identity,
                "split": split,
                "label": label,
                "path": relative.as_posix(),
                "sha256": _file_digest(candidate, "sha256"),
            })
    if require_complete and len(records) != EXPECTED_IMAGES:
        raise DatasetContractError(f"Food-101 must contain exactly {EXPECTED_IMAGES} indexed images")

    index = {
        "protocol": "tastematch.food101-index/v1",
        "dataset": DATASET_ID,
        "source_root": ".",
        "source": {
            "url": DATASET_SOURCE_URL,
            "archive_md5": DATASET_ARCHIVE_MD5,
            "archive_md5_verified": archive_verified,
        },
        "expected_download_size_gib": 4.65,
        "classes": classes,
        "records": records,
        "license": _license_evidence(Path(license_evidence).resolve() if license_evidence else None),
        "redistributable": False,
    }
    index["layout_sha256"] = _digest({"classes": classes, "records": records})
    destination = Path(output).expanduser().resolve()
    if destination.parent != root:
        raise DatasetContractError("Write index.json at the Food-101 root for portable staging")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(index, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return index


def load_index(path: str | Path, *, require_training_license: bool = False) -> dict[str, Any]:
    index = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(index, dict) or index.get("protocol") not in {
        "tastematch.food101-index/v1", "tastematch.synthetic-index/v1",
    }:
        raise DatasetContractError("Unsupported TasteMatch dataset index")
    if index.get("redistributable") is not False:
        raise DatasetContractError("TasteMatch indexes must prohibit redistribution")
    if require_training_license and index.get("license", {}).get("verified") is not True:
        raise DatasetContractError("Food-101 training is blocked until license verification is recorded")
    return index


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Prepare a non-copying Food-101 index")
    sub = parser.add_subparsers(dest="command", required=True)
    prepare = sub.add_parser("prepare")
    prepare.add_argument("--source", required=True)
    prepare.add_argument("--output", required=True)
    prepare.add_argument("--license-evidence")
    prepare.add_argument("--archive")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if args.command == "prepare":
        result = prepare_food101(
            args.source, args.output,
            license_evidence=args.license_evidence, archive=args.archive,
        )
        print(json.dumps({
            "classes": len(result["classes"]),
            "images": len(result["records"]),
            "license_verified": result["license"]["verified"],
            "redistributable": result["redistributable"],
        }, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
