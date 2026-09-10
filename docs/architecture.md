# Architecture

The alpha composes browser-neutral contracts and services into local product
workflows. The compiled React client is a presentation adapter, never the
owner of project files, credentials, execution, lifecycle state, or artifacts:

```text
compiled React loopback workbench / CLI (unstable delivery)
                         |
             Example Setup Service
               | plan | fetch | install
               |      external owner-only roots
                         |
       Project Service --+-- owner runtime configuration
                         |             |
                         +-- Dataset Service
                                      |
                          action-specific binder
                         |
              Run Service -> Executor
                         |       |    |
                         |     local  optional Modal
                  Artifact Service <-+
                         |
               SQLite + checked files
```

Project Service stores only a shallow authored manifest registration and emits
the schema-authoritative, non-authorizing capability projection. A distinct
owner-only runtime-configuration service stores local interpreter, executable,
dataset, and model/checkpoint paths and emits redacted readiness. Its reads do
not create state, and the same project ID cannot be silently reassigned.
Dataset Service pages a bounded
catalog and resolves only a declared relative sample whose regular-file type,
size, and SHA-256 still match. The generic action binder resolves explicit
placeholders for inference or prompt actions; it contains no project-name
branch. Python virtual-environment interpreter invocation paths are preserved
because resolving such a symlink would select the base interpreter.

The Example Setup Service is a pre-registration boundary, not an executor or
dependency manager. Its declarative plans describe upstream identity, terms,
external destinations, environment needs, supported actions, and current
qualification. Planning is read-only. Confirmed fetching can create only
pinned clean Git checkouts or bounded digest-verified files below an owner-only
external root; manual and gated inputs use explicit existing-path bindings.
Confirmed installation creates an isolated venv and can install only a packaged,
digest-checked requirements file. None of these operations imports fetched
source, registers a project, or runs a workload. Project ML imports remain
deferred until the existing managed action starts in that project environment.

The Run Service creates project-scoped durable identity before private request
and output paths are bound or a subprocess starts. Raw prompt messages remain
in an owner-only per-run request file, while durable SQLite stores their digest,
count, generation settings, and model revision. Durable configuration also
records content-only runtime, action, executable, interpreter, environment, and
source-revision identities without exposing paths. The Local Executor owns only a
process group, bounded output streams, a host deadline, and signal delivery. Action handlers
validate `modelforge.inference-result/v1` or
`modelforge.prompt-result/v1`; inference success requires at least one artifact
and exact input/checkpoint correlation, while prompt success requires a non-empty
assistant-only response list so echoed user/system messages cannot become
durable result artifacts. Artifact success is committed with terminal
success after regular-file, containment, size, and SHA-256 checks.

Every local managed action receives run-owned work/evidence/cache roots, Python cache
redirection, Hugging Face/Transformers offline flags, and no ambient
`PYTHONPATH`. BDD, SoccerNet, TasteMatch, and Qwen use the same
Project/Run/Executor/Artifact/UI path; only their project-authored adapters and
typed inputs/results differ.

The optional Modal adapter does not create another lifecycle. The same managed
action service allocates the durable run before SDK submission, retains an
opaque `fc-*` function-call identity, records cancellation intent before
provider cancellation, materializes one bounded run-bound result into the
owned evidence directory, and hands those bytes to the same Artifact Service.
The provider surface is limited to the packaged Synthetic Threshold function
and four fixed, owner-bound example functions. Credentials remain owned by the
Modal SDK. Live acceptance covers only the recorded account, environment,
resources, staged assets, and exact action bounds; it is not a general provider
or availability claim.

[Decision 0001](decisions/0001-project-owned-modal-action-binding.md) records
the accepted extension for real-project Modal actions.
It adds a separate owner-only binding keyed by project and authored action; it
does not add provider authority to `project.json` or redefine the local runtime
configuration. The bounded implementation and live evidence passed; broader
provider and training claims remain excluded.

[Decision 0002](decisions/0002-compiled-react-public-workbench.md) records the
recovery architecture. The mature local UX is adapted to additive public
service contracts. Project/source/Git, annotation, model inspection, training,
run comparison, jobs, settings, and Coding Assistant functionality must each
remain behind a typed server-owned port. A React control cannot become active
until that service exists, is capability-authorized, and has matching tests.
The status of those service slices is recorded in
[`requirements.md`](requirements.md); absence is a gap to implement, not an
architecture decision to remove the product area.

The workbench binds only `127.0.0.1`, uses a per-launch bearer token, validates
Host and mutation Origin, disables CORS, and emits restrictive browser headers.
Authenticated media is fetched into page-owned `blob:` URLs allowed only by the
media CSP. Artifact/sample endpoints support byte ranges; public JSON never
contains storage locators or registered paths.

The application can call a process live only while its executor handle is
attached in that workbench process. After restart, an unfinished unattached row
is projected as stale/unavailable and is not polled or offered for cancellation
as though it were live. Graceful loopback shutdown requests cancellation of
every owned action, retains its bounded checked process log on confirmed
cancellation, and joins the in-process finalizer. An abrupt host loss cannot
resume the process and remains an explicit nonclaim.

## Product and release boundary

The target local architecture includes bounded project/source/Git services,
annotation, safe model inspection, training/evaluation services with held-out
protection, run comparison, jobs, settings, and a project-scoped local Coding
Assistant. They are not all implemented in this candidate. Active subprocess
resume after service restart, dynamic project renderers, arbitrary action
interfaces, and stable HTTP/Python compatibility remain nonclaims.

Commercial identity, customer tenancy, billing, hosted operation,
Cloudflare/application publication, general provider/object-storage control,
desktop/updater distribution, and production service are outside the public
architecture.

## Package namespace

The installed package is `modelforge_workbench`; the CLI and wire protocols
retain the ModelForge name.
