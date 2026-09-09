"""Non-creating shallow filesystem adapter for authored project registration."""

from __future__ import annotations

import json
import os
from pathlib import Path
import threading

from ..application.projects import ProjectRegistration, thaw_manifest
from ..project_manifest import ProjectManifestCompatibilityError, load_project_manifest


class FileProjectRepository:
    def __init__(self, state_root: str | Path) -> None:
        self.root = Path(state_root).expanduser().resolve() / "projects"
        self._write_lock = threading.Lock()

    def list(self) -> tuple[ProjectRegistration, ...]:
        if not self.root.is_dir():
            return ()
        return tuple(
            value for path in sorted(self.root.glob("*/project.json"))
            if (value := self._read(path)) is not None
        )

    def get(self, project_id: str) -> ProjectRegistration | None:
        return self._read(self.root / project_id / "project.json")

    def add(self, registration: ProjectRegistration) -> ProjectRegistration:
        destination = self.root / registration.project_id
        if destination.parent != self.root:
            raise ValueError("Project registration escaped its catalog root")
        with self._write_lock:
            self.root.mkdir(mode=0o700, exist_ok=True)
            if destination.exists() or destination.is_symlink():
                raise ValueError("Project catalog entry already exists")
            destination.mkdir(mode=0o700)
            path = destination / "project.json"
            temporary = destination / f".project.{os.getpid()}.tmp"
            payload = (
                json.dumps(thaw_manifest(registration.manifest), indent=2, sort_keys=True)
                + "\n"
            ).encode()
            try:
                descriptor = os.open(
                    temporary,
                    os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                    0o600,
                )
                try:
                    os.write(descriptor, payload)
                    os.fsync(descriptor)
                finally:
                    os.close(descriptor)
                os.replace(temporary, path)
                os.chmod(path, 0o600)
                stored = self._read(path)
                if stored is None:
                    raise ValueError("Project registration could not be read back")
                return stored
            except Exception:
                temporary.unlink(missing_ok=True)
                path.unlink(missing_ok=True)
                destination.rmdir()
                raise

    @staticmethod
    def _read(path: Path) -> ProjectRegistration | None:
        try:
            manifest = load_project_manifest(path, resolve_repository=True)
        except (OSError, ProjectManifestCompatibilityError):
            return None
        project_id = str(manifest.get("id") or "").strip()
        if not project_id or path.parent.name != project_id:
            return None
        repository = Path(str(manifest.get("repository") or "")).resolve()
        if not repository.is_dir():
            return None
        return ProjectRegistration(project_id, path, repository, manifest)


__all__ = ["FileProjectRepository"]
