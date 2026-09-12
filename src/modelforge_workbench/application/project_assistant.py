"""Durable, read-only project evidence assistant for the public workbench.

This is intentionally not a hidden LLM or a legacy agent backend. It answers
bounded project questions from current public service projections. A future
Codex provider can implement the same port after its credential and context
isolation is qualified.
"""

from __future__ import annotations

import json
import os
import re
import threading
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Mapping


_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_MAX_MESSAGE = 8_000
_MAX_DOCUMENT = 512 * 1024


def _now() -> str:
    return datetime.now(UTC).isoformat()


def _id(value: Any, label: str) -> str:
    result = str(value or "").strip()
    if not _ID.fullmatch(result):
        raise ValueError(f"{label} identity is invalid")
    return result


class LocalProjectAssistantService:
    """Persist bounded conversations and answer from registered service state."""

    def __init__(self, state_root: Path) -> None:
        self.root = state_root / "assistant"
        self._lock = threading.RLock()

    def status(self) -> dict[str, Any]:
        return {
            "available": True,
            "provider": "Cliff · local evidence assistant",
            "mode": "read_only_project_evidence",
            "write_available": False,
            "codex_connected": False,
            "description": (
                "Answers from registered project, dataset, action, run, and artifact evidence. "
                "No model call or project mutation is performed."
            ),
        }

    def _path(self, project_id: str) -> Path:
        return self.root / f"{_id(project_id, 'Project')}.json"

    def _empty(self, project_id: str) -> dict[str, Any]:
        return {"protocol": "modelforge.project-assistant/v1", "project_id": project_id,
                "active_session_id": None, "sessions": [], "runs": []}

    def _load(self, project_id: str) -> dict[str, Any]:
        path = self._path(project_id)
        if not path.exists():
            return self._empty(project_id)
        if path.is_symlink() or not path.is_file() or path.stat().st_size > _MAX_DOCUMENT:
            raise OSError("Stored assistant state is invalid")
        value = json.loads(path.read_text(encoding="utf-8"))
        if (
            not isinstance(value, dict)
            or value.get("protocol") != "modelforge.project-assistant/v1"
            or value.get("project_id") != project_id
        ):
            raise ValueError("Stored assistant state has an invalid identity")
        return value

    def _put(self, project_id: str, value: Mapping[str, Any]) -> None:
        payload = (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode()
        if len(payload) > _MAX_DOCUMENT:
            raise ValueError("Assistant history exceeds the owner-state limit")
        self.root.mkdir(mode=0o700, exist_ok=True)
        os.chmod(self.root, 0o700)
        path = self._path(project_id)
        temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
        try:
            descriptor = os.open(
                temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600,
            )
            try:
                os.write(descriptor, payload)
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
            os.replace(temporary, path)
            os.chmod(path, 0o600)
        finally:
            temporary.unlink(missing_ok=True)

    def history(self, project_id: str) -> dict[str, Any]:
        with self._lock:
            value = self._load(project_id)
            return {
                "active_session_id": value.get("active_session_id"),
                "sessions": list(value.get("sessions") or []),
            }

    @staticmethod
    def _answer(project: Mapping[str, Any], runs: list[Mapping[str, Any]], message: str) -> str:
        actions = list(project.get("actions") or [project.get("action") or {}])
        dataset = project.get("dataset") or {}
        completed = [run for run in runs if run.get("status") == "completed"]
        active = [run for run in runs if run.get("status") in {"queued", "running"}]
        failed = [run for run in runs if run.get("status") in {"failed", "cancelled"}]
        lower = message.casefold()
        if any(word in lower for word in ("run", "result", "compare", "training", "inference")):
            recent = runs[:3]
            details = "\n".join(
                f"- `{run.get('id')}` — {run.get('status', 'unknown')} · "
                f"{run.get('action_kind') or run.get('workflow') or 'action'} · "
                f"{len(run.get('artifacts') or [])} checked artifact(s)"
                for run in recent
            ) or "- No durable runs have been recorded for this project yet."
            return (
                f"## Recorded execution evidence\n\n{details}\n\n"
                f"Totals: **{len(active)} active**, **{len(completed)} completed**, "
                f"and **{len(failed)} failed or cancelled**. Open **Jobs** for lifecycle state "
                "or **Training / Inference** to launch a registered action."
            )
        if any(word in lower for word in ("dataset", "data", "annotation", "sample")):
            if not dataset:
                return "This project has no registered dataset catalog. Its typed actions can still accept non-dataset inputs where declared."
            return (
                f"## Dataset boundary\n\n**{dataset.get('name', dataset.get('id', 'Dataset'))}** contains "
                f"**{dataset.get('sample_count', 0)}** registered sample(s). ModelForge checks each "
                "sample's size and SHA-256 before access. Annotations are revisioned owner-state "
                "sidecars and cannot rewrite source samples or protected held-out material."
            )
        if any(word in lower for word in ("model", "architecture", "lineage", "checkpoint")):
            bindings = list(project.get("bindings") or [])
            binding_text = ", ".join(
                f"{item.get('id')}@{item.get('revision') or str(item.get('sha256') or '')[:12] or 'registered'}"
                for item in bindings
            ) or "no external model/checkpoint binding"
            return (
                "## Model and lifecycle\n\nThe workbench projects a safe structural graph from "
                "registered action contracts without importing project code or deserializing a checkpoint. "
                f"Current bindings: **{binding_text}**. Successful outputs enter the artifact service only "
                "after result-protocol, containment, size, and digest validation."
            )
        action_text = "\n".join(
            f"- **{item.get('display_name') or item.get('id')}** — `{item.get('kind')}` via `{item.get('interface')}`"
            for item in actions
        )
        return (
            f"## {project.get('name') or project.get('id')}\n\n"
            f"{project.get('description') or 'Registered ModelForge project.'}\n\n"
            f"### Registered actions\n\n{action_text}\n\n"
            "I can explain the dataset and annotation boundary, model/checkpoint lineage, "
            "or the latest durable runs and checked results. This public-alpha assistant is "
            "read-only and does not invoke a model or modify project files."
        )

    def start(
        self, project: Mapping[str, Any], runs: list[Mapping[str, Any]], *,
        session_id: str | None, request_id: str, message: str,
    ) -> dict[str, Any]:
        project_id = _id(project.get("id"), "Project")
        request_id = _id(request_id, "Assistant request")
        if not isinstance(message, str) or not message.strip() or len(message) > _MAX_MESSAGE:
            raise ValueError(f"Assistant message must contain from 1 to {_MAX_MESSAGE} characters")
        with self._lock:
            value = self._load(project_id)
            existing = next((item for item in value["runs"] if item.get("request_id") == request_id), None)
            if existing:
                return dict(existing)
            resolved_session = _id(session_id, "Assistant session") if session_id else uuid.uuid4().hex
            session = next((item for item in value["sessions"] if item.get("id") == resolved_session), None)
            if session is None:
                session = {"id": resolved_session, "created_at": _now(), "messages": []}
                value["sessions"].insert(0, session)
            session["messages"].append({"role": "user", "content": message.strip()})
            answer = self._answer(project, runs, message)
            session["messages"].append({"role": "assistant", "content": answer})
            run = {
                "id": uuid.uuid4().hex, "session_id": resolved_session,
                "request_id": request_id, "status": "completed", "created_at": _now(),
                "completed_at": _now(), "event_cursor": 1,
                "events": [{"id": 1, "type": "evidence", "message": "Read current project service evidence"}],
                "result": {"answer": answer, "provider": "local_evidence", "changes": []},
            }
            value["runs"] = [run, *value["runs"]][:100]
            value["active_session_id"] = resolved_session
            self._put(project_id, value)
            return dict(run)

    def run(self, project_id: str, session_id: str, run_id: str, request_id: str) -> dict[str, Any]:
        with self._lock:
            value = self._load(_id(project_id, "Project"))
            run = next((item for item in value["runs"] if item.get("id") == run_id), None)
            if not run or run.get("session_id") != session_id or run.get("request_id") != request_id:
                raise KeyError("Assistant run was not found")
            return dict(run)

    def active(self, project_id: str, session_id: str) -> dict[str, Any] | None:
        with self._lock:
            value = self._load(_id(project_id, "Project"))
            return next((dict(item) for item in value["runs"]
                         if item.get("session_id") == session_id
                         and item.get("status") in {"queued", "running"}), None)

    def cancel(self, project_id: str, session_id: str, run_id: str, request_id: str) -> dict[str, Any]:
        run = self.run(project_id, session_id, run_id, request_id)
        if run["status"] not in {"queued", "running"}:
            return run
        raise ValueError("The bounded evidence response has already completed")


__all__ = ["LocalProjectAssistantService"]
