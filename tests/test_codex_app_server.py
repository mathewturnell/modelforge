from __future__ import annotations

import sys
from pathlib import Path

import pytest

from modelforge_workbench.application.codex_app_server import (
    CodexAppServer,
    CodexAppServerError,
)


def test_app_server_reads_account_and_starts_provider_owned_login():
    fixture = Path(__file__).parent / "fixtures" / "fake_codex_app_server.py"
    provider = CodexAppServer((sys.executable, str(fixture)))
    try:
        assert provider.account() == {
            "requires_openai_auth": True,
            "account": {
                "type": "chatgpt", "email": "owner@example.test", "planType": "pro",
            },
        }
        assert provider.begin_chatgpt_login() == {
            "login_id": "login-fixture",
            "auth_url": "https://auth.openai.com/authorize",
        }
    finally:
        provider.close()


def test_app_server_crash_is_explicit_and_bounded():
    provider = CodexAppServer((sys.executable, "-c", "raise SystemExit(0)"))
    try:
        with pytest.raises(CodexAppServerError, match="stopped unexpectedly|disconnected"):
            provider.account()
    finally:
        provider.close()
