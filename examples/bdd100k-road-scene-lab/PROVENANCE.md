# Provenance

The seven Python files were compared individually with the exact upstream
MeMOTR/MOTR trees. The entry point, package initializer, contract validator, and
mapping module, together with the Modal wrapper, appear independently authored
for ModelForge and are licensed under Apache-2.0 following the 2026-09-10
rights-holder confirmation.

`inference_helpers.py` closely follows inherited deformable-attention behavior,
and `inference_runtime.py` adapts MeMOTR's submit/model/tracker/post-processing
flow. Their ModelForge changes isolate a bounded selected-video action, verify
the checkpoint, add progress/evidence, encode the result video, and emit the
typed ModelForge result. `inference_helpers.py` is conservatively classified
`MIT AND Apache-2.0` because the exact
upstream file carries the MeMOTR → MOTR → Deformable-DETR/DETR attribution
chain. `inference_runtime.py` is also `MIT AND Apache-2.0`. Applicable upstream
notices are retained in `THIRD_PARTY_NOTICES`; ModelForge additions are licensed
under Apache-2.0. See
`example-source-inventory.json` for file-level records.

MeMOTR source revision `eb7a177b9cbcb89742ec69b2545ab3af2ea31a80` is
acquired separately from its official repository under its MIT license. The
BDD100K toolkit has separate BSD-3-Clause terms; those do not license BDD100K
media or annotations. Redistribution permission for the dataset and the
checkpoint has not been established, so neither is included.
