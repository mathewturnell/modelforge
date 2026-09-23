# Decision 0003: native annotation, model review, and bounded training

- Date: 2026-09-23
- Status: implemented for the explicitly bounded slices below
- Decision owner: repository maintainer; implementation requested with publication
- Requirements: PUB-ARCH-002, PUB-DATA-001, PUB-MODEL-001, PUB-TRAIN-001, PUB-UI-003/004

## Context and decision

The public React workbench retained navigation for annotation, model inspection,
and training but had no corresponding delivery-neutral services. Retained media
alone could not demonstrate execution after the architecture migration.

Add small server-owned ports to the existing public core:

- AnnotationService resolves the checked registered sample and keeps revisioned
  sidecar rectangles in private installation state. Original dataset bytes remain
  immutable. Unknown and protected splits are read-only, concurrent updates use an
  expected revision, and stale writes fail with HTTP 409.
- ModelInspectionService accepts only a bounded digest-bound JSON graph whose
  checkpoint identity matches the owner runtime binding. This is authored
  structural evidence, not arbitrary introspection or checkpoint deserialization.
- Registered training uses the existing Run/Executor/Artifact lifecycle, separate
  train/validation samples, owner-controlled resource parameters, validated scalar
  journals, unpromoted digest-bound candidates, and explicit candidate inference.
- Modal live observations use the existing FunctionCall's optional log stream.
  Bounded live scalars are observations; checked terminal artifacts remain the
  durable source. No secondary execution, object store, or credential path exists.

The React adapter enables controls only for server-advertised capabilities and
renders recorded steps and values without claiming scientific comparability.
Project-specific ML recipes and adapters remain in their example/project code.
The MeMOTR recipe freezes feature extraction and trains only a 1,028-parameter
box head; it does not implement the full published temporal training recipe.

## Alternatives and boundaries

Copying the legacy backend, presenting retained output as new inference, or
inventing metrics would violate the migration and evidence requirements. Those
approaches are excluded. The base package remains dependency-free; ML imports
remain in invoked project environments. No held-out promotion, writable Coding
Assistant, source/Git execution, provider billing authority, or hosted deployment
is added.

## Migration, rollback, and verification

Existing registrations and runs remain readable. New annotation sidecars are
additive; removing a sidecar does not edit the source sample. Runtime identities
remain immutable; a different recipe uses an explicitly registered configuration.
Rollback selects the previous public commit and preserves the new evidence files.

Service/HTTP tests cover identity, containment, concurrency, protected splits,
artifact corruption, and local/Modal lifecycle behavior. Browser tests exercise
real annotation save/reload/restart, protected data, safe graph interaction and
accessibility, and training checkpoints, metrics, logs, and restart recovery.
Real-model demonstrations are separately documented in the release evidence;
synthetic conformance fixtures cannot substitute for those runs.
