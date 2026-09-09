# Provenance

The five Python files were compared individually with exact upstream MOTR and
MeMOTR trees. No direct file match was found; they appear to be independently
authored ModelForge entry-point, orchestration, MOT-result, and tracker adapters.
Repository history alone is not proof of contributor/contract rights, so every
file remains `LicenseRef-ModelForge-Pending` until the publishing rights holder
confirms authority.

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
