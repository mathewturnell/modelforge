# ModelForge

ModelForge is an early, open-source, local-first ML development workbench for
developers working with coding agents. Agents supply coding intelligence;
ModelForge supplies inspectable project contracts, durable local run state,
checked artifacts, and a consistent browser journey.

The installed Python library uses the `modelforge_workbench` namespace. The
human-facing command and versioned wire protocols retain the `modelforge` name.

This `0.1.0a1` alpha is intentionally small. It is useful without an
embedded assistant. One shared Project/runtime-configuration/Dataset/Run/Artifact path has been
qualified with both selected-video inference and prompt-only inference, while
the four selected real-project action shapes have also completed through the
same owner-bound Modal lifecycle. The bundled synthetic workflow keeps
installation and CI lightweight. This is
not universal ML support, autonomous scientific judgment, production
readiness, or completion of the broader ModelForge architecture.

## Install

The supported alpha matrix is Linux x86-64 and CPython 3.12.

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install .
```

The installed base has no third-party runtime dependencies. Project-specific
ML libraries belong to the project environment; ModelForge does not install or
download them automatically.

## First workflow

Run the bundled, offline synthetic example in a disposable state directory:

```bash
.venv/bin/modelforge demo run --state-root /tmp/modelforge-alpha-state
.venv/bin/modelforge runs list --state-root /tmp/modelforge-alpha-state
```

The first command creates a durable SQLite run before starting a subprocess,
validates its inference result, verifies two JSON artifacts by size and
SHA-256, and commits the artifacts and successful terminal state atomically.
It uses four authored numeric samples and makes no quality claim.
ModelForge creates a missing state root with mode `0700`, records an ownership
marker, and creates its database with mode `0600`. It rejects broad system/home
paths, symlinked paths, permissive roots, and non-empty unowned directories
instead of changing or writing through them. Use a new path or an empty
directory that you explicitly secured to mode `0700`.

Start the browser workbench against the same state:

```bash
.venv/bin/modelforge serve --state-root /tmp/modelforge-alpha-state
```

Open the tokenized loopback URL printed by the command. Restarting the service
with the same state directory recovers the recorded run and artifacts. The
browser is a projection; closing it does not cancel a managed process.

Inspect an authored project without importing or executing its code:

```bash
.venv/bin/modelforge project capabilities \
  --manifest examples/synthetic-threshold/project.json
```

The result deliberately says `runtime_readiness: not_evaluated` and
`execution_authorized: false`. Static inspection is not permission to run.

## Real-project integrations

`modelforge examples path` locates installed authored manifests, integration
source, setup declarations, and owner-only runtime-configuration templates.
Preview external setup without changing the machine:

```bash
.venv/bin/modelforge examples setup plan \
  --example bdd100k-road-scene-lab \
  --external-root /srv/modelforge-examples
```

Fetching and isolated dependency installation are separate, explicit,
confirmation-gated commands. Manual or gated assets are bound with `--use`;
setup never accepts upstream terms, embeds credentials, imports fetched source,
or starts a workload. See [Explicit example setup](docs/example-setup.md).

- **BDD100K Road Scene Lab:** selected local video plus a pinned MeMOTR
  checkpoint through the shared dataset, managed inference, artifact, and
  native video path. It declares no training. BDD media, MeMOTR source, and the
  checkpoint remain user-acquired inputs.
- **Qwen2.5-7B Prompt Lab:** bounded prompt-only execution through the same run,
  executor, artifact, and UI services. It declares no dataset or training. The
  exact pinned Qwen snapshot is user-acquired and offline; substantial memory
  is required for local CPU execution.
- **SoccerNet Tracking:** bounded selected-sequence MOTR inference through the
  shared managed lifecycle. Training remains excluded and the dataset,
  checkpoint, and pinned upstream source remain user-acquired.
- **TasteMatch:** bounded base-SigLIP image inference with a native checked
  table result. It does not use or claim a trained TasteMatch adapter; training
  remains excluded.

The nineteen retained real-example Python files have individual provenance
records. Seventeen appear independently authored and remain pending publishing
rights confirmation; two BDD100K inference files conservatively retain
MeMOTR-derived terms and attribution plus pending ModelForge additions. See each
example's `PROVENANCE.md`,
[`example-source-inventory.json`](example-source-inventory.json), and
[Licensing](docs/licensing.md).

## Optional Modal workflow

The Synthetic Threshold Lab and separately owner-configured BDD100K,
SoccerNet, TasteMatch, and Qwen actions can use the existing managed
Run/Artifact lifecycle through fixed Modal functions. Modal is optional and
disabled from ordinary local use and CI. Real-project source/data/model assets
are acquired and staged by the user, never downloaded implicitly by
ModelForge. Install the `modal` extra, authenticate with Modal's tooling,
choose an environment explicitly, register an owner-only binding, and confirm
each billable launch. ModelForge does not promise free execution or enforce a
provider budget. Follow the [Modal setup tutorial](docs/modal.md).

## Alpha boundary

Supported:

- bounded JSON v1 manifest reading and authored capability inspection;
- shallow authored `project.json` registration plus separate owner-only runtime
  configuration for local inference and prompt actions;
- bounded dataset catalogs, content-checked sample selection, and authenticated
  local video preview;
- one bundled offline inference-shaped installation/CI example;
- shared local process execution with bounded output, a host deadline, and
  process-group cancellation;
- project-scoped durable SQLite run transitions and terminal recovery;
- action-specific inference/prompt result validation;
- assistant-only prompt result persistence, with raw requests retained only in
  owner-only run input;
- checked local artifacts and range-capable media access with storage paths
  removed from public views;
- a token-protected, loopback-only browser journey for dataset, prompt, status,
  logs, artifacts, text, and video results.

Unattached unfinished rows recovered after a workbench restart are shown as
stale/unavailable, never as observably live. Graceful server shutdown cancels
owned local actions, records their bounded process log, and joins their
finalizer; active process resume after abrupt host loss is not supported.

Experimental:

- the HTTP routes under `/api/v1` and local runtime-configuration format are
  alpha delivery/configuration contracts, not stable public APIs;
- BDD100K, SoccerNet, TasteMatch, and Qwen have bounded live Modal acceptance
  evidence on one owner account and exact staged inputs; their heavyweight
  environments and assets are not installed by ModelForge and other accounts,
  regions, revisions, or inputs remain unverified;
- the broader Phase 1–3 Python application modules are reusable but have no
  compatibility guarantee before beta;
- v1 compatibility inspection can describe more action shapes than this
  alpha is prepared to launch;
- the optional Modal executor and four fixed project deployments are alpha
  integrations, not a general provider abstraction or availability promise;
  declared resources are not a quote or enforced budget.

Excluded:

- annotation editing, arbitrary action interfaces, or dynamic project UI code;
- managed training, frozen evaluation/promotion, scalar telemetry charts,
  model compilation, and automatic or implicit environment setup;
- general provider support, hosted operation, billing management, commercial
  identity, deployment, object storage, desktop/updater, embedded assistants,
  and IDE extensions;
- GPU frameworks, model weights, datasets, checkpoints, media, private project
  code, and production/sandbox claims.

See [Architecture](docs/architecture.md), [Agent integration](docs/agent-integration.md),
[Product boundary](docs/product-boundary.md), [Modal setup](docs/modal.md),
[Release status](docs/release-status.md), and [Security](SECURITY.md).

## Status and license

The framework source is marked Apache-2.0. Contributions use Apache-2.0 section
5 while contributors retain copyright; no CLA or assignment is required.
Publication remains blocked until the accountable rights holder confirms every
pending real-example source group and approves the exact revision and
publishing identity. Name guidance is limited to truthful origin/compatibility
and non-endorsement, with no trademark-registration claim. See
[Licensing](docs/licensing.md).
