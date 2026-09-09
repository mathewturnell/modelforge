from __future__ import annotations

import sqlite3
import threading

import pytest

from modelforge_workbench.alpha import ALPHA_SCOPE, AlphaWorkbench
from modelforge_workbench.application.runs import RunTransition
from modelforge_workbench.infrastructure.sqlite_runs import SQLiteRunRepository


def test_artifacts_and_success_are_one_transaction(tmp_path):
    app = AlphaWorkbench(tmp_path)
    execution = app.start_example()
    with sqlite3.connect(app.runs.repository.path) as connection:
        connection.execute(
            "CREATE TRIGGER fail_second_artifact BEFORE INSERT ON artifacts "
            "WHEN (SELECT COUNT(*) FROM artifacts WHERE run_id = NEW.run_id) >= 1 "
            "BEGIN SELECT RAISE(ABORT, 'controlled artifact failure'); END"
        )
    with pytest.raises(sqlite3.IntegrityError, match="controlled artifact failure"):
        app.finish_example(execution)
    failed = app.runs.get(ALPHA_SCOPE, execution.run_id)
    assert failed["status"] == "failed"
    assert failed["artifacts"] == []


def test_two_repository_terminal_race_has_exactly_one_winner(tmp_path):
    app = AlphaWorkbench(tmp_path)
    execution = app.start_example()
    first = SQLiteRunRepository(app.runs.repository.path)
    second = SQLiteRunRepository(app.runs.repository.path)
    barrier = threading.Barrier(3)
    outcomes: list[bool] = []
    errors: list[BaseException] = []

    report = execution.allocation.evidence_root / "race-report.json"
    report.write_text("{}", encoding="utf-8")
    artifact = {
        "name": "race-report.json",
        "kind": "result",
        "storage_backend": "local",
        "storage_ref": str(report),
        "content_type": "application/json",
        "size_bytes": 2,
        "sha256": "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
        "metadata": {"evidence_id": execution.run_id},
    }

    def attempt(repository, transition):
        try:
            barrier.wait()
            outcomes.append(repository.transition(ALPHA_SCOPE, execution.run_id, transition))
        except BaseException as exc:  # pragma: no cover - asserted below
            errors.append(exc)

    completed = RunTransition(
        allowed_from=frozenset({"running"}), status="completed", artifacts=(artifact,),
    )
    cancelled = RunTransition(
        allowed_from=frozenset({"running"}), status="cancelled",
    )
    threads = [
        threading.Thread(target=attempt, args=(first, completed)),
        threading.Thread(target=attempt, args=(second, cancelled)),
    ]
    for thread in threads:
        thread.start()
    barrier.wait()
    for thread in threads:
        thread.join(timeout=5)

    assert errors == []
    assert sorted(outcomes) == [False, True]
    run = app.runs.get(ALPHA_SCOPE, execution.run_id)
    assert run["status"] in {"completed", "cancelled"}
    assert bool(run["artifacts"]) is (run["status"] == "completed")
