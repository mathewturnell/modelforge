# Explicit example setup

The four real-project examples ship ModelForge integration code and declarative
setup metadata. Upstream repositories, datasets, model snapshots, checkpoints,
credentials, caches, and outputs stay outside the source tree and distribution.
Planning never downloads, installs, imports project code, or starts a workload.

Choose an owner-only external root that is not your home directory, a Git
worktree, or the installed distribution. Preview an example first:

```bash
modelforge examples setup plan \
  --example bdd100k-road-scene-lab \
  --external-root /srv/modelforge-examples
```

The JSON plan names each upstream identifier, immutable revision when one is
available, destination, verification method, access and license links,
environment requirements, supported actions, and qualification status.

## Acquire external inputs

Fetch only public Git or digest-bound download entries after reviewing the plan:

```bash
modelforge examples setup fetch \
  --example bdd100k-road-scene-lab \
  --external-root /srv/modelforge-examples \
  --only memotr-source \
  --confirm
```

Manual or gated assets are never fetched. Bind an existing checkout, dataset,
checkpoint, or model cache instead:

```bash
modelforge examples setup fetch \
  --example bdd100k-road-scene-lab \
  --external-root /srv/modelforge-examples \
  --use memotr-source=/opt/ml/MeMOTR \
  --use bdd100k-data=/data/bdd100k \
  --use memotr-checkpoint=/models/memotr_bdd100k.pth \
  --confirm
```

Git inputs must be clean and at the declared detached commit. ModelForge
refuses modified, untracked, wrong-revision, conflicting, symlinked, or partial
destinations; it never resets or overwrites them. Digest-bound files must match
their declared SHA-256. Multi-file model snapshots without a published digest
are identified by their exact revision-directory binding and remain explicitly
less strongly verified. Setup state contains local paths, is written with mode
`0600`, and remains below the external root.

## Install dependencies

Environment creation is a separate confirmed step:

```bash
modelforge examples setup install \
  --example qwen-prompt-lab \
  --external-root /srv/modelforge-examples \
  --confirm
```

This creates a project-local virtual environment. It does not execute fetched
source. Only Qwen currently carries a reviewed direct-requirements file, and
installing those dependencies requires the additional explicit flag:

```bash
modelforge examples setup install \
  --example qwen-prompt-lab \
  --external-root /srv/modelforge-examples \
  --confirm --install-requirements
```

The direct pins are not a hash-locked transitive environment and installation
may contact package indexes. BDD100K, SoccerNet, and TasteMatch require manual
environment assembly against the user's existing CUDA/ML stack; ModelForge
does not change the host, CUDA, or system packages.

## Configure and run

Acquisition and installation do not register a project or authorize execution.
Copy the applicable `project.local.template.json` outside the distribution,
fill it with the external paths and interpreter, and then use:

```bash
modelforge project register --state-root /tmp/modelforge-state --config /secure/project.local.json
modelforge serve --state-root /tmp/modelforge-state
modelforge action run --state-root /tmp/modelforge-state --project PROJECT_ID --request /secure/request.json
```

For an optional user-owned Modal target, deploy the selected example's fixed
`modal_app.py`, stage its bounded acquired assets in the named owner volume,
fill `project.modal.template.json` outside the distribution, and register it
separately with `modelforge modal register`. See [Modal setup](modal.md).

The workbench and CLI use the existing shared Project, Dataset, Run, Executor,
Handler, and Artifact lifecycle. Logs, run records, and checked artifacts live
below the selected owner-only state root. The example-specific instructions
state which actions are actually runnable:

- [BDD100K Road Scene Lab](../examples/bdd100k-road-scene-lab/README.md)
- [Qwen2.5-7B Prompt Lab](../examples/qwen-prompt-lab/README.md)
- [SoccerNet Tracking](../examples/soccernet-tracking/README.md)
- [TasteMatch](../examples/tastematch/README.md)

External acquisition does not grant rights. Users must review and satisfy the
upstream terms, access gates, authentication requirements, and hardware limits.
