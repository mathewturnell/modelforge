from __future__ import annotations

from modelforge_workbench.workbench import server


def test_modal_browser_status_is_local_redacted_and_not_live_verified(monkeypatch):
    observed = []

    def status(environment):
        observed.append(environment)
        return {
            "sdk_installed": True,
            "ready": True,
            "credentials": "configured",
            "verification": "not_performed",
        }

    monkeypatch.setenv("MODAL_ENVIRONMENT", "alpha-test")
    monkeypatch.setenv("MODAL_PROFILE", "developer")
    monkeypatch.setattr(server.AlphaWorkbench, "modal_status", status)

    value = server._modal_provider_status()

    assert observed == ["alpha-test"]
    assert value == {
        "provider": "modal",
        "state": "configured",
        "installed": True,
        "profile": "developer",
        "environment": "alpha-test",
        "message": "Modal SDK and local credentials are configured; live provider verification has not been performed.",
        "live_verified": False,
    }
    assert "token" not in repr(value).casefold()


def test_modal_browser_status_is_unconfigured_without_optional_sdk(monkeypatch):
    monkeypatch.delenv("MODAL_ENVIRONMENT", raising=False)
    monkeypatch.delenv("MODAL_PROFILE", raising=False)
    monkeypatch.setattr(
        server.AlphaWorkbench,
        "modal_status",
        lambda environment: {"sdk_installed": False, "ready": False},
    )

    value = server._modal_provider_status()

    assert value["state"] == "unconfigured"
    assert value["installed"] is False
    assert value["environment"] == "main"
    assert value["profile"] is None
    assert value["live_verified"] is False


def test_packaged_modal_setup_page_has_cost_and_credential_boundaries():
    source = (
        server.files("modelforge_workbench.workbench")
        .joinpath("static", "modal-setup.html")
        .read_text(encoding="utf-8")
    )
    assert "--confirm-billable" in source
    assert "does not enforce a budget" in source
    assert "Never put tokens" in source
    assert "modal app stop" in source
    assert 'href="/modal-setup.css"' in source
    assert 'href="/app.css"' not in source
    stylesheet = (
        server.files("modelforge_workbench.workbench")
        .joinpath("static", "modal-setup.css")
        .read_text(encoding="utf-8")
    )
    assert "main.guide" in stylesheet
    assert ":focus-visible" in stylesheet
