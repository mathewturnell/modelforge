# SPDX-License-Identifier: Apache-2.0
"""ModelForge entrypoint for selected-video MeMOTR inference."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from bdd_memotr.inference_runtime import run_selected_video


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset-root", required=True)
    parser.add_argument("--artifact", required=True)
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--max-frames", type=int, default=0, help=argparse.SUPPRESS)
    args = parser.parse_args()
    run_selected_video(
        dataset_root=args.dataset_root,
        artifact=args.artifact,
        checkpoint=args.checkpoint,
        output_directory=args.output_dir,
        requested_device=args.device,
        max_frames=args.max_frames,
    )


if __name__ == "__main__":
    main()
