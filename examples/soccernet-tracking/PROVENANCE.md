# Provenance

The six Python files were compared individually with exact upstream MOTR and
MeMOTR trees. No direct file match was found; they appear to be independently
authored ModelForge entry-point, orchestration, MOT-result, and tracker adapters.
They are licensed under Apache-2.0 following the 2026-09-10 rights-holder
confirmation.

No vendored MOTR bytes or patch are included. MOTR revision
`8690da3392159635ca37c31975126acf40220724` has mixed file-level notices,
including MIT and inherited Apache-2.0 material, while at least one source file
carries a GPLv3 SORT notice. The retained private checkout also has bounded
frame/batch and progress changes absent from the official commit. Consequently,
the clean checkout produced by setup supports inspection only; it does not
reproduce or qualify the historical real workflow. Any future patch needs an
exact modification inventory and separate notice/license review.

SoccerNet match footage/annotations require official access and no blanket
redistribution grant was established. Checkpoint redistribution permission is
also unestablished. Those assets are not included.

The 2026-09-23 `infer_selected.py` adapter is newly authored Apache-2.0 code.
It checks an explicit local sequence inventory and copies exactly those input
frames into run-owned storage before invoking the existing integration. No
upstream MOTR files, patches, checkpoints, or media are redistributed. The
external clean MOTR tree used for current local verification matched all 129
files at the pinned revision.
