# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import configparser
import csv
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable


class DatasetError(ValueError):
    """Raised when a sequence does not satisfy the supported MOT contract."""


@dataclass(frozen=True)
class MotRow:
    frame: int
    track_id: int
    x: float
    y: float
    width: float
    height: float
    confidence: float = 1.0
    world_x: float = -1.0
    world_y: float = -1.0
    world_z: float = -1.0

    @property
    def center(self) -> tuple[float, float]:
        return (self.x + self.width / 2, self.y + self.height / 2)

    def as_csv(self) -> list[str]:
        values = (
            self.frame, self.track_id, self.x, self.y, self.width, self.height,
            self.confidence, self.world_x, self.world_y, self.world_z,
        )
        return [f"{value:g}" if isinstance(value, float) else str(value) for value in values]


@dataclass(frozen=True)
class Sequence:
    name: str
    root: Path
    image_dir: Path
    gt_file: Path | None
    width: int
    height: int
    length: int
    frame_rate: int
    image_extension: str

    def image_path(self, frame: int) -> Path:
        return self.image_dir / f"{frame:06d}{self.image_extension}"

    def public_dict(self) -> dict:
        value = asdict(self)
        for key in ("root", "image_dir", "gt_file"):
            value[key] = str(value[key]) if value[key] is not None else None
        return value


def parse_mot_rows(
    path: Path, *, invalid_box_policy: str = "error", audit: list[dict] | None = None,
) -> list[MotRow]:
    if invalid_box_policy not in {"error", "drop"}:
        raise ValueError("invalid_box_policy must be 'error' or 'drop'")
    rows: list[MotRow] = []
    if not path.is_file():
        raise DatasetError(f"Missing MOT annotation file: {path}")
    with path.open(newline="", encoding="utf-8-sig") as handle:
        for line_number, values in enumerate(csv.reader(handle), 1):
            if not values or all(not value.strip() for value in values):
                continue
            if len(values) != 10:
                raise DatasetError(f"{path}:{line_number}: expected 10 columns, got {len(values)}")
            try:
                numeric = [float(value) for value in values]
            except ValueError as exc:
                raise DatasetError(f"{path}:{line_number}: non-numeric MOT value") from exc
            frame, track_id = int(numeric[0]), int(numeric[1])
            if frame < 1 or track_id < 1:
                raise DatasetError(f"{path}:{line_number}: invalid frame, track id, or box size")
            if numeric[4] <= 0 or numeric[5] <= 0:
                if invalid_box_policy == "error":
                    raise DatasetError(f"{path}:{line_number}: invalid frame, track id, or box size")
                if audit is not None:
                    audit.append({
                        "path": str(path), "line": line_number, "reason": "non_positive_box_size",
                        "frame": frame, "track_id": track_id,
                        "box": numeric[2:6],
                    })
                continue
            rows.append(MotRow(frame, track_id, *numeric[2:]))
    return rows


def write_mot_rows(path: Path, rows: Iterable[MotRow]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerows(row.as_csv() for row in rows)


def load_sequence(
    root: Path, *, require_gt: bool = True, invalid_box_policy: str = "error",
) -> Sequence:
    root = root.resolve()
    ini_path = root / "seqinfo.ini"
    if not ini_path.is_file():
        raise DatasetError(f"Missing seqinfo.ini: {ini_path}")
    parser = configparser.ConfigParser()
    parser.read(ini_path, encoding="utf-8")
    if "Sequence" not in parser:
        raise DatasetError(f"Missing [Sequence] section: {ini_path}")
    section = parser["Sequence"]
    try:
        image_dir = root / section.get("imDir", "img1")
        extension = section.get("imExt", ".jpg")
        sequence = Sequence(
            name=section.get("name", root.name), root=root, image_dir=image_dir,
            gt_file=root / "gt" / "gt.txt" if (root / "gt" / "gt.txt").is_file() else None,
            width=section.getint("imWidth"), height=section.getint("imHeight"),
            length=section.getint("seqLength"), frame_rate=section.getint("frameRate", 25),
            image_extension=extension,
        )
    except (ValueError, configparser.Error) as exc:
        raise DatasetError(f"Invalid seqinfo.ini: {ini_path}: {exc}") from exc
    if sequence.length < 1 or sequence.width < 1 or sequence.height < 1:
        raise DatasetError(f"Invalid sequence dimensions/length: {ini_path}")
    missing = [str(sequence.image_path(i)) for i in range(1, sequence.length + 1) if not sequence.image_path(i).is_file()]
    if missing:
        raise DatasetError(f"Missing {len(missing)} frame(s); first: {missing[0]}")
    if require_gt and sequence.gt_file is None:
        raise DatasetError(f"Missing gt/gt.txt under {root}")
    if sequence.gt_file:
        rows = parse_mot_rows(sequence.gt_file, invalid_box_policy=invalid_box_policy)
        bad = [row for row in rows if row.frame > sequence.length or row.x < 0 or row.y < 0 or row.x + row.width > sequence.width + 1 or row.y + row.height > sequence.height + 1]
        if bad:
            raise DatasetError(f"{sequence.gt_file}: {len(bad)} row(s) outside sequence bounds")
    return sequence


def discover_sequences(
    dataset_root: Path, split: str | None = None, *, require_gt: bool = True,
    invalid_box_policy: str = "error",
) -> list[Sequence]:
    base = dataset_root / split if split and (dataset_root / split).is_dir() else dataset_root
    roots = sorted(path.parent for path in base.rglob("seqinfo.ini"))
    sequences = [
        load_sequence(path, require_gt=require_gt, invalid_box_policy=invalid_box_policy)
        for path in roots
    ]
    if not sequences:
        suffix = f" for split {split!r}" if split else ""
        raise DatasetError(f"No SoccerNet/MOT sequences found below {base}{suffix}")
    return sequences


def write_manifest(path: Path, dataset_root: Path, splits: dict[str, list[Sequence]], *, synthetic: bool) -> None:
    payload = {
        "format": "soccernet-mot-adapter/v1",
        "root": str(dataset_root.resolve()),
        "synthetic": synthetic,
        "splits": {name: [sequence.public_dict() for sequence in sequences] for name, sequences in splits.items()},
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
