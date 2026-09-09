"""Small SQLite adapter for the public-alpha Run repository port."""

from __future__ import annotations

import json
import os
import sqlite3
import stat
import threading
import time
import uuid
from pathlib import Path

from modelforge_workbench.application.runs import RunIntent, RunScope, RunTransition, thaw_json


def _encode(value) -> str:
    return json.dumps(value if value is not None else {}, sort_keys=True, separators=(",", ":"))


def _decode(value: str | None):
    return json.loads(value or "{}")


def _iso(value: float | None) -> str | None:
    if value is None:
        return None
    from datetime import datetime, timezone

    return datetime.fromtimestamp(value, timezone.utc).isoformat()


class SQLiteRunRepository:
    """Persist only local alpha runs and their checked artifacts."""

    def __init__(self, path: str | Path) -> None:
        requested = Path(path).expanduser()
        self.path = Path(os.path.abspath(requested))
        current = Path(self.path.anchor)
        for part in self.path.parts[1:-1]:
            current /= part
            try:
                metadata = os.lstat(current)
            except FileNotFoundError as exc:
                raise ValueError("Run database parent must already exist") from exc
            if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
                raise ValueError("Run database path cannot contain symbolic links or non-directories")
        existed = self.path.exists()
        if self.path.is_symlink():
            raise ValueError("Run database cannot be a symbolic link")
        if existed and not self.path.is_file():
            raise ValueError("Run database must be a regular file")
        if existed and stat.S_IMODE(self.path.stat().st_mode) != 0o600:
            raise ValueError("Existing run database must have mode 0600")
        if not existed:
            descriptor = os.open(
                self.path,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                0o600,
            )
            os.close(descriptor)
        self._lock = threading.RLock()
        with self._connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS runs (
                    id TEXT PRIMARY KEY,
                    organization_id TEXT NOT NULL,
                    project_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    name TEXT NOT NULL,
                    provider TEXT NOT NULL,
                    compute_target TEXT NOT NULL,
                    dataset_ref TEXT NOT NULL,
                    status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','cancelled')),
                    request_json TEXT NOT NULL,
                    configuration_json TEXT NOT NULL,
                    metrics_json TEXT NOT NULL,
                    backend_id TEXT,
                    artifact_backend TEXT,
                    artifact_prefix TEXT,
                    error TEXT,
                    created_at REAL NOT NULL,
                    started_at REAL,
                    completed_at REAL,
                    updated_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS runs_scope ON runs(organization_id, project_id, created_at DESC);
                CREATE TABLE IF NOT EXISTS artifacts (
                    id TEXT PRIMARY KEY,
                    run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
                    name TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    storage_backend TEXT NOT NULL CHECK(storage_backend = 'local'),
                    storage_ref TEXT NOT NULL,
                    content_type TEXT NOT NULL,
                    size_bytes INTEGER NOT NULL,
                    sha256 TEXT NOT NULL,
                    metadata_json TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    UNIQUE(run_id, storage_ref)
                );
                CREATE INDEX IF NOT EXISTS artifacts_run ON artifacts(run_id, created_at);
                """
            )
        if stat.S_IMODE(self.path.stat().st_mode) != 0o600:
            raise ValueError("Run database must have mode 0600")

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=30)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 30000")
        return connection

    @staticmethod
    def _run(row: sqlite3.Row, artifacts=()) -> dict:
        return {
            "id": row["id"],
            "organization_id": row["organization_id"],
            "project_id": row["project_id"],
            "user_id": row["user_id"],
            "name": row["name"],
            "provider": row["provider"],
            "compute_target": row["compute_target"],
            "dataset_ref": row["dataset_ref"],
            "status": row["status"],
            "request": _decode(row["request_json"]),
            "configuration": _decode(row["configuration_json"]),
            "metrics": _decode(row["metrics_json"]),
            "provider_action_id": row["backend_id"],
            "artifact_backend": row["artifact_backend"],
            "artifact_prefix": row["artifact_prefix"],
            "error": row["error"],
            "created_at": _iso(row["created_at"]),
            "started_at": _iso(row["started_at"]),
            "completed_at": _iso(row["completed_at"]),
            "updated_at": _iso(row["updated_at"]),
            "artifacts": list(artifacts),
        }

    @staticmethod
    def _artifact(row: sqlite3.Row) -> dict:
        return {
            "id": row["id"], "job_id": row["run_id"], "name": row["name"],
            "kind": row["kind"], "storage_backend": row["storage_backend"],
            "storage_ref": row["storage_ref"], "content_type": row["content_type"],
            "size_bytes": row["size_bytes"], "sha256": row["sha256"],
            "metadata": _decode(row["metadata_json"]), "created_at": _iso(row["created_at"]),
        }

    def create(self, intent: RunIntent, *, run_id: str | None = None) -> dict:
        run_id = str(run_id or uuid.uuid4().hex)
        now = time.time()
        with self._lock, self._connect() as connection:
            connection.execute(
                "INSERT INTO runs VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, '{}', NULL, ?, ?, NULL, ?, NULL, NULL, ?)",
                (
                    run_id, intent.scope.organization_id, str(intent.scope.project_id), intent.user_id,
                    intent.name, intent.provider, intent.compute_target, intent.dataset_ref,
                    _encode(thaw_json(intent.request)), _encode(thaw_json(intent.configuration)),
                    intent.artifact_backend, intent.artifact_prefix, now, now,
                ),
            )
        return self.get(intent.scope, run_id)

    def get(self, scope: RunScope, run_id: str, *, include_artifacts: bool = True) -> dict:
        with self._lock, self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM runs WHERE id = ? AND organization_id = ? AND project_id = ?",
                (str(run_id), scope.organization_id, scope.project_id),
            ).fetchone()
            if row is None:
                raise KeyError("Run was not found")
            artifacts = ()
            if include_artifacts:
                artifacts = tuple(
                    self._artifact(item) for item in connection.execute(
                        "SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at, id", (str(run_id),)
                    ).fetchall()
                )
            return self._run(row, artifacts)

    def list(self, scope: RunScope, *, limit: int = 100) -> list[dict]:
        if isinstance(limit, bool) or not isinstance(limit, int) or not 1 <= limit <= 1000:
            raise ValueError("Run list limit must be from 1 to 1000")
        with self._lock, self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM runs WHERE organization_id = ? AND project_id = ? ORDER BY created_at DESC LIMIT ?",
                (scope.organization_id, scope.project_id, limit),
            ).fetchall()
        return [self.get(scope, row["id"]) for row in rows]

    def transition(self, scope: RunScope, run_id: str, change: RunTransition) -> bool:
        now = time.time()
        with self._lock, self._connect() as connection:
            # Serialize the read/validation/write transaction across repository
            # instances. The in-process lock alone cannot provide this contract.
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM runs WHERE id = ? AND organization_id = ? AND project_id = ?",
                (str(run_id), scope.organization_id, scope.project_id),
            ).fetchone()
            if row is None:
                raise KeyError("Run was not found")
            configuration = _decode(row["configuration_json"])
            if row["status"] not in change.allowed_from or any(
                key in configuration for key in change.forbidden_configuration_keys
            ):
                return False
            configuration.update(thaw_json(change.configuration_patch))
            status = change.status or row["status"]
            started = row["started_at"] or (now if status == "running" else None)
            completed = row["completed_at"] or (now if status in {"completed", "failed", "cancelled"} else None)
            updated = connection.execute(
                "UPDATE runs SET status = ?, configuration_json = ?, metrics_json = ?, "
                "backend_id = COALESCE(?, backend_id), error = COALESCE(?, error), "
                "started_at = ?, completed_at = ?, updated_at = ? "
                "WHERE id = ? AND organization_id = ? AND project_id = ? AND status = ?",
                (
                    status, _encode(configuration),
                    row["metrics_json"] if change.metrics is None else _encode(thaw_json(change.metrics)),
                    change.backend_id, change.error, started, completed, now, str(run_id),
                    scope.organization_id, scope.project_id, row["status"],
                ),
            )
            if updated.rowcount != 1:
                connection.rollback()
                return False
            for artifact in change.artifacts:
                connection.execute(
                    "INSERT INTO artifacts VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        uuid.uuid4().hex, str(run_id), str(artifact["name"]), str(artifact["kind"]),
                        str(artifact["storage_backend"]), str(artifact["storage_ref"]),
                        str(artifact.get("content_type") or "application/octet-stream"),
                        int(artifact["size_bytes"]), str(artifact["sha256"]),
                        _encode(thaw_json(artifact.get("metadata") or {})), now,
                    ),
                )
        return True


__all__ = ["SQLiteRunRepository"]
