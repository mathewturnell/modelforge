from __future__ import annotations

from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).parents[1]
STATIC = ROOT / "src" / "modelforge_workbench" / "workbench" / "static"


class _Elements(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.attributes: dict[str, dict[str, str | None]] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if element_id := values.get("id"):
            assert element_id not in self.attributes
            self.attributes[element_id] = {"tag": tag, **values}


def _page_elements() -> dict[str, dict[str, str | None]]:
    parser = _Elements()
    parser.feed((STATIC / "index.html").read_text(encoding="utf-8"))
    return parser.attributes


def test_modal_target_controls_are_explicit_accessible_and_non_defaulting() -> None:
    elements = _page_elements()

    assert elements["execution-panel"]["tag"] == "fieldset"
    assert elements["execution-target"] == {
        "tag": "select",
        "id": "execution-target",
        "aria-describedby": "execution-detail",
    }
    assert elements["billable-confirm"]["type"] == "checkbox"
    assert elements["billable-confirm"]["aria-describedby"] == "billable-warning"
    assert elements["recover"]["type"] == "button"
    assert "hidden" in elements["recover"]

    script = (STATIC / "app.js").read_text(encoding="utf-8")
    assert "targetIsReady(target) && !target.billable && !isModalTarget(target)" in script
    assert 'node("billable-confirm").checked = false' in script
    assert "Confirm billable run to continue" in script
    assert "planned and unreconciled" in (STATIC / "index.html").read_text(encoding="utf-8")


def test_managed_launch_uses_stale_binding_confirmation_and_retry_identity() -> None:
    script = (STATIC / "app.js").read_text(encoding="utf-8")

    assert 'protocol: "modelforge.managed-action-request/v1"' in script
    assert "idempotency_key: pending.idempotency_key" in script
    assert "binding_sha256: launchingTarget.binding_sha256 || null" in script
    assert "billable_confirmed:" in script
    assert "sessionStorage.setItem(idempotencyStorageKey(project)" in script
    assert "retrying unchanged will reuse the same launch identity" in script
    assert "clearPendingLaunch(launchingProject)" in script
    assert "application: launchingTarget" not in script
    assert "function: launchingTarget" not in script
    assert "environment: launchingTarget" not in script


def test_provider_recovery_and_missing_observations_are_not_presented_as_success() -> None:
    script = (STATIC / "app.js").read_text(encoding="utf-8")

    assert "/recover`" in script
    assert "Recovery does not start a second call" in script
    assert "No completion or failure has been inferred" in script
    assert "live Modal logs are not streamed" in script
    assert "no live scientific telemetry or provider usage" in script
    assert "Cancellation was confirmed by Modal" in script


def test_modal_controls_remain_operable_in_compact_layout() -> None:
    styles = (STATIC / "app.css").read_text(encoding="utf-8")

    compact = styles[styles.index("@media (max-width: 620px)") :]
    assert ".run-controls" in compact
    assert ".run-controls button, #run { width: 100%; }" in compact
    assert ".target-detail code" in compact
    assert "word-break: break-all" in compact


def test_modal_setup_describes_owner_binding_cost_and_nonduplicating_recovery() -> None:
    guide = (STATIC / "modal-setup.html").read_text(encoding="utf-8")

    assert "private owner binding" in guide
    assert "does not verify an app or its assets" in guide
    assert "not a quote or budget cap" in guide
    assert "recovery never starts a new call" in guide
    assert "Removing local state does not stop remote work" in guide
    assert "only the bundled Synthetic Threshold Lab" not in guide
