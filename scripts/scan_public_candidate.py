#!/usr/bin/env python3
"""Redacted worktree, package-source, and Git-object exposure scan.

The report intentionally names only a safe path/category pair. It never prints
the bytes that caused a match. Run this from a clean candidate: ignored and
untracked files are findings because release archives and ad-hoc copies are a
common way for private state to escape otherwise correct packaging rules.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TEXT_LIMIT = 2 * 1024 * 1024
FORBIDDEN_SUFFIXES = {
    ".cache", ".ckpt", ".db", ".gif", ".jpeg", ".jpg", ".key", ".log",
    ".mp4", ".onnx", ".p12", ".pem", ".pfx", ".png", ".pt", ".pth",
    ".safetensors", ".sqlite", ".sqlite3", ".tar", ".tgz", ".zip",
}
FORBIDDEN_NAMES = {
    ".modal.toml", ".netrc", ".npmrc", ".pypirc", "credentials", "credentials.json",
    "id_dsa", "id_ed25519", "id_rsa", "service-account.json",
}
GENERATED_PARTS = {
    ".mypy_cache", ".pytest_cache", ".ruff_cache", "__pycache__", "build",
    "dist", "html-report", "node_modules", "playwright-report", "test-results",
}
APPROVED_BINARY_FIXTURES = {
    # Owner-authored product identity: exact source and digest-named Vite output,
    # recorded in the React/public source inventories. Other binary assets remain denied.
    "workbench/src/assets/modalitysystems.png",
    "src/modelforge_workbench/workbench/static/workbench/assets/modalitysystems-upIcUup5.png",
    "modelforge_workbench/workbench/static/workbench/assets/modalitysystems-upIcUup5.png",
    "browser-tests/journeys/first-use.spec.js-snapshots/first-use-desktop-github-ubuntu-24.04.png",
    "browser-tests/journeys/first-use.spec.js-snapshots/first-use-desktop-linux.png",
    "browser-tests/journeys/first-use.spec.js-snapshots/first-use-mobile-390-github-ubuntu-24.04.png",
    "browser-tests/journeys/first-use.spec.js-snapshots/first-use-mobile-390-linux.png",
    "docs/assets/screenshots/01-project-overview.png",
    "docs/assets/screenshots/02-dataset-selection.png",
    "docs/assets/screenshots/03-vision-result.png",
    "docs/assets/screenshots/04-qwen-prompt.png",
    "docs/assets/screenshots/05-qwen-result.png",
    "docs/assets/screenshots/06-tastematch-result.png",
    "docs/assets/screenshots/07-mobile-saved-run.png",
}
PATTERNS = {
    "private_home_path": re.compile(rb"/(?:home|Users)/[^/\s]+/"),
    "aws_access_key": re.compile(rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    "github_token": re.compile(rb"\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}\b"),
    "gitlab_token": re.compile(rb"\bglpat-[A-Za-z0-9_-]{20,}\b"),
    "google_api_key": re.compile(rb"\bAIza[A-Za-z0-9_-]{30,}\b"),
    "huggingface_token": re.compile(rb"\bhf_[A-Za-z0-9]{24,}\b"),
    "modal_token_id": re.compile(rb"\bak-[A-Za-z0-9_-]{16,}\b"),
    "modal_token_secret": re.compile(rb"\bas-[A-Za-z0-9_-]{16,}\b"),
    "openai_key": re.compile(rb"\bsk-[A-Za-z0-9_-]{20,}\b"),
    "slack_token": re.compile(rb"\bxox[baprs]-[A-Za-z0-9-]{20,}\b"),
    "stripe_secret": re.compile(rb"\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b"),
    "private_key": re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
}


def _run(*arguments: str, text: bool = False) -> bytes | str:
    return subprocess.run(
        arguments, cwd=ROOT, check=True, capture_output=True, text=text,
    ).stdout


def _category_for_path(relative: str) -> str | None:
    path = Path(relative)
    lowered = path.name.casefold()
    if Path(relative).as_posix() in APPROVED_BINARY_FIXTURES:
        return None
    if lowered in FORBIDDEN_NAMES:
        return "credential_or_auth_file"
    if lowered == ".env" or (lowered.startswith(".env.") and not lowered.endswith(
        (".example", ".sample", ".template")
    )):
        return "populated_environment_file"
    if any(part in GENERATED_PARTS or part.endswith(".egg-info") for part in path.parts):
        return "generated_or_cache_material"
    if path.suffix.casefold() in FORBIDDEN_SUFFIXES or lowered.endswith((".tar.gz", ".tar.bz2")):
        return "private_binary_or_execution_material"
    return None


def _scan_payload(payload: bytes, *, scope: str, label: str, issues: list[dict]) -> None:
    for category, pattern in PATTERNS.items():
        if pattern.search(payload):
            issues.append({"scope": scope, "path": label, "category": category})


def main() -> int:
    issues = []
    files = _run("git", "ls-files", "-z").split(b"\0")
    for raw in files:
        if not raw:
            continue
        relative = raw.decode()
        path = ROOT / relative
        if path.is_symlink() or not path.is_file():
            issues.append({"path": relative, "category": "non_regular_member"})
            continue
        path_category = _category_for_path(relative)
        if path_category:
            issues.append({"scope": "tree", "path": relative, "category": path_category})
        if path.stat().st_size > TEXT_LIMIT:
            issues.append({"path": relative, "category": "oversized_member"})
            continue
        _scan_payload(path.read_bytes(), scope="tree", label=relative, issues=issues)

    untracked = {
        value.decode() for value in _run(
            "git", "ls-files", "--others", "--exclude-standard", "-z",
        ).split(b"\0") if value
    }
    ignored = {
        value.decode() for value in _run(
            "git", "ls-files", "--others", "--ignored", "--exclude-standard", "-z",
        ).split(b"\0") if value
    }
    for relative in sorted(untracked | ignored):
        path = ROOT / relative
        if not path.is_file():
            continue
        issues.append({
            "scope": "worktree", "path": relative,
            "category": "untracked_or_ignored_member",
        })
        if path.stat().st_size <= TEXT_LIMIT:
            _scan_payload(path.read_bytes(), scope="worktree", label=relative, issues=issues)

    history_blobs = 0
    refs = _run(
        "git", "for-each-ref", "--format=%(refname)", "refs/heads", "refs/tags",
        text=True,
    ).splitlines()
    # Actions checks pull-request merge commits out in a detached checkout. Scan
    # the checked-out commit explicitly as well as every publishable branch/tag.
    refs.append("HEAD")
    objects = (
        _run("git", "rev-list", "--objects", *refs, text=True).splitlines()
        if refs else []
    )
    seen_blobs = set()
    for line in objects:
        object_id, _, historical_path = line.partition(" ")
        kind = _run("git", "cat-file", "-t", object_id, text=True).strip()
        if kind != "blob" or object_id in seen_blobs:
            continue
        seen_blobs.add(object_id)
        history_blobs += 1
        payload = _run("git", "cat-file", "-p", object_id)
        label = historical_path or object_id
        path_category = _category_for_path(historical_path)
        if path_category:
            issues.append({"scope": "history", "path": label, "category": path_category})
        if len(payload) > TEXT_LIMIT:
            issues.append({"scope": "history", "path": label, "category": "oversized_member"})
            continue
        _scan_payload(payload, scope="history", label=label, issues=issues)

    revisions = _run("git", "rev-list", *refs, text=True).split() if refs else []
    for revision in revisions:
        payload = _run("git", "cat-file", "commit", revision)
        _scan_payload(payload, scope="commit_metadata", label=revision[:12], issues=issues)

    git_config = ROOT / ".git" / "config"
    if git_config.is_file() and git_config.stat().st_size <= TEXT_LIMIT:
        _scan_payload(
            git_config.read_bytes(), scope="git_metadata", label=".git/config", issues=issues,
        )
    unreachable = _run(
        "git", "fsck", "--full", "--unreachable", "--no-reflogs", text=True,
    ).splitlines()
    if unreachable:
        issues.append({
            "scope": "git_objects", "path": ".git/objects",
            "category": "unreachable_objects_present", "count": len(unreachable),
        })

    commits = len(revisions)
    roots = (
        _run("git", "rev-list", "--max-parents=0", *refs, text=True).split()
        if refs else []
    )
    report = {
        "files_scanned": len(files) - 1,
        "untracked_or_ignored_files_scanned": len(untracked | ignored),
        "history_blobs_scanned": history_blobs,
        "commit_count": commits,
        "refs_scanned": refs,
        "root_count": len(roots),
        "issues": issues,
    }
    json.dump(report, sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")
    return 1 if issues or len(roots) != 1 else 0


if __name__ == "__main__":
    raise SystemExit(main())
