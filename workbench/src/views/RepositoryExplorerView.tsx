import {useEffect, useRef, useState} from "react";
import {ArrowDownToLine, ExternalLink, Search, Star} from "lucide-react";
import {api} from "../lib/api";
import type {JsonMap, Project} from "../types";
import {Button, ErrorNotice, LoadingState} from "../components/ui";
import {RepositoryReadme} from "../components/RepositoryReadme";

type Provider = "github" | "huggingface";

function text(value: unknown, fallback = ""): string { return String(value ?? fallback); }
function number(value: unknown): number { return Number(value || 0); }
function compact(value: unknown): string { return new Intl.NumberFormat(undefined, {notation: "compact", maximumFractionDigits: 1}).format(number(value)); }
function bytes(value: unknown): string {
  let amount = number(value); const units = ["B", "KB", "MB", "GB", "TB"]; let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
  return `${amount >= 10 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`;
}
function list(value: unknown): string[] { return Array.isArray(value) ? value.map(String).filter(Boolean) : []; }
function safeRepositoryUrl(value: unknown, provider: Provider): string {
  const candidate = text(value);
  const origin = provider === "github" ? "https://github.com/" : "https://huggingface.co/";
  return candidate.startsWith(origin) ? candidate : "";
}
function repositoryImageUrl(source: string, provider: Provider, item: JsonMap, inspection: JsonMap): string {
  const repoId = text(item.repo_id);
  const revision = text(inspection.revision);
  if (!repoId || !/^[0-9a-f]{40,64}$/i.test(revision)) return "";
  let candidate = source.trim().split("#", 1)[0].split("?", 1)[0];
  if (!candidate) return "";
  if (/^https:\/\//i.test(candidate)) {
    try {
      const url = new URL(candidate);
      const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
      const [owner, repository] = repoId.split("/");
      if (provider === "github" && url.hostname === "raw.githubusercontent.com" && parts[0] === owner && parts[1] === repository) candidate = parts.slice(3).join("/");
      else if (provider === "github" && url.hostname === "github.com" && parts[0] === owner && parts[1] === repository && ["blob", "raw"].includes(parts[2])) candidate = parts.slice(4).join("/");
      else if (provider === "huggingface" && url.hostname === "huggingface.co") {
        const resolveAt = parts.indexOf("resolve");
        const repoAt = parts[0] === "datasets" || parts[0] === "spaces" ? 1 : 0;
        if (parts[repoAt] !== owner || parts[repoAt + 1] !== repository || resolveAt < repoAt + 2) return "";
        candidate = parts.slice(resolveAt + 2).join("/");
      } else return "";
    } catch { return ""; }
  } else {
    try { candidate = decodeURIComponent(candidate); } catch { return ""; }
    const base = candidate.startsWith("/") ? [] : text(inspection.readme_path, "README.md").split("/").slice(0, -1);
    candidate = candidate.replace(/^\/+/, "");
    const resolved = [...base];
    for (const part of candidate.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") { if (!resolved.length) return ""; resolved.pop(); }
      else resolved.push(part);
    }
    candidate = resolved.join("/");
  }
  if (!/\.(?:gif|jpe?g|png|webp)$/i.test(candidate) || candidate.includes("\\")) return "";
  const query = new URLSearchParams({repo_id: repoId, revision, path: candidate});
  if (provider === "huggingface") query.set("repo_type", "dataset");
  return `/api/integrations/${provider}/readme-image?${query}`;
}
function projectDefaults(item: JsonMap, projects: Project[]) {
  const raw = text(item.name || text(item.repo_id).split("/").pop(), "Imported Project");
  const name = raw.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const base = raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "imported-project";
  let id = base; let suffix = 2;
  while (projects.some((project) => project.id === id)) { id = `${base}-${suffix}`; suffix += 1; }
  return {name, id};
}

export function ProviderMark({provider, decorative = false}: {provider: Provider; decorative?: boolean}) {
  const label = provider === "github" ? "GitHub" : "Hugging Face";
  return <img className={`provider-mark ${provider}`} src={provider === "github" ? "/github-mark.svg" : "/huggingface-mark.svg"} alt={decorative ? "" : label} aria-hidden={decorative || undefined} />;
}

export function RepositoryExplorerView({provider, project, projects, onImported}: {
  provider: Provider;
  project: Project | null;
  projects: Project[];
  onImported: (project: Project, destination: "source" | "data") => Promise<void>;
}) {
  const huggingFace = provider === "huggingface";
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState(huggingFace ? "trending_score" : "stars");
  const [results, setResults] = useState<JsonMap[]>([]);
  const [selected, setSelected] = useState<JsonMap | null>(null);
  const [inspection, setInspection] = useState<JsonMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [inspecting, setInspecting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [target, setTarget] = useState<"new" | "existing">("new");
  const [projectName, setProjectName] = useState("");
  const [projectId, setProjectId] = useState("");
  const [packageScope, setPackageScope] = useState("source");
  const selectionRevision = useRef(0);

  const search = async () => {
    setLoading(true); setError(""); setSelected(null); setInspection(null); setStatus("");
    try {
      if (huggingFace) {
        const response = await api.searchHuggingFace(query.trim(), sort); setResults(response.datasets || []);
      } else {
        const response = await api.searchGitHub(query.trim(), sort); setResults(response.repositories || []);
      }
    } catch (reason) { setResults([]); setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  };

  useEffect(() => { void search(); }, [provider]);

  const select = async (item: JsonMap) => {
    const revision = selectionRevision.current + 1; selectionRevision.current = revision;
    setSelected(item); setInspection(null); setInspecting(true); setError(""); setStatus("Resolving an immutable repository revision…");
    const defaults = projectDefaults(item, projects); setProjectName(defaults.name); setProjectId(defaults.id);
    try {
      const inspected = huggingFace
        ? await api.inspectHuggingFace(text(item.repo_id), "dataset", text(item.revision))
        : await api.inspectGitHub(text(item.repo_id), text(item.default_branch || item.revision));
      if (selectionRevision.current !== revision) return;
      setInspection(inspected); setStatus(`Ready · revision ${text(inspected.revision).slice(0, 12)} will be pinned.`);
    } catch (reason) {
      if (selectionRevision.current !== revision) return;
      setError(reason instanceof Error ? reason.message : String(reason)); setStatus("");
    } finally { if (selectionRevision.current === revision) setInspecting(false); }
  };

  const importRepository = async () => {
    if (!selected || !inspection || importing) return;
    setImporting(true); setError(""); setStatus(huggingFace ? "Importing the pinned Hub snapshot…" : "Importing the pinned GitHub working copy…");
    try {
      const common: JsonMap = {
        target, repo_id: text(selected.repo_id), revision: text(inspection.revision),
        ...(target === "new" ? {new_project_name: projectName.trim(), new_project_id: projectId.trim()} : {project_id: project?.id || ""}),
      };
      const result = huggingFace
        ? await api.importHuggingFace({...common, repo_type: "dataset", package: packageScope})
        : await api.importGitHub(common);
      setStatus(`${result.project.name || result.project.id} is ready.`);
      await onImported(result.project, huggingFace ? "data" : "source");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setStatus(""); }
    finally { setImporting(false); }
  };

  const selectedUrl = selected ? safeRepositoryUrl(selected.repository_url, provider) : "";
  return <div className={`repository-explorer ${provider}`}>
    <header className="repository-explorer-header">
      <span className="repository-provider-logo"><ProviderMark provider={provider} decorative /></span>
      <div><span className="eyebrow">External repository explorer</span><h1>{huggingFace ? "Hugging Face datasets" : "GitHub transformer projects"}</h1><p>{huggingFace ? "Find public or token-authorized datasets, inspect immutable metadata, and import a bounded snapshot." : "Search transformer repositories, inspect the pinned revision, and bring source into a ModelForge project."}</p></div>
    </header>
    <form className="repository-explorer-toolbar" onSubmit={(event) => {event.preventDefault(); void search();}}>
      <label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={huggingFace ? "Search datasets, organizations, or tasks…" : "Search modalities, model families, or tasks…"} /></label>
      <select aria-label={`Sort ${huggingFace ? "Hugging Face" : "GitHub"} results`} value={sort} onChange={(event) => setSort(event.target.value)}>{huggingFace ? <><option value="trending_score">Trending</option><option value="downloads">Most downloaded</option><option value="likes">Most liked</option><option value="last_modified">Recently updated</option></> : <><option value="stars">Most starred</option><option value="updated">Recently updated</option><option value="forks">Most forked</option></>}</select>
      <Button variant="primary" type="submit" busy={loading}>Search</Button>
    </form>
    {error && <ErrorNotice message={error} />}
    <div className="repository-explorer-layout">
      <section className="repository-results" aria-label={`${huggingFace ? "Hugging Face" : "GitHub"} search results`}>
        <header><strong>{query.trim() ? "Search results" : huggingFace ? "Trending datasets" : "Popular transformer projects"}</strong><span>{results.length} found</span></header>
        <div>{loading ? <LoadingState label={`Searching ${huggingFace ? "Hugging Face" : "GitHub"}…`} /> : results.length ? results.map((item) => <button key={text(item.repo_id)} type="button" className={selected?.repo_id === item.repo_id ? "selected" : ""} onClick={() => void select(item)}>
          <span className="repository-result-mark"><ProviderMark provider={provider} decorative /></span>
          <span className="repository-result-copy"><strong>{text(item.name || item.repo_id)}</strong><small>{text(item.repo_id)}</small><p>{text(item.description, "No repository description provided.")}</p><span>{[...list(item.tasks || item.topics), text(item.size_category || item.language)].filter(Boolean).slice(0, 3).map((tag) => <i key={tag}>{tag.replace(/_/g, " ")}</i>)}</span></span>
          <span className="repository-result-metrics">{huggingFace ? <><b>↓ {compact(item.downloads)}</b><b>♥ {compact(item.likes)}</b></> : <><b><Star size={10} /> {compact(item.stars)}</b><b>⑂ {compact(item.forks)}</b></>}</span>
        </button>) : <div className="repository-empty">No matching repositories found. Try a broader query.</div>}</div>
      </section>
      <aside className="repository-inspector" aria-label="Selected repository">
        {!selected ? <div className="repository-selection-empty"><ProviderMark provider={provider} decorative /><strong>Select a repository</strong><p>Its pinned revision, license, files, and import controls will appear here.</p></div> : <div className="repository-selection">
          <div className="repository-selection-title"><div><span className="eyebrow">Selected repository</span><h2>{text(selected.repo_id)}</h2></div>{selectedUrl && <a href={selectedUrl} target="_blank" rel="noopener noreferrer">Open {huggingFace ? "Hub" : "GitHub"} <ExternalLink size={13} /></a>}</div>
          <p>{text(selected.description, "No repository description provided.")}</p>
          <dl><div><dt>Revision</dt><dd>{inspecting ? "Resolving…" : text(inspection?.revision).slice(0, 12) || "Unavailable"}</dd></div><div><dt>License</dt><dd>{text(inspection?.license || selected.license, "Not declared")}</dd></div><div><dt>{huggingFace ? "Files" : "Language"}</dt><dd>{huggingFace ? compact(inspection?.files) : text(selected.language, "Not declared")}</dd></div><div><dt>Snapshot size</dt><dd>{bytes(inspection?.total_size || inspection?.size_bytes)}</dd></div></dl>
          {!inspecting && <RepositoryReadme source={text(inspection?.readme || selected.description)} path={text(inspection?.readme_path, "README.md")} dataset={huggingFace} resolveImage={(source) => repositoryImageUrl(source, provider, selected, inspection || {})} />}
          <label><span>Import target</span><select value={target} onChange={(event) => setTarget(event.target.value as "new" | "existing")}><option value="new">Create a new project</option><option value="existing" disabled={!project}>Add to {project?.name || "active project"}</option></select></label>
          {target === "new" && <div className="repository-project-fields"><label><span>Project name</span><input value={projectName} onChange={(event) => setProjectName(event.target.value)} /></label><label><span>Project ID</span><input value={projectId} pattern="[a-z0-9-]+" onChange={(event) => setProjectId(event.target.value)} /></label></div>}
          {huggingFace && <label><span>Import scope</span><select value={packageScope} onChange={(event) => setPackageScope(event.target.value)}><option value="source">Metadata and scripts · fast</option><option value="full">Complete dataset snapshot</option></select><small>{packageScope === "full" ? `Downloads the complete pinned snapshot${inspection?.total_size ? ` · approximately ${bytes(inspection.total_size)}` : ""}.` : "Imports cards, scripts, schemas, and configuration without large dataset files."}</small></label>}
          {status && <div className="repository-status" role="status">{status}</div>}
          <Button variant="primary" size="lg" busy={importing} disabled={!inspection || inspecting || (target === "new" && (!projectName.trim() || !projectId.trim()))} onClick={() => void importRepository()}><ArrowDownToLine size={15} /> {target === "new" ? "Create project" : "Import into project"}</Button>
        </div>}
      </aside>
    </div>
  </div>;
}
