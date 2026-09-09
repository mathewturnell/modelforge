# TasteMatch

This source-visible example retains a bounded Food-101 index reader and fixture
plus pinned-local SigLIP inference engines. Dataset inspection is fixture-
qualified; real managed inference and training are not qualified.

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

## 3. Inspect the project

```bash
modelforge project capabilities --manifest examples/tastematch/project.inspectable.json
```

There is no runnable local configuration template in this candidate.

## 4. Supported workflow

Public CI exercises the bounded path-only index with authored PPM-like fixtures.
Real Food-101/SigLIP inference is source-visible but not workbench-qualified.
Training/provider execution is unsupported and its dependency-identity,
materialization, summary, and telemetry drift remains unresolved.

## 5. Logs and results

No qualified TasteMatch managed run is started by this alpha, so no run logs or
results are claimed. Any future runnable integration must use the shared
Run/Executor/Artifact lifecycle rather than the removed project web application.

## 6. Limits and terms

Food-101 images, SigLIP weights, trained adapters, prompts, and outputs remain
external. See `setup.json`, `PROVENANCE.md`, and
[`docs/licensing.md`](../../docs/licensing.md) for exact upstream identities and
terms.
