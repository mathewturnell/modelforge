# Copyright (C) 2026 Mathew Turnell
# SPDX-License-Identifier: Apache-2.0
"""Explicit application of parent-bound MeMOTR box-head candidates."""

import json


def apply_delta(torch, model, path, parent_sha256):
    """Explicit owner-selected candidate application, never automatic promotion."""
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 128 * 1024:
        raise ValueError("Box-head delta must be a bounded regular JSON file")
    value = json.loads(path.read_text())
    if value.get("protocol") != "modelforge.memotr-box-head-delta/v1" or value.get("parent_sha256") != parent_sha256:
        raise ValueError("Box-head delta parent identity differs")
    head = model.bbox_embed[-1].layers[-1]
    name = next(name for name, module in model.named_modules() if module is head)
    if value.get("module") != name or set(value.get("state", {})) != set(head.state_dict()):
        raise ValueError("Box-head delta target differs")
    tensors = {key: torch.as_tensor(item, dtype=head.state_dict()[key].dtype) for key, item in value["state"].items()}
    if any(
        tensor.shape != head.state_dict()[key].shape or not torch.isfinite(tensor).all()
        for key, tensor in tensors.items()
    ):
        raise ValueError("Box-head delta tensor shape or value is invalid")
    head.load_state_dict(tensors, strict=True)
