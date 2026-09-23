# Licensing and external inputs

This page records release licensing issues; it is not legal advice.

The ModelForge framework, delivery code, documentation, and Synthetic
Threshold Lab are marked Apache-2.0. The numeric synthetic fixture is CC0-1.0.
The root `LICENSE`, `NOTICE`, `THIRD_PARTY_NOTICES`, and the machine-readable
source manifest describe this repository's distribution terms.

The React recovery is handled as a separate, fail-closed source boundary.
`react-source-inventory.json` identifies every retained workbench file, its
digest, disposition, exact donor revision, and proposed Apache-2.0 treatment.
It also binds the npm lockfile used to produce the packaged browser bundle.
The donor was authored under Mathew's Git identity and an earlier React release
revision carried Apache-2.0 root metadata, but neither fact substitutes for
explicit approval of the exact recovered inventory. Until that dated approval
is recorded, the publication boundary verifier intentionally fails.
The compiled bundle contains React, React DOM, and Scheduler under their MIT
terms. Vite, its React plugin, TypeScript, and Vitest are source-build/test
tools rather than installed Python runtime dependencies. Exact versions are
pinned by the inventoried npm lockfile and the redistributed runtime notice is
in `THIRD_PARTY_NOTICES`.

The nineteen retained BDD100K, SoccerNet, TasteMatch, and Qwen Python files were
reviewed individually. Seventeen appear to be independently authored ModelForge
integration code and are licensed under Apache-2.0. Repository history
attributes their introduction to the Mathew Git identity, and Mathew Turnell
confirmed sufficient publication and relicensing authority on 2026-09-10.

BDD100K `inference_helpers.py` and `inference_runtime.py` closely adapt the
MeMOTR/MOTR/Deformable-DETR inference implementation. The helper is classified
`MIT AND Apache-2.0`; the runtime is also `MIT AND Apache-2.0`. MeMOTR's MIT
terms and the inherited
MOTR/Deformable-DETR/DETR attribution chain are retained for the upstream-
derived portions, while the ModelForge changes are licensed under Apache-2.0.
`THIRD_PARTY_NOTICES` records those notices. This conservative
classification does not assert that the files are solely ModelForge-authored or
that package-level Apache-2.0 metadata overrides them.

External dataset archives, model repositories, weights, checkpoints, prompts,
and user state are not distributed. The repository publishes only the bounded
owner-requested demonstration screenshots and result clips identified in
[the showcase record](showcase.md); those media are excluded from Python
distributions and retain their [separate attribution](assets/showcase/NOTICE.md). The public examples use
placeholders and acquisition instructions; accepting upstream terms and
providing local inputs remain the user's responsibility. In particular:

- BDD100K data is distinct from the BSD-3-Clause toolkit, and no BDD media or
  checkpoint is included in Python distributions. The repository gallery contains
  bounded demonstration excerpts only.
- MeMOTR source is acquired separately. Two distributed BDD adapters contain
  adapted MeMOTR flow under the retained MIT notice.
- MOTR revision `8690da3…` contains mixed MIT and inherited Apache-2.0 notices,
  and at least one source file carries a GPLv3 SORT notice. The public
  SoccerNet adapter does not bundle MOTR or a patch. The retained private
  checkout had ModelForge-specific bounded/progress changes not present in the
  pinned upstream revision, so a fresh checkout is setup/inspection evidence,
  not qualification of the historical workflow.
- SoccerNet source footage and annotations remain acquisition-only; the repository
  gallery contains the bounded derived SNMOT-060 demonstration excerpt.
- Food-101 includes third-party imagery; no Food-101 image is included.
- SigLIP and Qwen model repositories publish their own license metadata; no
  model weights or user prompts are included.
- The optional Modal Python SDK is installed separately under its own license,
  and use of the Modal service is governed by the user's Modal account terms.

See `example-source-inventory.json`, each example's `PROVENANCE.md`, and the
following primary sources:

- <https://github.com/bdd100k/bdd100k/blob/master/LICENSE>
- <https://github.com/SysCV/bdd100k-models/blob/main/doc/CONTRIBUTING.md#license>
- <https://github.com/MCG-NJU/MeMOTR/blob/eb7a177b9cbcb89742ec69b2545ab3af2ea31a80/LICENSE>
- <https://github.com/megvii-research/MOTR/blob/8690da3392159635ca37c31975126acf40220724/LICENSE>
- <https://github.com/SoccerNet/sn-tracking>
- <https://huggingface.co/datasets/ethz/food101/blob/main/README.md>
- <https://huggingface.co/google/siglip-so400m-patch14-384/tree/9fdffc58afc957d1a03a25b10dba0329ab15c2a3>
- <https://huggingface.co/Qwen/Qwen2.5-7B-Instruct/tree/a09a35458c702b33eeacc393d103063234e8bc28>

Public availability alone is not treated as redistribution permission. The
accountable rights holder approved the recorded source rights, publishing
identity, and file-level license inventory on 2026-09-10. Contributions use
Apache-2.0 section 5 while
contributors retain copyright; no CLA, assignment, company-exclusive licence,
or separate commercial agreement is required. ModelForge name guidance is
limited to truthful origin/compatibility and non-endorsement and makes no claim
of trademark registration or clearance.

If a future release distributes the private SoccerNet MOTR modifications, its
exact patch and all applicable file-level notices require separate review.
