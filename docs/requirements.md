# Public alpha requirements and traceability

This register records the clean public implementation. It deliberately does
not copy implementation status from the commercially classified development
repository. `planned` and `partial` describe gaps; they are not release claims.

| ID | Status | Requirement | Primary evidence |
| --- | --- | --- | --- |
| `PUB-ARCH-001` | implemented | Project, runtime configuration, dataset, run, executor/handler, and artifact services remain delivery-neutral; browser delivery imports no project implementation or provider credential. | application service tests; `docs/architecture.md` |
| `PUB-ARCH-002` | partial | Every enabled local product feature is exposed through a typed service port and additive `/api/v1` projection before its React control is enabled. Overview, read-only source/Git, structural model inspection, and project-evidence assistant ports are implemented; write-capable and excluded features remain disabled. | API schema/route tests; feature rows below |
| `PUB-UI-001` | implemented | The packaged root route serves one compiled React workbench with the mature ModelForge shell and no commercial or project-supplied UI code. | React build; package/distribution tests; Decision 0002 |
| `PUB-UI-002` | implemented | The public client stores the fragment token only in session storage, removes it from history, sends it as an Authorization header, and uses a server-issued HttpOnly SameSite launch cookie for checked native media. Query-token access is rejected. | client unit tests; server route/security tests; packaged browser journeys |
| `PUB-UI-003` | implemented | Project switching, launch, progress, cancellation, failure, completion, restart, stale state, exact-call recovery, logs, and checked artifacts are projections of server truth. | lifecycle unit/integration/browser tests |
| `PUB-UI-004` | partial | Navigation, forms, dialogs, status and errors are keyboard and screen-reader oriented; desktop, 390px, and effective 320px layouts avoid page-wide overflow and respect reduced motion. | component tests; Axe; accessibility tree; visual/browser checks |
| `PUB-PROJ-001` | partial | The local UI supports registered-project switching, opens owner-registered projects ahead of the bundled conformance lab, and provides bounded source inspection and read-only Git status through server-owned paths. Browser project creation/import, source editing, and confirmed Git operations remain disabled. | project/source/Git service and browser tests |
| `PUB-DATA-001` | implemented | Dataset catalogs and authenticated checked sample access use the shared project service; revisioned local annotation sidecars bind the exact sample digest and cannot alter source or protected held-out material. | dataset and annotation service/route tests; four reference browser journeys |
| `PUB-DATA-002` | implemented | Annotation supports bounded task labels, review notes, and normalized visual boxes with optimistic revision conflicts; non-visual conversation samples use the same immutable sample and revision boundary without invented geometry. | annotation validation/conflict tests; BDD100K, SoccerNet, TasteMatch, and Qwen-shaped conformance journeys |
| `PUB-MODEL-001` | implemented | Architecture/model inspection projects registered action, input, result, and binding structure without importing arbitrary project code or deserializing unsafe checkpoints. | workspace presentation tests; React graph tests; browser journey |
| `PUB-MODEL-002` | implemented | A project may bind one bounded, project-relative, inspection-only architecture presentation descriptor. The service validates graph identities and references without importing project or upstream code; the BDD100K example declares the reviewed MeMOTR backbone, deformable transformer, query memory, class/box heads, runtime association, and checked-result boundary against its pinned public revision. | BDD100K architecture descriptor; workspace descriptor tests; React graph tests |
| `PUB-TRAIN-001` | partial | Registered project-owned local training reuses durable Run/Executor/Handler/Artifact ownership, binds dataset and annotation identity, rejects held-out splits, supports logs/cancellation/failure, and returns checked metrics and checkpoint artifacts without promotion. Validation, scientific comparison, and real-project trainers remain project-owned follow-on work. | training contract and negative tests; four deterministic reference-project conformance journeys |
| `PUB-INF-001` | implemented | Local inference/prompt execution, Jobs, cancellation, recovery, and checked results use the shared managed lifecycle without project-specific framework branches. | existing action/run/artifact tests; Jobs/browser tests |
| `PUB-INF-002` | implemented | A registered inference process may expose a bounded frame-limit option. `0` explicitly means the complete selected local input; a positive owner-selected value is retained in durable request evidence and bound to the actual process argument. Checked result artifacts retain frame count, frame rate, and media duration, and the UI presents media duration separately from process duration without rounding sub-second results to zero. Cloud execution requires a positive project-supported bound. | project-action override tests; inference timing component test; BDD100K result contract |
| `PUB-AGENT-001` | partial | The local assistant port is exact-project scoped, durable, cancellable, read-only, and limited to redacted registered project/dataset/action/run/artifact evidence. Model-backed Codex execution, attachments, delegation, and write authority remain disabled. | assistant service/security/browser tests |
| `PUB-SET-001` | partial | The read-only Settings projection exposes server-owned browser-security and Modal readiness status without credential values or commercial controls; broader local configuration remains planned. | Settings browser tests; provider route tests |
| `PUB-LIC-001` | partial | Root `LICENSE`, package metadata, every retained React file, dependency notice, source archive, and built distribution agree on the approved public licensing treatment. | boundary verifier; React provenance inventory; distribution verifier |
| `PUB-REL-001` | partial | The exact tracked tree matches the approved source manifest, has one clean public root, contains no forbidden commercial inventory/history, and passes redacted secret scans. | source-manifest verifier; public scanner; Gitleaks |

## Source-requirement lineage

The public implementation preserves the intent—but not the status—of these
previously recorded reusable requirement families:

- foundation and lifecycle: `FW-BOUND-001/002/005/006`,
  `FW-PROJ-009`–`FW-PROJ-012`, `FW-RUN-002/003/008/015/016`;
- projects/source/Git: `PROD-PROJ-001/002/006/009/010/013/014`,
  `ARCH-DATA-003/015`, `ARCH-SEC-007/017`;
- data and annotation: `PROD-DATA-001/002/005/009/013`–`020`,
  `FW-DATA-004/006/010`–`020`;
- architecture/model: `PROD-MODEL-001`–`011`, `FW-ARCH-001`–`009`;
- training/evaluation: `PROD-EXEC-001`–`007/010`–`012`,
  `FW-TRAIN-001`–`009`, `FW-EVAL-001`–`005`;
- inference/jobs/artifacts: `PROD-INF-001`–`017`,
  `FW-UI-014/018/019/023/024/026/027`;
- React UX: `PROD-UX-001/002/005`–`009/011`–`020`,
  `FW-UI-008`–`016/018`–`029`;
- local Coding Assistant: `PROD-AGENT-001`–`005/008`–`010/019`–`027/035`–`038`,
  `AGENT-LOCAL-001/002/009`–`019`, and
  `AGENT-INT-001`–`008/015/018/025/033/034`;
- licensing and release: `IP-LIC-001`–`007`, `IP-DATA-001`,
  `FW-TEST-001`–`006`, and applicable `ARCH-API-*` requirements.

Those identifiers remain historical provenance. A public row becomes
`implemented` only when this repository contains the behavior and the cited
evidence passes against the exact candidate.
