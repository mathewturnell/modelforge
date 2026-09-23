# SoccerNet Tracking

This example preserves ModelForge-owned inspection/inference adapter source.
Bounded selected-sequence managed inference has live Modal acceptance evidence;
training is not supported.

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

## 3. Register the project

```bash
modelforge project capabilities --manifest examples/soccernet-tracking/project.inspectable.json
modelforge project register --state-root /tmp/modelforge-state --config /secure/soccernet.local.json
```

Copy `project.local.template.json` outside the distribution and replace every
placeholder with exact acquired source/data/checkpoint identities. For Modal,
separately deploy `modal_app.py`, stage only the bounded selected sequence and
checkpoint in the named owner volume, fill `project.modal.template.json`, and
register that owner-only binding as described in
[`docs/modal.md`](../../docs/modal.md).

## 4. Supported workflow

The accepted path runs exactly 24 frames from one explicitly selected sequence
against pinned clean MOTR source and a digest-bound compatible checkpoint. It
completed through the compiled workbench and shared Run/Artifact lifecycle on
one owner-staged Modal L40S environment. This does not qualify arbitrary
sequences, checkpoints, accounts, regions, training, or tracking quality.
Training remains unsupported, including the open reserved-test/self-promotion
prerequisite.

## 5. Logs and results

The accepted run retained a bounded process log, checked result envelope,
manifest, and native MP4 beneath owner-only local state. Browser and server
restart projection reopens the same digest-checked artifacts. Direct scripts
remain low-level debugging paths only.

## 6. Limits and terms

SoccerNet footage/annotations and checkpoints remain external. MOTR includes
mixed file-level notices; no MOTR bytes or patch are distributed. See
`setup.json`, `PROVENANCE.md`, and [`docs/licensing.md`](../../docs/licensing.md)
before any future patch or
runtime claim.

## Checked local sequence excerpts

`infer_selected.py` accepts a `modelforge.soccernet-local-selection/v1` JSON
selection with an explicit split, sequence, maximum frame count (up to 750), and
exact filename/size/SHA-256 inventory. `MODELFORGE_SOCCERNET_DATASET_ROOT` binds
the owner-acquired dataset; `MODELFORGE_MOTR_SOURCE_ROOT` binds clean pinned
upstream code. The adapter copies only selected frames into run-owned storage,
uses serial loading to avoid long multiprocessing socket paths, and binds the
result to the selected descriptor and checkpoint. It does not modify the
independent 24-frame Modal contract. Current local verification completed 125
SNMOT-060 frames (5 seconds), including the showcased seconds 2–5 excerpt.
This is a tracking demonstration, not ball-detection or benchmark evidence.
