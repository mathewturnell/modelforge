from __future__ import annotations

from pathlib import Path
import re


ROOT = Path(__file__).parents[1]
STATIC = ROOT / "src" / "modelforge_workbench" / "workbench" / "static"
CLIENT = ROOT / "workbench" / "src"


def test_modal_target_controls_are_explicit_accessible_and_non_defaulting() -> None:
    picker = (CLIENT / "components" / "ComputeTargetPicker.tsx").read_text(encoding="utf-8")
    toolbar = (CLIENT / "components" / "ExecutionToolbar.tsx").read_text(encoding="utf-8")
    api = (CLIENT / "lib" / "api.ts").read_text(encoding="utf-8")

    assert 'aria-label="Execution target"' in picker
    assert '<option value="cloud" disabled={!cloudReady}>' in picker
    assert 'disabled: !cloudReady' in toolbar
    assert "Provider compute may be billable" in api
    assert 'billable_confirmed: true' in api


def test_managed_launch_uses_stale_binding_confirmation_and_retry_identity() -> None:
    script = (CLIENT / "lib" / "api.ts").read_text(encoding="utf-8")

    assert 'protocol: "modelforge.managed-action-request/v1"' in script
    assert "idempotency_key: idempotencyKey" in script
    assert "binding_sha256: bindingSha256" in script
    assert "billable_confirmed: true" in script
    assert re.search(
        r"sessionStorage\.setItem\(retryKey, JSON\.stringify\(\{fingerprint, idempotency: idempotencyKey\}\)\)",
        script,
    )
    assert "retained.fingerprint === fingerprint" in script
    assert "sessionStorage.removeItem(retryKey)" in script
    assert "application: target" not in script
    assert "function: target" not in script
    assert "environment: target" not in script


def test_provider_recovery_and_missing_observations_are_not_presented_as_success() -> None:
    script = (CLIENT / "views" / "JobsView.tsx").read_text(encoding="utf-8")
    api = (CLIENT / "lib" / "api.ts").read_text(encoding="utf-8")

    assert "/recover`" in api
    assert "Recover exact Modal call" in script
    assert 'observation.state === "unavailable"' in script
    assert 'observation.stale === true' in script
    assert 'jobLocation(job) === "cloud"' in script
    assert "it does not submit a new one" in script
    assert "jobCanRecover(job)" in script


def test_modal_controls_remain_operable_in_compact_layout() -> None:
    styles = (CLIENT / "styles.css").read_text(encoding="utf-8")

    compact = styles[styles.index("@media (max-width: 760px)") :]
    assert ".compact-activity-trigger { display: inline-grid; }" in compact
    assert ".run-detail" in compact
    assert ".artifact-modal-body { grid-template-columns: 1fr; }" in compact
    assert "min-height: 45px" in styles
    assert "overflow-wrap: anywhere" in styles


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
