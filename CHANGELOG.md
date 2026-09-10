# Changelog

## 0.1.0a1 (public source, 2026-09-11)

Full notes: [ModelForge 0.1.0a1 — public source alpha](docs/releases/0.1.0a1.md).

- Re-established the clean Apache public architecture as the only release
  baseline and integrated the approved compiled React workbench through its
  typed service ports. No commercial backend, history, identity, billing,
  hosted workbench, or deployment service is included.
- Added explicit public requirements, traceability, source provenance, and
  fail-closed release controls so missing local features remain visible
  implementation gaps instead of silently shrinking the product definition.
- Prepared a small local-first workbench with durable project-scoped runs,
  checked artifacts, local inference/prompt handlers, and a token-protected
  loopback UI.
- Added explicit, preview-first setup for BDD100K, SoccerNet, TasteMatch, and
  Qwen examples while keeping upstream code, data, models, checkpoints, caches,
  environments, and outputs outside the distribution.
- Preserved the optional Modal tutorial and shared managed lifecycle without
  making provider execution part of ordinary installation or CI.
- Added owner-configured fixed Modal bindings for BDD100K, SoccerNet,
  TasteMatch, and Qwen. Bounded live journeys, provider-confirmed cancellation,
  same-call recovery, and native video/table/text results passed on one
  recorded owner environment; this is not a general provider or quality claim.
- Recorded per-file provenance and conservative license treatment for the
  nineteen retained real-example Python files. The rights holder approved the
  Apache-2.0 and notice-preserving mixed treatments on 2026-09-10.
