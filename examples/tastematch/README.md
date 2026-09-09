# TasteMatch

This example retains a bounded Food-101 index reader and pinned-local SigLIP
inference. Dataset inspection is fixture-qualified; bounded base-SigLIP managed
inference has live Modal acceptance evidence. Training is not qualified.

## 1. Obtain external components

```bash
modelforge examples setup plan --example tastematch --external-root /srv/modelforge-examples
```

Review Food-101's image-use notice and acquire it yourself. Acquire exact SigLIP
revision `9fdffc58afc957d1a03a25b10dba0329ab15c2a3` through official Hugging Face
tooling, then bind existing paths:

```bash
modelforge examples setup fetch --example tastematch --external-root /srv/modelforge-examples \
  --use food101-data=/data/food-101 \
  --use siglip-model=/models/siglip/snapshots/9fdffc58afc957d1a03a25b10dba0329ab15c2a3 --confirm
```

ModelForge does not download the dataset/model, authenticate, or accept terms.
The revision-directory binding is not a full multi-file model digest.

## 2. Configure an isolated environment

```bash
modelforge examples setup install --example tastematch --external-root /srv/modelforge-examples --confirm
```

This creates an empty Python 3.12 venv. Install a reviewed host-compatible
PyTorch/Transformers, Pillow, and NumPy stack manually. Setup does not import the
model or execute fetched code.

## 3. Register the project

```bash
modelforge project capabilities --manifest examples/tastematch/project.inspectable.json
modelforge project register --state-root /tmp/modelforge-state --config /secure/tastematch.local.json
```

Copy `project.local.template.json` outside the distribution and replace every
placeholder with exact acquired input/model identities. For Modal, separately
deploy `modal_app.py`, stage one selected image and the pinned model snapshot in
the named owner volume, fill `project.modal.template.json`, and register the
owner-only binding described in [`docs/modal.md`](../../docs/modal.md).

## 4. Supported workflow

Public CI exercises the bounded path-only index with authored PPM-like fixtures.
One owner-staged real image completed base-SigLIP inference through the compiled
workbench on Modal L4 and produced a native checked five-row score table. It did
not load a trained TasteMatch adapter and makes no classification-quality claim.
Training is unsupported and its dependency-identity, materialization, summary,
and telemetry drift remains unresolved.

## 5. Logs and results

The accepted managed run retained its result envelope and table artifact under
owner-only state and re-rendered the table after service restart at desktop and
compact widths. The shared Run/Executor/Artifact lifecycle owns the evidence;
the removed project web application is not required.

## 6. Limits and terms

Food-101 images, SigLIP weights, trained adapters, prompts, and outputs remain
external. See `setup.json`, `PROVENANCE.md`, and
[`docs/licensing.md`](../../docs/licensing.md) for exact upstream identities and
terms.
