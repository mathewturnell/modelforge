<p align="center">
  <img src="docs/assets/modelforge-wordmark.svg" width="520" alt="ModelForge">
</p>

<h3 align="center">Inspectable local ML workflows, from project action to checked artifact.</h3>

<p align="center">
  <a href="#quickstart">Quickstart</a> ·
  <a href="docs/example-setup.md">Examples</a> ·
  <a href="docs/modal.md">Modal</a> ·
  <a href="docs/architecture.md">Architecture</a> ·
  <a href="SECURITY.md">Security</a> ·
  <a href="docs/releases/0.1.0a1.md">Release notes</a>
</p>

<p align="center">
  <a href="https://github.com/mathewturnell/modelforge/actions/workflows/ci.yml"><img src="https://github.com/mathewturnell/modelforge/actions/workflows/ci.yml/badge.svg" alt="Public alpha CI"></a>
</p>

<p align="center">
  <code>public alpha 0.1.0a1</code> · <code>Linux x86-64</code> ·
  <code>Python 3.12</code> · <code>Apache-2.0</code>
</p>

> [!IMPORTANT]
> ModelForge is an early, trusted-local developer preview—not a hosted service,
> sandbox, training framework, or production-deployment guarantee.

ModelForge is an open-source, local-first ML development workbench for
developers working with coding agents. Projects keep ownership of their models,
datasets, task semantics, and algorithms. ModelForge provides the reusable
workflow around them: inspectable contracts, bounded inputs, durable run state,
checked artifacts, and a consistent loopback browser experience.

It works without an embedded assistant. Agents can use the same visible,
auditable operations as a developer; they do not become a hidden execution or
scientific authority.

This release combines the clean public service architecture with a compiled
React workbench. The intended local product includes project and source
workflows, datasets and annotation, model and architecture inspection,
training and run comparison, inference and jobs, local settings, and a local
ModelForge Coding Assistant integration. Features are enabled only when a real
server-owned service and project capability support them; incomplete areas stay
visible as explicit implementation gaps instead of disappearing from the
product definition or pretending to work.

The currently proven execution slice is one shared Project/runtime
configuration/Dataset/Run/Artifact path for selected-video and prompt-only
inference, including four owner-bound Modal action shapes. See
[`docs/requirements.md`](docs/requirements.md) for the exact implemented,
partial, and planned status of every product area.

## Why ModelForge?

| Principle | What it means in practice |
| --- | --- |
| **Projects own the science** | Model code, metrics, datasets, prompts, and task-specific behavior stay in the project. |
| **ModelForge owns the workflow** | Declared actions enter one managed Project → Dataset → Run → Executor → Artifact lifecycle. |
| **Evidence stays inspectable** | Run identity is durable before process start, terminal state is explicit, and artifacts are verified by size and SHA-256. |
| **Local means local** | The default server is token-protected and loopback-only. Remote execution is optional, explicit, and separately authorized. |

```text
project.json + owner-only runtime configuration
                     │
                     ▼
        Project and Dataset services
                     │
                     ▼
      durable Run ──► local Executor
                     │
                     ▼
       checked Artifacts and results
                     │
                     ▼
       CLI + tokenized loopback UI
```

## Quickstart

The alpha supports Linux x86-64 with CPython 3.12. ModelForge itself has no
third-party runtime dependencies; project-specific ML libraries belong in the
project environment.

```bash
git clone https://github.com/mathewturnell/modelforge.git
cd modelforge
python3.12 -m venv .venv
.venv/bin/python -m pip install .
```

Run the bundled offline workflow in a disposable state directory:

```bash
.venv/bin/modelforge demo run --state-root /tmp/modelforge-alpha-state
.venv/bin/modelforge runs list --state-root /tmp/modelforge-alpha-state
```

The demo creates a durable SQLite run before starting a subprocess, validates
its inference-shaped result, and verifies two JSON artifacts. It uses four
authored numeric samples, requires no account or network access, and makes no
model-quality claim.

Open the workbench against the same state:

```bash
.venv/bin/modelforge serve --state-root /tmp/modelforge-alpha-state
```

Visit the tokenized loopback URL printed by the command. Restarting the service
with the same state directory recovers recorded runs and artifacts. Closing the
browser does not cancel a managed process.

ModelForge creates a missing state root with mode `0700`, records an ownership
marker, and creates its database with mode `0600`. It rejects broad system or
home paths, symlinked paths, permissive roots, and non-empty unowned directories
instead of changing or writing through them.

## Inspect before executing

Inspect an authored project without importing or executing its code:

```bash
.venv/bin/modelforge project capabilities \
  --manifest examples/synthetic-threshold/project.json
```

Inspection reports `runtime_readiness: not_evaluated` and
`execution_authorized: false`. A valid manifest describes a project; it does
not grant permission to run it.

## Real-project integrations

ModelForge includes integration code and setup declarations—not upstream
repositories, datasets, weights, checkpoints, caches, or prior outputs.

| Example | Managed action | What the alpha demonstrates |
| --- | --- | --- |
| [**BDD100K Road Scene Lab**](examples/bdd100k-road-scene-lab/README.md) | Selected-video inference | Bounded video selection, pinned MeMOTR checkpoint identity, durable execution, and native checked video playback. No training is declared. |
| [**Qwen2.5-7B Prompt Lab**](examples/qwen-prompt-lab/README.md) | Prompt-only inference | Bounded messages and generation settings, pinned model identity, durable prompt execution, and checked assistant text. No dataset or training is declared. |
| [**SoccerNet Tracking**](examples/soccernet-tracking/README.md) | Selected-sequence inference | A second tracked-video shape using the same managed lifecycle. Training remains excluded. |
| [**TasteMatch**](examples/tastematch/README.md) | Base-SigLIP image inference | Bounded image input and a native checked table result. It does not claim or use a trained TasteMatch adapter. |

Preview a real example’s external setup plan without changing the machine:

```bash
.venv/bin/modelforge examples setup plan \
  --example bdd100k-road-scene-lab \
  --external-root /srv/modelforge-examples
```

Fetch and dependency installation are separate, explicit, confirmation-gated
commands. ModelForge never accepts upstream terms on your behalf, embeds
credentials, imports fetched source, or starts a workload during planning. See
[Explicit example setup](docs/example-setup.md) for the complete flow.

## Optional Modal execution

The same managed Run and Artifact lifecycle can target fixed, owner-configured
Modal functions for the synthetic lab and the four real-project action shapes.
Modal support is optional and disabled in ordinary local use and CI.

Remote use requires the optional dependency, the user’s own authenticated
Modal account, an explicit environment and owner-only binding, and confirmation
for every billable launch. ModelForge does not promise free execution or enforce
a provider budget. Follow the [Modal setup tutorial](docs/modal.md).

## Security model

- Project actions are **trusted local code** and run with the invoking user’s
  host permissions. ModelForge is not a sandbox.
- The workbench binds to loopback, requires its generated bearer token, and
  removes raw storage paths from browser-facing artifact views.
- State and artifacts are project-scoped; registered artifacts are rechecked
  before serving and support bounded byte ranges for media playback.
- Credentials, private project assets, datasets, weights, checkpoints, and run
  outputs do not belong in this repository or agent conversations.

Read [SECURITY.md](SECURITY.md) before registering real project code or enabling
a remote executor.

## Alpha scope

<details>
<summary><strong>Supported now</strong></summary>

- Bounded JSON v1 manifest reading and authored capability inspection.
- Shallow `project.json` registration with separate owner-only local runtime
  configuration for inference and prompt actions.
- Bounded dataset catalogs, content-checked sample selection, and authenticated
  local video preview.
- Shared local process execution with bounded output, a host deadline, and
  process-group cancellation.
- Project-scoped durable SQLite run transitions and terminal recovery.
- Action-specific inference and prompt-result validation.
- Assistant-only prompt-result persistence, with raw requests retained only in
  owner-only run input.
- Checked local artifacts and range-capable media access with storage paths
  removed from public views.
- Token-protected compiled React UI for project switching, dataset or prompt
  input, status, logs, artifacts, text, and video results.
- One bundled offline inference-shaped installation and CI example.

</details>

<details>
<summary><strong>Experimental</strong></summary>

- HTTP routes under `/api/v1` and the local runtime-configuration format.
- BDD100K, SoccerNet, TasteMatch, and Qwen integrations outside their exact
  bounded acceptance inputs and environments.
- The reusable Phase 1–3 Python application modules before beta.
- Optional Modal execution and fixed project deployments outside the recorded
  owner environment. Declared resources are not a quote or enforced budget.

</details>

<details>
<summary><strong>Planned or partial</strong></summary>

- Bounded project, source, and Git workflows plus local settings.
- Local annotation with held-out-data protection.
- Safe architecture and model inspection.
- Managed local training, validation, compatible run comparison, and jobs.
- The project-scoped local ModelForge Coding Assistant service.

</details>

<details>
<summary><strong>Deliberately excluded</strong></summary>

- Dynamic project-supplied UI code, implicit environment setup, and arbitrary
  unreviewed action interfaces.
- General provider control, hosted operation, customer tenancy, billing,
  commercial identity, application publication, object-storage administration,
  desktop updates, and production claims.
- Bundled GPU frameworks, model weights, datasets, checkpoints, media, private
  project code, or sandbox claims.

</details>

An unfinished local process that disappears after abrupt host loss reconciles
to failure; active-process resume is not supported. Completed durable records
remain recoverable. See [Product boundary](docs/product-boundary.md) and
[Release status](docs/release-status.md) for the precise qualification record.

## Release, architecture, and contribution

- [Release notes for `0.1.0a1`](docs/releases/0.1.0a1.md)
- [Architecture](docs/architecture.md)
- [Agent integration](docs/agent-integration.md)
- [Contributing](CONTRIBUTING.md)
- [Licensing and provenance](docs/licensing.md)

The framework source is Apache-2.0. Contributions use Apache-2.0 section 5;
contributors retain copyright and no CLA or assignment is required. Two
BDD100K integration files preserve their recorded upstream terms alongside the
Apache-2.0 ModelForge additions. See [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES)
and the per-example `PROVENANCE.md` files for details.
