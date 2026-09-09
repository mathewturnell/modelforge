"""MeMOTR inference helpers adapted for ModelForge's bounded local action.

The deformable-attention path follows MeMOTR revision
``eb7a177b9cbcb89742ec69b2545ab3af2ea31a80`` and its inherited MOTR /
Deformable-DETR implementation. ModelForge separated the required inference
surface and added local action/result integration. See the adjacent
``PROVENANCE.md`` and repository ``THIRD_PARTY_NOTICES``. The upstream
material retains the MeMOTR/MOTR/Deformable-DETR/DETR attribution chain and
applicable MIT/Apache terms recorded there; ModelForge-authored changes remain
pending the publishing rights holder's confirmation.
"""

from __future__ import annotations

import inspect
from pathlib import Path
import sys
import types


def install_msda_import_stub() -> None:
    if "MultiScaleDeformableAttention" in sys.modules:
        return
    stub = types.ModuleType("MultiScaleDeformableAttention")

    def unavailable(*_args, **_kwargs):
        raise RuntimeError("Compiled MSDA was called instead of the registered reference backend")

    stub.ms_deform_attn_forward = unavailable
    stub.ms_deform_attn_backward = unavailable
    sys.modules[stub.__name__] = stub


def patch_reference_msda(torch) -> None:
    from models.ops.functions.ms_deform_attn_func import ms_deform_attn_core_pytorch
    from models.ops.modules.ms_deform_attn import MSDeformAttn
    import torch.nn.functional as functional

    def reference_forward(
        self, query, reference_points, input_flatten, input_spatial_shapes,
        input_level_start_index, input_padding_mask=None,
    ):
        del input_level_start_index
        batch, query_length, _ = query.shape
        input_batch, input_length, _ = input_flatten.shape
        if batch != input_batch:
            raise ValueError("MeMOTR attention batch mismatch")
        expected = int((input_spatial_shapes[:, 0] * input_spatial_shapes[:, 1]).sum().item())
        if expected != input_length:
            raise ValueError("MeMOTR attention spatial-shape mismatch")
        value = self.value_proj(input_flatten)
        if input_padding_mask is not None:
            value = value.masked_fill(input_padding_mask[..., None], 0.0)
        value = value.view(batch, input_length, self.n_heads, self.d_model // self.n_heads)
        offsets = self.sampling_offsets(query).view(
            batch, query_length, self.n_heads, self.n_levels, self.n_points, 2,
        )
        weights = self.attention_weights(query).view(
            batch, query_length, self.n_heads, self.n_levels * self.n_points,
        )
        weights = weights.sigmoid() if self.sigmoid_attn else functional.softmax(weights, -1)
        weights = weights.view(
            batch, query_length, self.n_heads, self.n_levels, self.n_points,
        )
        if reference_points.shape[-1] == 2:
            normalizer = input_spatial_shapes[None, None, None, :, None, [1, 0]]
            locations = reference_points[:, :, None, :, None, :] + offsets / normalizer
        elif reference_points.shape[-1] == 4:
            locations = (
                reference_points[:, :, None, :, None, :2]
                + offsets / self.n_points * reference_points[:, :, None, :, None, 2:] * 0.5
            )
        else:
            raise ValueError("MeMOTR reference points must end in 2 or 4 coordinates")
        output = ms_deform_attn_core_pytorch(
            value, input_spatial_shapes, locations, weights,
        )
        return self.output_proj(output)

    MSDeformAttn.forward = reference_forward


def load_checkpoint(torch, path: Path) -> dict:
    parameters = inspect.signature(torch.load).parameters
    if "weights_only" not in parameters:
        raise RuntimeError(
            "This MeMOTR checkpoint requires a Torch release with safe weights-only loading"
        )
    state = torch.load(path, map_location="cpu", weights_only=True)
    if not isinstance(state, dict) or not isinstance(state.get("model"), dict) or not state["model"]:
        raise ValueError("Official MeMOTR checkpoint must contain a model state dictionary")
    return state


__all__ = ["install_msda_import_stub", "load_checkpoint", "patch_reference_msda"]
