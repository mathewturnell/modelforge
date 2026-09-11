from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).parents[1]
STATIC = ROOT / "src" / "modelforge_workbench" / "workbench" / "static"
CLIENT = ROOT / "workbench" / "src"


def test_modal_target_controls_are_explicit_accessible_and_non_defaulting() -> None:
    app = (CLIENT / "App.tsx").read_text(encoding="utf-8")

    assert "<span>Execution target</span><select" in app
    assert 'type="checkbox" checked={billable}' in app
    assert "I confirm this exact user-owned Modal binding may incur charges." in app
    assert 'target?.billable && !billable ? "Confirm this billable target"' in app
    assert "setBillable(false)" in app
    assert "Recover exact Modal call" in app


def test_managed_launch_uses_stale_binding_confirmation_and_retry_identity() -> None:
    script = (CLIENT / "App.tsx").read_text(encoding="utf-8")

    assert 'protocol: "modelforge.managed-action-request/v1"' in script
    assert "idempotency_key: idempotency" in script
    assert "binding_sha256: target.binding_sha256 || null" in script
    assert "billable_confirmed:" in script
    assert "sessionStorage.setItem(key, JSON.stringify({fingerprint, idempotency}))" in script
    assert "retrying unchanged reuses the same identity" in script
    assert "sessionStorage.removeItem(key)" in script
    assert "application: target" not in script
    assert "function: target" not in script
    assert "environment: target" not in script


def test_provider_recovery_and_missing_observations_are_not_presented_as_success() -> None:
    script = (CLIENT / "App.tsx").read_text(encoding="utf-8")
    api = (CLIENT / "lib" / "api.ts").read_text(encoding="utf-8")

    assert "/recover`" in api
    assert "Recover exact Modal call" in script
    assert '`${run.status} · unavailable`' in script
    assert '`${run.status} · cancellation requested`' in script
    assert "No live progress reported." in script
    assert "completed · unavailable" not in script


def test_modal_controls_remain_operable_in_compact_layout() -> None:
    styles = (CLIENT / "styles.css").read_text(encoding="utf-8")

    compact = styles[styles.index("@media(max-width:1050px)") :]
    assert '"rail inspector"' in compact
    assert '"inspector"' in compact
    assert ".run-inspector{border-top" in compact
    assert ".primary{width:100%;min-height:44px}" in compact
    assert "word-break:break-all" in compact


def test_modal_setup_describes_owner_binding_cost_and_nonduplicating_recovery() -> None:
    guide = (STATIC / "modal-setup.html").read_text(encoding="utf-8")

    assert "private owner binding" in guide
    assert "does not verify an app or its assets" in guide
    assert "not a quote or budget cap" in guide
    assert "recovery never starts a new call" in guide
    assert "Removing local state does not stop remote work" in guide
    assert "only the bundled Synthetic Threshold Lab" not in guide
    assert 'href="/modal-setup.css"' in guide


def test_real_project_modal_recovery_tutorial_uses_the_project_action_command() -> None:
    tutorial = (ROOT / "docs" / "modal.md").read_text(encoding="utf-8")

    assert ".venv/bin/modelforge action recover-modal" in tutorial
    assert "--project <PROJECT_ID>" in tutorial
