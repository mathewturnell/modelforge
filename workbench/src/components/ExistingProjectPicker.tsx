import {useEffect, useRef, useState} from "react";
import {ChevronRight, Folder, FolderOpen} from "lucide-react";
import {api} from "../lib/api";
import type {BrowseResponse, Project} from "../types";
import {Badge, Button, EmptyState, ErrorNotice, LoadingState, Modal} from "./ui";

type Registration = {project: Project; projects: Project[]; active_id: string};

export function browseResponseIsCurrent(requestId: number, currentRequestId: number, requestedPath: string, authoredPath: string): boolean {
  return requestId === currentRequestId && requestedPath === authoredPath;
}

export function ExistingProjectPicker({open, initialPath, onOpenChange, onRegistered}: {
  open: boolean;
  initialPath: string;
  onOpenChange: (open: boolean) => void;
  onRegistered: (registration: Registration) => void;
}) {
  const [path, setPath] = useState(initialPath);
  const [listing, setListing] = useState<BrowseResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [showInternal, setShowInternal] = useState(false);
  const [error, setError] = useState("");
  const browseRequestRef = useRef(0);
  const pathRef = useRef(initialPath);
  const load = async (next: string) => {
    const requestedPath = String(next);
    const requestId = ++browseRequestRef.current;
    pathRef.current = requestedPath;
    setPath(requestedPath); setListing(null);
    setLoading(true); setError("");
    try {
      const response = await api.browse(requestedPath, ".json");
      if (!browseResponseIsCurrent(requestId, browseRequestRef.current, requestedPath, pathRef.current)) return;
      pathRef.current = response.path;
      setListing(response); setPath(response.path);
    } catch (reason) {
      if (browseResponseIsCurrent(requestId, browseRequestRef.current, requestedPath, pathRef.current)) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (requestId === browseRequestRef.current) setLoading(false);
    }
  };
  useEffect(() => {
    if (!open) { browseRequestRef.current += 1; return; }
    void load(initialPath);
    return () => { browseRequestRef.current += 1; };
  }, [open, initialPath]);
  const hasManifest = Boolean(
    listing?.path === path
    && listing.files?.some((file) => String(file.name || "") === "project.json")
  );
  const directories = (listing?.directories || []).filter((directory) => showInternal || !directory.name.startsWith("."));
  const register = async () => {
    browseRequestRef.current += 1; setLoading(false);
    setRegistering(true); setError("");
    try {
      const registration = await api.registerExistingProject(path);
      onRegistered(registration); onOpenChange(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setRegistering(false); }
  };
  return <Modal open={open} onOpenChange={onOpenChange} title="Add an existing project" description="Choose a folder containing project.json. ModelForge registers the folder in place; it does not copy or delete your source." wide>
    <div className="dataset-picker existing-project-picker">
      <div className="project-picker-path"><label><span>Project folder</span><input value={path} onChange={(event) => {pathRef.current = event.target.value; setPath(event.target.value); setListing(null);}} onKeyDown={(event) => {if (event.key === "Enter") {event.preventDefault(); void load(path);}}} /></label><Button busy={loading} onClick={() => void load(path)}>Go</Button></div>
      <div className="dataset-picker-location"><Button disabled={!listing?.parent || loading} onClick={() => listing?.parent && void load(listing.parent)}><FolderOpen size={14} /> Up</Button><div><span>Current folder</span><code title={listing?.path || path}>{listing?.path || path || "Choose a folder"}</code></div><label><input type="checkbox" checked={showInternal} onChange={(event) => setShowInternal(event.target.checked)} /> Show internal folders</label></div>
      {error && <ErrorNotice message={error} />}
      <nav className="dataset-picker-list existing-project-folders" aria-label="Folders in the current project location">{loading ? <LoadingState label="Reading project folders…" /> : <ul>{directories.map((directory) => <li key={directory.path}><button type="button" aria-label={`Open folder ${directory.name}`} onClick={() => void load(directory.path)}><span><Folder size={17} aria-hidden="true" /></span><div><strong>{directory.name}</strong><small>Open folder</small></div><ChevronRight size={15} aria-hidden="true" /></button></li>)}</ul>}</nav>
      {!loading && !directories.length && <EmptyState icon={<Folder />} title="No child folders" description="Add the current folder if it contains project.json, or navigate to its parent." />}
      <footer><div><Badge tone={hasManifest ? "success" : "neutral"}>{hasManifest ? "ModelForge project" : "project.json required"}</Badge><span>{path.split(/[\\/]/).filter(Boolean).at(-1) || "Project folder"}</span></div><div><Button onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" busy={registering} disabled={!hasManifest || loading} onClick={() => void register()}>Add this project</Button></div></footer>
    </div>
  </Modal>;
}
