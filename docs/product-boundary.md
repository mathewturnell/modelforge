# Public alpha product boundary

The package, CLI, loopback workbench, and public tests expose the same boundary.

| Area | Alpha status | Notes |
| --- | --- | --- |
| Manifest/capability inspection | Supported | Static, bounded, non-authorizing v1 inspection. |
| Project registration | Supported | Shallow authored `project.json` identity/capabilities, separate from owner-only runtime configuration. Runtime paths are redacted from public projections. |
| Dataset samples | Supported | Bounded catalogs, stable identities, exact size/SHA-256 checks, and authenticated byte/range access. |
| Local annotation | Partial | Checked image/video rectangle labels, track IDs, private revisioned sidecars, conflict detection, protected-split denial, and save/reload. Advanced temporal/format tools remain absent. |
| Project/source/Git | Planned | Registration exists; bounded inspection/editing and confirmed Git operations remain implementation gaps. |
| Architecture/model inspection | Partial | Digest-bound owner-authored JSON graphs correlated to the registered checkpoint. No code import, unsafe deserialization, or arbitrary model introspection. |
| Managed local inference/prompt | Supported | Durable identity precedes binding/process start; content-bound runtime identity; action-specific result correlation; visible bounded logs; host deadline; explicit cancellation. |
| Runs and local artifacts | Supported | Project-scoped SQLite truth, terminal recovery, digest-checked artifacts, text/video projection. Unattached unfinished records are stale/unavailable; active process resume after service restart is not claimed. |
| Compiled React loopback workbench | Partial | The real Project/Run/Artifact journey is supported. Other local product areas remain visible only as truthful unavailable states until their public services pass. Token, Host, mutation-Origin, CSP, stale/disconnected, and graceful-shutdown controls remain required. HTTP remains unstable. |
| Synthetic Threshold Lab | Supported | CPU/offline installation and CI mechanics only; no model-quality claim. |
| BDD100K + MeMOTR | Supported with user prerequisites | Selected-video managed inference shape. External data/source/checkpoint and CUDA; optional separate bounded box-head training recipe; no full-training, evaluation, or model-quality claim. Integration source remains rights-gated. |
| Qwen2.5-7B Prompt Lab | Supported with user prerequisites | Local bounded prompt shape at a pinned model revision. External ~15.2 GiB weights; no training/dataset claim. Integration source remains rights-gated. |
| SoccerNet + MOTR | Supported with user prerequisites | Bounded selected-sequence managed inference passed on one owner-staged Modal L40S environment. External source/data/checkpoint; no training or quality claim. |
| TasteMatch + SigLIP | Supported with user prerequisites | Bounded base-SigLIP image inference passed on one owner-staged Modal L4 environment with a native table result. No trained adapter or training claim. |
| Phase 1–3 Python seams | Experimental | Real consumers exist, but compatibility may change before beta. |
| Training/evaluation/run comparison | Partial | Registered bounded training shares Run/Executor/Artifact ownership; separate train/validation inputs, scalar journals, unpromoted checkpoints, and exact-value comparison. Real MeMOTR box-head smoke passed locally; full temporal training, held-out evaluation, and promotion remain absent. |
| Local ModelForge Coding Assistant/Codex | Planned | Must be project-scoped, environment-filtered, cancellable, durable, and excluded from credentials and held-out evidence. |
| Local settings | Planned | May expose only server-owned non-secret configuration. |
| Modal | Experimental | Fixed synthetic and owner-bound project functions use the shared lifecycle. Four bounded real actions, failure, cancellation, and same-call recovery passed on one account; no general availability, price, or provider claim. |
| Hosted/commercial/desktop/publication control | Excluded | No customer tenancy, billing, hosted workbench, Cloudflare/application publication, desktop updater, or production claim. |

Supported base platform: Linux x86-64 with CPython 3.12 and a current
Chromium-family browser. The base wheel has no third-party runtime dependency.
Project environments and external assets are installed/acquired by the user.
ModelForge performs no implicit download: an explicit, confirmation-gated
setup fetch may acquire declared public Git or digest-bound inputs, while
manual or gated assets remain user-acquired. Managed actions use offline
policy.

Project code is trusted local code with the user's operating-system authority.
Run-owned work, evidence, and caches isolate ModelForge outputs; they do not
sandbox an intentionally executed project from other accessible host resources.
