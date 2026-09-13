<p align="center">
  <img src="docs/assets/modelforge-wordmark.svg" width="520" alt="ModelForge — open-source ML workbench">
</p>

<h3 align="center">A shared workbench for ML projects built with coding agents.</h3>

<p align="center">
  <a href="#quickstart">Quickstart</a> ·
  <a href="docs/getting-started.md"><strong>Your first experiment</strong></a> ·
  <a href="#examples">Examples</a> ·
  <a href="docs/modal.md">Modal</a> ·
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

<p align="center">
  <a href="https://github.com/mathewturnell/modelforge/actions/workflows/ci.yml"><img src="https://github.com/mathewturnell/modelforge/actions/workflows/ci.yml/badge.svg" alt="Public alpha CI status"></a>
  <br>
  <code>public alpha 0.1.0a1</code> · <code>Linux x86-64</code> ·
  <code>Python 3.12</code> · <code>Apache-2.0</code>
</p>

ModelForge is an open-source ML workbench for developers building projects
with coding agents. Agents help you develop and integrate the ML code;
ModelForge supplies the reusable interface around it: choose inputs, configure
supported experiments, start runs, follow execution, and inspect the outputs.

Today, the public alpha supports checked dataset loading, revisioned annotation,
registered local training, selected-input inference, and prompt workflows
through one consistent local application. You can follow run status and logs,
inspect checked metrics and checkpoints, watch video results, inspect result
tables, read model responses, and reopen completed runs later. Projects still
own their model code, datasets, task semantics, recipes, and environments—
ModelForge does not claim universal project compatibility, scientific validity,
or control how a coding agent behaves.

![The current ModelForge workbench showing project selection, product navigation, readiness, and run output](docs/assets/screenshots/01-project-overview.png)

<p align="center"><sub>Select a registered project, move between its available workflows, and keep run evidence in view. This capture uses an explicitly labelled synthetic documentation fixture.</sub></p>

<table>
  <tr>
    <td width="50%">
      <img src="docs/assets/screenshots/03-annotation-editor.png" alt="The revisioned annotation editor showing a checked synthetic visual sample and normalized box">
      <br><sub>Review a checked sample and save digest-bound annotation sidecars without changing source data.</sub>
    </td>
    <td width="50%">
      <img src="docs/assets/screenshots/04-training-dashboard.png" alt="The managed training dashboard showing recorded metrics, logs, and checked checkpoint artifacts">
      <br><sub>Run a declared local trainer and inspect only recorded metrics and checked artifacts.</sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="docs/assets/screenshots/03-vision-result.png" alt="A completed synthetic vision-shaped run with logs, checked artifacts, and native video playback">
      <br><sub>Follow a vision-shaped run from logs to checked native video.</sub>
    </td>
    <td width="50%">
      <img src="docs/assets/screenshots/05-qwen-result.png" alt="A completed synthetic Qwen-shaped prompt run with its checked assistant response">
      <br><sub>Enter a prompt and read the checked assistant response.</sub>
    </td>
  </tr>
  <tr>
    <td colspan="2">
      <img src="docs/assets/screenshots/06-tastematch-result.png" alt="A completed synthetic TasteMatch-shaped run rendered as a semantic result table">
      <br><sub>Inspect TasteMatch's implemented base-SigLIP result shape as a native table. The shown scores are authored documentation data, not model-quality evidence.</sub>
    </td>
  </tr>
</table>

## Why use ModelForge?

- **Work with the inputs you can see.** Browse a bounded sample catalog, select
  a video or image, and preview checked content before launch.
- **Keep curation separate from source data.** Save revisioned labels, notes,
  and normalized boxes in owner state, bound to the exact sample digest.
- **Train through the same evidence path.** Declared project trainers produce
  durable state, logs, recorded metrics, and checked checkpoint artifacts.
- **Keep execution understandable.** Choose a ready target, start an inference
  or prompt action, and follow explicit queued, running, failed, cancelled, or
  completed state with bounded logs and progress when the action reports it.
- **Inspect useful results in place.** Play video, view images, read assistant
  text, and explore semantic result tables without switching to a project-only
  web application.
- **Come back to the evidence.** Completed runs and their checked artifacts
  remain available after a browser reconnect or workbench restart.
- **Use your actual Codex account.** Settings connects the OS user's ChatGPT
  account through Codex App Server; the project assistant makes real Codex
  turns instead of returning canned project summaries.
- **Choose where supported work runs.** Use local compute by default or an
  explicitly configured function in your own Modal account.

## What works today

The implemented public-alpha path covers project registration and switching,
checked dataset samples, revisioned digest-bound annotation sidecars, registered
local training, prompt entry, managed local inference/prompt execution, run
status and cancellation, bounded logs, digest-checked metrics/checkpoints and
native video/image/text/table results, plus recovery of completed run records.
The bundled Synthetic Threshold Lab remains the smallest offline installation
check; named-project conformance fixtures exercise the complete UI/backend path
without loading upstream data, models, checkpoints, providers, or paid compute.

Only recorded training metrics are plotted; absent scientific telemetry is not
shown as zero. Source and Git workflows, model/architecture inspection,
validation and scientific run comparison, and broader settings remain planned
or partial. ModelForge Coding Assistant is Codex-backed and project-scoped in a
read-only sandbox; write authority, attachments, and delegation remain disabled.
The retained real-model
examples still expose only their reviewed inference or prompt adapters; their
training prerequisites and recipes remain project-owned. See the exact
[product boundary](docs/product-boundary.md) for the status of each area.

## Quickstart

ModelForge currently supports Linux x86-64 with CPython 3.12. The base package
has no third-party runtime dependency; real ML examples use their own isolated
environments and user-acquired assets.

```bash
git clone https://github.com/mathewturnell/modelforge.git
cd modelforge
python3.12 -m venv .venv
.venv/bin/python -m pip install .
```

Verify the installation without an account, model download, or GPU:

```bash
.venv/bin/modelforge demo run --state-root /tmp/modelforge-alpha-state
.venv/bin/modelforge serve --state-root /tmp/modelforge-alpha-state
```

`serve` prints and opens a tokenized loopback URL. Stop it with `Ctrl-C`; start
it again with the same state directory to reopen completed runs and outputs.

To use ModelForge Coding Assistant, install the Codex CLI, then open
**Settings → ModelForge Coding Assistant**. An existing `codex login` session
is detected automatically, or Settings can start Codex's ChatGPT sign-in flow.
Codex owns the credential; ModelForge stores only its own project-scoped
conversation and run projection.

> [!TIP]
> Continue with **[Your first ModelForge experiment](docs/getting-started.md)**
> for a screenshot-backed tour, a BDD100K tracking workflow, Qwen Prompt Lab,
> result recovery, optional Modal execution, and troubleshooting.

## Examples

The repository contains ModelForge integration code and setup declarations.
It does not redistribute upstream repositories, datasets, weights,
checkpoints, media, prompts, or prior outputs.

| Example | ML task | Input → output | Before you run |
| --- | --- | --- | --- |
| [**BDD100K Road Scene Lab**](examples/bdd100k-road-scene-lab/README.md) | MeMOTR road-object tracking | One selected local MP4 → checked native tracking video | Acquire BDD100K MOT data, pinned MeMOTR source/checkpoint, and a compatible CUDA environment. |
| [**Qwen2.5-7B Prompt Lab**](examples/qwen-prompt-lab/README.md) | Bounded instruction prompting | User prompt and generation settings → checked assistant text | Acquire the exact external model snapshot (~15.2 GiB); CPU works slowly, while compatible CUDA is practical. |
| [**SoccerNet Tracking**](examples/soccernet-tracking/README.md) | MOTR player/ball tracking | One selected sequence → checked native tracking video | Acquire gated SoccerNet data, pinned MOTR source, a compatible checkpoint, and CUDA. |
| [**TasteMatch**](examples/tastematch/README.md) | Base-SigLIP food-image similarity | One selected image → checked five-row score table | Acquire Food-101 and the pinned SigLIP snapshot. No trained TasteMatch adapter or training path is supported. |

Preview any example's setup without changing the machine:

```bash
.venv/bin/modelforge examples setup plan \
  --example bdd100k-road-scene-lab \
  --external-root /srv/modelforge-examples
```

Fetch and installation steps are separate and confirmation-gated. Follow the
[worked guide](docs/getting-started.md) or the lower-level
[example setup reference](docs/example-setup.md) before registering real code.

## Optional Modal execution

Supported action shapes can target fixed functions in the user's own Modal
account. Install the optional dependency, authenticate with Modal's tooling,
deploy the reviewed example function, and register its owner-only binding.
In the workbench, select the `modal` execution target and confirm that the exact
launch may incur charges; status, cancellation, logs, and checked results stay
in the same ModelForge run view.

ModelForge does not quote or enforce provider spend, and removing local state
does not stop remote work. Follow the [Modal account and cleanup tutorial](docs/modal.md)
before deploying or starting anything billable.

## Alpha limits and technical documentation

This is an early trusted-local developer preview, not a hosted service,
sandbox, complete training environment, or production-deployment guarantee.
Project actions run with the invoking user's operating-system permissions.
An active local process cannot resume after an abrupt service/host loss;
completed run records remain recoverable. Native 200% browser zoom and an
end-user screen-reader session remain accepted but unverified alpha checks.

- [Your first experiment](docs/getting-started.md)
- [Architecture](docs/architecture.md) and [requirements/status](docs/requirements.md)
- [Security model](SECURITY.md) and [agent integration](docs/agent-integration.md)
- [Licensing and provenance](docs/licensing.md) and [third-party notices](THIRD_PARTY_NOTICES)
- [Contributing](CONTRIBUTING.md) and [release qualification](docs/release-status.md)

The framework source is Apache-2.0. Contributors retain copyright under the
Apache-2.0 section 5 inbound policy; no CLA or assignment is required. Two
BDD100K integration files preserve their recorded upstream terms alongside the
Apache-2.0 ModelForge additions.
