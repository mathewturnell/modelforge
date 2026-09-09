# BDD100K Road Scene Lab

This integration runs the pinned MeMOTR checkpoint on one ModelForge-selected
local MP4 and emits a checked `modelforge.inference-result/v1` video result. It
declares no training action and makes no tracking-quality claim.

## 1. Obtain external components

Review the no-write plan, then explicitly fetch only the public MeMOTR source:

```bash
modelforge examples setup plan --example bdd100k-road-scene-lab --external-root /srv/modelforge-examples
modelforge examples setup fetch --example bdd100k-road-scene-lab --external-root /srv/modelforge-examples --only memotr-source --confirm
```

Acquire BDD100K MOT 2020 data and the published MeMOTR BDD checkpoint manually
under their upstream access terms. ModelForge does not authenticate, accept
terms, or download them. Reuse existing material and verify the checkpoint:

```bash
sha256sum /models/memotr_bdd100k.pth
# expected: c90604ab0b4036d1f6b0d5ff4be7c1ea41ff581e344b234fb802b24f9d3487bd
modelforge examples setup fetch --example bdd100k-road-scene-lab --external-root /srv/modelforge-examples \
  --use bdd100k-data=/data/bdd100k --use memotr-checkpoint=/models/memotr_bdd100k.pth --confirm
```

## 2. Configure an isolated environment

```bash
modelforge examples setup install --example bdd100k-road-scene-lab --external-root /srv/modelforge-examples --confirm
```

This creates an empty Python 3.12 venv. Install the pinned MeMOTR requirements,
OpenCV, PyYAML, NumPy, ffmpeg, and a PyTorch build compatible with the existing
host CUDA runtime yourself. ModelForge does not change CUDA or system packages
and does not execute the fetched checkout during setup.

## 3. Open the project

Copy `project.local.template.json` outside the distribution. Set its interpreter,
MeMOTR source, BDD root, selected-video size/SHA-256, checkpoint path/SHA-256,
and output/cache paths to external locations, then register it:

```bash
modelforge project register --state-root /tmp/modelforge-state --config /secure/bdd100k.local.json
modelforge serve --state-root /tmp/modelforge-state
```

## 4. Run the supported workflow

Use the browser's Inference view, or submit the equivalent request through
`modelforge action run`. The qualified boundary is checkpoint-bound,
selected-video inference on Linux x86-64 with compatible CUDA. Direct project
scripts remain debugging paths and do not demonstrate managed-run behavior.

## 5. Logs and results

The shared lifecycle creates the durable run before process start. Bounded logs,
result metadata, and digest-checked video artifacts live below the owner-only
state root and remain recoverable after browser reconnect/service restart.

## 6. Limits and terms

BDD100K media/annotations, MeMOTR source, checkpoint, and outputs are external.
See `setup.json`, `PROVENANCE.md`, upstream license/access links in the setup
plan, and the repository licensing page. Two adapter files retain conservative
MeMOTR-derived MIT treatment; ModelForge additions remain pending ownership
confirmation.
