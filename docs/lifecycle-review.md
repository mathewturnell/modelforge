# Dataset annotation and model review

The public workbench now offers native rectangles for registered image/video
samples. Select the checked sample in Dataset, open Annotation, choose a frame,
draw a rectangle, and edit its label or track identity. Video frame navigation
uses the explicitly entered source FPS; the workbench does not infer a frame rate
from an arbitrary file. Rectangle coordinates are normalized to the source view.

Save writes a private versioned sidecar bound to the original sample SHA-256.
Reopening reads that revision. A concurrent edit returns a conflict instead of
silently overwriting another revision. Original media remains unchanged.
`train`, `training`, `val`, `validation`, `unspecified`, and `unassigned` are the
editable split allowlist. Test, held-out, and unknown splits are read-only.
The current editor does not implement polygons, interpolation, track splitting,
annotation-format import/export, collaborative merging, or automatic assistance.

For Models / Architecture, add an owner runtime binding `model_descriptor` with
an absolute JSON file path and its SHA-256. Its protocol is
`modelforge.model-descriptor/v1`; fields are `model_id`, `name`, `checkpoint`,
`nodes`, and `edges`. A node declares `id`, `label`, `kind`, and optionally a
nonnegative `parameter_count`; an edge references existing `source` and `target`
node IDs. `checkpoint` declares the SHA-256 or revision matching the runtime's
checkpoint/model binding. The UI displays a checked authored graph and lets the
user inspect a component. Reading it never executes project code or unpickles a
model. It is not a claim that arbitrary graph metadata proves model internals.

See [bounded training](training.md) for real optimization, telemetry, comparison,
and explicit candidate inference.
