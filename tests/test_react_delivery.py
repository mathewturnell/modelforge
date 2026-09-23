from __future__ import annotations

import http.client
import json
import re
import threading
from pathlib import Path

import pytest

from modelforge_workbench.alpha import AlphaWorkbench
from modelforge_workbench.workbench import server as server_module
from modelforge_workbench.workbench.server import _Server


def _request(
    server: _Server,
    method: str,
    path: str,
    *,
    token: str | None = None,
    origin: str | None = None,
    body: dict | None = None,
):
    connection = http.client.HTTPConnection(
        "127.0.0.1", server.server_address[1], timeout=5,
    )
    headers = {"Host": f"127.0.0.1:{server.server_address[1]}"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if origin:
        headers["Origin"] = origin
    payload = None
    if body is not None:
        payload = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
        headers["Content-Length"] = str(len(payload))
    connection.request(method, path, body=payload, headers=headers)
    response = connection.getresponse()
    result = response.status, response.headers, response.read()
    connection.close()
    return result


@pytest.fixture
def compiled_client(tmp_path, monkeypatch):
    package_root = tmp_path / "package"
    client_root = package_root / "static" / "workbench"
    assets = client_root / "assets"
    assets.mkdir(parents=True)
    index = (
        '<!doctype html><html><head></head><body><div id="root"></div>'
        '<script type="module" src="/workbench/assets/index-a1b2c3.js"></script></body></html>'
    )
    (client_root / "index.html").write_text(index, encoding="utf-8")
    (assets / "index-a1b2c3.js").write_text(
        'sessionStorage.setItem("modelforge.token", location.hash);', encoding="utf-8",
    )
    (assets / "index-d4e5f6.css").write_text("#root{display:block}", encoding="utf-8")
    monkeypatch.setattr(server_module, "files", lambda _package: package_root)
    return index


def test_root_and_hashed_assets_serve_with_restrictive_headers(
    tmp_path, compiled_client,
):
    token = "test-session-token"
    server = _Server(("127.0.0.1", 0), AlphaWorkbench(tmp_path / "state"), token)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        status, headers, body = _request(server, "GET", "/")
        assert status == 200
        assert re.sub(r'<meta name="modelforge-style-nonce" content="[A-Za-z0-9_-]+">', "",
                      body.decode("utf-8")) == compiled_client
        assert headers["Cache-Control"] == "no-cache, no-store"
        assert headers["X-Content-Type-Options"] == "nosniff"
        assert headers["X-Frame-Options"] == "DENY"
        assert "script-src 'self'" in headers["Content-Security-Policy"]
        assert "media-src 'self' blob:" in headers["Content-Security-Policy"]
        assert "connect-src 'self'" in headers["Content-Security-Policy"]

        status, headers, body = _request(
            server, "GET", "/workbench/assets/index-a1b2c3.js",
        )
        assert status == 200
        assert headers["Content-Type"] == "text/javascript; charset=utf-8"
        assert headers["Cache-Control"] == "public, max-age=31536000, immutable"
        assert b"sessionStorage" in body

        assert _request(server, "GET", "/workbench/assets/missing.js")[0] == 404
        assert _request(server, "GET", "/workbench/%2e%2e/index.html")[0] == 404
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


def test_public_projection_requires_bearer_and_has_no_commercial_api(
    tmp_path, compiled_client,
):
    token = "test-session-token"
    server = _Server(("127.0.0.1", 0), AlphaWorkbench(tmp_path / "state"), token)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        assert _request(server, "GET", "/api/v1/projects")[0] == 401
        status, _headers, body = _request(
            server, "GET", "/api/v1/projects", token=token,
        )
        assert status == 200
        projection = json.loads(body)
        assert projection["projects"][0]["id"] == "synthetic-threshold"
        serialized = json.dumps(projection)
        assert "storage_ref" not in serialized
        assert "project_repository" not in serialized
        assert _request(server, "GET", "/api/commercial/status", token=token)[0] == 404
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


def test_generic_project_action_route_dispatches_bundled_public_action(
    tmp_path, compiled_client,
):
    token = "test-session-token"
    server = _Server(("127.0.0.1", 0), AlphaWorkbench(tmp_path / "state"), token)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    route = "/api/v1/projects/synthetic-threshold/actions/inference/runs"
    request = {
        "protocol": "modelforge.managed-action-request/v1",
        "execution": {"target": "local"},
        "input": {},
    }
    try:
        port = server.server_address[1]
        assert _request(
            server, "POST", route, token=token, origin="https://attacker.invalid",
            body=request,
        )[0] == 403
        status, _headers, body = _request(
            server, "POST", route, token=token,
            origin=f"http://127.0.0.1:{port}", body=request,
        )
        assert status == 202
        run = json.loads(body)
        assert run["project_id"] == "synthetic-threshold"
        assert run["status"] in {"queued", "running", "completed"}

        wrong_target = {**request, "execution": {"target": "hosted"}}
        assert _request(
            server, "POST", route, token=token, body=wrong_target,
        )[0] == 400
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


def test_compiled_client_paths_are_declared_for_wheel_and_sdist():
    root = Path(__file__).parents[1]
    pyproject = (root / "pyproject.toml").read_text(encoding="utf-8")
    manifest = (root / "MANIFEST.in").read_text(encoding="utf-8")

    assert '"static/workbench/*"' in pyproject
    assert '"static/workbench/assets/*"' in pyproject
    assert '"static/*.css"' in pyproject
    assert "recursive-include src/modelforge_workbench/workbench/static *.html *.css" in manifest
    assert "recursive-include src/modelforge_workbench/workbench/static/workbench *" in manifest
