# Decision 0004: MUI foundation and original workbench fidelity

- Date: 2026-09-23
- Owner: Mathew Turnell
- Status: authorized implementation by the user's explicit MUI/React instruction
- Requirements: `PUB-UI-001`–`PUB-UI-006`, `PUB-DATA-001`, `PUB-MODEL-001`, `PUB-TRAIN-001`

## Problem and decision

The preceding public client replaced established ModelForge controls, logs,
charts, model inspection and workspace geometry with simpler equivalents.
Functional lifecycle tests did not establish visual or interaction continuity.

React with Material UI is the common presentation foundation. A shared dark
MUI theme preserves the original graphite surfaces, green accent, compact
controls and typography. MUI supplies buttons, tabs, dialogs, selection controls,
forms, tables and surfaces. React Flow and Recharts retain their specialist
roles for the original graph and scientific chart interactions. Dependencies
are locally bundled, version-locked and included in the source/license inventory;
no remote font or script dependency is introduced.

Original React presentation and styles are adapted file by file. The current
Project/Run/Executor/Artifact services remain authoritative. There is no legacy
backend import, alternate lifecycle, project renderer, arbitrary command
surface, or new provider execution authority.

## Observable acceptance

Desktop reference geometry is a 58 px title bar, 70 px icon rail, 39 px document
strip, 24 px status bar and a 300 px contextual collection for training/data.
Model inspection has its own canvas/inspector with zoom, minimap and node
selection. Training supports single-run essential curves and comparison with
missing evidence represented explicitly. Timestamped neutral logs return to a
collapsible bottom panel. Jobs uses a full-width registry. Annotation opens in
a full-screen editor with tool rail, source canvas, object properties and a
recorded-frame track timeline. Compact layouts preserve accessible controls.

Visual comparison uses the existing product-page captures as references, with
known differences in live data and unsupported services recorded separately.
A new snapshot cannot establish fidelity merely by being accepted as a baseline.

## Bounded data and browser security

Model descriptors may carry bounded display-only category, scalar configuration,
node groups, model brief and explicit source-membership metadata. These fields
remain digest-bound, import-free and non-authorizing. No inferred graph capsule
is presented as a declared source relationship.

Temporal annotation retains normalized frame rectangles, protected-split rules,
source identity, optimistic revisions and atomic private sidecars. The selected
video workflow needs more than 2,000 rectangles: the envelope is bounded at
10,000 rectangles and 4 MiB. Only the authenticated annotation mutation accepts
the larger body; other JSON mutations retain the 128 KiB limit.

MUI's Emotion style elements use a fresh random nonce for each HTML response.
The nonce appears in a document meta element and in that response's `style-src`.
HTML is not cached. `script-src 'self'`, Host/Origin checks, bearer authentication,
CORS denial and the remaining CSP restrictions are preserved. The style nonce
never contains or grants the session bearer. No `unsafe-inline` or `unsafe-eval`
exception is added.

## Limits and verification

Restoring the presentation does not implement unavailable services. Assistant
execution, richer annotation primitives/review workflows, inferred source
membership and absent scientific telemetry are not fabricated. Existing Modal
execution restrictions and the user's spending ceiling remain unchanged.

Evidence: restored browser journeys; reference-derived geometry and interaction
checks; independent image inspection; chart/graph/annotation unit tests; model,
annotation and CSP service tests; strict-CSP browser runs; distribution/source
inventories and dependency audit. Rollback selects a prior clean public commit.
