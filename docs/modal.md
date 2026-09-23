# Optional Modal execution

ModelForge can send the bundled **Synthetic Threshold Lab** or one of four
fixed, owner-configured project actions to explicitly deployed Modal functions.
This is optional: the default install and local workflow do not import the
Modal SDK, require an account, or use the network.

The project functions cover BDD100K/MeMOTR selected-video inference,
SoccerNet/MOTR selected-sequence inference, TasteMatch base-SigLIP image
inference, and Qwen2.5-7B prompt execution. A separate explicitly bound MeMOTR box-head training function is described in
[bounded training](training.md). The four inference/prompt functions do not train. ModelForge does
not download, accept terms for, or redistribute their upstream source,
datasets, weights, checkpoints, media, prompts, or outputs. The account owner
acquires and stages exact assets before registering a private provider binding.
A passing run demonstrates the bounded integration shape, not model quality or
general Modal compatibility.

## Boundary

ModelForge creates the durable run before it asks Modal to spawn the function.
The Run Service remains authoritative for requested, running, cancellation,
and terminal state. The Modal adapter stores only the provider name, declared
compute target, and opaque `fc-*` FunctionCall identity. It collects one
bounded result envelope into the run's private evidence directory; the normal
Artifact Service then validates and registers those local bytes.

The adapter uses the Modal SDK's own credential resolution. Tokens never belong
in project manifests, CLI arguments, run configuration, logs, or artifacts.
`MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET`, when set, take precedence over the
active token in `~/.modal.toml`. ModelForge always passes the chosen Modal
environment explicitly.

The synthetic packaged function is fixed to:

- app: `modelforge-alpha-synthetic`
- function: `run_synthetic_threshold`
- resources: 0.125 CPU, 128 MiB memory, 60-second timeout, zero retries, at
  most one container, and zero warm containers
- no GPU, secret, volume, schedule, dataset upload, model download, or provider
  object store

The example directories additionally define fixed functions and named input
volumes. Their checked `project.modal.template.json` files disclose the exact
GPU/CPU/memory/timeout/retry/container bounds. The accepted shapes are BDD100K
on one L40S for two frames, SoccerNet on one L40S for 24 frames, TasteMatch on
one L4 for one image, and Qwen on one L40S for at most four messages and 64 new
tokens. Each has zero retries, at most one container, and zero warm containers.
Volume mounts are not represented as read-only by Modal's API; every function
therefore verifies staged identities and writes only beneath its temporary
output directory. Treat the named volumes as owner-controlled inputs.

## Install and configure

Replace placeholders such as `<ENV>` and `<STATE>` before running these
commands. Use a dedicated non-production Modal environment.

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install 'modelforge-workbench[modal]==0.1.0a1'
.venv/bin/python -m modal setup
.venv/bin/python -m modal token info
.venv/bin/python -m modal profile current
.venv/bin/python -m modal environment create <ENV>
```

`modal setup`, token/profile inspection, and environment creation can contact
Modal; environment creation changes workspace state. Review the active account
before using them.

Deploying and running are networked, billable provider actions. Inspect the
source and your active Modal workspace before deployment:

```bash
.venv/bin/python -m modal deploy --env <ENV> -m modelforge_workbench.example.modal_app
.venv/bin/modelforge modal status --environment <ENV>
.venv/bin/modelforge demo run \
  --executor modal \
  --modal-environment <ENV> \
  --confirm-billable \
  --state-root <STATE>
.venv/bin/modelforge runs list --state-root <STATE> --project synthetic-threshold
```

`modal status` is local-only: it reports whether the optional SDK and a token
appear configured, while provider verification remains `not_performed`. It
does not authenticate, deploy, invoke, or estimate cost. `--confirm-billable`
records informed intent; it is not a price cap and does not guarantee that a
provider action remains within a budget.

The command waits for the bounded function call and records the returned
result through the shared Run and Artifact services. `runs list` shows the
durable state and available outputs. Scientific telemetry is unavailable for
this synthetic action and is reported as unavailable rather than zero. For
provider-side live logs, use `.venv/bin/python -m modal app logs` in a second terminal.

### Owner-bound real-project action

From a reviewed source checkout, first follow the selected example README and
`setup.json`. Acquire every upstream component yourself. Create a dedicated
non-production Modal environment and the exact named input volume from that
example's `modal_app.py`, then stage only the bounded files named by its
`project.modal.template.json`. Use Modal's own `volume put` command and verify
local and remote sizes/digests before deployment; never place credentials in a
manifest or binding.

Copy `project.local.template.json` and `project.modal.template.json` outside
the distribution, replace all placeholders, and keep both files owner-only.
The local configuration supplies project/action/sample identities for the
workbench. The Modal binding separately supplies the fixed app/function,
resource plan, transport bounds, deployment identity, and staged asset
identities:

```bash
.venv/bin/modelforge project register --state-root <STATE> --config /secure/<PROJECT>.local.json
.venv/bin/modelforge modal register --state-root <STATE> --config /secure/<PROJECT>.modal.json
.venv/bin/python -m modal deploy --env <ENV> examples/<PROJECT>/modal_app.py
.venv/bin/modelforge serve --state-root <STATE>
```

Registration is local-only and makes no provider call. Starting the action in
the compiled workbench requires selecting Modal and checking the billable-action
confirmation. Project-authored manifests cannot choose an app, function,
environment, credential, or compute target. Recovery reattaches to the recorded
`fc-*` call and never starts another call.

If the client stops after Modal accepted the call, recover the same unfinished
run rather than creating a second lifecycle:

```bash
.venv/bin/modelforge action recover-modal \
  --state-root <STATE> \
  --project <PROJECT_ID> \
  --run-id <RUN_ID>
```

Recovery is accepted only for a durable unfinished Modal run with a coherent
`fc-*` identity and the same recorded environment/function/resource target.

## Cost, cancellation, and cleanup

Modal charges for compute and may apply plan-specific credits or limits. Check
current [pricing](https://modal.com/pricing), [billing behavior](https://modal.com/docs/guide/billing),
and [budget controls](https://modal.com/docs/guide/budgets) in your own
workspace. A tiny CPU request should be inexpensive, but ModelForge does not
quote or enforce the final invoice. Network transfer, build time, minimum
charges, retries outside this function, taxes, or future provider changes can
affect cost.

ModelForge records cancellation intent before calling `FunctionCall.cancel()`.
It reports cancellation as confirmed only when the SDK observes provider
cancellation. A race may complete normally after cancellation was requested.
Inspect and stop unexpected provider state explicitly:

```bash
.venv/bin/python -m modal app list --env <ENV>
.venv/bin/python -m modal app logs modelforge-alpha-synthetic --env <ENV>
.venv/bin/python -m modal app stop modelforge-alpha-synthetic --env <ENV>
.venv/bin/python -m modal billing report
```

Stopping an app can interrupt active calls. Confirm the exact app/environment
before doing so. Removing local `<STATE>` does not stop provider work, and
stopping/deleting provider state does not remove local ModelForge evidence.

## Verification status

Fake-SDK qualification verifies lazy imports, durable-before-spawn ordering,
explicit environment selection, bounded materialization, artifact registration,
cancellation ordering, and `fc-*` recovery without a network call.

An authorized live acceptance in a dedicated environment additionally passed
all four real project actions through the compiled workbench. BDD100K and
SoccerNet produced checked native video; TasteMatch produced a checked native
table; Qwen produced checked assistant text. A separate Qwen call recorded the
request and provider-confirmed cancellation timestamps, and a successful Qwen
call recovered the same durable run and `fc-*` identity after a local server
restart. Preserved failed calls exposed deployment, dependency, compatibility,
and result-correlation defects before those defects were corrected.

This evidence is bound to one owner account, environment, revision, and staged
asset set. It does not promise availability, performance, cost, or compatibility
for another account, region, dependency/model revision, or input. Before any
release claim, rebuild the exact candidate artifact, install it directly, stop
the exact disposable apps, reconcile provider resources/cost, and retain the
local evidence report. Publication remains a separate human decision.

Official references: [getting started](https://modal.com/docs/guide),
[account setup](https://modal.com/docs/guide/modal-user-account-setup),
[tokens](https://modal.com/docs/cli/latest/token),
[SDK configuration](https://modal.com/docs/sdk/py/latest/config),
[profiles](https://modal.com/docs/cli/latest/profile),
[environments](https://modal.com/docs/guide/environments),
[function invocation](https://modal.com/docs/guide/function-invocation-methods),
[FunctionCall API](https://modal.com/docs/sdk/py/latest/FunctionCall), and
[app operations](https://modal.com/docs/cli/latest/app).

## Live run evidence

When the installed SDK exposes per-FunctionCall logs, the executor streams
bounded stdout/stderr into the existing run view. Observation stops at completion
or cancellation and has independent byte, entry, and duration limits. Missing
stream support leaves live logs unavailable and still retains validated final
output. Scientific training events are validated before live display; completed
charts are rebuilt from digest-checked artifact journals. The stream never
confers run success, promotion, or provider billing authority.
