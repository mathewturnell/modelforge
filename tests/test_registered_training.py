from __future__ import annotations
import hashlib
import json
import sys
import pytest
from modelforge_workbench.alpha import AlphaWorkbench
from modelforge_workbench.application.training_telemetry import read_training_telemetry


def fixture(tmp_path):
    project = tmp_path / "project"
    project.mkdir()
    worker = project / "train.py"
    worker.write_text("""import sys,json,hashlib
from pathlib import Path
request=json.loads(Path(sys.argv[1]).read_text())
output=Path(sys.argv[2])
# Real optimization of one scalar on separate authored synthetic splits.
w=0.0
with (output/'telemetry.jsonl').open('w') as f:
 for step in range(request['max_batches']):
  loss=(w-2.0)**2
  w-=request['learning_rate']*2*(w-2.0)
  print('optimization step',step,'loss',loss,flush=True)
  for split,v in [('train',loss),('validation',(w-2.1)**2)]:
   f.write(json.dumps(dict(protocol='modelforge.training-scalar/v1',step=step,split=split,name='loss',value=v))+'\\n')
  f.flush()
checkpoint=output/'candidate.json'
checkpoint.write_text(json.dumps({'weight':w}))
def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()
result=dict(protocol='modelforge.training-result/v1',candidate_status='unpromoted',provenance={k:request.get(k) for k in ['dataset_sample_sha256','validation_sample_sha256','checkpoint_sha256']},results=[dict(kind='checkpoint',path=checkpoint.name,sha256=digest(checkpoint),mime_type='application/json')],telemetry=dict(path='telemetry.jsonl',sha256=digest(output/'telemetry.jsonl')))
(output/'result.json').write_text(json.dumps(result))
""")
    samples = []
    for split in ("train", "validation", "test"):
        p = project / f"{split}.json"
        p.write_text(json.dumps({"split": split}))
        samples.append(
            dict(
                id=split,
                path=p.name,
                split=split,
                content_type="application/json",
                size_bytes=p.stat().st_size,
                sha256=hashlib.sha256(p.read_bytes()).hexdigest(),
            )
        )
    action = dict(
        id="training",
        kind="training",
        interface="training_process",
        result_protocol="modelforge.training-result/v1",
        interpreter=sys.executable,
        executable=str(worker),
        working_directory=str(project),
        arguments=["{request}", "{output}", "{training_sample}", "{validation_sample}"],
        parameters=dict(epochs=1, max_batches=3, learning_rate=0.1, seed=7, device="cpu"),
    )
    (project / "project.json").write_text(
        json.dumps(
            dict(
                schema_version=1,
                id="train-fixture",
                name="Training fixture",
                runtime=dict(
                    protocol="modelforge.project-runtime/v1",
                    actions={
                        "training": dict(
                            kind="executable",
                            interface="training_process",
                            executable="train.py",
                            result_contract={"protocol": "modelforge.training-result/v1"},
                        )
                    },
                ),
            )
        )
    )
    cfg = tmp_path / "config.json"
    cfg.write_text(
        json.dumps(
            dict(
                protocol="modelforge.local-runtime-configuration/v1",
                id="train-fixture",
                name="Training fixture",
                project_repository=str(project),
                action=action,
                dataset=dict(id="samples", name="Samples", root=str(project), samples=samples),
            )
        )
    )
    app = AlphaWorkbench(tmp_path / "state")
    app.register_project(cfg)
    return app, dict(dataset_id="samples", sample_id="train", validation_sample_id="validation")


def test_training_shared_lifecycle_checkpoint_logs_telemetry_restart(tmp_path):
    app, request = fixture(tmp_path)
    execution = app.start_project_action("train-fixture", request)
    assert app.get_run(execution.run_id, "train-fixture")["status"] == "running"
    result = app.finish_project_action(execution)
    assert result["status"] == "completed", result
    assert {"checkpoint", "process-log", "training-telemetry"} <= {x["kind"] for x in result["artifacts"]}
    events = app.project_actions.training_telemetry("train-fixture", execution.run_id)["events"]
    assert len(events) == 6 and events[0]["value"] > events[-2]["value"]
    other = AlphaWorkbench(app.state_root)
    assert other.project_actions.training_telemetry("train-fixture", execution.run_id)["events"] == events
    with pytest.raises(KeyError):
        other.project_actions.training_telemetry("different-project", execution.run_id)


@pytest.mark.parametrize(
    "field,value",
    [
        ("sample_id", "test"),
        ("validation_sample_id", "test"),
        ("validation_sample_id", "train"),
        ("promote", True),
        ("epochs", 999),
    ],
)
def test_training_rejects_heldout_leakage_and_unauthorized_overrides(tmp_path, field, value):
    app, request = fixture(tmp_path)
    request[field] = value
    with pytest.raises(ValueError):
        app.start_project_action("train-fixture", request)
    assert app.list_runs("train-fixture") == []


def test_training_rejects_tampered_checkpoint(tmp_path):
    app, request = fixture(tmp_path)
    execution = app.start_project_action("train-fixture", request)
    execution.handle.wait()
    (execution.allocation.evidence_root / "candidate.json").write_text("tampered")
    with pytest.raises(OSError, match="digest"):
        app.finish_project_action(execution)
    result = app.get_run(execution.run_id, "train-fixture")
    assert result["status"] == "failed"
    assert not any(a["kind"] == "checkpoint" for a in result["artifacts"])


def test_telemetry_live_partial_line_and_invalid_values(tmp_path):
    path = tmp_path / "telemetry.jsonl"
    event = dict(protocol="modelforge.training-scalar/v1", step=0, split="train", name="loss", value=1.0)
    path.write_text(json.dumps(event) + '\n{"partial":')
    assert len(read_training_telemetry(path)["events"]) == 1
    with pytest.raises(ValueError):
        read_training_telemetry(path, complete=True)
    for invalid in ({**event, "value": float("nan")}, {**event, "split": "test"}):
        path.write_text(json.dumps(invalid) + "\n")
        with pytest.raises(ValueError):
            read_training_telemetry(path, complete=True)


def test_live_scalar_validation_detaches_and_rejects_invalid_schema():
    from modelforge_workbench.application.training_telemetry import validate_training_scalar

    original = dict(protocol="modelforge.training-scalar/v1", step=2, split="train", name="loss", value=0.2)
    accepted = validate_training_scalar(original)
    original["value"] = 8
    assert accepted["value"] == 0.2
    for invalid in (
        [],
        {**accepted, "step": True},
        {**accepted, "name": "../private\n"},
        {**accepted, "value": float("inf")},
        {**accepted, "split": []},
        {**accepted, "value": 10**1000},
    ):
        with pytest.raises(ValueError):
            validate_training_scalar(invalid)
