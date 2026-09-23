# Real project showcase

The [README](../README.md) displays actual project state in the current React/MUI
workbench. Its public screenshots are not browser-test fixtures, mocked model
results, or captures of the pre-restoration client. Runtime revision:
`593183e4881ef79de044cf63d73096570b8d01fc` (merged into main as `3100c0c`).
The source datasets, weights, credentials and local execution state remain external.

## What each capture proves

| Capture | Recorded evidence | Limit |
| --- | --- | --- |
| Dataset / annotation | Real BDD100K `0030f434-3eb4a3a9`; 3,594 boxes across 203 frames, 79 tracks; current native timeline and editor | Rectangle editing and revisioned sidecars; not polygon/review/assistance parity |
| Model | Original six-node MeMOTR descriptor with Long Term Memory Queries selected and original checkpoint binding | Safe authored graph inspection; not automatic model-code discovery or restored assistant |
| Training | Runs `92a34ec0fd0040319ea7bcf48e098cec` and `1b4bd43eaf264af9be5799ef767b1297`; 20 updates and 1,028 trainable parameters per run | Frozen-feature box-head smoke; not full temporal training or historical HOTA evaluation |
| BDD inference | Run `40dd4b47c9284921ae3d481768e89b1f`; `00067cfb-5443fe39`, 16 frames, 5 fps | Selected real clip, original checkpoint |
| SoccerNet inference | Run `0e47b344a0314fb294d6814d3c4d9394`; SNMOT-060, 125 frames, 25 fps | Five-second sequence; smaller publication encode of the same output |
| Weather inference | Run `507f34fdc8e64d6786fdbfcfeb4a8487`; 27 scientific timesteps, 54 encoded frames, 6 fps | Reproduced diagnostic MP4; not old interactive 3D viewer or scientific promotion |
| Jobs | Actual recorded runs across the selected projects | Current run history, not a recreation of historical job counts |
| Workbench tour | Current comparison, Jobs, model and annotation views | Short review tour, not a recording of every full model execution |

All screenshots were captured through the real browser UI, without replacing
DOM content, masking errors, or substituting source media. Inference views reopen
existing completed reproduction runs and seek their checked results. Their
successful playback is separate from the original execution evidence recorded
in the [lifecycle release notes](releases/2026-09-23-lifecycle-restoration.md).
The fresh inference/dataset capture pass recorded no browser page errors.

[Exact public file hashes and video metadata](assets/showcase/manifest.json)
include original checked-output hashes where a publication encode differs.
BDD100K and Weather MP4 files preserve the checked bytes. In particular, Weather
SHA-256 `24af2f132695197b21d5728a2dc3aabb68eae245093f4eeb4e5b17e2f5164ebc`
matches the original product-page output.

The owner requested publication of these bounded demonstration excerpts.
They do not include model weights, dataset archives, access tokens, or local
state. [Media attribution and terms](assets/showcase/NOTICE.md) are separate
from the Apache-2.0 framework source. The gallery is repository documentation;
its media is excluded from the Python wheel and source distribution.

The first-use tutorial and automated browser suites continue to use explicitly
labelled synthetic fixtures. Those exercise reproducible UI contracts and are
not evidence of real model quality. They are no longer the README showcase.

Real Modal training remains unverified after the recorded upload block. No
paid compute was launched to prepare this publication correction. Full assistant
execution, advanced annotation, benchmark/evaluation and promotion workflows,
and the old Weather 3D experience remain outside the verified restoration.
