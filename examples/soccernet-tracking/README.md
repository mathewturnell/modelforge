# SoccerNet Tracking

This example preserves ModelForge-owned inspection/inference adapter source. In
this alpha, setup and static inspection are supported; real managed inference
and training are not qualified.

## 1. Obtain external components

```bash
modelforge examples setup plan --example soccernet-tracking --external-root /srv/modelforge-examples
modelforge examples setup fetch --example soccernet-tracking --external-root /srv/modelforge-examples --only motr-source --confirm
```

The fetch creates a clean detached MOTR checkout at
`8690da3392159635ca37c31975126acf40220724`. Obtain SoccerNet data through its
official registration/terms process and choose a separately reviewed compatible
checkpoint, then bind existing paths with `--use`. ModelForge never accepts an
NDA/terms, collects credentials, or downloads match data.

## 2. Configure an isolated environment

```bash
modelforge examples setup install --example soccernet-tracking --external-root /srv/modelforge-examples --confirm
```

This creates an empty Python 3.12 venv. Install a host-compatible CUDA/PyTorch,
torchvision, OpenCV, NumPy, ffmpeg, the pinned MOTR requirements, and the
official SoccerNet client manually. Setup does not execute fetched code.

## 3. Inspect the project

```bash
modelforge project capabilities --manifest examples/soccernet-tracking/project.inspectable.json
```

There is no runnable local configuration template in this candidate. Do not
register or invoke the adapter as a claimed public-alpha managed action.

## 4. Supported workflow

Only setup planning/acquisition and static capability inspection are supported.
The historical real provider workflow used a privately modified MOTR checkout;
the clean pinned upstream checkout lacks ModelForge's bounded/progress changes.
Acquisition therefore does not qualify inference. Training remains unsupported,
including the open reserved-test/self-promotion prerequisite.

## 5. Logs and results

No public-alpha SoccerNet run is created, so there are no qualified shared-run
logs or results. Future managed execution must use the common lifecycle; direct
scripts remain low-level debugging paths only.

## 6. Limits and terms

SoccerNet footage/annotations and checkpoints remain external. MOTR includes
mixed file-level notices; no MOTR bytes or patch are distributed. See
`setup.json`, `PROVENANCE.md`, and [`docs/licensing.md`](../../docs/licensing.md)
before any future patch or
runtime claim.
