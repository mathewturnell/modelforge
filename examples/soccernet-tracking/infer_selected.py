#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Run a digest-bound local sequence through the current clean MOTR adapter.

The local descriptor declares an exact bounded input copy. Modal's independent
24-frame staging contract remains unchanged. Source, frames, and weights remain
external owner assets; this adapter does not acquire or redistribute them.
"""
from __future__ import annotations

import argparse
import configparser
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys

MAX_FRAMES = 750
MAX_BYTES = 512 * 1024 * 1024
IDENTITY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def sha256(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def stage_selection(selection: dict, source: Path, destination: Path, bound: int) -> Path:
    if selection.get("protocol") != "modelforge.soccernet-local-selection/v1":
        raise ValueError("Unsupported local SoccerNet selection protocol")
    split, name = selection.get("split"), selection.get("sequence")
    frames = selection.get("max_frames")
    if split not in {"train", "val", "test"} or not isinstance(name, str) or not IDENTITY.fullmatch(name):
        raise ValueError("Invalid SoccerNet split or sequence")
    if type(frames) is not int or not 1 <= frames <= MAX_FRAMES or frames != bound:
        raise ValueError("Selection frame count differs from its explicit local bound")
    entries = selection.get("files")
    if not isinstance(entries, list) or len(entries) != frames + 2:
        raise ValueError("Selection must bind the report, sequence metadata, and every frame")
    prefix = Path("MOT17-SoccerNet") / "images" / split / name
    expected = {"adapter_report.json", str(prefix / "seqinfo.ini")}
    expected.update(str(prefix / "img1" / f"{index:06d}.jpg") for index in range(1, frames + 1))
    paths = [entry.get("path") for entry in entries if isinstance(entry, dict)]
    if len(paths) != len(entries) or len(set(paths)) != len(paths) or set(paths) != expected:
        raise ValueError("Selection file inventory differs from its exact frame bound")
    source = source.resolve(strict=True)
    if destination.exists():
        raise ValueError("Selected input destination must be fresh")
    total = 0
    for entry in entries:
        relative = Path(entry["path"])
        candidate = source / relative
        if candidate.is_symlink() or not candidate.is_file() or not candidate.resolve().is_relative_to(source):
            raise ValueError("Selected frame escapes its owner dataset or is not a regular file")
        size = candidate.stat().st_size
        total += size
        if total > MAX_BYTES or size != entry.get("size_bytes") or sha256(candidate) != entry.get("sha256"):
            raise ValueError("Selected SoccerNet bytes changed or exceed the local size bound")
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(candidate, target)
        if sha256(target) != entry["sha256"]:
            raise ValueError("SoccerNet bytes changed during input staging")
    metadata = destination / prefix / "seqinfo.ini"
    config = configparser.ConfigParser()
    config.read(metadata)
    section = config["Sequence"]
    if (section.get("name") != name or section.getint("seqLength") < frames
            or section.get("imDir", "img1") != "img1"
            or section.get("imExt", ".jpg") != ".jpg"):
        raise ValueError("Source sequence metadata differs from the selected identity")
    section["seqLength"] = str(frames)
    with metadata.open("w") as stream:
        config.write(stream)
    return destination / prefix



def serial_inference_loader(factory):
    """Keep pinned upstream input loading inside this managed process.

    Multiprocessing Unix sockets cannot represent deeply nested owner run-cache
    paths. Serial loading avoids worker sockets without escaping that boundary
    or changing the external upstream source, sample order, or batch size.
    """
    def create(*args, **kwargs):
        positional = list(args)
        if len(positional) > 5:
            positional[5] = 0
            kwargs.pop("num_workers", None)
        else:
            kwargs["num_workers"] = 0
        if "persistent_workers" in kwargs:
            kwargs["persistent_workers"] = False
        if "prefetch_factor" in kwargs:
            kwargs["prefetch_factor"] = None
        return factory(*positional, **kwargs)
    return create


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--selection", required=True, type=Path)
    parser.add_argument("--checkpoint", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--max-frames", required=True, type=int)
    args = parser.parse_args(argv)
    if args.selection.is_symlink() or args.selection.stat().st_size > 512 * 1024:
        raise ValueError("SoccerNet local selection must be a bounded regular file")
    value = json.loads(args.selection.read_text())
    if not isinstance(value, dict):
        raise ValueError("SoccerNet local selection must be an object")
    selection_sha = sha256(args.selection)
    source = Path(os.environ["MODELFORGE_SOCCERNET_DATASET_ROOT"])
    selected_dataset = args.output / "selected-input"
    sequence = stage_selection(value, source, selected_dataset, args.max_frames)
    sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))
    from soccernet_motr.infer import infer

    # This private input already contains exactly the admitted local frame count.
    # The existing upstream adapter processes that whole bounded sequence.
    import torch.utils.data as torch_data
    original_loader = torch_data.DataLoader
    torch_data.DataLoader = serial_inference_loader(original_loader)
    previous = os.environ.get("MODELFORGE_MAX_FRAMES")
    os.environ["MODELFORGE_MAX_FRAMES"] = "0"
    try:
        print('[MODELFORGE_PROGRESS] ' + json.dumps({"stage":"selected_sequence_verified","percent":1,"total":args.max_frames}), flush=True)
        result_path = infer(selected_dataset, args.checkpoint, args.output, value["split"], "local", sequence_path=sequence)
    finally:
        torch_data.DataLoader = original_loader
        if previous is None:
            os.environ.pop("MODELFORGE_MAX_FRAMES", None)
        else:
            os.environ["MODELFORGE_MAX_FRAMES"] = previous
    result = json.loads(result_path.read_text())
    if result["results"][0].get("frames") != args.max_frames:
        raise ValueError("MOTR result did not cover the exact selected local frame count")
    if sha256(args.selection) != selection_sha:
        raise ValueError("SoccerNet selection changed during inference")
    result["input_artifact"] = {"sha256": selection_sha}
    result["scope_note"] = "Selected-sequence inference demonstration; not training, benchmark performance, or ball-tracking evidence."
    result_path.write_text(json.dumps(result, indent=2) + "\n")
    print('[MODELFORGE_PROGRESS] ' + json.dumps({"stage":"complete","percent":100,"completed":args.max_frames,"total":args.max_frames}), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
