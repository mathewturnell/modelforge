# Restore native dataset review, bounded training, and real showcase inference

This change restores functional slices missing from the public architecture:
source-linked annotation editing, safe model graph review, registered training,
scientific scalar comparison, and exact-call live Modal observations. It also
re-runs the three real models shown on the product page through the current
Project/Run/Executor/Artifact services and compiled React workbench.

It is an incremental restoration, not a claim that every legacy feature is back.

## User-visible behavior

- Select a checked image/video, draw or add a rectangle, edit labels, coordinates
  and track identity, and save a source-bound revision. Edits survive browser and
  server restart. Stale revisions conflict; protected splits remain read-only.
- Inspect a digest-bound authored model graph and its exact checkpoint identity
  without loading model code or unsafe checkpoint objects.
- Launch a configured training action with separate train/validation inputs.
  See bounded logs, actual optimizer-step scalar values, exact-value tables,
  comparisons, and checked unpromoted checkpoint artifacts. Absent metrics are
  unavailable, never zero.
- Select a parent-bound MeMOTR box-head delta for subsequent inference. Candidate
  creation does not promote or replace the original checkpoint.
- Observe optional Modal logs from the same recorded FunctionCall. Live values
  are bounded observations; terminal artifacts remain authoritative. Cancellation
  closes observation without creating a second provider call.
- Play checked results in a larger native central preview. A new local SoccerNet
  selection adapter binds every input file and supports the full showcased clip.

## Real execution evidence

| Workflow | Fresh result | Scope |
| --- | --- | --- |
| BDD100K / MeMOTR | Run `40dd4b47c9284921ae3d481768e89b1f`; exact `00067cfb-5443fe39` source, 16 frames, 1280×720, 5 fps, 3.2 seconds | Original checkpoint, selected demonstration clip |
| BDD annotation | Exact `0030f434-3eb4a3a9` daylight frame with 19 source tracks; label change saved, reloaded, then restored | Versioned sidecar; original media untouched |
| MeMOTR training | Runs `92a34ec0fd0040319ea7bcf48e098cec` and UI-launched `1b4bd43eaf264af9be5799ef767b1297`; 20 updates, 1,028 trainable parameters, 20 train + 20 validation scalar events per run | Frozen features, final box-head finetuning smoke; not full temporal training |
| Candidate inference | Run `fa5fe8eccc3e48b68897433a17552ddb`; 2 real frames using the new parent-bound delta | Validated candidate roundtrip, no promotion |
| SoccerNet / MOTR | Run `0e47b344a0314fb294d6814d3c4d9394`; `SNMOT-060`, 125 frames, 25 fps, 5 seconds | Includes original seconds 2–5 excerpt; clean pinned upstream code |
| WeatherBench2 / HURDAT2 | Run `507f34fdc8e64d6786fdbfcfeb4a8487`; all 27 scientific timesteps, 54 encoded frames, 1280×720, 6 fps, 9 seconds | Retrospective global diagnostic; scientific promotion gate remains unpassed |

The fresh Weather MP4 SHA-256 is
`24af2f132695197b21d5728a2dc3aabb68eae245093f4eeb4e5b17e2f5164ebc`,
matching the source MP4 identity recorded for the existing product-page showcase.
This is recomputation followed by checked native playback, not an imported run
presented as fresh execution. Weather project code and its relocated data remain
external project-owned inputs; they are not copied into the framework.

Recordings, source/output identity receipts, screenshots, and three-second GIFs
are retained in the local reproduction evidence bundle. Model weights, datasets,
provider credentials, private runtime paths, and raw local logs are excluded from
this public source change.

## Defects fixed during reproduction

- SoccerNet's multiprocessing data loader failed to bind a Unix socket inside the
  long run-owned temporary directory. Its local adapter now uses serial loading,
  preserving frame order, batch size, upstream source, and the output boundary.
  The first attempt remains a cancelled run with its failure log; the replacement
  completed all 125 frames.
- Annotation file errors exposed local paths. HTTP errors now redact filesystem
  details while retaining actionable validation and conflict responses.
- Interactive model nodes nested in an image-role graph failed accessibility
  checks. The graph is now a labelled group with keyboard-operable nodes.
- Concurrent launch observations no longer share a single temporary live-state
  key. Training scalar observations reject invalid, nonfinite, held-out, duplicate,
  and out-of-order data before presentation.
- Metric comparisons now show numeric axis bounds and preserve recorded precision
  in tables. Run checkboxes reflect the displayed series, including empty selection.

## Verification and limits

The current core suite passed 313 tests. The full browser suite passed 22 tests
with two explicit optional skips. Frontend unit tests, type checking, service
security negatives, artifact digest checks, and browser accessibility checks
passed. Dataset/model/training browser fixtures are explicitly synthetic;
real-model claims above come from separate checked executions.

Real Modal training is **not yet verified for this change**. Automatic approval
review rejected staging the 603 MB pretrained checkpoint and two BDD samples to
the dedicated account environment and requested exact upload authorization.
No model assets were uploaded and no paid training call was launched. The live
Modal adapter is covered by deterministic tests; those are not a substitute for
provider execution evidence. The user's USD 10 ceiling remains in force.

Full MeMOTR/MOTR temporal training, benchmark/HOTA reproduction, held-out model
selection or promotion, advanced annotation interpolation/format workflows,
project creation by the Coding Assistant, and the old model-chat screenshot are
still outside the verified slice. Weather output identity does not establish
restoration of the old interactive 3D scene viewer. No claim of complete legacy
parity is made.
