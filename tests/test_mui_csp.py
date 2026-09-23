"""Emotion styles get a fresh document nonce without broadening script authority."""
from __future__ import annotations

import http.client
import re
import threading

import pytest

from modelforge_workbench.alpha import AlphaWorkbench
from modelforge_workbench.workbench import server as server_module
from modelforge_workbench.workbench.server import _SECURITY_HEADERS, _Server


@pytest.fixture
def mui_server(tmp_path, monkeypatch):
    package = tmp_path / "package"
    client = package / "static" / "workbench"
    assets = client / "assets"
    assets.mkdir(parents=True)
    (client / "index.html").write_text('<!doctype html><html><head><title>App</title></head><body></body></html>')
    (assets / "app.js").write_text('export const value = "app";')
    (assets / "app.css").write_text('body{color:white}')
    monkeypatch.setattr(server_module, "files", lambda _package: package)
    server = _Server(("127.0.0.1", 0), AlphaWorkbench(tmp_path / "state"), "private-bearer-for-test")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)


def read(server, route, *, method="GET", host=None, authorized=False, origin=None):
    connection = http.client.HTTPConnection("127.0.0.1", server.server_address[1], timeout=5)
    headers = {"Host": host or f"127.0.0.1:{server.server_address[1]}"}
    if authorized:
        headers["Authorization"] = "Bearer private-bearer-for-test"
    if origin:
        headers["Origin"] = origin
    try:
        connection.request(method, route, headers=headers)
        response = connection.getresponse()
        return response.status, dict(response.headers), response.read()
    finally:
        connection.close()


def test_document_nonce_is_fresh_and_only_authorizes_matching_style_elements(mui_server):
    seen = set()
    for route in ("/", "/", "/index.html", "/workbench", "/workbench/", "/workbench/index.html"):
        status, headers, body = read(mui_server, route)
        assert status == 200
        match = re.search(rb'<head><meta name="modelforge-style-nonce" content="([A-Za-z0-9_-]{43})">', body)
        assert match is not None
        nonce = match[1].decode()
        assert nonce not in seen
        seen.add(nonce)
        csp = headers["Content-Security-Policy"]
        assert csp == _SECURITY_HEADERS["Content-Security-Policy"].replace(
            "style-src 'self';", f"style-src 'self' 'nonce-{nonce}';",
        )
        assert "script-src 'self';" in csp
        assert "unsafe-inline" not in csp and "unsafe-eval" not in csp
        assert headers["Cache-Control"] == "no-cache, no-store"
        assert int(headers["Content-Length"]) == len(body)
        assert b"private-bearer-for-test" not in body
        assert "private-bearer-for-test" not in str(headers)


@pytest.mark.parametrize("route", ["/workbench/assets/app.js", "/workbench/assets/app.css"])
def test_static_assets_keep_immutable_headers_without_nonce(mui_server, route):
    status, headers, body = read(mui_server, route)
    assert status == 200
    assert headers["Cache-Control"] == "public, max-age=31536000, immutable"
    assert headers["Content-Security-Policy"] == _SECURITY_HEADERS["Content-Security-Policy"]
    assert b"modelforge-style-nonce" not in body


def test_api_authorization_host_and_origin_controls_are_unchanged(mui_server):
    status, headers, body = read(mui_server, "/api/v1/projects")
    assert status == 401
    assert headers["Content-Security-Policy"] == _SECURITY_HEADERS["Content-Security-Policy"]
    assert "Access-Control-Allow-Origin" not in headers
    assert b"private-bearer-for-test" not in body and b"nonce" not in body
    assert read(mui_server, "/api/v1/projects", authorized=True)[0] == 200
    assert read(mui_server, "/", host="untrusted.invalid")[0] == 400
    assert read(mui_server, "/api/v1/runs", method="POST", authorized=True,
                origin="https://untrusted.invalid")[0] == 403
