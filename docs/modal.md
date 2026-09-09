# Optional Modal execution

ModelForge can send the bundled **Synthetic Threshold Lab** smoke test to one
fixed, explicitly deployed Modal CPU function. This is an optional integration:
the default install and local workflow do not import the Modal SDK, require an
account, or use the network.

The example remains synthetic. It processes four authored numeric values and
does not train or load a model. A successful provider run demonstrates the
shared managed Run/Artifact lifecycle, not model quality or general Modal
compatibility.

This workflow has no external data or model location to configure: the four
CC0 numeric samples ship with ModelForge. Real-project assets are never sent to
Modal by this integration.

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

The packaged function is fixed to:

- app: `modelforge-alpha-synthetic`
- function: `run_synthetic_threshold`
- resources: 0.125 CPU, 128 MiB memory, 60-second timeout, zero retries, at
  most one container, and zero warm containers
- no GPU, secret, volume, schedule, dataset upload, model download, or provider
  object store

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

If the client stops after Modal accepted the call, recover the same unfinished
run rather than creating a second lifecycle:

```bash
.venv/bin/modelforge demo recover-modal \
  --run-id <RUN_ID> \
  --modal-environment <ENV> \
  --confirm-billable \
  --state-root <STATE>
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

The non-paid qualification uses an injected fake SDK to verify lazy imports,
durable-before-spawn ordering, explicit environment selection, bounded result
materialization, artifact registration, cancellation ordering, and `fc-*`
recovery. It makes no Modal request.

A single authorized live run is necessary before claiming that the published
package currently works with Modal. It is not necessary to merge or test the
adapter locally, and it must not be performed without account, network, and
billable-action authority.

### Approval-only live validation plan

No step in this plan has been executed during non-paid qualification. After a
separate approval, use a dedicated `modelforge-alpha-validation` environment,
deploy exactly `modelforge_workbench.example.modal_app`, and invoke exactly one
Synthetic Threshold run with `--confirm-billable`. The function is capped at
0.125 CPU, 128 MiB, 60 seconds, zero retries, and one container; it has no GPU,
volume, secret, dataset, or model input. Expected elapsed time is under five
minutes including a first deployment, with the function itself bounded to one
minute. Expected function compute is below USD 0.01 at the reviewed pricing,
but this is an estimate rather than a budget cap; build, transfer, account,
tax, and pricing changes may alter the charge.

The approval must name the Modal workspace/account, set a maximum authorized
all-in spend, and bind the validation to the exact candidate revision and
built-wheel SHA-256. Before publication, install that reviewed wheel directly;
do not assume a package index already serves the intended `0.1.0a1` bytes.

After verifying the durable completed run, two checked JSON artifacts, and the
provider logs, stop the exact app in that environment and inspect the billing
report. Preserve the local run evidence until review; deleting it does not stop
provider work. If deployment or execution fails, do not create a second call
until the app list, call identity, logs, and remaining resources have been
checked.

Official references: [getting started](https://modal.com/docs/guide),
[account setup](https://modal.com/docs/guide/modal-user-account-setup),
[tokens](https://modal.com/docs/cli/latest/token),
[SDK configuration](https://modal.com/docs/sdk/py/latest/config),
[profiles](https://modal.com/docs/cli/latest/profile),
[environments](https://modal.com/docs/guide/environments),
[function invocation](https://modal.com/docs/guide/function-invocation-methods),
[FunctionCall API](https://modal.com/docs/sdk/py/latest/FunctionCall), and
[app operations](https://modal.com/docs/cli/latest/app).
