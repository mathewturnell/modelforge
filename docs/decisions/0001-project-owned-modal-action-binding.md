# Decision 0001: Owner-configured project Modal action binding

- Date: 2026-09-09
- Decision owner: human Mathew
- Coordination owner: Chloé
- Status: accepted for bounded public-alpha implementation; live execution and
  publication remain separately gated
- Intake candidate: `fe1ccd4e72c7ec5567ec1b5f128dd38b1df2ae51`
- Related source requirements: `FW-RUN-015`, `FW-RUN-016`,
  `PROD-EXEC-007`, `PROD-INF-002`, `PROD-INF-005`, and `PROD-UX-018`
- Precursor: source-repository Decision 0099

## Context

The public-alpha candidate has one shared Project, Run, Executor, Handler, and
Artifact lifecycle, but its Modal adapter is intentionally fixed to Synthetic
Threshold Lab. Registered real-project actions are local-only. The four-project
acceptance therefore cannot be achieved by changing only an app or function
name: the workbench also needs explicit provider authority, stale-confirmation
protection, durable idempotency, provider recovery, and honest resource and
cost presentation.

An authored `project.json` is inspectable project truth, not execution or
provider authority. The existing `modelforge.local-runtime-configuration/v1`
is an owner-only local-process configuration. Expanding either document to
silently authorize remote paid work would collapse established boundaries.

## Decision

Add one separate owner-only contract,
`modelforge.modal-action-binding/v1`, keyed by `(project_id, action_id)`. It is
stored below the installation's private state root with mode `0600`. It may
coexist with a local runtime configuration, but neither configuration implies
the other. A project may be Modal-only.

The binding is supplied explicitly by the local owner. It is not read from
project source, an authored manifest, browser storage, a result, or a provider
response. It contains no credential value. Modal credentials continue to be
resolved by the Modal SDK from the user's selected profile.

One alpha binding has this closed JSON shape:

```json
{
  "protocol": "modelforge.modal-action-binding/v1",
  "project_id": "qwen-prompt-lab",
  "action_id": "prompt",
  "provider": "modal",
  "environment": "modelforge-alpha-acceptance-20260909",
  "application": "modelforge-alpha-qwen-prompt",
  "function": "run_prompt",
  "compute": {
    "target": "modal-l4",
    "gpu": "L4",
    "gpu_count": 1,
    "cpu_millis": 1000,
    "memory_mib": 4096,
    "timeout_seconds": 600,
    "retries": 0,
    "max_containers": 1,
    "warm_containers": 0
  },
  "transport": {
    "protocol": "modelforge.modal-execution-result/v1",
    "max_stdout_bytes": 262144,
    "max_stderr_bytes": 262144,
    "max_artifacts": 8,
    "max_artifact_bytes": 2097152,
    "max_total_artifact_bytes": 2097152
  },
  "deployment": {
    "source_manifest_sha256": "64 lowercase hexadecimal characters",
    "resource_plan_sha256": "64 lowercase hexadecimal characters"
  },
  "assets": [
    {
      "id": "model",
      "role": "model",
      "provider_path": "/models/qwen",
      "verification": "revision",
      "revision": "immutable upstream revision"
    }
  ]
}
```

Normative validation for the implementation:

- `project_id` and `action_id` must match one registered, statically supported
  authored action. The binding cannot invent an action or change its kind or
  result protocol.
- `provider` is exactly `modal` in v1. Application, function, environment, and
  identifiers match `[A-Za-z0-9][A-Za-z0-9._-]{0,127}`; no client request can
  replace them.
- `compute` is a disclosure of the project-owned deployed function's declared
  resources. For this acceptance it permits one optional GPU, a single
  container, zero retries, zero warm containers, and a finite deadline. It is
  not a provider quote, observed usage, or billing cap. Counts, MiB, integer
  CPU millicores, and seconds are positive bounded integers; a CPU-only target
  uses `gpu: null` and `gpu_count: 0`.
- `transport` is bounded by the equal or stricter limits enforced in the Modal
  executor. The current `modelforge.modal-execution-result/v1` envelope is
  retained: exact run identity, bounded stdout/stderr, and digest-bound regular
  file payloads. A new result protocol is not justified by this acceptance.
- `deployment.source_manifest_sha256` binds a canonical allowlist of the
  project-owned deployment entrypoint and its packaged project code.
  `resource_plan_sha256` binds the canonical `compute` and `transport`
  declaration. ModelForge records both before dispatch; it does not claim to
  attest the deployed image or provider configuration.
- Each asset has a bounded ID and role. Its provider path is private and never
  appears in project/run public projections. At most sixteen assets are
  accepted. `provider_path` is a bounded absolute POSIX path with no `..`
  component. A `verification: sha256` asset requires one lowercase SHA-256 and
  non-negative integer `size_bytes`, and forbids `revision`. A multi-file model
  snapshot may instead use `verification: revision` with one bounded immutable
  `revision`, and forbids file digest and size fields. Roles are limited to
  `source`, `input`, `dataset`, `checkpoint`, and `model`. The selected local
  input/model identity in the action request must match the configured provider
  asset identity before dispatch.
- The binding's canonical SHA-256 excludes no field. It is shown in the
  workbench and retained in the durable run configuration so the user confirms
  the exact current target rather than a stale presentation.

Large source, data, checkpoint, and model acquisition or staging remains an
explicit setup operation. Starting a run never silently creates a Modal
environment, deploys an app, accepts external terms, uploads an undeclared
asset, installs dependencies, or changes a budget. Project-owned deployment
modules define their images and Volume mounts. The shared executor receives
only the already-authorized app/function/environment and private action
payload.

## Managed launch request

The unstable loopback HTTP adapter and CLI use the same application request:

```json
{
  "protocol": "modelforge.managed-action-request/v1",
  "execution": {
    "target": "modal",
    "idempotency_key": "caller-generated UUID",
    "binding_sha256": "the binding presented to the user",
    "billable_confirmed": true
  },
  "input": {
    "action-specific": "inference or prompt payload"
  }
}
```

The client supplies no application, function, environment, resource, Volume,
or credential field. A local launch continues to use `target: local` and does
not accept billable confirmation.

For Modal, a false or absent confirmation, malformed/reused idempotency key,
stale binding digest, unready binding, unavailable verified asset, or
unconfigured SDK credential fails before durable allocation or provider work.
The same idempotency key with the same canonical request returns the original
run; reuse with different content fails. The implementation should derive the
run identity from the project/action/idempotency scope or provide an equivalent
atomic uniqueness guarantee using the current persistence format. If that
cannot be done without a database migration, implementation stops for a new
decision.

After durable allocation, the private provider payload is:

```json
{
  "protocol": "modelforge.modal-project-action-request/v1",
  "run_id": "durable ModelForge run identity",
  "binding_sha256": "canonical owner binding identity",
  "project_id": "registered project identity",
  "action_id": "authored action identity",
  "action_kind": "inference or prompt",
  "request": {},
  "assets": []
}
```

`request` is the already validated private action request. Raw prompt content
may cross this provider boundary but is not copied into the public run
projection or process log. `assets` contains only the binding entries needed by
that action. Host-local paths and credentials are forbidden; the validated
provider paths come only from the owner binding.

## Lifecycle and presentation

Run Service remains authoritative. It creates the run before `Function.spawn`,
records the opaque `fc-*` identity only after acceptance, and commits success
only after the action handler validates the existing inference or prompt result
and Artifact Service validates every returned byte.

Browser closure does not cancel provider work. An attached process may poll the
call; after application restart the same binding and `fc-*` identity may
recover the unfinished call. Recovery never creates a new call. Cancellation
records requested state before calling Modal and becomes terminal `cancelled`
only after provider acknowledgement; a completion race may validly complete.
Unknown provider state remains running/unavailable and is not inferred from a
missing local process.

The project projection exposes only provider name, environment, declared
compute target/resources, binding digest, readiness, and a billable marker.
Provider asset paths and credentials remain private. The workbench labels
declared resources as planned and unreconciled. Missing live logs, progress,
scientific telemetry, usage, or price are shown as unavailable, never zero.
Bounded returned stdout/stderr may become a checked terminal process-log
artifact; that does not imply live Modal log streaming.

## Alternatives

- Put Modal fields in `project.json`: rejected because project-authored facts
  do not authorize credentials or paid execution.
- Extend `modelforge.local-runtime-configuration/v1`: rejected because it would
  couple remote readiness to a local interpreter and prevent a clean
  Modal-only example.
- Add a generic provider registry or arbitrary remote command runner: rejected
  as broader than the four-project acceptance and inconsistent with fixed
  project-owned actions.
- Add provider/object-store lifecycle tables: rejected unless the bounded
  transport or current Run record proves insufficient. No migration is
  authorized by this decision.

## Verification and stop gates

Before a paid call, qualification requires schema-derived positive/negative
tests, owner-only persistence and redaction checks, manifest/action mismatch
tests, durable-before-spawn and idempotency races, stale-confirmation rejection,
fake-SDK start/recovery/cancel/failure tests, result and artifact corruption
tests, browser reload/restart journeys, billable disclosure, and clean-install
setup evidence. Ordinary CI uses no account, provider, private repository,
large asset, or paid execution.

Live acceptance remains gated by the approved account/environment/ceiling,
asset and cloud-processing authority, exact deployment/asset identities, and a
separate pre-dispatch review. A schema migration, general provider abstraction,
training work, private patched source, modified protected asset, host/CUDA
change, hidden retry, warm container, or provider-side result larger than the
bounded transport triggers stop-and-replan.

## Documentation and release consequences

Implementation must synchronize `docs/architecture.md`,
`docs/product-boundary.md`, `docs/modal.md`, `docs/example-setup.md`, each
applicable example README/setup/template, `docs/release-status.md`, and
`CHANGELOG.md`. Support claims remain unchanged until exact-candidate live
evidence passes. The source manifest, licensing inventory, archive verifier,
and final artifact digests must be regenerated after the implementation; this
decision grants no publication, push, package upload, hosted deployment, or
training authority.
