# Changelog

## 0.1.0a1 (unreleased)

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
  nineteen retained real-example Python files. Publication remains blocked on
  the ownership and publishing decisions in `docs/release-status.md`.
