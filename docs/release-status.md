# Public alpha release status

This candidate is prepared for final publication review but is **not approved
for publication**. No push, package upload, deployment, or visibility change
has occurred.

## Implemented release boundary

- Four example setup declarations and one explicit plan/fetch/install CLI.
- All external source, data, weights, checkpoints, caches, environments, and
  outputs remain outside Git and package archives.
- BDD100K selected-video inference and Qwen prompt execution retain the shared
  managed lifecycle; SoccerNet and TasteMatch remain setup/inspection examples,
  not newly qualified workloads.
- Fifteen retained Python files have individual provenance dispositions in
  `example-source-inventory.json`. Thirteen appear independently authored but
  remain pending ownership confirmation. Two BDD100K files retain conservative
  MeMOTR-derived treatment, inherited Apache terms where applicable, and the
  upstream attribution chain.
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

The revised wheel plus source distribution contain 272 archive members in
total. The verifier inspected all 237 regular-file payloads and excluded 35
directory-container records because they carry no payload. Symbolic links and
other non-regular members are rejected rather than counted as exclusions. This
resolves the earlier count discrepancy: “total” described archive records,
while the former inspection count described only file payloads.

## Publication blockers

The accountable human must confirm the publishing rights holder and sufficient
relicensing rights for the thirteen independently authored integration files
and the ModelForge additions in the two MeMOTR-derived files. The selected
inbound policy is Apache-2.0 section 5 with contributors retaining copyright,
no CLA or assignment, and no separate company-exclusive or commercial licence.
The ModelForge name guidance is limited to truthful origin/compatibility and
non-endorsement; no trademark registration or clearance is claimed.

For the two BDD100K-derived files, the final publication decision must choose
between retaining the notice-preserving mixed treatment recorded here or a
later independently authored refactor against upstream interfaces. If a
SoccerNet patch against the retained, locally modified MOTR checkout is ever
distributed, that exact patch and MOTR's mixed file-level notices require a
separate review; no such patch is in this candidate.

Native browser 200% zoom and an end-user screen-reader session remain manual
release checks. The only current graphical environment is the user's active
GNOME Wayland desktop, with no isolated compositor, OS-level input driver, or
verifiable speech capture; taking control was not appropriate. Automated
390-pixel reflow, axe, keyboard, and Chrome accessibility-tree evidence must not
be represented as those manual checks.

The preferred GitHub destination, `mathewturnell/modelforge`, is currently an
occupied private repository with its original multi-branch history. It was
inspected read-only and left unchanged. The clean one-root candidate must not be
pushed into that repository and made public while its private refs remain.
