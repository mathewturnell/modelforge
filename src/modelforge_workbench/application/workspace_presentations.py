"""Safe read-only projections for the compiled local workbench.

These services deliberately sit on top of the public project/runtime contracts.
They do not import or execute project code and they never return registered host
paths to the browser.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path, PurePosixPath
from typing import Any, Mapping

from .runtime_configurations import ProjectRuntimeConfigurationService


_EXCLUDED_NAMES = frozenset({
    ".git", ".hg", ".svn", ".env", ".venv", "venv", "env", "node_modules",
    "__pycache__", ".pytest_cache", ".mypy_cache", ".ruff_cache", ".tox",
    ".idea", ".vscode", "dist", "build", "credentials", "secrets",
})
_EXCLUDED_SUFFIXES = frozenset({
    ".key", ".pem", ".p12", ".pfx", ".sqlite", ".sqlite3", ".db", ".bin",
    ".ckpt", ".pt", ".pth", ".safetensors", ".onnx", ".npy", ".npz",
})
_VIEWABLE_SUFFIXES = frozenset({
    "", ".c", ".cc", ".cfg", ".conf", ".cpp", ".css", ".csv", ".go",
    ".h", ".hpp", ".html", ".ini", ".java", ".js", ".json", ".jsx",
    ".md", ".mjs", ".py", ".rs", ".sh", ".sql", ".toml", ".ts",
    ".tsx", ".txt", ".yaml", ".yml",
})
_MAX_SOURCE_BYTES = 512 * 1024
_MAX_TREE_ENTRIES = 500
_MAX_ARCHITECTURE_BYTES = 512 * 1024
_ARCHITECTURE_ID = re.compile(r"^[A-Za-z_][A-Za-z0-9_.-]{0,79}$")


def _relative(value: str) -> PurePosixPath:
    raw = value.replace("\\", "/")
    if raw.startswith("/"):
        raise ValueError("Project-relative source path is invalid")
    normalized = raw.strip("/")
    path = PurePosixPath(normalized or ".")
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts if part != "."):
        raise ValueError("Project-relative source path is invalid")
    return path


def _excluded(path: PurePosixPath) -> bool:
    return any(part.casefold() in _EXCLUDED_NAMES for part in path.parts) or path.suffix.casefold() in _EXCLUDED_SUFFIXES


def _regular_contained(root: Path, relative: PurePosixPath) -> Path:
    if _excluded(relative):
        raise ValueError("This project path is excluded from source inspection")
    current = root
    for part in (() if str(relative) == "." else relative.parts):
        current = current / part
        if current.is_symlink():
            raise ValueError("Project source paths cannot contain symbolic links")
    resolved = current.resolve()
    if not resolved.is_relative_to(root.resolve()):
        raise ValueError("Project source path escaped its registered repository")
    return resolved


class ProjectWorkspacePresentationService:
    """Project overview, source, architecture, and read-only Git projections."""

    def __init__(
        self, projects: ProjectRuntimeConfigurationService,
        fallback_roots: Mapping[str, Path] | None = None,
    ) -> None:
        self.projects = projects
        self.fallback_roots = dict(fallback_roots or {})

    def _runtime(self, project_id: str) -> dict[str, Any]:
        return self.projects.get(project_id)

    def _root(self, project_id: str) -> Path:
        try:
            root = Path(self._runtime(project_id)["project_repository"])
        except KeyError:
            root = self.fallback_roots.get(project_id)
        if root is None or root.is_symlink() or not root.is_dir():
            raise OSError("Registered project repository is unavailable")
        return root.resolve()

    def source_tree(self, project_id: str, path: str = "") -> dict[str, Any]:
        root = self._root(project_id)
        relative = _relative(path)
        directory = _regular_contained(root, relative)
        if not directory.is_dir():
            raise ValueError("Project source path is not a directory")
        entries: list[dict[str, Any]] = []
        for child in sorted(directory.iterdir(), key=lambda item: (not item.is_dir(), item.name.casefold())):
            child_relative = PurePosixPath(child.relative_to(root).as_posix())
            if child.is_symlink() or _excluded(child_relative):
                continue
            try:
                metadata = child.stat()
            except OSError:
                continue
            if not child.is_dir() and not child.is_file():
                continue
            entries.append({
                "name": child.name,
                "path": child_relative.as_posix(),
                "type": "directory" if child.is_dir() else "file",
                "extension": child.suffix.casefold(),
                "size": metadata.st_size,
                "modified": int(metadata.st_mtime),
                "viewable": child.is_dir() or (
                    child.suffix.casefold() in _VIEWABLE_SUFFIXES
                    and metadata.st_size <= _MAX_SOURCE_BYTES
                ),
            })
            if len(entries) >= _MAX_TREE_ENTRIES:
                break
        return {
            "path": "" if str(relative) == "." else relative.as_posix(),
            "entries": entries,
            "truncated": len(entries) >= _MAX_TREE_ENTRIES,
            "tooling": {"read_only": True, "project_scoped": True},
        }

    def source_file(self, project_id: str, path: str) -> dict[str, Any]:
        relative = _relative(path)
        if str(relative) == ".":
            raise ValueError("A project source file is required")
        source = _regular_contained(self._root(project_id), relative)
        if not source.is_file() or source.suffix.casefold() not in _VIEWABLE_SUFFIXES:
            raise ValueError("Project source file is not a supported text file")
        metadata = source.stat()
        if metadata.st_size > _MAX_SOURCE_BYTES:
            raise ValueError("Project source file exceeds the 512 KiB viewer limit")
        try:
            content = source.read_text(encoding="utf-8")
        except UnicodeDecodeError as exc:
            raise ValueError("Project source file is not UTF-8 text") from exc
        return {
            "name": source.name,
            "path": relative.as_posix(),
            "extension": source.suffix.casefold(),
            "content": content,
            "size": metadata.st_size,
            "modified": int(metadata.st_mtime),
        }

    def git_status(self, project_id: str) -> dict[str, Any]:
        root = self._root(project_id)
        command = ["git", "-c", "safe.directory=*", "-C", str(root)]
        try:
            head = subprocess.run(
                [*command, "rev-parse", "--short=12", "HEAD"], check=True,
                capture_output=True, text=True, timeout=3,
            ).stdout.strip()
            branch = subprocess.run(
                [*command, "branch", "--show-current"], check=True,
                capture_output=True, text=True, timeout=3,
            ).stdout.strip() or "Detached"
            raw = subprocess.run(
                [*command, "status", "--porcelain=v1", "-z", "--untracked-files=normal"],
                check=True, capture_output=True, timeout=5,
            ).stdout
        except (FileNotFoundError, subprocess.SubprocessError) as exc:
            raise ValueError("Registered project is not an inspectable Git working copy") from exc
        changes = []
        for record in raw.split(b"\0"):
            if len(record) < 4:
                continue
            status = record[:2].decode("ascii", errors="replace")
            relative = record[3:].decode("utf-8", errors="replace")
            safe = PurePosixPath(relative.replace("\\", "/"))
            eligible = not _excluded(safe)
            changes.append({
                "index": status[0], "worktree": status[1], "path": safe.as_posix(),
                "eligible": eligible,
                **({"reason": "Excluded from public source operations"} if not eligible else {}),
            })
        return {
            "branch": branch, "head": head, "clean": not changes, "changes": changes,
            "read_only": True, "write_available": False,
            "write_reason": "Git mutations are not enabled in the public alpha service.",
        }

    def overview(self, project: Mapping[str, Any]) -> dict[str, Any]:
        actions = list(project.get("actions") or [project.get("action") or {}])
        dataset = dict(project.get("dataset") or {})
        action_names = [str(item.get("display_name") or item.get("kind") or "Action") for item in actions]
        return {
            "title": project.get("name") or project["id"],
            "summary": project.get("description") or "A registered ModelForge project.",
            "highlights": [
                {"keyword": "Bounded", "text": "Project actions execute through the shared durable lifecycle."},
                {"keyword": "Inspectable", "text": "Dataset, source, logs, results, and provenance remain connected."},
                {"keyword": "Recoverable", "text": "Run identity and checked artifacts survive browser reloads."},
            ],
            "dataset": {
                "name": dataset.get("name") or "No registered dataset",
                "description": (
                    f"{dataset.get('sample_count', 0)} registered, digest-checked samples."
                    if dataset else "This project does not declare a dataset catalog."
                ),
                "inputs": ([{"name": dataset.get("id"), "type": "registered catalog"}] if dataset else []),
            },
            "architecture": {
                "name": "Project action pipeline",
                "description": "Project-owned adapters connected to ModelForge run and artifact services.",
                "nodes": [{"name": name, "type": item.get("kind")} for name, item in zip(action_names, actions)],
            },
            "rationale_points": [
                "The browser is a presentation adapter over server-owned project state.",
                "A durable run is created before a local or Modal action starts.",
                "Only checked result artifacts become browser-visible evidence.",
            ],
            "instructions": [
                {"workspace": "data", "title": "Inspect the dataset", "description": "Open registered samples and revisioned annotations."},
                {"workspace": "model", "title": "Inspect the model path", "description": "Review the safe structural action graph and bindings."},
                {"workspace": "runs", "title": "Run and compare", "description": "Launch a registered action and inspect durable results."},
            ],
            "provenance": {"repository": "Registered local project · host path redacted"},
        }

    def architecture(self, project: Mapping[str, Any]) -> dict[str, Any]:
        try:
            runtime = self._runtime(str(project["id"]))
        except KeyError:
            raw_actions = list(project.get("actions") or [project.get("action") or {}])
            runtime = {
                "actions": [{
                    **item,
                    "interface": item.get("interface") or f"{item.get('kind', 'inference')}_process",
                    "result_protocol": f"modelforge.{item.get('kind', 'inference')}-result/v1",
                    "executable": "",
                } for item in raw_actions],
                "bindings": {},
            }
        actions = list(runtime.get("actions") or [runtime["action"]])
        dataset = runtime.get("dataset") or {}
        bindings = runtime.get("bindings") or {}
        declared = self._declared_architecture(project, bindings)
        if declared is not None:
            return declared
        input_id = "registered_dataset" if dataset else "action_request"
        nodes = []
        for action in actions:
            executable = Path(str(action.get("executable") or ""))
            try:
                implementation = executable.resolve().relative_to(self._root(str(project["id"]))).as_posix()
            except (OSError, ValueError):
                implementation = ""
            nodes.append({
                "id": f"action_{action['id']}",
                "type": f"project_{action['kind']}_adapter",
                "input": input_id,
                "config": {
                    "interface": action["interface"],
                    "result_protocol": action["result_protocol"],
                    "execution": "managed lifecycle",
                },
                "metadata": {"name": action["display_name"]},
                **({"implementation": implementation} if implementation else {}),
            })
        outputs = [{
            "id": f"checked_{action['kind']}_result",
            "type": action["result_protocol"],
            "input": f"action_{action['id']}",
        } for action in actions]
        checkpoint = bindings.get("checkpoint") or {}
        model = bindings.get("model") or {}
        return {
            "available": True,
            "architecture": {
                "model": {
                    "name": project.get("name") or project["id"],
                    "description": "Safe structural projection of registered project actions; project code is not imported.",
                    "checkpoint": checkpoint.get("name") or checkpoint.get("id") or "",
                    "checkpoint_sha256": checkpoint.get("sha256"),
                },
                "intent": {
                    "description": project.get("description") or "Registered ModelForge project",
                    "goals": action_names(actions),
                    "reasoning": ["Project-owned adapters", "Shared durable lifecycle", "Checked artifacts"],
                },
                "inputs": [{
                    "id": input_id,
                    "type": "registered_dataset_catalog" if dataset else "typed_action_request",
                    "metadata": {"name": dataset.get("name") or "Action request"},
                }],
                "nodes": nodes,
                "outputs": outputs,
            },
            "validation": {"valid": True, "errors": [], "mode": "safe_registration_projection"},
            "checkpoint_binding": {
                "registered": bool(checkpoint), "valid": bool(checkpoint),
                "name": checkpoint.get("name") or checkpoint.get("id"),
                "sha256": checkpoint.get("sha256"),
            },
            "model_binding": {
                "registered": bool(model), "revision": model.get("revision"),
            },
            "training_ready": any(item.get("kind") == "training" for item in actions),
            "project": dict(project),
        }

    def _declared_architecture(
        self, project: Mapping[str, Any], bindings: Mapping[str, Any],
    ) -> dict[str, Any] | None:
        """Read one bounded project-owned inspection descriptor without imports."""

        project_id = str(project["id"])
        root = self._root(project_id)
        manifest_path = _regular_contained(root, PurePosixPath("project.json"))
        if not manifest_path.is_file() or manifest_path.stat().st_size > _MAX_ARCHITECTURE_BYTES:
            return None
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        descriptor_value = manifest.get("architecture_descriptor")
        if descriptor_value is None:
            return None
        if not isinstance(descriptor_value, str):
            raise ValueError("Project architecture descriptor path is invalid")
        descriptor_relative = _relative(descriptor_value)
        descriptor_path = _regular_contained(root, descriptor_relative)
        if (
            descriptor_path.is_symlink()
            or not descriptor_path.is_file()
            or descriptor_path.stat().st_size > _MAX_ARCHITECTURE_BYTES
        ):
            raise ValueError("Project architecture descriptor is unavailable or too large")
        document = json.loads(descriptor_path.read_text(encoding="utf-8"))
        if not isinstance(document, dict) or document.get("protocol") != "modelforge.project-architecture-presentation/v1":
            raise ValueError("Project architecture descriptor protocol is unsupported")
        architecture = document.get("architecture")
        if not isinstance(architecture, dict):
            raise ValueError("Project architecture descriptor requires an architecture object")
        collections = {}
        identities: set[str] = set()
        for name, lower, upper in (("inputs", 1, 16), ("nodes", 1, 128), ("outputs", 1, 32)):
            values = architecture.get(name)
            if not isinstance(values, list) or not lower <= len(values) <= upper:
                raise ValueError(f"Project architecture {name} are invalid or unbounded")
            normalized = []
            for value in values:
                if not isinstance(value, dict):
                    raise ValueError(f"Project architecture {name} must contain objects")
                identity = str(value.get("id") or "")
                kind = str(value.get("type") or "")
                if not _ARCHITECTURE_ID.fullmatch(identity) or identity in identities:
                    raise ValueError("Project architecture object identity is invalid or duplicated")
                if not kind or len(kind) > 120:
                    raise ValueError("Project architecture object type is invalid")
                identities.add(identity)
                normalized.append(dict(value))
            collections[name] = normalized
        for value in [*collections["nodes"], *collections["outputs"]]:
            raw = value.get("inputs", value.get("input"))
            references = (
                list(raw.values()) if isinstance(raw, dict)
                else raw if isinstance(raw, list)
                else [raw]
            )
            for reference in references:
                reference_id = str(reference.get("id") if isinstance(reference, dict) else reference or "")
                if reference_id not in identities:
                    raise ValueError("Project architecture contains an unresolved graph reference")
        dependencies: dict[str, list[str]] = {}
        for value in [*collections["nodes"], *collections["outputs"]]:
            raw = value.get("inputs", value.get("input"))
            references = list(raw.values()) if isinstance(raw, dict) else raw if isinstance(raw, list) else [raw]
            dependencies[str(value["id"])] = [
                str(reference.get("id") if isinstance(reference, dict) else reference or "")
                for reference in references
            ]
        visiting: set[str] = set()
        visited: set[str] = set()

        def visit(identity: str) -> None:
            if identity in visiting:
                raise ValueError("Project architecture graph contains a cycle")
            if identity in visited:
                return
            visiting.add(identity)
            for dependency in dependencies.get(identity, []):
                visit(dependency)
            visiting.remove(identity)
            visited.add(identity)

        for identity in identities:
            visit(identity)
        model = architecture.get("model")
        intent = architecture.get("intent")
        metadata = architecture.get("metadata")
        for value, label in ((model, "model"), (intent, "intent"), (metadata, "metadata")):
            if value is not None and not isinstance(value, dict):
                raise ValueError(f"Project architecture {label} must be an object")
        checkpoint = bindings.get("checkpoint") or {}
        model_binding = bindings.get("model") or bindings.get("source") or {}
        projected = {
            **architecture,
            **collections,
            "model": {
                **dict(model or {}),
                "checkpoint": checkpoint.get("name") or checkpoint.get("id") or "",
                "checkpoint_sha256": checkpoint.get("sha256"),
            },
        }
        return {
            "available": True,
            "architecture": projected,
            "validation": {
                "valid": True,
                "errors": [],
                "mode": "reviewed_project_descriptor",
                "descriptor": descriptor_relative.as_posix(),
            },
            "checkpoint_binding": {
                "registered": bool(checkpoint),
                "valid": bool(checkpoint),
                "name": checkpoint.get("name") or checkpoint.get("id"),
                "sha256": checkpoint.get("sha256"),
            },
            "model_binding": {
                "registered": bool(model_binding),
                "revision": model_binding.get("revision"),
            },
            "training_ready": False,
            "project": {**dict(project), "architecture_descriptor": {"path": descriptor_relative.as_posix()}},
        }


def action_names(actions: list[Mapping[str, Any]]) -> list[str]:
    return [str(item.get("display_name") or item.get("kind") or item.get("id")) for item in actions]


def system_metrics(modal: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Return bounded host telemetry without adding a runtime dependency."""

    processor = "Local processor"
    try:
        for line in Path("/proc/cpuinfo").read_text(encoding="utf-8").splitlines():
            if line.lower().startswith("model name"):
                processor = line.split(":", 1)[1].strip()[:160]
                break
    except OSError:
        pass
    load = 0.0
    try:
        load = min(100.0, max(0.0, os.getloadavg()[0] / max(1, os.cpu_count() or 1) * 100))
    except OSError:
        pass
    memory_percent = 0.0
    try:
        values = {}
        for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
            key, value = line.split(":", 1)
            values[key] = int(value.strip().split()[0])
        total = values.get("MemTotal", 0)
        available = values.get("MemAvailable", 0)
        memory_percent = (total - available) / total * 100 if total else 0.0
    except (OSError, ValueError):
        pass
    gpu_roots = list(Path("/proc/driver/nvidia/gpus").glob("*/information"))
    gpu_name = ""
    if gpu_roots:
        try:
            fields = dict(
                line.split(":", 1) for line in gpu_roots[0].read_text(encoding="utf-8").splitlines()
                if ":" in line
            )
            gpu_name = fields.get("Model", "").strip()
        except OSError:
            pass
    cloud_ready = bool(modal and modal.get("state") == "configured")
    return {
        "cpu": {"name": processor, "percent": load, "load_percent": load,
                "memory": {"percent": memory_percent}},
        "memory": {"percent": memory_percent},
        "memory_percent": memory_percent,
        "gpu": {"available": bool(gpu_roots), "name": gpu_name or "NVIDIA GPU", "load_percent": 0},
        "cloud": {
            "available": cloud_ready, "dispatch_ready": cloud_ready,
            "provider": "Modal", "gpu_targets": ["L4", "L40S", "A10G", "A100"],
        },
    }


__all__ = ["ProjectWorkspacePresentationService", "system_metrics"]
