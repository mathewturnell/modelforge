# Bounded project training

Registered owner runtime configurations accept `training` / `training_process`
with result protocol `modelforge.training-result/v1`. The same durable Run,
Executor and Artifact services own local and explicitly bound Modal execution.
A browser request selects only `dataset_id`, `sample_id`, and
`validation_sample_id`; execution parameters remain in owner configuration.

The training selection must declare `train`; the validation selection must
declare `val` or `validation`. Identical file paths or digests are rejected.
Held-out/test selections and request-side parameter or promotion overrides fail
before launch. Local execution copies only those two selected files into the
run-owned input directory; it does not hand the adapter the dataset catalog root.
Adapters own deeper sample/sequence overlap checks and modality interpretation.
Trusted local execution is not an operating-system filesystem sandbox.

Owner parameters are bounded `epochs`, `max_batches`, `learning_rate`, `seed`,
and `device`. Argument placeholders additionally include `training_sample` and
`validation_sample`. The private request and durable request bind both selected
content digests, optional parent checkpoint digest, and all execution parameters.
Checkpoint creation never activates, promotes, evaluates, or deploys a candidate.

A successful result requires:

- protocol `modelforge.training-result/v1` and `candidate_status: unpromoted`;
- `provenance` matching the requested `dataset_sample_sha256`,
  `validation_sample_sha256`, and `checkpoint_sha256`;
- one to eight `results`, each a `checkpoint` with a contained filename and SHA-256;
- a digest-bound `telemetry` entry naming `telemetry.jsonl`.

Scalar JSONL events use protocol `modelforge.training-scalar/v1`, a nonnegative
integer `step`, `split` (`train` or `validation`), bounded metric `name`, and
finite numeric `value`. Each series' steps strictly increase. Readers bound
bytes/events and ignore only an incomplete final line while a run is active.
Completed telemetry is rechecked against its registered artifact digest.
An absent series is unavailable, never a fabricated zero. The stream describes
reported observations; it does not establish scientific quality by itself.

The BDD example's `train_box_head.py` is an explicit project-owned smoke recipe:
it caches frozen MeMOTR query features for separate real training/validation
frames, Hungarian-matches annotated boxes, and optimizes the final box-regression
layer. Its parent-bound JSON delta can be selected through an owner
`adaptation` binding and the `MODELFORGE_MEMOTR_DELTA_PATH` environment binding.
Inference binds both the base checkpoint and adaptation digests. This is not the
published full temporal training recipe, a tracking-quality evaluation, or
restoration of every legacy training workflow.

`modal_training.py` declares one L40S, four CPUs, 32 GiB, 900-second execution and
startup deadlines, zero retries, at most one container, and zero warm containers.
It accepts at most 100 updates over one epoch. Staged source/checkpoint and two
input files are separately verified; only the small delta, scalar evidence,
and result envelope return through the bounded provider transport. A resource
bound is not an invoice cap. The operator must reserve aggregate budget and
reconcile provider charges across builds, runs, and storage.

Verification: `tests/test_registered_training.py`, `tests/test_box_head_training.py`,
`tests/test_action_handlers.py`, and existing managed local/Modal lifecycle tests.

Live SDK log observations accept the same validated scalar schema via the
`[MODELFORGE_TELEMETRY] ` prefix. The UI bounds these observations and uses the
checked journal after completion. Local real-model runs passed; this change's
real Modal training remains unverified pending the explicitly requested staging
authorization described in its release notes.
