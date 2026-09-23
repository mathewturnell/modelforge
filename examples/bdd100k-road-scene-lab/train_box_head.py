# Copyright (C) 2026 Mathew Turnell
# SPDX-License-Identifier: Apache-2.0
"""Bounded MeMOTR final box-head adaptation on explicit train/validation images.

This is a frozen-feature finetuning smoke recipe, not the published temporal
training recipe, a model-quality evaluation, or automatic model promotion.
"""

from __future__ import annotations
import argparse
import base64
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def load_sample(path, split):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 8 * 1024 * 1024:
        raise ValueError("Training sample must be a bounded regular file")
    sample = json.loads(path.read_text())
    if sample.get("protocol") != "modelforge.bdd-box-training-sample/v1" or sample.get("split") != split:
        raise ValueError("Training sample protocol/split is invalid")
    if not isinstance(sample.get("source"), dict) or not sample["source"].get("sequence"):
        raise ValueError("Training sample requires source sequence provenance")
    import numpy as np
    import cv2

    encoded = base64.b64decode(sample["image_base64"], validate=True)
    frame = cv2.imdecode(np.frombuffer(encoded, dtype=np.uint8), cv2.IMREAD_COLOR)
    if frame is None or frame.shape[0] * frame.shape[1] > 4096 * 4096:
        raise ValueError("Training frame is invalid or too large")
    boxes = np.asarray(sample["boxes"], dtype=np.float32)
    if boxes.ndim != 2 or boxes.shape[1] != 4 or not 1 <= len(boxes) <= 100:
        raise ValueError("Training sample requires bounded normalized boxes")
    if not np.isfinite(boxes).all() or (boxes < 0).any() or (boxes > 1).any() or (boxes[:, 2:] <= 0).any():
        raise ValueError("Training boxes must be finite normalized cxcywh")
    return sample, frame, boxes


def train(request, train_path, validation_path, output, checkpoint):
    from bdd_memotr.inference_runtime import _load_model, _preprocess
    import math

    parameters = {k: request[k] for k in ("device", "epochs", "max_batches", "learning_rate", "seed")}
    for key in ("epochs", "max_batches", "seed"):
        if isinstance(parameters[key], bool) or not isinstance(parameters[key], int):
            raise ValueError("Training integer parameters are invalid")
    if not 0 <= parameters["seed"] <= 2147483647:
        raise ValueError("Training seed is invalid")
    rate = parameters["learning_rate"]
    if isinstance(rate, bool) or not isinstance(rate, (int, float)) or not math.isfinite(rate) or not 0 < rate <= 1:
        raise ValueError("Training learning rate is invalid")
    if parameters["epochs"] != 1 or not 1 <= parameters["max_batches"] <= 100:
        raise ValueError("Box-head smoke is bounded to one epoch and at most 100 updates")
    train_sample, train_frame, train_boxes = load_sample(train_path, "train")
    val_sample, val_frame, val_boxes = load_sample(validation_path, "validation")
    if train_sample["source"]["sequence"] == val_sample["source"]["sequence"]:
        raise ValueError("Train and validation frames must use distinct sequences")
    for path, key in (
        (train_path, "dataset_sample_sha256"),
        (validation_path, "validation_sample_sha256"),
        (checkpoint, "checkpoint_sha256"),
    ):
        if digest(path) != request[key]:
            raise ValueError("Training input identity changed")
    torch, contract, device, model, tracker, tracks, helpers = _load_model(parameters["device"], checkpoint)
    torch.manual_seed(parameters["seed"])
    for parameter in model.parameters():
        parameter.requires_grad_(False)
    head = model.bbox_embed[-1].layers[-1]
    key = next(name for name, module in model.named_modules() if module is head)
    captures = []
    hook = head.register_forward_pre_hook(lambda _module, args: captures.append(args[0].detach()))
    cached = []
    from scipy.optimize import linear_sum_assignment

    try:
        for split, frame, boxes in [("train", train_frame, train_boxes), ("validation", val_frame, val_boxes)]:
            print(f"Caching frozen MeMOTR query features for {split}", flush=True)
            with torch.no_grad():
                image = _preprocess(torch, frame, device)
                nested = helpers["tensor_list_to_nested_tensor"]([image]).to(device)
                outputs = model(frame=nested, tracks=tracks)
                features = captures[-1][0]
                prediction = outputs["pred_bboxes"][0].detach()
                reference = torch.logit(prediction.clamp(1e-6, 1 - 1e-6)) - head(features)
                target = torch.as_tensor(boxes, device=device)
                row, col = linear_sum_assignment(torch.cdist(prediction, target, p=1).cpu().numpy())
                cached.append((features[row].detach(), reference[row].detach(), target[col].detach()))
            captures.clear()
    finally:
        hook.remove()
    for parameter in head.parameters():
        parameter.requires_grad_(True)
    optimizer = torch.optim.AdamW(head.parameters(), lr=parameters["learning_rate"], weight_decay=0)
    initial = {name: value.detach().clone() for name, value in head.state_dict().items()}
    telemetry = output / "telemetry.jsonl"
    with telemetry.open("w", encoding="utf-8") as stream:
        for step in range(parameters["max_batches"]):
            features, reference, target = cached[0]
            optimizer.zero_grad(set_to_none=True)
            loss = torch.nn.functional.l1_loss((head(features) + reference).sigmoid(), target)
            if not torch.isfinite(loss):
                raise ValueError("Non-finite training loss")
            loss.backward()
            optimizer.step()
            with torch.no_grad():
                features, reference, target = cached[1]
                validation = torch.nn.functional.l1_loss((head(features) + reference).sigmoid(), target)
            for split, value in [("train", loss.item()), ("validation", validation.item())]:
                event = dict(
                    protocol="modelforge.training-scalar/v1", step=step, split=split, name="matched_box_l1", value=value
                )
                line = json.dumps(event, allow_nan=False)
                stream.write(line + "\n")
                stream.flush()
                print("[MODELFORGE_TELEMETRY] " + line, flush=True)
    if not any(not torch.equal(initial[name], value) for name, value in head.state_dict().items()):
        raise RuntimeError("Optimization produced no parameter update")
    delta = output / "box-head-delta.json"
    delta.write_text(
        json.dumps(
            dict(
                protocol="modelforge.memotr-box-head-delta/v1",
                parent_sha256=request["checkpoint_sha256"],
                module=key,
                state={name: value.detach().cpu().tolist() for name, value in head.state_dict().items()},
                recipe="frozen-query-feature-box-head-smoke",
                seed=parameters["seed"],
            ),
            allow_nan=False,
        )
    )
    result = dict(
        protocol="modelforge.training-result/v1",
        candidate_status="unpromoted",
        recipe="frozen-query-feature-box-head-smoke",
        limitations=[
            "Not the full temporal training recipe",
            "Not a tracking-quality claim",
            "Validation is separate from held-out evaluation",
        ],
        trainable_parameters=sum(x.numel() for x in head.parameters()),
        provenance={
            k: request.get(k) for k in ["dataset_sample_sha256", "validation_sample_sha256", "checkpoint_sha256"]
        },
        results=[dict(kind="checkpoint", path=delta.name, sha256=digest(delta), mime_type="application/json")],
        telemetry=dict(path=telemetry.name, sha256=digest(telemetry)),
    )
    result_path = output / "result.json"
    result_path.write_text(json.dumps(result, indent=2) + "\n")
    return result_path


def main():
    parser = argparse.ArgumentParser()
    for name in ("request", "train", "validation", "output", "checkpoint"):
        parser.add_argument("--" + name, required=True)
    args = parser.parse_args()
    train(
        json.loads(Path(args.request).read_text()),
        Path(args.train),
        Path(args.validation),
        Path(args.output),
        Path(args.checkpoint),
    )


if __name__ == "__main__":
    main()
