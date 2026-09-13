import {lazy, Suspense, useEffect, useMemo, useState} from "react";
import * as Tabs from "@radix-ui/react-tabs";
import {
  ChevronDown, ChevronRight, CircleDot, File, FileCode2, Folder, FolderOpen, GitBranch,
  GitCommitHorizontal, GitPullRequestArrow, RefreshCw, Search, UploadCloud,
} from "lucide-react";
import {api, post, request} from "../lib/api";
import {formatBytes, languageForPath, statusTone} from "../lib/utils";
import type {JsonMap, Project, SourceEntry, SourceFile, SourceTreeResponse} from "../types";
import {Badge, Button, EmptyState, ErrorNotice, IconButton, LoadingState} from "../components/ui";

const MonacoEditor = lazy(() => import("../components/MonacoSourceEditor"));

function SourceTree({projectId, onOpen}: {projectId: string; onOpen: (entry: SourceEntry) => void}) {
  const [children, setChildren] = useState<Record<string, SourceEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");

  const load = async (path: string) => {
    setLoading((current) => new Set(current).add(path));
    setError("");
    try {
      const result = await api.source(path);
      setChildren((current) => ({...current, [path]: result.entries || []}));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading((current) => { const next = new Set(current); next.delete(path); return next; });
    }
  };

  useEffect(() => { setChildren({}); setExpanded(new Set([""])); void load(""); }, [projectId]);

  const toggle = (entry: SourceEntry) => {
    if (entry.type !== "directory") return onOpen(entry);
    const next = new Set(expanded);
    if (next.has(entry.path)) next.delete(entry.path);
    else { next.add(entry.path); if (!children[entry.path]) void load(entry.path); }
    setExpanded(next);
  };

  const renderEntries = (path: string, depth = 0): React.ReactNode => {
    const entries = children[path] || [];
    return entries.filter((entry) => !query || entry.name.toLowerCase().includes(query.toLowerCase())).map((entry) => {
      const opened = expanded.has(entry.path);
      return <div key={entry.path}>
        <button className="tree-row" style={{paddingLeft: 10 + depth * 14}} onClick={() => toggle(entry)} title={entry.path}>
          <span className="tree-chevron">{entry.type === "directory" ? (opened ? <ChevronDown /> : <ChevronRight />) : null}</span>
          {entry.type === "directory" ? (opened ? <FolderOpen className="folder-icon" /> : <Folder className="folder-icon" />) : <FileCode2 className="file-icon" />}
          <span>{entry.name}</span>
          {loading.has(entry.path) && <RefreshCw className="animate-spin tree-loading" />}
        </button>
        {entry.type === "directory" && opened && <div>{renderEntries(entry.path, depth + 1)}</div>}
      </div>;
    });
  };

  return <div className="source-tree-panel">
    <div className="sidebar-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter files" aria-label="Filter source files" /></div>
    {error && <ErrorNotice message={error} />}
    <div className="tree-scroll">{renderEntries("")}</div>
  </div>;
}

function GitPanel({project}: {project: Project}) {
  const [data, setData] = useState<JsonMap | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");
  const load = async () => {
    setError("");
    try { setData(await api.gitStatus()); }
    catch (reason) { setData(null); setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  useEffect(() => { void load(); }, [project.id]);
  const changes = (Array.isArray(data?.changes) ? data?.changes : Array.isArray(data?.items) ? data?.items : []) as JsonMap[];
  const mutate = async (operation: "commit" | "pull" | "push") => {
    if (operation === "push" && !window.confirm("Push the current branch to its validated origin without force?")) return;
    setBusy(operation); setError("");
    try {
      await api.gitAction(operation, project.id, [...selected], message, operation === "push");
      if (operation === "commit") { setMessage(""); setSelected(new Set()); }
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(""); }
  };
  if (error && !data) return <EmptyState icon={<GitBranch />} title="Git is unavailable" description={/not a git repository/i.test(error) ? "This project is not backed by an eligible Git working copy." : error} action={<Button onClick={() => void load()}>Retry</Button>} />;
  return <div className="git-panel">
    <div className="git-summary">
      <div><GitBranch size={16} /><strong>{String(data?.branch || "Detached")}</strong><span>{String(data?.head || "No commit").slice(0, 12)}</span></div>
      <Badge tone={statusTone(data?.clean ? "clean" : changes.length ? "pending" : "neutral")}>{data?.clean ? "Clean" : `${changes.length} changed`}</Badge>
      <IconButton label="Refresh Git status" onClick={() => void load()}><RefreshCw size={14} /></IconButton>
    </div>
    {error && <ErrorNotice message={error} />}
    <div className="git-changes">
      {changes.map((change) => {
        const path = String(change.path || "");
        const eligible = change.eligible !== false;
        return <label key={path} className="git-change-row">
          <input type="checkbox" checked={selected.has(path)} disabled={!eligible} onChange={(event) => setSelected((current) => { const next = new Set(current); event.target.checked ? next.add(path) : next.delete(path); return next; })} />
          <code>{String(change.index || " ")}{String(change.worktree || " ")}</code>
          <span>{path}</span><small>{eligible ? "Source change" : String(change.reason || "Not eligible")}</small>
        </label>;
      })}
      {!changes.length && <div className="quiet-state">Working copy clean.</div>}
    </div>
    <div className="git-actions">
      {data?.write_available === false && <small>{String(data.write_reason || "Source control is read-only in this workbench.")}</small>}
      <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Commit message" aria-label="Commit message" />
      <Button busy={busy === "commit"} disabled={data?.write_available === false || !selected.size || !message.trim()} onClick={() => void mutate("commit")}><GitCommitHorizontal size={14} /> Commit selected</Button>
      <Button busy={busy === "pull"} disabled={data?.write_available === false || !data?.clean} onClick={() => void mutate("pull")}><GitPullRequestArrow size={14} /> Pull</Button>
      <Button busy={busy === "push"} disabled={data?.write_available === false || !data?.clean} onClick={() => void mutate("push")}><UploadCloud size={14} /> Push</Button>
    </div>
  </div>;
}

function RemoteRepositoryPanel({project}: {project: Project}) {
  const sources = (Array.isArray(project.repository_sources) ? project.repository_sources : Array.isArray(project.model_sources) ? project.model_sources : []) as JsonMap[];
  const [sourceId, setSourceId] = useState("");
  const [path, setPath] = useState("");
  const [tree, setTree] = useState<SourceTreeResponse | null>(null);
  const [file, setFile] = useState<SourceFile | null>(null);
  const [error, setError] = useState("");
  const chosen = sourceId || String(sources[0]?.id || "");
  const load = async (nextPath = "") => {
    if (!chosen) return;
    setError(""); setFile(null);
    try { setTree(await request<SourceTreeResponse>(`/api/integrations/repository?source=${encodeURIComponent(chosen)}&path=${encodeURIComponent(nextPath)}`)); setPath(nextPath); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  useEffect(() => { if (chosen) void load(""); }, [project.id, chosen]);
  if (!sources.length) return <EmptyState icon={<GitBranch />} title="No external repository registered" description="Pinned GitHub model sources will appear here as read-only repositories." />;
  return <div className="remote-repository">
    <div className="remote-toolbar"><select value={chosen} onChange={(event) => { setSourceId(event.target.value); setPath(""); }}>{sources.map((source) => <option key={String(source.id)} value={String(source.id)}>{String(source.name || source.repository || source.id)}</option>)}</select><span>{path || "/"}</span></div>
    {error && <ErrorNotice message={error} />}
    <div className="remote-grid"><div className="remote-tree">{path && <button className="tree-row" onClick={() => void load(path.split("/").slice(0, -1).join("/"))}><ChevronRight className="rotate-180" />..</button>}{(tree?.entries || []).map((entry) => <button key={entry.path} className="tree-row" onClick={async () => { if (entry.type === "directory") void load(entry.path); else { try { setFile(await request<SourceFile>(`/api/integrations/repository/file?source=${encodeURIComponent(chosen)}&path=${encodeURIComponent(entry.path)}`)); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } } }}>{entry.type === "directory" ? <Folder /> : <File />}<span>{entry.name}</span></button>)}</div><pre className="remote-preview">{file?.content || "Select a file from the pinned repository."}</pre></div>
  </div>;
}

export function SourceView({project, activeFile, onOpenFile}: {project: Project; activeFile?: SourceFile | null; onOpenFile: (file: SourceFile) => void}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const open = async (entry: SourceEntry) => {
    if (entry.type !== "file" || entry.viewable === false) return;
    setLoading(true); setError("");
    try {
      const file = await api.sourceFile(entry.path);
      onOpenFile(file);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  };

  return <Tabs.Root defaultValue="files" className="source-workspace">
    <div className="subnav-bar"><Tabs.List><Tabs.Trigger value="files">Project source</Tabs.Trigger><Tabs.Trigger value="git">Source control</Tabs.Trigger><Tabs.Trigger value="remote">Repositories</Tabs.Trigger></Tabs.List></div>
    <Tabs.Content value="files" className="source-content">
      <aside><div className="pane-heading"><span>Explorer</span><small>{project.name || project.id}</small></div><SourceTree projectId={project.id} onOpen={(entry) => void open(entry)} /></aside>
      <main className="editor-pane">
        {error && <ErrorNotice message={error} />}
        {loading && !activeFile && <LoadingState label="Opening source file…" />}
        {activeFile ? <>
          <div className="editor-breadcrumbs">{activeFile.path.split("/").map((part, index) => <span key={`${part}-${index}`}>{part}</span>)}<Badge>{languageForPath(activeFile.path)}</Badge><small>{formatBytes(activeFile.size)}</small></div>
          <Suspense fallback={<LoadingState label="Loading Monaco…" />}>
            <MonacoEditor
              path={`${project.id}/${activeFile.path}`}
              value={activeFile.content}
              language={languageForPath(activeFile.path)}
              theme="vs-dark"
              options={{readOnly: true, minimap: {enabled: true}, fontSize: 13, lineHeight: 21, fontLigatures: true, smoothScrolling: true, renderWhitespace: "selection", padding: {top: 14}, scrollBeyondLastLine: false, automaticLayout: true}}
            />
          </Suspense>
        </> : <EmptyState icon={<FileCode2 />} title="Open a project file" description="Select a safe text file from Explorer. Source is rendered locally and never interpreted as project HTML." />}
      </main>
    </Tabs.Content>
    <Tabs.Content value="git" className="source-tab-content"><GitPanel project={project} /></Tabs.Content>
    <Tabs.Content value="remote" className="source-tab-content"><RemoteRepositoryPanel project={project} /></Tabs.Content>
  </Tabs.Root>;
}
