from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

import pytest

from modelforge_workbench import cli
from modelforge_workbench.application.example_setup import (
    ExampleSetupService,
    load_example_setup,
)


def _run(*args: str, cwd: Path | None = None) -> str:
    completed = subprocess.run(
        args, cwd=cwd, text=True, capture_output=True, timeout=30, check=True,
    )
    return completed.stdout.strip()


def _git_fixture(root: Path) -> tuple[Path, str]:
    repository = root / "upstream"
    repository.mkdir()
    _run("git", "init", "--quiet", str(repository))
    _run("git", "config", "user.name", "Fixture Author", cwd=repository)
    _run("git", "config", "user.email", "fixture@example.invalid", cwd=repository)
    (repository / "source.py").write_text("VALUE = 1\n", encoding="utf-8")
    _run("git", "add", "source.py", cwd=repository)
    _run("git", "commit", "--quiet", "-m", "fixture", cwd=repository)
    return repository, _run("git", "rev-parse", "HEAD", cwd=repository)


def _write_declaration(
    examples: Path,
    *,
    repository: Path | None = None,
    revision: str | None = None,
    download: Path | None = None,
    download_sha256: str | None = None,
) -> Path:
    root = examples / "fixture-example"
    root.mkdir(parents=True)
    acquisitions = []
    if repository is not None:
        acquisitions.append({
            "id": "upstream-source", "identifier": "fixture:upstream-source",
            "name": "Fixture source", "kind": "repository",
            "method": "git", "destination": "sources/upstream",
            "url": repository.as_uri(), "revision": revision, "sha256": None,
            "access": "Authored local fixture; no credentials.",
            "license_url": "https://example.invalid/license",
            "instructions": "Fetch the pinned fixture checkout.", "required": True,
        })
    if download is not None:
        acquisitions.append({
            "id": "fixture-file", "identifier": "fixture:model-file",
            "name": "Fixture file", "kind": "model",
            "method": "download", "destination": "models/fixture.bin",
            "url": download.as_uri(), "revision": "fixture-v1",
            "sha256": download_sha256, "maximum_bytes": 1024,
            "access": "Authored local fixture; no credentials.",
            "license_url": "https://example.invalid/license",
            "instructions": "Fetch the bounded fixture file.", "required": True,
        })
    if not acquisitions:
        acquisitions.append({
            "id": "manual-data", "identifier": "fixture:manual-data",
            "name": "Manual data", "kind": "dataset",
            "method": "manual", "destination": "data/manual",
            "url": "https://example.invalid/data", "revision": "fixture-v1", "sha256": None,
            "access": "Manual fixture prerequisite.",
            "license_url": "https://example.invalid/terms",
            "instructions": "Bind an existing local folder.", "required": True,
        })
    value = {
        "protocol": "modelforge.example-setup/v1", "id": "fixture-example",
        "name": "Fixture example", "qualification": "Contract fixture only.",
        "environment": {
            "isolation": "venv", "python": "CPython 3.12",
            "platforms": ["test-platform"], "accelerator": "None",
            "dependencies": ["Python standard library"],
            "installation": "No external packages are needed.",
        },
        "acquisitions": acquisitions,
        "actions": [{
            "id": "inference", "status": "fixture-qualified",
            "qualification": "Uses only authored fixture bytes.",
        }],
    }
    path = root / "setup.json"
    path.write_text(json.dumps(value), encoding="utf-8")
    return path


def test_all_public_example_setup_declarations_are_valid_and_explicit():
    examples = Path(__file__).parents[1] / "examples"
    expected = {
        "bdd100k-road-scene-lab", "soccernet-tracking", "tastematch", "qwen-prompt-lab",
    }
    observed = {}
    for example_id in expected:
        value = load_example_setup(examples / example_id / "setup.json")
        observed[example_id] = value
        assert value["id"] == example_id
        assert value["environment"]["isolation"] == "venv"
        assert value["environment"]["platforms"] == ["linux-x86_64"]
        assert value["environment"]["dependencies"]
        assert value["actions"]
        for item in value["acquisitions"]:
            assert item["identifier"]
            assert item["license_url"] and item["access"] and item["instructions"]
            if item["method"] == "git":
                assert len(item["revision"]) == 40
    assert observed["qwen-prompt-lab"]["actions"][1]["status"] == "not-declared"
    assert observed["soccernet-tracking"]["actions"][1]["status"] == "not-supported"
    assert observed["tastematch"]["actions"][2]["status"] == "not-supported"


def test_next_steps_offer_managed_execution_only_for_qualified_examples(tmp_path):
    service = ExampleSetupService(Path(__file__).parents[1] / "examples")
    for example_id in (
        "bdd100k-road-scene-lab", "qwen-prompt-lab",
        "soccernet-tracking", "tastematch",
    ):
        plan = service.plan(example_id, tmp_path / f"external-{example_id}")
        assert "Configure and register" in plan["next_steps"][-1]
        assert "owner-only Modal binding" in plan["next_steps"][-1]


def test_plan_is_read_only_and_fetch_requires_confirmation(tmp_path):
    upstream, revision = _git_fixture(tmp_path)
    examples = tmp_path / "distribution" / "examples"
    _write_declaration(examples, repository=upstream, revision=revision)
    external = tmp_path / "external"
    service = ExampleSetupService(examples)

    plan = service.plan("fixture-example", external)
    preview = service.fetch("fixture-example", external)

    assert plan["protocol"] == "modelforge.example-setup-plan/v1"
    assert plan["performs_fetch"] is False
    assert plan["execution_authorized"] is False
    assert plan["items"][0]["status"] == "missing"
    assert preview["confirmation_required"] is True
    assert not external.exists()


def test_explicit_git_fetch_is_pinned_repeatable_and_protects_user_work(tmp_path):
    upstream, revision = _git_fixture(tmp_path)
    examples = tmp_path / "distribution" / "examples"
    _write_declaration(examples, repository=upstream, revision=revision)
    external = tmp_path / "external"
    service = ExampleSetupService(examples)

    fetched = service.fetch("fixture-example", external, confirmed=True)
    checkout = external / "fixture-example" / "sources" / "upstream"
    assert fetched["outcomes"] == [{"id": "upstream-source", "status": "ready"}]
    assert _run("git", "rev-parse", "HEAD", cwd=checkout) == revision
    assert service.fetch("fixture-example", external, confirmed=True)["outcomes"] == [
        {"id": "upstream-source", "status": "ready"},
    ]

    (checkout / "source.py").write_text("VALUE = 2\n", encoding="utf-8")
    conflicted = service.plan("fixture-example", external)
    assert conflicted["items"][0]["status"] == "conflict"
    with pytest.raises(ValueError, match="modified or untracked"):
        service.fetch("fixture-example", external, confirmed=True)
    assert (checkout / "source.py").read_text(encoding="utf-8") == "VALUE = 2\n"
    assert _run("git", "rev-parse", "HEAD", cwd=checkout) == revision


def test_existing_checkout_binding_is_verified_without_copy_or_fetch(tmp_path):
    upstream, revision = _git_fixture(tmp_path)
    examples = tmp_path / "distribution" / "examples"
    _write_declaration(examples, repository=upstream, revision=revision)
    external = tmp_path / "external"
    service = ExampleSetupService(examples)

    plan = service.plan(
        "fixture-example", external, use={"upstream-source": upstream},
    )
    fetched = service.fetch(
        "fixture-example", external, use={"upstream-source": upstream}, confirmed=True,
    )

    assert plan["items"][0]["uses_existing_path"] is True
    assert plan["items"][0]["status"] == "ready"
    assert fetched["outcomes"] == [{"id": "upstream-source", "status": "ready"}]
    assert not (external / "fixture-example" / "sources").exists()
    remembered = ExampleSetupService(examples).plan("fixture-example", external)
    assert remembered["items"][0]["destination"] == str(upstream.resolve())
    assert remembered["items"][0]["status"] == "ready"
    state = external / "fixture-example" / "setup-state.json"
    assert state.stat().st_mode & 0o777 == 0o600
    assert "credential" not in state.read_text(encoding="utf-8").casefold()


def test_existing_checkout_at_another_revision_is_refused_without_reset(tmp_path):
    upstream, revision = _git_fixture(tmp_path)
    examples = tmp_path / "distribution" / "examples"
    _write_declaration(examples, repository=upstream, revision=revision)
    (upstream / "source.py").write_text("VALUE = 2\n", encoding="utf-8")
    _run("git", "add", "source.py", cwd=upstream)
    _run("git", "commit", "--quiet", "-m", "later", cwd=upstream)
    later = _run("git", "rev-parse", "HEAD", cwd=upstream)
    service = ExampleSetupService(examples)

    plan = service.plan(
        "fixture-example", tmp_path / "external", use={"upstream-source": upstream},
    )
    assert plan["items"][0]["status"] == "conflict"
    with pytest.raises(ValueError, match="different revision"):
        service.fetch(
            "fixture-example",
            tmp_path / "external",
            use={"upstream-source": upstream},
            confirmed=True,
        )
    assert _run("git", "rev-parse", "HEAD", cwd=upstream) == later


def test_existing_hugging_face_cache_is_bound_by_revision_directory(tmp_path):
    examples = Path(__file__).parents[1] / "examples"
    service = ExampleSetupService(examples)
    revision = "a09a35458c702b33eeacc393d103063234e8bc28"
    matching = tmp_path / "models" / revision
    matching.mkdir(parents=True)
    plan = service.plan(
        "qwen-prompt-lab",
        tmp_path / "external",
        use={"qwen-model": matching},
    )
    assert plan["items"][0]["status"] == "ready"
    assert "revision directory" in plan["items"][0]["status_detail"]

    alias = tmp_path / "models" / "latest"
    alias.mkdir()
    conflict = service.plan(
        "qwen-prompt-lab",
        tmp_path / "other-external",
        use={"qwen-model": alias},
    )
    assert conflict["items"][0]["status"] == "conflict"


def test_interrupted_checkout_is_reported_and_never_overwritten(tmp_path):
    upstream, revision = _git_fixture(tmp_path)
    examples = tmp_path / "distribution" / "examples"
    _write_declaration(examples, repository=upstream, revision=revision)
    external = tmp_path / "external"
    partial = external / "fixture-example" / "sources" / "upstream.partial"
    partial.mkdir(parents=True)
    marker = partial / "preserve.txt"
    marker.write_text("partial user-visible evidence", encoding="utf-8")
    service = ExampleSetupService(examples)

    assert service.plan("fixture-example", external)["items"][0]["status"] == "incomplete"
    with pytest.raises(ValueError, match="interrupted partial"):
        service.fetch("fixture-example", external, confirmed=True)
    assert marker.read_text(encoding="utf-8") == "partial user-visible evidence"


def test_controlled_download_is_bounded_content_checked_and_explicit(tmp_path):
    payload = tmp_path / "fixture.bin"
    payload.write_bytes(b"redistributable fixture bytes")
    digest = hashlib.sha256(payload.read_bytes()).hexdigest()
    examples = tmp_path / "distribution" / "examples"
    _write_declaration(
        examples, download=payload, download_sha256=digest,
    )
    external = tmp_path / "external"
    service = ExampleSetupService(examples)

    assert service.fetch("fixture-example", external)["confirmation_required"] is True
    target = external / "fixture-example" / "models" / "fixture.bin"
    assert not target.exists()
    fetched = service.fetch("fixture-example", external, confirmed=True)
    assert fetched["outcomes"] == [{"id": "fixture-file", "status": "ready"}]
    assert target.read_bytes() == payload.read_bytes()
    assert service.plan("fixture-example", external)["items"][0]["status"] == "ready"


def test_wrong_download_digest_preserves_partial_and_blocks_repeat(tmp_path):
    payload = tmp_path / "fixture.bin"
    payload.write_bytes(b"unexpected bytes")
    examples = tmp_path / "distribution" / "examples"
    _write_declaration(examples, download=payload, download_sha256="0" * 64)
    external = tmp_path / "external"
    service = ExampleSetupService(examples)

    with pytest.raises(OSError, match="SHA-256"):
        service.fetch("fixture-example", external, confirmed=True)
    partial = external / "fixture-example" / "models" / "fixture.bin.partial"
    assert partial.read_bytes() == payload.read_bytes()
    assert service.plan("fixture-example", external)["items"][0]["status"] == "incomplete"
    with pytest.raises(ValueError, match="interrupted partial"):
        service.fetch("fixture-example", external, confirmed=True)


def test_install_is_separate_previewed_and_creates_only_isolated_environment(tmp_path):
    examples = tmp_path / "distribution" / "examples"
    _write_declaration(examples)
    external = tmp_path / "external"
    service = ExampleSetupService(examples)

    preview = service.install("fixture-example", external)
    assert preview["confirmation_required"] is True
    assert not external.exists()
    installed = service.install("fixture-example", external, confirmed=True)
    environment = external / "fixture-example" / "environment"
    assert installed["environment_status"] == "ready"
    assert installed["requirements_installed"] is False
    assert (environment / "pyvenv.cfg").is_file()
    assert not (external / "fixture-example" / "data" / "manual").exists()


def test_install_refuses_a_symlinked_environment_without_touching_target(tmp_path):
    examples = tmp_path / "distribution" / "examples"
    _write_declaration(examples)
    external = tmp_path / "external"
    workspace = external / "fixture-example"
    workspace.mkdir(parents=True)
    target = tmp_path / "existing-environment"
    target.mkdir()
    marker = target / "preserve.txt"
    marker.write_text("preserve", encoding="utf-8")
    (workspace / "environment").symlink_to(target, target_is_directory=True)

    with pytest.raises(ValueError, match="symbolic links"):
        ExampleSetupService(examples).install(
            "fixture-example", external, confirmed=True,
        )

    assert marker.read_text(encoding="utf-8") == "preserve"


def test_preexisting_manual_material_at_declared_destination_is_remembered(tmp_path):
    examples = tmp_path / "distribution" / "examples"
    _write_declaration(examples)
    external = tmp_path / "external"
    material = external / "fixture-example" / "data" / "manual"
    material.mkdir(parents=True)
    service = ExampleSetupService(examples)

    result = service.fetch("fixture-example", external, confirmed=True)
    assert result["outcomes"] == [{"id": "manual-data", "status": "ready-unverified"}]
    assert ExampleSetupService(examples).plan(
        "fixture-example", external,
    )["items"][0]["destination"] == str(material)


def test_setup_refuses_distribution_paths_symlinks_and_unknown_bindings(tmp_path):
    examples = tmp_path / "distribution" / "examples"
    _write_declaration(examples)
    service = ExampleSetupService(examples)
    with pytest.raises(ValueError, match="outside the ModelForge distribution"):
        service.plan("fixture-example", examples.parent / "external")
    tracked = tmp_path / "tracked"
    (tracked / ".git").mkdir(parents=True)
    with pytest.raises(ValueError, match="outside a Git worktree"):
        service.plan("fixture-example", tracked / "external")
    target = tmp_path / "target"
    target.mkdir()
    link = tmp_path / "linked"
    link.symlink_to(target, target_is_directory=True)
    with pytest.raises(ValueError, match="symbolic links"):
        service.plan("fixture-example", link)
    existing = tmp_path / "existing"
    existing.mkdir()
    with pytest.raises(ValueError, match="Unknown acquisition binding"):
        service.plan("fixture-example", tmp_path / "external", use={"wrong": existing})


def test_cli_setup_plan_and_unconfirmed_fetch_are_read_only(tmp_path, monkeypatch, capsys):
    examples = tmp_path / "distribution" / "examples"
    _write_declaration(examples)
    external = tmp_path / "external"
    monkeypatch.setattr(cli, "_examples_root", lambda: examples)

    assert cli.main([
        "examples", "setup", "plan", "--example", "fixture-example",
        "--external-root", str(external),
    ]) == 0
    plan = json.loads(capsys.readouterr().out)
    assert plan["performs_fetch"] is False
    assert cli.main([
        "examples", "setup", "fetch", "--example", "fixture-example",
        "--external-root", str(external),
    ]) == 0
    preview = json.loads(capsys.readouterr().out)
    assert preview["confirmation_required"] is True
    assert not external.exists()
