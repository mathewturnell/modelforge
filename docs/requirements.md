# Public alpha requirements and traceability

This register records the clean public implementation. It deliberately does
not copy implementation status from the commercially classified development
repository. `planned` and `partial` describe gaps; they are not release claims.

| ID | Status | Requirement | Primary evidence |
| --- | --- | --- | --- |
| `PUB-ARCH-001` | implemented | Project, runtime configuration, dataset, run, executor/handler, and artifact services remain delivery-neutral; browser delivery imports no project implementation or provider credential. | application service tests; `docs/architecture.md` |
| `PUB-ARCH-002` | partial | Every local product feature is exposed through a typed service port and additive `/api/v1` projection before its React control is enabled. | API schema/route tests; feature rows below |
| `PUB-UI-001` | partial | The packaged root route serves one compiled React workbench with the mature ModelForge shell and no commercial or project-supplied UI code. | React build; package/distribution tests; Decisions 0002/0004; selected original workspaces restored, remaining feature gaps tracked below |
| `PUB-UI-002` | implemented | A public-specific client stores the fragment token only in session storage, sends it only as an Authorization header, rejects stale responses, and owns/revokes authenticated blob URLs. | client unit tests; packaged browser journeys |
| `PUB-UI-003` | implemented | Project switching, launch, progress, cancellation, failure, completion, restart, stale state, exact-call recovery, logs, and checked artifacts are projections of server truth. | lifecycle unit/integration/browser tests |
| `PUB-UI-004` | partial | Navigation, forms, dialogs, status and errors are keyboard and screen-reader oriented; desktop, 390px, and effective 320px layouts avoid page-wide overflow and respect reduced motion. | component tests; Axe; accessibility tree; visual/browser checks |
| `PUB-UI-005` | implemented | React uses one MUI theme and locally bundled controls while preserving the established shell, bottom logs, full-screen annotation, React Flow model view and Recharts training presentations; visual fidelity is checked against reference-derived geometry and interactions. | `workbench/src/theme.ts`, `browser-tests/journeys/visual-restoration.spec.js`; Decision 0004 |
| `PUB-UI-006` | implemented | Each HTML document receives a fresh style-only CSP nonce for trusted Emotion styles without broadening script policy or exposing the bearer; static assets and API responses keep their existing policy. | `tests/test_mui_csp.py`, `tests/test_react_delivery.py`; strict-CSP browser journeys |
| `PUB-PROJ-001` | planned | The local UI supports project registration/switching, bounded source inspection/editing, and explicitly confirmed Git operations through server-owned paths and rollback. | project/source/Git service and browser tests |
| `PUB-DATA-001` | partial | Dataset catalogs and authenticated checked sample access use the shared project service; local annotation mutations are bounded and cannot alter protected held-out material. | `tests/test_annotations.py`, `tests/test_restored_workbench_services.py`, `browser-tests/journeys/restored-lifecycle.spec.js`; full-screen frame rectangles, recorded temporal tracks, optimistic sidecars bounded at 10,000 rectangles / 4 MiB; broader annotation operations remain gaps |
| `PUB-MODEL-001` | partial | Architecture/model inspection validates descriptors and safe structural evidence without importing arbitrary project code or deserializing unsafe checkpoints. | `tests/test_model_inspection.py`, restored browser model/Axe check; original React Flow presentation over bounded display metadata; authored checked graph only |
| `PUB-TRAIN-001` | partial | Local training, validation, and compatible run comparison reuse durable Run/Executor/Artifact ownership and never expose held-out evaluation for iteration. | `tests/test_registered_training.py`, `tests/test_box_head_training.py`, `tests/test_modal_live_logs.py`, restored browser training check, `TrainingTelemetryView.test.ts`; Recharts comparison and essential curves; real bounded MeMOTR head training; full evaluation/promotion remains absent |
| `PUB-INF-001` | implemented | Local inference/prompt execution, Jobs, cancellation, recovery, and checked results use the shared managed lifecycle without project-specific framework branches. | existing action/run/artifact tests; Jobs/browser tests |
| `PUB-AGENT-001` | planned | The local ModelForge Coding Assistant/Codex integration is provider-neutral, exact-project scoped, environment-filtered, cancellable, durable, and excluded from credentials, commercial authority, and held-out evidence. | assistant service/security/browser tests |
| `PUB-SET-001` | partial | The read-only Settings projection exposes server-owned browser-security and Modal readiness status without credential values or commercial controls; broader local configuration remains planned. | Settings browser tests; provider route tests |
| `PUB-LIC-001` | partial | Root `LICENSE`, package metadata, every retained React file, dependency notice, source archive, and built distribution agree on the approved public licensing treatment. | boundary verifier; React provenance inventory; distribution verifier |
| `PUB-REL-001` | partial | The exact tracked tree matches the approved source manifest, has one clean public root, contains no forbidden commercial inventory/history, and passes redacted secret scans. | source-manifest verifier; public scanner; Gitleaks; exact reviewed showcase inventory and separate media attribution in `docs/showcase.md` |

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
