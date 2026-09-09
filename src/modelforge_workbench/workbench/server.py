"""Small, explicitly unstable HTTP adapter for the public alpha."""

from __future__ import annotations

import json
import os
import secrets
import threading
import webbrowser
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib.resources import files
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from modelforge_workbench.alpha import AlphaWorkbench


_SECURITY_HEADERS = {
    "Content-Security-Policy": (
        "default-src 'self'; script-src 'self'; style-src 'self'; "
        "img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; "
        "object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    ),
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
}


def _modal_provider_status() -> dict:
    """Project local-only Modal readiness into the browser without credential values."""

    environment = os.environ.get("MODAL_ENVIRONMENT", "main").strip() or "main"
    profile = os.environ.get("MODAL_PROFILE", "").strip() or None
    try:
        readiness = AlphaWorkbench.modal_status(environment)
    except Exception:
        return {
            "provider": "modal",
            "state": "error",
            "installed": False,
            "profile": profile,
            "environment": environment,
            "message": "Modal readiness could not be inspected locally. Open the setup guide for troubleshooting.",
            "live_verified": False,
        }
    configured = bool(readiness.get("ready"))
    installed = bool(readiness.get("sdk_installed"))
    if configured:
        message = "Modal SDK and local credentials are configured; live provider verification has not been performed."
    elif installed:
        message = "Modal SDK is installed, but local credentials are not configured."
    else:
        message = "Modal is optional and not configured. Install the Modal extra to use the remote synthetic workflow."
    return {
        "provider": "modal",
        "state": "configured" if configured else "unconfigured",
        "installed": installed,
        "profile": profile,
        "environment": environment,
        "message": message,
        "live_verified": False,
    }


class _Server(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, app: AlphaWorkbench, token: str):
        super().__init__(address, _Handler)
        self.app = app
        self.token = token
        self.finishing: dict[str, threading.Thread] = {}
        self._managed_close_lock = threading.Lock()
        self._managed_closed = False

    def close_managed_actions(self) -> None:
        """Stop owned actions and wait for their bounded finalizers on shutdown."""

        with self._managed_close_lock:
            if self._managed_closed:
                return
            self._managed_closed = True
        self.app.shutdown()
        for thread in tuple(self.finishing.values()):
            thread.join(timeout=3)

    def server_close(self) -> None:
        self.close_managed_actions()
        super().server_close()


class _Handler(BaseHTTPRequestHandler):
    server: _Server

    def log_message(self, format, *args):  # noqa: A002
        return

    def _headers(self, status: int, content_type: str, length: int | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        for name, value in _SECURITY_HEADERS.items():
            self.send_header(name, value)
        if length is not None:
            self.send_header("Content-Length", str(length))

    def _host_valid(self) -> bool:
        port = self.server.server_address[1]
        return self.headers.get("Host", "") in {f"127.0.0.1:{port}", f"localhost:{port}"}

    def _authorized(self, *, mutation: bool = False) -> bool:
        if not self._host_valid():
            self._json(HTTPStatus.BAD_REQUEST, {"error": "Invalid loopback host"})
            return False
        expected = f"Bearer {self.server.token}"
        if not secrets.compare_digest(self.headers.get("Authorization", ""), expected):
            self._json(HTTPStatus.UNAUTHORIZED, {"error": "Local session token required"})
            return False
        if mutation:
            origin = self.headers.get("Origin")
            port = self.server.server_address[1]
            if origin not in {None, f"http://127.0.0.1:{port}", f"http://localhost:{port}"}:
                self._json(HTTPStatus.FORBIDDEN, {"error": "Cross-origin mutation denied"})
                return False
        return True

    def _json(self, status: int, value) -> None:
        payload = json.dumps(value, sort_keys=True).encode("utf-8")
        self._headers(status, "application/json; charset=utf-8", len(payload))
        self.end_headers()
        self.wfile.write(payload)

    def _static(self, name: str, content_type: str) -> None:
        payload = files("modelforge_workbench.workbench").joinpath("static", name).read_bytes()
        self._headers(HTTPStatus.OK, content_type, len(payload))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(payload)

    def _body(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as exc:
            raise ValueError("Request content length is invalid") from exc
        if not 0 < length <= 128 * 1024:
            raise ValueError("JSON request must be from 1 byte to 128 KiB")
        value = json.loads(self.rfile.read(length))
        if not isinstance(value, dict):
            raise ValueError("JSON request must be an object")
        return value

    def do_GET(self):  # noqa: N802
        parsed = urlparse(self.path)
        route = parsed.path
        if not self._host_valid():
            self._json(HTTPStatus.BAD_REQUEST, {"error": "Invalid loopback host"})
            return
        if route == "/api/v1/ready":
            self._json(HTTPStatus.OK, {"ready": True, "scope": "public-alpha", "network": "loopback"})
            return
        if route in {"/", "/index.html"}:
            self._static("index.html", "text/html; charset=utf-8")
            return
        if route == "/modal-setup.html":
            self._static("modal-setup.html", "text/html; charset=utf-8")
            return
        if route == "/app.css":
            self._static("app.css", "text/css; charset=utf-8")
            return
        if route == "/app.js":
            self._static("app.js", "text/javascript; charset=utf-8")
            return
        if not self._authorized():
            return
        if route == "/api/v1/project":
            self._json(HTTPStatus.OK, self.server.app.capabilities())
            return
        if route == "/api/v1/projects":
            self._json(HTTPStatus.OK, {"projects": self.server.app.list_projects()})
            return
        if route == "/api/v1/providers/modal":
            self._json(HTTPStatus.OK, _modal_provider_status())
            return
        if route == "/api/v1/runs":
            project_id = parse_qs(parsed.query).get("project_id", [None])[0]
            self._json(HTTPStatus.OK, {"runs": self.server.app.list_runs(project_id)})
            return
        parts = [part for part in route.split("/") if part]
        if len(parts) == 4 and parts[:3] == ["api", "v1", "projects"]:
            try:
                self._json(HTTPStatus.OK, self.server.app.project(parts[3]))
            except KeyError:
                self._json(HTTPStatus.NOT_FOUND, {"error": "Project was not found"})
            return
        if (
            len(parts) == 7 and parts[:3] == ["api", "v1", "projects"]
            and parts[4] == "datasets" and parts[6] == "samples"
        ):
            try:
                query = parse_qs(parsed.query)
                self._json(HTTPStatus.OK, self.server.app.list_samples(
                    parts[3], parts[5], cursor=int(query.get("cursor", [0])[0]),
                    limit=int(query.get("limit", [50])[0]),
                ))
            except (KeyError, OSError, ValueError) as exc:
                self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)[:300]})
            return
        if (
            len(parts) == 9 and parts[:3] == ["api", "v1", "projects"]
            and parts[4] == "datasets" and parts[6] == "samples" and parts[8] == "content"
        ):
            try:
                sample = self.server.app.open_sample(parts[3], parts[5], parts[7])
                self._file(sample.path, sample.content_type, sample.size_bytes, sample.path.name)
            except (KeyError, OSError, ValueError):
                self._json(HTTPStatus.NOT_FOUND, {"error": "Sample was not found or changed"})
            return
        if len(parts) == 4 and parts[:3] == ["api", "v1", "runs"]:
            try:
                self._json(HTTPStatus.OK, self.server.app.get_run(parts[3]))
            except KeyError:
                self._json(HTTPStatus.NOT_FOUND, {"error": "Run was not found"})
            return
        if len(parts) == 6 and parts[:3] == ["api", "v1", "runs"] and parts[4] == "artifacts":
            self._artifact(parts[3], parts[5])
            return
        self._json(HTTPStatus.NOT_FOUND, {"error": "Not found"})

    def _artifact(self, run_id: str, artifact_id: str) -> None:
        try:
            opened = self.server.app.open_artifact(run_id, artifact_id)
        except (KeyError, OSError, ValueError):
            self._json(HTTPStatus.NOT_FOUND, {"error": "Artifact was not found or changed"})
            return
        with opened.stream:
            self._stream(opened.stream, opened.content_type, opened.size_bytes, opened.filename)

    def _file(self, path: Path, content_type: str, size_bytes: int, filename: str) -> None:
        with path.open("rb") as stream:
            self._stream(stream, content_type, size_bytes, filename)

    def _stream(self, stream, content_type: str, size_bytes: int, filename: str) -> None:
        start, end = 0, size_bytes - 1
        status = HTTPStatus.OK
        requested = self.headers.get("Range")
        if requested:
            try:
                unit, span = requested.split("=", 1)
                first, last = span.split("-", 1)
                if unit != "bytes" or not first:
                    raise ValueError
                start = int(first)
                end = int(last) if last else end
                if start < 0 or end < start or end >= size_bytes:
                    raise ValueError
                status = HTTPStatus.PARTIAL_CONTENT
            except ValueError:
                self._headers(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE, "application/json", 0)
                self.send_header("Content-Range", f"bytes */{size_bytes}")
                self.end_headers()
                return
        length = end - start + 1
        self._headers(status, content_type, length)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Disposition", f'inline; filename="{filename}"')
        if status == HTTPStatus.PARTIAL_CONTENT:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size_bytes}")
        self.end_headers()
        stream.seek(start)
        remaining = length
        while remaining:
            chunk = stream.read(min(64 * 1024, remaining))
            if not chunk:
                break
            self.wfile.write(chunk)
            remaining -= len(chunk)

    def do_POST(self):  # noqa: N802
        route = urlparse(self.path).path
        if not self._authorized(mutation=True):
            return
        if route == "/api/v1/example-runs":
            try:
                execution = self.server.app.start_example()
            except Exception as exc:
                self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)[:300]})
                return

            def finish():
                try:
                    self.server.app.finish_example(execution)
                except Exception:
                    pass
                finally:
                    self.server.finishing.pop(execution.run_id, None)

            thread = threading.Thread(target=finish)
            self.server.finishing[execution.run_id] = thread
            thread.start()
            self._json(HTTPStatus.ACCEPTED, self.server.app.get_run(execution.run_id))
            return
        parts = [part for part in route.split("/") if part]
        if (
            len(parts) == 7 and parts[:3] == ["api", "v1", "projects"]
            and parts[4] == "actions" and parts[6] == "runs"
        ):
            try:
                project = self.server.app.project(parts[3])
                if project["action"]["id"] != parts[5]:
                    raise ValueError("Action is not registered for this project")
                execution = self.server.app.start_project_action(parts[3], self._body())
            except (KeyError, OSError, ValueError, json.JSONDecodeError) as exc:
                self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)[:300]})
                return

            if isinstance(execution, dict):
                self._json(HTTPStatus.OK, execution)
                return

            def finish_project():
                try:
                    self.server.app.finish_project_action(execution)
                except Exception:
                    pass
                finally:
                    self.server.finishing.pop(execution.run_id, None)

            thread = threading.Thread(target=finish_project)
            # Provider work outlives this loopback process. A local action is
            # still owned by it and must finish or be cancelled on shutdown.
            thread.daemon = execution.intent.provider != "local"
            self.server.finishing[execution.run_id] = thread
            thread.start()
            self._json(HTTPStatus.ACCEPTED, self.server.app.get_run(execution.run_id, parts[3]))
            return
        if len(parts) == 5 and parts[:3] == ["api", "v1", "runs"] and parts[4] == "recover":
            try:
                run = self.server.app.get_run(parts[3])
                execution = self.server.app.recover_project_action(run["project_id"], parts[3])
            except (KeyError, OSError, RuntimeError, ValueError) as exc:
                self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)[:300]})
                return

            def finish_recovery():
                try:
                    self.server.app.finish_project_action(execution)
                except Exception:
                    pass
                finally:
                    self.server.finishing.pop(execution.run_id, None)

            thread = threading.Thread(target=finish_recovery, daemon=True)
            self.server.finishing[execution.run_id] = thread
            thread.start()
            self._json(HTTPStatus.ACCEPTED, self.server.app.get_run(execution.run_id, run["project_id"]))
            return
        if len(parts) == 5 and parts[:3] == ["api", "v1", "runs"] and parts[4] == "cancel":
            try:
                run = self.server.app.get_run(parts[3])
                self._json(HTTPStatus.OK, self.server.app.cancel(parts[3], run["project_id"]))
            except KeyError:
                self._json(HTTPStatus.NOT_FOUND, {"error": "Run was not found"})
            return
        self._json(HTTPStatus.NOT_FOUND, {"error": "Not found"})


def serve(
    *, state_root: str | Path | None = None, port: int = 8000,
    open_browser: bool = True, token: str | None = None,
) -> None:
    if isinstance(port, bool) or not isinstance(port, int) or not 0 <= port <= 65535:
        raise ValueError("Port must be from 0 to 65535")
    session_token = token or secrets.token_urlsafe(32)
    server = _Server(("127.0.0.1", port), AlphaWorkbench(state_root), session_token)
    actual_port = server.server_address[1]
    url = f"http://127.0.0.1:{actual_port}/#token={session_token}"
    print(f"ModelForge public alpha: {url}", flush=True)
    print("Trusted-local boundary: project processes run with your user permissions.", flush=True)
    if open_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


__all__ = ["serve"]
