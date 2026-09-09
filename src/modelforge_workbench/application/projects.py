"""Delivery-neutral authored project registration and capability access."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import re
from types import MappingProxyType
from typing import Any, Mapping, Protocol

from ..contracts.project_capabilities import project_capabilities
from ..project_manifest import ProjectManifestCompatibilityError, load_project_manifest


PROJECT_REGISTRATION_MAX_BYTES = 512 * 1024
_PROJECT_ID = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")


def _freeze(value: Any) -> Any:
    if isinstance(value, Mapping):
        return MappingProxyType({str(key): _freeze(item) for key, item in value.items()})
    if isinstance(value, (list, tuple)):
        return tuple(_freeze(item) for item in value)
    return value


def thaw_manifest(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(key): thaw_manifest(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return [thaw_manifest(item) for item in value]
    return value


def _project_id(value: Any) -> str:
    normalized = str(value or "").strip().casefold()
    if not _PROJECT_ID.fullmatch(normalized):
        raise ValueError("Project ID must use lowercase letters, numbers, and single hyphens")
    return normalized


@dataclass(frozen=True)
class ProjectRegistration:
    project_id: str
    manifest_path: Path
    repository: Path
    manifest: Mapping[str, Any]

    def __post_init__(self) -> None:
        object.__setattr__(self, "project_id", _project_id(self.project_id))
        object.__setattr__(self, "manifest_path", Path(self.manifest_path).resolve())
        object.__setattr__(self, "repository", Path(self.repository).resolve())
        object.__setattr__(self, "manifest", _freeze(self.manifest))


class ProjectRepository(Protocol):
    def list(self) -> tuple[ProjectRegistration, ...]: ...
    def get(self, project_id: str) -> ProjectRegistration | None: ...
    def add(self, registration: ProjectRegistration) -> ProjectRegistration: ...


class ProjectService:
    """Own shallow authored registration without runtime or project-code authority."""

    def __init__(self, repository: ProjectRepository) -> None:
        self.repository = repository

    def prepare_registration(self, repository: str | Path) -> ProjectRegistration:
        requested = Path(str(repository or "")).expanduser()
        if requested.is_symlink():
            raise ValueError("Project folder cannot be a symbolic link")
        root = requested.resolve()
        if not root.is_dir() or root in {Path("/"), Path.home()}:
            raise ValueError("Choose a specific existing project folder")
        manifest_path = root / "project.json"
        try:
            manifest = load_project_manifest(
                manifest_path, maximum_bytes=PROJECT_REGISTRATION_MAX_BYTES,
            )
        except ProjectManifestCompatibilityError as exc:
            raise ValueError(f"Selected folder has no valid project.json: {exc}") from exc
        project_id = _project_id(manifest.get("id"))
        declared = Path(str(manifest.get("repository") or ".")).expanduser()
        declared = (root / declared).resolve() if not declared.is_absolute() else declared.resolve()
        if declared != root:
            raise ValueError("Project manifest must describe the selected folder as its repository")
        shallow = dict(manifest)
        shallow["repository"] = str(root)
        return ProjectRegistration(project_id, manifest_path, root, shallow)

    def register_existing_folder(self, repository: str | Path) -> ProjectRegistration:
        candidate = self.prepare_registration(repository)
        existing = self.repository.get(candidate.project_id)
        if existing is not None:
            if existing.repository != candidate.repository:
                raise ValueError(
                    f"Project ID '{candidate.project_id}' is already registered to a different folder"
                )
            return existing
        return self.repository.add(candidate)

    def lookup(self, project_id: str) -> ProjectRegistration:
        value = self.repository.get(_project_id(project_id))
        if value is None:
            raise KeyError("Project is not registered")
        return value

    def list(self) -> tuple[ProjectRegistration, ...]:
        return self.repository.list()

    def capabilities(self, project_id: str) -> dict[str, Any]:
        return project_capabilities(thaw_manifest(self.lookup(project_id).manifest))


__all__ = [
    "PROJECT_REGISTRATION_MAX_BYTES", "ProjectRegistration", "ProjectRepository",
    "ProjectService", "thaw_manifest",
]
