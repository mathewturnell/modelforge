"""Explicit, non-authorizing acquisition plans for packaged examples.

The setup service deliberately keeps acquisition, dependency installation, and
managed execution separate.  Merely loading or planning a declaration performs
no filesystem write, network request, package installation, or project import.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import urllib.parse
import urllib.request
import venv
from pathlib import Path
from typing import Any, Callable, Mapping, Sequence


SETUP_PROTOCOL = "modelforge.example-setup/v1"
PLAN_PROTOCOL = "modelforge.example-setup-plan/v1"
STATE_PROTOCOL = "modelforge.example-setup-state/v1"
MAX_DECLARATION_BYTES = 256 * 1024
MAX_DOWNLOAD_BYTES = 2 * 1024 * 1024 * 1024
_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,79}$")
_REVISION = re.compile(r"^[a-f0-9]{40}$")
_SHA256 = re.compile(r"^[a-f0-9]{64}$")


def _object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{label} must be an object")
    return {str(key): item for key, item in value.items()}


def _bounded_text(value: Any, label: str, *, maximum: int = 1000) -> str:
    result = str(value or "").strip()
    if not result or len(result) > maximum:
        raise ValueError(f"{label} is required and must be at most {maximum} characters")
    return result


def _identity(value: Any, label: str) -> str:
    result = _bounded_text(value, label, maximum=80).casefold()
    if not _ID.fullmatch(result):
        raise ValueError(f"{label} must use lowercase letters, numbers, and single hyphens")
    return result


def _relative_path(value: Any, label: str) -> Path:
    result = Path(_bounded_text(value, label, maximum=512))
    if result.is_absolute() or not result.parts or ".." in result.parts:
        raise ValueError(f"{label} must be a contained relative path")
    return result


def _url(value: Any, label: str) -> str:
    result = _bounded_text(value, label, maximum=2048)
    parsed = urllib.parse.urlsplit(result)
    if parsed.scheme not in {"https", "file"} or parsed.username or parsed.password:
        raise ValueError(f"{label} must be an HTTPS or local fixture URL without credentials")
    return result


def _normalize_declaration(value: Mapping[str, Any]) -> dict[str, Any]:
    source = _object(value, "Example setup declaration")
    if source.get("protocol") != SETUP_PROTOCOL:
        raise ValueError("Example setup declaration protocol is unsupported")
    example_id = _identity(source.get("id"), "Example ID")
    environment = _object(source.get("environment"), "Environment")
    if environment.get("isolation") != "venv":
        raise ValueError("Example dependencies must use an isolated venv")
    python = _bounded_text(environment.get("python"), "Supported Python", maximum=160)
    platforms = environment.get("platforms")
    if (
        not isinstance(platforms, list)
        or not 1 <= len(platforms) <= 8
        or not all(isinstance(item, str) and 1 <= len(item.strip()) <= 80 for item in platforms)
    ):
        raise ValueError("Supported platforms must be a bounded non-empty string list")
    dependencies = environment.get("dependencies")
    if (
        not isinstance(dependencies, list)
        or not 1 <= len(dependencies) <= 64
        or not all(
            isinstance(item, str) and 1 <= len(item.strip()) <= 160 for item in dependencies
        )
    ):
        raise ValueError("Required dependencies must be a bounded non-empty string list")
    requirements_file = environment.get("requirements_file")
    requirements_sha256 = environment.get("requirements_sha256")
    if requirements_file is not None:
        requirements_file = _relative_path(requirements_file, "Requirements file").as_posix()
        digest = str(requirements_sha256 or "").strip().casefold()
        if not _SHA256.fullmatch(digest):
            raise ValueError("Requirements file must declare a SHA-256")
        requirements_sha256 = digest
    elif requirements_sha256 is not None:
        raise ValueError("Requirements SHA-256 requires a requirements file")

    acquisitions = source.get("acquisitions")
    if not isinstance(acquisitions, list) or not acquisitions or len(acquisitions) > 32:
        raise ValueError("Example setup must declare from 1 to 32 acquisitions")
    normalized_acquisitions: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, raw_item in enumerate(acquisitions):
        item = _object(raw_item, f"Acquisition {index + 1}")
        item_id = _identity(item.get("id"), "Acquisition ID")
        if item_id in seen:
            raise ValueError(f"Duplicate acquisition ID: {item_id}")
        seen.add(item_id)
        kind = str(item.get("kind") or "").strip().casefold()
        method = str(item.get("method") or "").strip().casefold()
        if kind not in {"repository", "dataset", "model"}:
            raise ValueError(f"Acquisition {item_id} has an unsupported kind")
        if method not in {"git", "download", "manual"}:
            raise ValueError(f"Acquisition {item_id} has an unsupported method")
        destination = _relative_path(item.get("destination"), "Acquisition destination")
        revision = item.get("revision")
        revision = str(revision).strip() if revision is not None else None
        sha256 = item.get("sha256")
        sha256 = str(sha256).strip().casefold() if sha256 is not None else None
        if method == "git":
            if kind != "repository" or not revision or not _REVISION.fullmatch(revision):
                raise ValueError(f"Git acquisition {item_id} requires an immutable commit revision")
            if sha256 is not None and not _SHA256.fullmatch(sha256):
                raise ValueError(f"Acquisition {item_id} SHA-256 is invalid")
        elif method == "download":
            if not sha256 or not _SHA256.fullmatch(sha256):
                raise ValueError(f"Download acquisition {item_id} requires a SHA-256")
        elif sha256 is not None and not _SHA256.fullmatch(sha256):
            raise ValueError(f"Acquisition {item_id} SHA-256 is invalid")
        verification = str(item.get("verification") or "").strip().casefold()
        expected_verification = (
            "git-commit" if method == "git"
            else "sha256" if sha256 is not None
            else "presence-only"
        )
        if verification:
            if verification not in {
                "git-commit", "sha256", "directory-name-revision", "presence-only",
            }:
                raise ValueError(f"Acquisition {item_id} verification method is unsupported")
            if verification == "directory-name-revision" and not revision:
                raise ValueError(
                    f"Acquisition {item_id} directory-name verification requires a revision",
                )
            if method == "git" and verification != "git-commit":
                raise ValueError(f"Git acquisition {item_id} must verify its commit")
            if method == "download" and verification != "sha256":
                raise ValueError(f"Download acquisition {item_id} must verify its SHA-256")
        else:
            verification = expected_verification
        url = _url(item.get("url"), f"Acquisition {item_id} URL")
        maximum_bytes = item.get("maximum_bytes")
        if method == "download":
            if (
                isinstance(maximum_bytes, bool)
                or not isinstance(maximum_bytes, int)
                or not 1 <= maximum_bytes <= MAX_DOWNLOAD_BYTES
            ):
                raise ValueError(f"Download acquisition {item_id} requires bounded maximum_bytes")
        elif maximum_bytes is not None:
            raise ValueError(f"Acquisition {item_id} maximum_bytes is only valid for downloads")
        normalized_acquisitions.append({
            "id": item_id,
            "identifier": _bounded_text(
                item.get("identifier"), "Upstream identifier", maximum=300,
            ),
            "name": _bounded_text(item.get("name"), "Acquisition name", maximum=160),
            "kind": kind,
            "method": method,
            "destination": destination.as_posix(),
            "url": url,
            "revision": revision,
            "sha256": sha256,
            "maximum_bytes": maximum_bytes,
            "verification": verification,
            "access": _bounded_text(item.get("access"), "Access condition", maximum=500),
            "license_url": _url(item.get("license_url"), "License or terms URL"),
            "instructions": _bounded_text(
                item.get("instructions"), "Acquisition instructions", maximum=2000,
            ),
            "required": bool(item.get("required", True)),
        })

    actions = source.get("actions")
    if not isinstance(actions, list) or not actions or len(actions) > 16:
        raise ValueError("Example setup must declare from 1 to 16 action statuses")
    normalized_actions = []
    for raw_action in actions:
        action = _object(raw_action, "Example action")
        normalized_actions.append({
            "id": _identity(action.get("id"), "Action ID"),
            "status": _bounded_text(action.get("status"), "Action status", maximum=80),
            "qualification": _bounded_text(
                action.get("qualification"), "Action qualification", maximum=500,
            ),
        })
    return {
        "protocol": SETUP_PROTOCOL,
        "id": example_id,
        "name": _bounded_text(source.get("name"), "Example name", maximum=160),
        "qualification": _bounded_text(
            source.get("qualification"), "Example qualification", maximum=1000,
        ),
        "environment": {
            "isolation": "venv",
            "python": python,
            "platforms": [item.strip() for item in platforms],
            "accelerator": _bounded_text(
                environment.get("accelerator"), "Accelerator requirement", maximum=300,
            ),
            "dependencies": [item.strip() for item in dependencies],
            "requirements_file": requirements_file,
            "requirements_sha256": requirements_sha256,
            "installation": _bounded_text(
                environment.get("installation"), "Dependency installation status", maximum=1000,
            ),
        },
        "acquisitions": normalized_acquisitions,
        "actions": normalized_actions,
    }


def load_example_setup(path: str | Path) -> dict[str, Any]:
    declaration_path = Path(path)
    if declaration_path.is_symlink() or not declaration_path.is_file():
        raise ValueError("Example setup declaration must be an existing regular file")
    if declaration_path.stat().st_size > MAX_DECLARATION_BYTES:
        raise ValueError("Example setup declaration is too large")
    try:
        value = json.loads(declaration_path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("Example setup declaration is not valid UTF-8 JSON") from exc
    return _normalize_declaration(_object(value, "Example setup declaration"))


def _is_within(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
    except ValueError:
        return False
    return True


def _assert_no_symlink_components(path: Path) -> None:
    current = path
    while True:
        if current.is_symlink():
            raise ValueError("Example setup paths cannot contain symbolic links")
        if current.parent == current:
            return
        current = current.parent


def _git_ancestor(path: Path) -> Path | None:
    current = path
    while not current.exists() and current.parent != current:
        current = current.parent
    while True:
        if (current / ".git").exists():
            return current
        if current.parent == current:
            return None
        current = current.parent


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


class ExampleSetupService:
    """Plan and explicitly perform bounded example acquisition and installation."""

    def __init__(
        self,
        examples_root: str | Path,
        *,
        command_runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
        url_opener: Callable[..., Any] = urllib.request.urlopen,
    ) -> None:
        self.examples_root = Path(examples_root).resolve()
        self._command_runner = command_runner
        self._url_opener = url_opener

    def declaration(self, example_id: str) -> tuple[Path, dict[str, Any]]:
        normalized = _identity(example_id, "Example ID")
        path = self.examples_root / normalized / "setup.json"
        value = load_example_setup(path)
        if value["id"] != normalized:
            raise ValueError("Example setup declaration identity differs from its folder")
        return path, value

    def _workspace(self, external_root: str | Path, example_id: str) -> Path:
        requested = Path(str(external_root or "")).expanduser()
        if not requested.is_absolute():
            raise ValueError("External root must be an absolute path")
        _assert_no_symlink_components(requested)
        root = requested.resolve(strict=False)
        if root in {Path("/"), Path.home()}:
            raise ValueError("Choose a specific external example root")
        distribution_root = self.examples_root.parent.resolve()
        if _is_within(root, distribution_root):
            raise ValueError("External material must be stored outside the ModelForge distribution")
        if _git_ancestor(root) is not None:
            raise ValueError("External material must be stored outside a Git worktree")
        workspace = root / example_id
        _assert_no_symlink_components(workspace)
        return workspace

    @staticmethod
    def _use_bindings(use: Mapping[str, str | Path] | None) -> dict[str, Path]:
        bindings: dict[str, Path] = {}
        for raw_id, raw_path in (use or {}).items():
            item_id = _identity(raw_id, "Acquisition binding ID")
            path = Path(str(raw_path)).expanduser()
            if not path.is_absolute() or not path.exists():
                raise ValueError(f"Existing acquisition {item_id} must be an absolute existing path")
            _assert_no_symlink_components(path)
            bindings[item_id] = path.resolve()
        return bindings

    @staticmethod
    def _stored_bindings(workspace: Path) -> dict[str, Path]:
        state_path = workspace / "setup-state.json"
        if not state_path.exists():
            return {}
        if state_path.is_symlink() or not state_path.is_file() or state_path.stat().st_size > 64 * 1024:
            raise ValueError("Example setup state is not a bounded regular file")
        try:
            value = _object(json.loads(state_path.read_text(encoding="utf-8")), "Setup state")
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("Example setup state is not valid UTF-8 JSON") from exc
        if value.get("protocol") != STATE_PROTOCOL:
            raise ValueError("Example setup state protocol is unsupported")
        if value.get("example_id") != workspace.name:
            raise ValueError("Example setup state identity differs from its workspace")
        raw_bindings = _object(value.get("bindings"), "Setup state bindings")
        return ExampleSetupService._use_bindings(raw_bindings)

    @staticmethod
    def _write_bindings(workspace: Path, example_id: str, bindings: Mapping[str, Path]) -> None:
        state_path = workspace / "setup-state.json"
        temporary = workspace / "setup-state.json.partial"
        if state_path.is_symlink() or temporary.exists():
            raise ValueError("Example setup state has an unsafe or interrupted write")
        payload = json.dumps({
            "protocol": STATE_PROTOCOL,
            "example_id": example_id,
            "bindings": {key: str(value) for key, value in sorted(bindings.items())},
        }, indent=2, sort_keys=True) + "\n"
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
        except BaseException:
            raise
        os.replace(temporary, state_path)

    def _git(self, args: Sequence[str], *, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
        env = {
            **os.environ,
            "GIT_CONFIG_NOSYSTEM": "1",
            "GIT_CONFIG_GLOBAL": os.devnull,
            "GIT_TERMINAL_PROMPT": "0",
        }
        env.pop("GIT_ASKPASS", None)
        env.pop("SSH_ASKPASS", None)
        env.pop("GIT_SSH_COMMAND", None)
        for name in tuple(env):
            if name.startswith("GIT_CONFIG_"):
                env.pop(name)
        env["GIT_CONFIG_NOSYSTEM"] = "1"
        env["GIT_CONFIG_GLOBAL"] = os.devnull
        completed = self._command_runner(
            (
                "git", "-c", "core.hooksPath=/dev/null", "-c", "credential.helper=",
                "-c", "filter.lfs.smudge=", "-c", "filter.lfs.required=false", *args,
            ),
            cwd=cwd,
            env=env,
            text=True,
            capture_output=True,
            timeout=300,
            check=False,
        )
        if completed.returncode:
            raise RuntimeError("Git acquisition failed without changing an existing checkout")
        return completed

    def _repository_status(self, path: Path, revision: str) -> tuple[str, str]:
        partial = path.with_name(path.name + ".partial")
        if partial.exists():
            return "incomplete", "An interrupted partial checkout exists; inspect or remove it before retrying."
        if not path.exists():
            return "missing", "Pinned checkout has not been fetched."
        if path.is_symlink() or not path.is_dir() or not (path / ".git").exists():
            return "conflict", "Destination exists but is not the expected Git checkout."
        try:
            head = self._git(("-C", str(path), "rev-parse", "HEAD")).stdout.strip()
            changes = self._git(
                ("-C", str(path), "status", "--porcelain", "--untracked-files=all"),
            ).stdout.strip()
        except RuntimeError:
            return "conflict", "Existing checkout could not be verified."
        if changes:
            return "conflict", "Existing checkout contains modified or untracked work and will not be reset."
        if head != revision:
            return "conflict", "Existing clean checkout is at a different revision and will not be reset."
        return "ready", "Existing checkout is clean and matches the pinned revision."

    @staticmethod
    def _file_status(
        path: Path,
        sha256: str | None,
        *,
        verification: str,
        revision: str | None,
    ) -> tuple[str, str]:
        partial = path.with_name(path.name + ".partial")
        if partial.exists():
            return "incomplete", "An interrupted partial download exists; inspect or remove it before retrying."
        if not path.exists():
            return "missing", "External material is not present."
        if path.is_symlink():
            return "conflict", "External material cannot be a symbolic link."
        if sha256 is not None:
            if not path.is_file() or _sha256(path) != sha256:
                return "conflict", "Existing material does not match the declared SHA-256."
            return "ready", "Existing material matches the declared SHA-256."
        if verification == "directory-name-revision":
            if not path.is_dir() or path.name != revision:
                return "conflict", "Existing cache path does not end in the declared revision."
            return "ready", "Existing cache path is bound to the declared revision directory."
        return "ready-unverified", "Existing material is present; upstream publishes no content checksum."

    def plan(
        self,
        example_id: str,
        external_root: str | Path,
        *,
        use: Mapping[str, str | Path] | None = None,
    ) -> dict[str, Any]:
        declaration_path, declaration = self.declaration(example_id)
        workspace = self._workspace(external_root, declaration["id"])
        bindings = self._stored_bindings(workspace)
        bindings.update(self._use_bindings(use))
        unknown = set(bindings) - {item["id"] for item in declaration["acquisitions"]}
        if unknown:
            raise ValueError(f"Unknown acquisition binding: {sorted(unknown)[0]}")
        items = []
        for item in declaration["acquisitions"]:
            destination = bindings.get(item["id"], workspace / item["destination"])
            if item["method"] == "git":
                status, detail = self._repository_status(destination, item["revision"])
            else:
                status, detail = self._file_status(
                    destination,
                    item["sha256"],
                    verification=item["verification"],
                    revision=item["revision"],
                )
            items.append({
                **item,
                "destination": str(destination),
                "uses_existing_path": item["id"] in bindings,
                "status": status,
                "status_detail": detail,
            })
        environment_path = workspace / "environment"
        environment_status = "ready" if (environment_path / "pyvenv.cfg").is_file() else "missing"
        managed_action_available = any(
            item["status"] in {
                "supported-with-prerequisites",
                "fixture-qualified-real-cache-required",
            }
            for item in declaration["actions"]
        )
        next_steps = [
            "Review access and license terms for every external item.",
            "Run the explicit fetch command with --confirm to acquire only fetchable items.",
            "Run the separate install command with --confirm to create the isolated environment.",
        ]
        next_steps.append(
            "Configure and register the project, then use an explicitly enabled local target or a separately registered owner-only Modal binding for the managed workload."
            if managed_action_available
            else "Inspect the authored manifest and adapter; this alpha does not qualify a managed workload for this example."
        )
        return {
            "protocol": PLAN_PROTOCOL,
            "example_id": declaration["id"],
            "name": declaration["name"],
            "qualification": declaration["qualification"],
            "external_root": str(Path(external_root).expanduser().resolve(strict=False)),
            "workspace": str(workspace),
            "environment_path": str(environment_path),
            "environment_status": environment_status,
            "environment": declaration["environment"],
            "items": items,
            "actions": declaration["actions"],
            "performs_fetch": False,
            "performs_install": False,
            "execution_authorized": False,
            "next_steps": next_steps,
            "declaration": str(declaration_path),
        }

    @staticmethod
    def _ensure_workspace(workspace: Path) -> None:
        _assert_no_symlink_components(workspace)
        workspace.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(workspace, 0o700)

    def _fetch_repository(self, item: Mapping[str, Any], destination: Path) -> None:
        _assert_no_symlink_components(destination)
        status, detail = self._repository_status(destination, str(item["revision"]))
        if status == "ready":
            return
        if status != "missing":
            raise ValueError(detail)
        partial = destination.with_name(destination.name + ".partial")
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        self._git((
            "clone", "--no-checkout", "--filter=blob:none", str(item["url"]), str(partial),
        ))
        self._git(("-C", str(partial), "checkout", "--detach", str(item["revision"])))
        resolved = self._git(("-C", str(partial), "rev-parse", "HEAD")).stdout.strip()
        if resolved != item["revision"]:
            raise OSError("Fetched repository did not resolve to the declared revision")
        if self._git(
            ("-C", str(partial), "status", "--porcelain", "--untracked-files=all"),
        ).stdout.strip():
            raise OSError("Fetched repository is unexpectedly modified")
        os.replace(partial, destination)

    def _fetch_download(self, item: Mapping[str, Any], destination: Path) -> None:
        _assert_no_symlink_components(destination)
        status, detail = self._file_status(
            destination,
            str(item["sha256"]),
            verification=str(item["verification"]),
            revision=str(item["revision"]) if item["revision"] is not None else None,
        )
        if status == "ready":
            return
        if status != "missing":
            raise ValueError(detail)
        partial = destination.with_name(destination.name + ".partial")
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        total = 0
        digest = hashlib.sha256()
        request = urllib.request.Request(str(item["url"]), headers={"User-Agent": "ModelForge-example-setup/1"})
        with self._url_opener(request, timeout=60) as response, partial.open("xb") as stream:
            while chunk := response.read(1024 * 1024):
                total += len(chunk)
                if total > item["maximum_bytes"]:
                    raise OSError("External download exceeded its declared byte bound")
                stream.write(chunk)
                digest.update(chunk)
        if digest.hexdigest() != item["sha256"]:
            raise OSError("External download did not match the declared SHA-256")
        os.replace(partial, destination)

    def fetch(
        self,
        example_id: str,
        external_root: str | Path,
        *,
        use: Mapping[str, str | Path] | None = None,
        selected: Sequence[str] = (),
        confirmed: bool = False,
    ) -> dict[str, Any]:
        plan = self.plan(example_id, external_root, use=use)
        if not confirmed:
            return {**plan, "confirmation_required": True}
        wanted = {_identity(value, "Selected acquisition ID") for value in selected}
        known = {item["id"] for item in plan["items"]}
        if wanted - known:
            raise ValueError(f"Unknown selected acquisition: {sorted(wanted - known)[0]}")
        workspace = Path(plan["workspace"])
        self._ensure_workspace(workspace)
        outcomes = []
        retained_bindings: dict[str, Path] = {}
        for item in plan["items"]:
            if wanted and item["id"] not in wanted:
                if item["uses_existing_path"] and item["status"] in {"ready", "ready-unverified"}:
                    retained_bindings[item["id"]] = Path(item["destination"])
                outcomes.append({"id": item["id"], "status": "not-selected"})
                continue
            if item["status"] in {"ready", "ready-unverified"}:
                retained_bindings[item["id"]] = Path(item["destination"])
                outcomes.append({"id": item["id"], "status": item["status"]})
                continue
            if item["uses_existing_path"]:
                raise ValueError(item["status_detail"])
            destination = Path(item["destination"])
            if item["method"] == "git":
                self._fetch_repository(item, destination)
                status = "ready"
            elif item["method"] == "download":
                self._fetch_download(item, destination)
                status = "ready"
            else:
                status = "manual-action-required"
            if status == "ready":
                retained_bindings[item["id"]] = destination
            outcomes.append({"id": item["id"], "status": status})
        self._write_bindings(workspace, example_id, retained_bindings)
        return {
            **self.plan(example_id, external_root, use=use),
            "performs_fetch": True,
            "fetch_performed": True,
            "confirmation_required": False,
            "outcomes": outcomes,
        }

    def install(
        self,
        example_id: str,
        external_root: str | Path,
        *,
        confirmed: bool = False,
        install_requirements: bool = False,
    ) -> dict[str, Any]:
        plan = self.plan(example_id, external_root)
        if not confirmed:
            return {
                **plan,
                "confirmation_required": True,
                "install_requirements_requested": install_requirements,
            }
        workspace = Path(plan["workspace"])
        self._ensure_workspace(workspace)
        environment = Path(plan["environment_path"])
        _assert_no_symlink_components(environment)
        if environment.exists() and not (environment / "pyvenv.cfg").is_file():
            raise ValueError("Environment destination exists but is not an isolated venv")
        if not environment.exists():
            venv.EnvBuilder(with_pip=True, clear=False, symlinks=True).create(environment)
        dependency = plan["environment"]
        requirements_file = dependency["requirements_file"]
        installed = False
        if install_requirements:
            if requirements_file is None:
                raise ValueError("This example has no automated dependency installation")
            source = self.examples_root / example_id / requirements_file
            if source.is_symlink() or not source.is_file():
                raise ValueError("Declared requirements file is unavailable")
            if _sha256(source) != dependency["requirements_sha256"]:
                raise OSError("Declared requirements file changed after setup declaration review")
            python = environment / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
            completed = self._command_runner(
                (str(python), "-I", "-m", "pip", "install", "--requirement", str(source)),
                cwd=workspace,
                env={**os.environ, "PYTHONSAFEPATH": "1"},
                text=True,
                capture_output=True,
                timeout=1800,
                check=False,
            )
            if completed.returncode:
                raise RuntimeError("Dependency installation failed; inspect the isolated environment")
            installed = True
        return {
            **self.plan(example_id, external_root),
            "performs_install": True,
            "environment_status": "ready",
            "install_performed": True,
            "requirements_installed": installed,
            "confirmation_required": False,
        }


__all__ = [
    "ExampleSetupService", "MAX_DECLARATION_BYTES", "PLAN_PROTOCOL",
    "SETUP_PROTOCOL", "STATE_PROTOCOL", "load_example_setup",
]
