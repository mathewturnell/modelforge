"""Small provider adapter for the documented Codex App Server protocol.

The adapter deliberately delegates authentication to Codex.  ModelForge never
reads or stores the provider credential; it only asks the local App Server for
the bounded account projection and thread/turn lifecycle used by the UI.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence


class CodexAppServerError(RuntimeError):
    """A bounded failure reported by, or while communicating with, Codex."""


NotificationListener = Callable[[Mapping[str, Any]], None]


def discover_codex_executable() -> str | None:
    """Find the OS user's Codex CLI without inspecting its credential store."""

    configured = os.environ.get("MODELFORGE_CODEX_EXECUTABLE", "").strip()
    candidates: list[Path] = []
    if configured:
        candidates.append(Path(configured).expanduser())
    discovered = shutil.which("codex")
    if discovered:
        candidates.append(Path(discovered))
    extension_root = Path.home() / ".vscode" / "extensions"
    if extension_root.is_dir():
        candidates.extend(sorted(
            extension_root.glob("openai.chatgpt-*/bin/*/codex"), reverse=True,
        ))
    for candidate in candidates:
        absolute = Path(os.path.abspath(candidate))
        if absolute.is_file() and os.access(absolute, os.X_OK):
            return str(absolute)
    return None


class CodexAppServer:
    """Thread-safe JSON-lines client for one local Codex App Server process."""

    def __init__(self, command: Sequence[str] | None = None) -> None:
        executable = discover_codex_executable()
        self.command = tuple(command or (
            (executable, "app-server", "--stdio") if executable else ()
        ))
        self._process: subprocess.Popen[str] | None = None
        self._startup_lock = threading.Lock()
        self._write_lock = threading.Lock()
        self._state_lock = threading.RLock()
        self._next_id = 1
        self._pending: dict[int, tuple[threading.Event, dict[str, Any]]] = {}
        self._listeners: dict[int, NotificationListener] = {}
        self._next_listener = 1
        self._reader: threading.Thread | None = None
        self._stderr_reader: threading.Thread | None = None
        self._stderr_tail = ""

    @property
    def installed(self) -> bool:
        return bool(self.command)

    def _send(self, value: Mapping[str, Any]) -> None:
        process = self._process
        if process is None or process.stdin is None or process.poll() is not None:
            raise CodexAppServerError("Codex App Server is not running")
        payload = json.dumps(dict(value), ensure_ascii=False, separators=(",", ":")) + "\n"
        try:
            with self._write_lock:
                process.stdin.write(payload)
                process.stdin.flush()
        except (BrokenPipeError, OSError, ValueError) as exc:
            raise CodexAppServerError("Codex App Server disconnected") from exc

    def _start(self) -> None:
        with self._state_lock:
            if self._process is not None and self._process.poll() is None:
                return
            if not self.command:
                raise CodexAppServerError(
                    "Codex CLI was not found. Install Codex or make its executable available to ModelForge."
                )
            try:
                self._process = subprocess.Popen(
                    self.command,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    bufsize=1,
                )
            except (OSError, ValueError) as exc:
                raise CodexAppServerError("Codex App Server could not be started") from exc
            self._stderr_tail = ""
            self._reader = threading.Thread(
                target=self._read_stdout, name="modelforge-codex-events", daemon=True,
            )
            self._stderr_reader = threading.Thread(
                target=self._read_stderr, name="modelforge-codex-errors", daemon=True,
            )
            self._reader.start()
            self._stderr_reader.start()
        try:
            self.request("initialize", {
                "clientInfo": {
                    "name": "modelforge-public-workbench",
                    "title": "ModelForge Coding Assistant",
                    "version": "0.1.0a1",
                },
            })
            self._send({"jsonrpc": "2.0", "method": "initialized", "params": {}})
        except Exception:
            self.close()
            raise

    def _read_stdout(self) -> None:
        process = self._process
        stream = process.stdout if process is not None else None
        if stream is None:
            return
        try:
            for line in stream:
                try:
                    value = json.loads(line)
                except (json.JSONDecodeError, TypeError):
                    continue
                if not isinstance(value, dict):
                    continue
                if "method" in value:
                    if "id" in value:
                        self._decline_server_request(value)
                    else:
                        with self._state_lock:
                            listeners = tuple(self._listeners.values())
                        for listener in listeners:
                            try:
                                listener(value)
                            except Exception:
                                continue
                    continue
                request_id = value.get("id")
                if isinstance(request_id, int):
                    with self._state_lock:
                        pending = self._pending.get(request_id)
                    if pending is not None:
                        pending[1]["response"] = value
                        pending[0].set()
        finally:
            with self._state_lock:
                pending = tuple(self._pending.values())
            for event, box in pending:
                box.setdefault("failure", "Codex App Server stopped unexpectedly")
                event.set()

    def _read_stderr(self) -> None:
        process = self._process
        stream = process.stderr if process is not None else None
        if stream is None:
            return
        for line in stream:
            self._stderr_tail = (self._stderr_tail + line)[-8_192:]

    def _decline_server_request(self, request: Mapping[str, Any]) -> None:
        """Fail closed: the public slice has no browser approval grant yet."""

        method = str(request.get("method") or "")
        if method in {
            "item/commandExecution/requestApproval", "item/fileChange/requestApproval",
            "execCommandApproval", "applyPatchApproval",
        }:
            response: dict[str, Any] = {"id": request["id"], "result": {"decision": "decline"}}
        else:
            response = {
                "id": request["id"],
                "error": {"code": -32601, "message": "Operation is not exposed by ModelForge"},
            }
        try:
            self._send(response)
        except CodexAppServerError:
            pass

    @staticmethod
    def _error_message(value: Any) -> str:
        if isinstance(value, Mapping):
            message = str(value.get("message") or "Codex rejected the request")
        else:
            message = str(value or "Codex rejected the request")
        return message[:500]

    def request(
        self, method: str, params: Mapping[str, Any] | None = None, *, timeout: float = 15,
    ) -> dict[str, Any]:
        if method != "initialize":
            with self._startup_lock:
                self._start()
        elif self._process is None:
            # initialize is called only by _start after the process is created.
            raise CodexAppServerError("Codex App Server is not running")
        with self._state_lock:
            request_id = self._next_id
            self._next_id += 1
            event = threading.Event()
            box: dict[str, Any] = {}
            self._pending[request_id] = (event, box)
        try:
            self._send({
                "jsonrpc": "2.0", "id": request_id,
                "method": method, "params": dict(params or {}),
            })
            if not event.wait(timeout):
                raise CodexAppServerError(f"Codex did not answer {method} in time")
            if box.get("failure"):
                raise CodexAppServerError(str(box["failure"]))
            response = box.get("response")
            if not isinstance(response, Mapping):
                raise CodexAppServerError("Codex returned an invalid response")
            if response.get("error") is not None:
                raise CodexAppServerError(self._error_message(response["error"]))
            result = response.get("result")
            if not isinstance(result, Mapping):
                raise CodexAppServerError("Codex returned an invalid result")
            return dict(result)
        finally:
            with self._state_lock:
                self._pending.pop(request_id, None)

    def add_listener(self, listener: NotificationListener) -> int:
        with self._state_lock:
            identity = self._next_listener
            self._next_listener += 1
            self._listeners[identity] = listener
            return identity

    def remove_listener(self, identity: int) -> None:
        with self._state_lock:
            self._listeners.pop(identity, None)

    def account(self) -> dict[str, Any]:
        value = self.request("account/read", {"refreshToken": False})
        account = value.get("account")
        return {
            "requires_openai_auth": bool(value.get("requiresOpenaiAuth", True)),
            "account": dict(account) if isinstance(account, Mapping) else None,
        }

    def begin_chatgpt_login(self) -> dict[str, Any]:
        value = self.request("account/login/start", {"type": "chatgpt"})
        if value.get("type") != "chatgpt" or not value.get("loginId") or not value.get("authUrl"):
            raise CodexAppServerError("Codex returned an invalid ChatGPT login response")
        return {"login_id": str(value["loginId"]), "auth_url": str(value["authUrl"])}

    def close(self) -> None:
        with self._state_lock:
            process = self._process
            self._process = None
        if process is None:
            return
        try:
            process.terminate()
            process.wait(timeout=2)
        except (OSError, subprocess.TimeoutExpired):
            try:
                process.kill()
            except OSError:
                pass


__all__ = [
    "CodexAppServer", "CodexAppServerError", "discover_codex_executable",
]
