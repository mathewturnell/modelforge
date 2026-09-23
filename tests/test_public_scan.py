from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest


ROOT = Path(__file__).parents[1]


def _scanner():
    path = ROOT / "scripts" / "scan_public_candidate.py"
    spec = importlib.util.spec_from_file_location("public_candidate_scanner", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize(
    ("category", "payload"),
    (
        ("private_home_path", b"/" + b"home" + b"/person/project"),
        ("aws_access_key", b"AK" + b"IA" + b"A" * 16),
        ("github_token", b"gh" + b"p_" + b"A" * 24),
        ("gitlab_token", b"gl" + b"pat-" + b"A" * 24),
        ("google_api_key", b"AI" + b"za" + b"A" * 32),
        ("huggingface_token", b"hf" + b"_" + b"A" * 30),
        ("modal_token_id", b"ak" + b"-" + b"A" * 24),
        ("modal_token_secret", b"as" + b"-" + b"A" * 24),
        ("openai_key", b"sk" + b"-" + b"A" * 24),
        ("slack_token", b"xo" + b"xb-" + b"A" * 24),
        ("stripe_secret", b"sk" + b"_live_" + b"A" * 24),
        ("private_key", b"-----BEGIN " + b"PRIVATE KEY-----"),
    ),
)
def test_every_secret_pattern_has_a_positive_and_negative_case(category, payload):
    pattern = _scanner().PATTERNS[category]
    assert pattern.search(payload)
    assert pattern.search(b"reviewed placeholder <secret>") is None


@pytest.mark.parametrize(
    ("path", "category"),
    (
        (".env", "populated_environment_file"),
        ("config/.env.production", "populated_environment_file"),
        (".modal.toml", "credential_or_auth_file"),
        ("state/runs.sqlite3", "private_binary_or_execution_material"),
        ("src/__pycache__/module.pyc", "generated_or_cache_material"),
    ),
)
def test_sensitive_and_generated_path_families_are_classified(path, category):
    assert _scanner()._category_for_path(path) == category


def test_reviewed_environment_templates_are_not_classified_as_credentials():
    scanner = _scanner()
    assert scanner._category_for_path(".env.example") is None
    assert scanner._category_for_path("config/.env.template") is None


def test_only_named_reviewed_visuals_are_accepted_as_binary_fixtures():
    scanner = _scanner()
    expected = {
        "browser-tests/journeys/first-use.spec.js-snapshots/first-use-desktop-linux.png",
        "browser-tests/journeys/first-use.spec.js-snapshots/first-use-mobile-390-linux.png",
        "docs/assets/screenshots/01-project-overview.png",
        "docs/assets/screenshots/02-dataset-selection.png",
        "docs/assets/screenshots/03-vision-result.png",
        "docs/assets/screenshots/04-qwen-prompt.png",
        "docs/assets/screenshots/05-qwen-result.png",
        "docs/assets/screenshots/06-tastematch-result.png",
        "docs/assets/screenshots/07-mobile-saved-run.png",
        "browser-tests/journeys/first-use.spec.js-snapshots/first-use-desktop-github-ubuntu-24.04.png",
        "browser-tests/journeys/first-use.spec.js-snapshots/first-use-mobile-390-github-ubuntu-24.04.png",
    }
    expected.update({
        "workbench/src/assets/modalitysystems.png",
        "src/modelforge_workbench/workbench/static/workbench/assets/modalitysystems-upIcUup5.png",
        "modelforge_workbench/workbench/static/workbench/assets/modalitysystems-upIcUup5.png",
    })
    expected.update({
        "docs/assets/showcase/annotation.png",
        "docs/assets/showcase/architecture.png",
        "docs/assets/showcase/bdd100k-dataset.png",
        "docs/assets/showcase/bdd100k-inference.png",
        "docs/assets/showcase/bdd100k-result.mp4",
        "docs/assets/showcase/current-workbench.webm",
        "docs/assets/showcase/jobs.png",
        "docs/assets/showcase/soccernet-inference.png",
        "docs/assets/showcase/soccernet-result.mp4",
        "docs/assets/showcase/training-comparison.png",
        "docs/assets/showcase/weatherbench2-inference.png",
        "docs/assets/showcase/weatherbench2-result.mp4",
    })
    assert scanner.APPROVED_BINARY_FIXTURES == expected
    assert all(scanner._category_for_path(path) is None for path in expected)
    assert scanner._category_for_path("docs/unreviewed-screenshot.png") == (
        "private_binary_or_execution_material"
    )
