"""Deterministic JSON-lines Codex App Server fixture; it makes no model call."""

from __future__ import annotations

import json
import sys


for line in sys.stdin:
    request = json.loads(line)
    method = request.get("method")
    if "id" not in request:
        continue
    if method == "initialize":
        result = {"userAgent": "fake-codex/1.0"}
    elif method == "account/read":
        result = {
            "account": {"type": "chatgpt", "email": "owner@example.test", "planType": "pro"},
            "requiresOpenaiAuth": True,
        }
    elif method == "account/login/start":
        result = {
            "type": "chatgpt", "loginId": "login-fixture",
            "authUrl": "https://auth.openai.com/authorize",
        }
    else:
        print(json.dumps({
            "id": request["id"],
            "error": {"code": -32601, "message": f"unsupported fixture method: {method}"},
        }), flush=True)
        continue
    print(json.dumps({"id": request["id"], "result": result}), flush=True)
