# Public alpha recovery status

The React recovery candidate is approved for qualification and clean
publication. Mathew Turnell approved the earlier exact React source inventory
at recovery commit `10dda5f37c550902a0ae2e0d7ff16b75ba59b928` on 2026-09-11,
then explicitly directed restoration of the established UI/UX from the
Apache-licensed archive and connection of every exposed workflow to the public
backend on 2026-09-12. The final exact React file identities and dependency
graph are recorded in `react-source-inventory.json`. This approval does not
approve write-capable Git or assistant services. Mathew separately confirmed
authorization to replace `mathewturnell/modelforge` with only the qualified
clean `main`, apply protection, and make it public. Tags, GitHub Releases,
package publication, service deployment, and paid workloads remain outside
that authorization.

The recovery is being built in a clean standalone Git object store derived
from the Apache candidate. The commercially classified repository history is
not a permissible release input. The approved clean-publication sequence
requires the exact source and dependency inventory, security exposure,
candidate digest, hosted checks, and remote state to remain verifiable through
publication.

The Modal acceptance apps from the previously qualified baseline are stopped
and their dedicated staging volumes were deleted.

## Current local recovery evidence

- The restored React client is limited to 101 inventoried source, asset,
  configuration, and lock files from the Apache-licensed archive plus bounded
  public adaptations. Commercial
  API clients, identity, billing, hosting, and deployment surfaces are absent.
- The public client uses only additive `/api/v1` projections and supports
  project selection, authenticated dataset inspection, sample-bound visual and
  conversation annotation, local training, inference/prompt execution, durable
  jobs, cancellation, recovery, checked artifacts, logs, telemetry, native
  result previews, read-only project assistant chat, and Modal readiness.
- Eighty-nine React tests, TypeScript checking, the production build, and 240
  Python tests pass. Monaco language workers and the architecture/chart chunks
  remain code-split from the primary shell.
- Twenty-one packaged-loopback browser journeys exercise the compiled client at
  desktop and 390-pixel widths, including Axe and accessibility-tree gates.
  Four redistributable conformance projects each cover dataset loading,
  persisted annotation, annotation-bound training metrics/checkpoint evidence,
  and inference or prompt results. These fixtures qualify framework plumbing,
  not scientific model quality.
- The npm production and full development graphs report zero known
  vulnerabilities with Vitest 4.1.11.
- The exact 101-file React source inventory and locked dependency graph
  are bound to the implementation revision identified in the inventory. The
  boundary verifier must pass this source-licensing gate before publication.

## Previously qualified baseline evidence

- Four example setup declarations and one explicit plan/fetch/install CLI.
- All external source, data, weights, checkpoints, caches, environments, and
  outputs remain outside Git and package archives.
- BDD100K, SoccerNet, TasteMatch, and Qwen use the shared managed lifecycle;
  each has a bounded, current live Modal acceptance run through the compiled
  workbench. Training remains excluded.
- Nineteen retained Python files have individual provenance dispositions in
  `example-source-inventory.json`. Seventeen independently authored files use
  Apache-2.0. Two BDD100K files retain a notice-preserving `MIT AND Apache-2.0`
  treatment and the upstream attribution chain.
- Archive verification reports all member counts and excludes only directory
  container entries from payload inspection.

## Fresh real-workflow evidence

The final technical review registered both supported real examples through the
public CLI, selected their input through the compiled loopback workbench, and
started them through the shared Project/Run/Executor/Artifact services. All new
state, work, cache, log, result, and artifact bytes are below the owner-only
disposable root `/tmp/modelforge-public-alpha-real-final`; external source,
data, checkpoint, model cache, manifests, databases, and prior outputs remained
unchanged.

| Workflow | Current evidence |
| --- | --- |
| BDD100K Road Scene Lab | Run `603b47a89fad4d97bf58153bbd3dfd8d` was durably allocated, bound the training-split video SHA-256 `f68d5e82…` and checkpoint SHA-256 `c90604ab…`, and completed two real CUDA frames. The checked H.264 result is 90,227 bytes with SHA-256 `c3d0a6e4…`; manifest, result envelope, and bounded process log were also registered. |
| Qwen2.5-7B Prompt Lab | Run `147f82ec5f0e4b498dd39dd34460adbf` was durably allocated, bound exact model revision `a09a3545…`, and completed one eight-token maximum real CPU prompt. The assistant-only artifact is 32 bytes with SHA-256 `6cd018c3…`; result envelope and bounded model-load log were also registered. |

Both results remained selectable after a browser reload and after a real server
restart with the same state root. Native video and assistant-text previews
recovered, every registered artifact returned a checked `206` byte range, and
the public run projection exposed neither a storage reference nor a home path.
Scientific telemetry is unavailable for these inference/prompt actions and is
shown as unavailable; BDD operational frame progress and bounded process logs
were present. This is integration evidence, not model-quality evidence.

## Live Modal acceptance evidence

The authorized provider acceptance used the `mathewturnell` Modal workspace and
the dedicated `modelforge-alpha-acceptance-20260909` environment. Four fixed
apps and four dedicated input volumes were created for the checkpoint. Runs
were serial, retry count was zero, warm-container count was zero, and the human
approved a USD 10 incremental gross ceiling. All source, dataset, model,
checkpoint, request, output, and provider identities were recorded outside the
repository under owner-only `/tmp/modelforge-modal-acceptance-live` state.

| Project | Current accepted managed run |
| --- | --- |
| BDD100K Road Scene Lab | Run `b80c119692b1651ca5f43e1394b1ed32`, provider call `fc-01M241GG4A9PYNJSNVXYN1D41A`, completed two frames on L40S. Native MP4: 89,799 bytes, SHA-256 `d594ab10da4a2ab60068d3c7a93da74ef3425b5e629cfc6560d14161e8a7f18c`. |
| SoccerNet Tracking | Run `ef117a5c285c4d6c747eaf9df62e1b6b`, provider call `fc-01M2430GHPBMS1T2BH1XT4FNMP`, completed 24 selected training-split frames on L40S. Native MP4: 24,046 bytes, SHA-256 `58afb8fba93789f7c7c3b6f1e141bd0951aaf7b755ce91afae9a304f359e138b`. |
| TasteMatch | Run `994a64676d09445f13a747f69cc62dd5`, provider call `fc-01M243ANWHGP0JB50HR10DKEDQ`, completed one base-SigLIP image on L4. Checked table: 758 bytes, SHA-256 `c7da18b961aeb1e36ff80c81ef9a360bb20d38c34a9a54a59136f96cbda58ad0`. No trained adapter was used. |
| Qwen2.5-7B Prompt Lab | Run `8c840bec445fe3d65d2a75eb245774de`, provider call `fc-01M244BWN76K50P8M9YFKE7JWB`, completed on L40S after the local workbench restarted and recovered the same call. Checked assistant text: 19 bytes, SHA-256 `e9617ad608d43d4db66f703efd3779aef9383b881f411b4923b93accf79078a2`. |

Separate Qwen run `81a986bdac810755838477b677372316`
recorded billable launch, cancellation request, exact provider termination, and
durable confirmation as `cancelled`. Earlier preserved calls remain explicit
failures: they exposed archive layout, selected-split, dependency closure,
legacy torchvision parsing, PyTorch checkpoint loading, input-result
correlation, tokenizer dependency, and delayed provider-cancellation issues.
Tests were added for each corrected code path; failures were not rewritten as
success.

After restart, BDD100K and SoccerNet rendered native video, TasteMatch rendered
a bounded semantic HTML table, and Qwen rendered checked assistant text at
1280- and 390-pixel widths without page errors or horizontal overflow. Video
artifacts returned authenticated 32-byte `206` ranges and exact content-range
headers; every non-video artifact returned its registered byte count.
Scientific telemetry and live provider usage remain unavailable rather than
zero. The operator recorded a pre-run Modal monthly value of USD 12.98947888,
but did not retain that initial summary file; the retained final summary is USD
13.67947888 with billed cost still USD 0 after account credits/free storage.
The two retained detailed hourly reports independently sum to USD 0.69118354,
which substantiates spend below the authorized USD 10 ceiling and is consistent
with the monthly values' cent-rounded USD 0.69 difference. After evidence
capture, all recorded acceptance and intermediate apps were stopped, all four
dedicated input volumes were deleted, and the environment reported no deployed
app, volume, or active container. Declared resource plans remain disclosures,
not quotes or budget enforcement.

The revised wheel plus source distribution contain 527 archive members in
total. The verifier inspected all 476 regular-file payloads and excluded 51
directory-container records because they carry no payload. Symbolic links and
other non-regular members are rejected rather than counted as exclusions. This
resolves the earlier count discrepancy: “total” described archive records,
while the former inspection count described only file payloads.

## Publication decisions and unverified checks

Mathew Turnell confirmed sufficient publishing and Apache-2.0 relicensing
authority for the seventeen independently authored integration files and the
ModelForge additions in the two MeMOTR-derived files on 2026-09-10. The two
derived files keep their recorded upstream MIT/Apache terms and notices. The
selected inbound policy is Apache-2.0 section 5 with contributors retaining
copyright, no CLA or assignment, and no separate company-exclusive or
commercial licence. The ModelForge name guidance is limited to truthful
origin/compatibility and non-endorsement; no trademark registration or
clearance is claimed.

The publication decision retains the two BDD100K-derived files under their
notice-preserving mixed treatment. If a SoccerNet patch against the retained,
locally modified MOTR checkout is ever distributed, that exact patch and
MOTR's mixed file-level notices require a separate review; no such patch is in
this candidate.

Native browser 200% zoom and an end-user screen-reader session remain
**unverified alpha checks accepted for repository publication**, not passed
checks. The only current graphical environment is the user's active
GNOME Wayland desktop, with no isolated compositor, OS-level input driver, or
verifiable speech capture; taking control was not appropriate. Automated
390-pixel reflow, axe, keyboard, and Chrome accessibility-tree evidence must not
be represented as those manual checks.

`mathewturnell/modelforge` becomes the canonical public release source only
after every pre-publication ref is replaced by the qualified single-root
`main`, the hosted public-alpha gates pass, branch protection is applied, and
anonymous access is verified. A correct tip commit alone does not make an
object store containing legacy refs publishable.
