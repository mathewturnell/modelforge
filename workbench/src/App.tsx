import {lazy, Suspense, useEffect, useState} from "react";
import {Group, Panel, Separator} from "react-resizable-panels";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  Activity, Bell, BookOpen, Box, Braces, ChevronDown, Cloud, Code2, Command, Database,
  FileCode2, FolderKanban, FolderPlus, GitBranch, GitCompareArrows, Home, Layers3, ListChecks, Menu,
  Gauge, MessagesSquare, MonitorDot, MoreHorizontal, Plus, ScanSearch, Search, Settings, Share2, Sparkles,
  Trash2, X,
} from "lucide-react";
import {api} from "./lib/api";
import type {ActivityId, InferenceTarget, JobRecord, OpenDocument, Project, RunRecord, SourceFile} from "./types";
import {activityDocument, replaceCollectionDocument, runDocument, sourceDocument} from "./lib/documents";
import {reconcileProjectCatalogOrder} from "./lib/project-catalog";
import {Badge, Button, ErrorNotice, IconButton, LoadingState, Tooltip} from "./components/ui";
import {CliffPanel, type CliffInitialTurn} from "./components/CliffPanel";
import {BottomPanel} from "./components/BottomPanel";
import {CliffMark} from "./components/CliffMark";
import {PointCloudWave} from "./components/PointCloudWave";
import {ExecutionToolbar} from "./components/ExecutionToolbar";
import {ExistingProjectPicker} from "./components/ExistingProjectPicker";
import {ProjectLauncher} from "./components/ProjectLauncher";
import type {ComputeSelection} from "./components/ComputeTargetPicker";
import {OverviewView} from "./views/OverviewView";
import {SourceView} from "./views/SourceView";
import {DatasetView} from "./views/DatasetView";
import {RunsView} from "./views/RunsView";
import {InferenceView} from "./views/InferenceView";
import {JobsView, jobLocation, jobWorkspace} from "./views/JobsView";
import {DeployView} from "./views/DeployView";
import {SettingsView} from "./views/SettingsView";
import {CalibrationView} from "./views/CalibrationView";
import {LlmStudioView} from "./views/LlmStudioView";
import {ProviderMark, RepositoryExplorerView} from "./views/RepositoryExplorerView";
import {KnowledgeBaseView} from "./views/KnowledgeBaseView";

const ArchitectureView = lazy(() => import("./views/ArchitectureView"));

const providerActivities: Array<{id: ActivityId; label: string; railLabel: string; icon: React.ReactNode}> = [
  {id: "github", label: "GitHub", railLabel: "GitHub", icon: <ProviderMark provider="github" decorative />},
  {id: "huggingface", label: "Hugging Face", railLabel: "HF Hub", icon: <ProviderMark provider="huggingface" decorative />},
];
const activities: Array<{id: ActivityId; label: string; icon: React.ReactNode; top?: string}> = [
  {id: "overview", label: "Overview", icon: <Home />},
  {id: "source", label: "Source", icon: <FileCode2 />, top: "Code"},
  {id: "data", label: "Datasets", icon: <Database />, top: "Datasets"},
  {id: "model", label: "Models", icon: <Box />, top: "Model"},
  {id: "llm", label: "LLM Lab", icon: <MessagesSquare />, top: "LLM Lab"},
  {id: "runs", label: "Training", icon: <GitCompareArrows />, top: "Training"},
  {id: "inference", label: "Inference", icon: <ScanSearch />, top: "Inference"},
  {id: "calibration", label: "Performance", icon: <Gauge />, top: "Performance"},
  {id: "deploy", label: "Deployments", icon: <Cloud />, top: "Deploy"},
  {id: "jobs", label: "Jobs", icon: <ListChecks />, top: "Jobs"},
  {id: "knowledge", label: "Knowledge Base", icon: <BookOpen />, top: "Documentation"},
  {id: "settings", label: "Settings", icon: <Settings />},
  ...providerActivities,
];
export const compactActivities = activities.filter((activity) => activity.id !== "github" && activity.id !== "huggingface");

function canonicalActivity(activity: ActivityId): ActivityId {
  return activity === "monitor" ? "deploy" : activity;
}

function ActivityRail({active, showProviders, onSelect, onCommand}: {active: ActivityId; showProviders: boolean; onSelect: (id: ActivityId) => void; onCommand: () => void}) {
  return <nav className="activity-rail" aria-label="Workbench activities">
    <div className="activity-primary">{activities.filter((activity) => activity.id !== "settings" && activity.id !== "knowledge" && activity.id !== "github" && activity.id !== "huggingface").map((activity) => <Tooltip key={activity.id} text={activity.label}><button className={active === activity.id ? "active" : ""} onClick={() => onSelect(activity.id)} aria-label={activity.label} aria-current={active === activity.id ? "page" : undefined}>{activity.icon}<span>{activity.label}</span></button></Tooltip>)}</div>
    <div className="activity-secondary">{showProviders && <div className="activity-home-providers" aria-label="Explore project sources">{providerActivities.map((provider) => <Tooltip key={provider.id} text={provider.label}><button onClick={() => onSelect(provider.id)} aria-label={provider.label}>{provider.icon}<span>{provider.railLabel}</span></button></Tooltip>)}</div>}<Tooltip text="Knowledge Base"><button className={active === "knowledge" ? "active" : ""} onClick={() => onSelect("knowledge")} aria-label="Knowledge Base" aria-current={active === "knowledge" ? "page" : undefined}><BookOpen /><span>Learn</span></button></Tooltip><Tooltip text="Command palette"><button onClick={onCommand} aria-label="Command palette"><Command /><span>Commands</span></button></Tooltip><Tooltip text="Settings"><button className={active === "settings" ? "active" : ""} onClick={() => onSelect("settings")} aria-label="Settings" aria-current={active === "settings" ? "page" : undefined}><Settings /><span>Settings</span></button></Tooltip></div>
  </nav>;
}

export function CompactActivityMenu({active, onSelect}: {active: ActivityId; onSelect: (id: ActivityId) => void}) {
  return <DropdownMenu.Root><DropdownMenu.Trigger asChild><button className="compact-activity-trigger" aria-label="Open workspace navigation"><Menu size={18} /></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="dropdown-content compact-activity-content" align="start" sideOffset={8} collisionPadding={8}><DropdownMenu.Label>Workspaces</DropdownMenu.Label>{compactActivities.map((activity) => <DropdownMenu.Item key={activity.id} className="compact-activity-item" aria-current={active === activity.id ? "page" : undefined} onSelect={() => onSelect(activity.id)}>{activity.icon}<span>{activity.label}</span>{active === activity.id && <CircleCheckIcon />}</DropdownMenu.Item>)}</DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>;
}

function ProductIdentity({large = false}: {large?: boolean}) {
  return <span className={`product-identity ${large ? "large" : ""}`}><img className="brand-symbol" src="/favicon.svg" alt="" aria-hidden="true" /><span className="brand-word"><span>Model</span><strong>Forge</strong></span></span>;
}

function ProductRelease({version, className = ""}: {version?: string; className?: string}) {
  return <span className={`product-release ${className}`.trim()}><strong>ALPHA</strong>{version && <span>v{version}</span>}</span>;
}

function ModalitySystemsLogo() {
  return <span className="title-modality-logo"><img src="/modalitysystems.png" alt="Modality Systems" /></span>;
}

function accountInitials(user: Record<string, unknown>): string {
  const name = String(user.display_name || "").trim();
  if (name) return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const email = String(user.email || user.login || "").trim();
  return (email[0] || "MF").toUpperCase();
}

function TitleBar({projects, project, activity, productVersion, user, compute, onComputeChange, onSelectProject, onRemoveProject, onAddExisting, onSelectActivity, onHome, onCommand, onToggleCliff}: {
  projects: Project[]; project: Project | null; activity: ActivityId;
  productVersion: string; user: Record<string, unknown>;
  compute: ComputeSelection; onComputeChange: (selection: ComputeSelection) => void;
  onSelectProject: (id: string) => void; onRemoveProject: (project: Project) => void; onAddExisting: () => void; onSelectActivity: (id: ActivityId) => void;
  onHome: () => void;
  onCommand: () => void; onToggleCliff: () => void;
}) {
  const accountName = String(user.display_name || user.email || user.login || "ModelForge account");
  const candidateImage = String(user.avatar_url || user.picture_url || user.picture || "").trim();
  const accountImage = candidateImage.startsWith("https://") || candidateImage.startsWith("/api/") ? candidateImage : "";
  return <header className="title-bar">
    <button className="product-brand" onClick={onHome} aria-label={`ModelForge Alpha ${productVersion} · Home`}><ProductIdentity /></button>
    <CompactActivityMenu active={activity} onSelect={onSelectActivity} />
    <DropdownMenu.Root><DropdownMenu.Trigger asChild><button className="project-switcher"><FolderKanban size={15} /><span>{project ? project.name || project.id : "New project"}</span><ChevronDown size={13} /></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="dropdown-content" align="start" sideOffset={8} collisionPadding={8}><DropdownMenu.Label>Open project</DropdownMenu.Label>{projects.length ? projects.map((item) => <div key={item.id} className="dropdown-item" role="presentation"><DropdownMenu.Item className="project-open" onSelect={() => onSelectProject(item.id)}><span className="project-color" /><div><strong>{item.name || item.id}</strong><small>{item.id}</small></div>{item.id === project?.id && <Badge tone="success">Active</Badge>}</DropdownMenu.Item><DropdownMenu.Item className="project-remove" aria-label={`Remove ${item.name || item.id} from project list`} title="Remove from project list" onSelect={(event) => {event.preventDefault(); onRemoveProject(item);}}><Trash2 size={14} /></DropdownMenu.Item></div>) : <DropdownMenu.Label>No projects yet</DropdownMenu.Label>}<DropdownMenu.Separator className="dropdown-separator" /><DropdownMenu.Item className="dropdown-add-project" onSelect={onAddExisting}><FolderPlus size={15} /><span>Add existing project folder…</span></DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>
    <ExecutionToolbar value={compute} onChange={onComputeChange} projectId={project?.id || ""} />
    <button className="command-trigger" aria-label="Search or run a command" onClick={onCommand}><Search size={14} /><span>Search or run a command</span><kbd>Ctrl K</kbd></button>
    <div className="title-actions"><IconButton label="Share project context" variant="ghost"><Share2 size={15} /></IconButton><IconButton label="Notifications" variant="ghost"><Bell size={15} /></IconButton><IconButton label="Toggle Cliff" variant="ghost" onClick={onToggleCliff}><CliffMark /></IconButton><a className="avatar" href="/account" aria-label={`Open account for ${accountName}`} title={accountName}><span>{accountInitials(user)}</span>{accountImage && <img src={accountImage} alt="" referrerPolicy="no-referrer" onError={(event) => {event.currentTarget.hidden = true;}} />}<i /></a><ModalitySystemsLogo /></div>
  </header>;
}

function documentIcon(document: OpenDocument) {
  if (document.kind === "overview") return <Home />;
  if (document.kind === "source" || document.kind === "source-collection") return <FileCode2 />;
  if (document.kind === "dataset" || document.kind === "artifact" || document.kind === "annotation") return <Database />;
  if (document.kind === "architecture") return <Layers3 />;
  if (document.kind === "llm") return <MessagesSquare />;
  if (document.activity === "github") return <ProviderMark provider="github" decorative />;
  if (document.activity === "huggingface") return <ProviderMark provider="huggingface" decorative />;
  if (document.kind === "run" || document.kind === "run-collection") return <Activity />;
  if (document.kind === "inference") return <ScanSearch />;
  if (document.kind === "jobs") return <ListChecks />;
  if (document.kind === "calibration") return <Gauge />;
  if (document.kind === "deployment") return <Cloud />;
  if (document.kind === "knowledge") return <BookOpen />;
  if (document.kind === "settings") return <Settings />;
  return <MonitorDot />;
}

function DocumentTabs({documents, activeKey, onActivate, onClose, onNew}: {documents: OpenDocument[]; activeKey: string | null; onActivate: (document: OpenDocument) => void; onClose: (key: string) => void; onNew: () => void}) {
  return <div className="document-tabs" role="tablist" aria-label="Open project objects">{documents.map((document) => <button key={document.key} role="tab" aria-selected={activeKey === document.key} aria-label={document.subtitle ? `${document.title} · ${document.subtitle}` : document.title} title={document.subtitle} className={activeKey === document.key ? "active" : ""} onClick={() => onActivate(document)}>{documentIcon(document)}<span>{document.title}</span>{document.closeable && <i onClick={(event) => {event.stopPropagation(); onClose(document.key);}}><X size={12} /></i>}</button>)}<button className="new-tab" role="tab" aria-selected="false" aria-label="Open command palette" onClick={onNew}><Plus size={14} /></button></div>;
}

function CommandPalette({open, onOpenChange, onSelect}: {open: boolean; onOpenChange: (open: boolean) => void; onSelect: (id: ActivityId) => void}) {
  const [query, setQuery] = useState("");
  const commands = activities.filter((item) => `${item.label} ${item.top || ""}`.toLowerCase().includes(query.toLowerCase()));
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="command-palette"><Dialog.Title className="sr-only">Command palette</Dialog.Title><div className="command-input"><Search size={18} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects, files, datasets, jobs, or commands…" /></div><div className="command-results"><span className="eyebrow">Navigate</span>{commands.map((command) => <button key={command.id} onClick={() => {onSelect(command.id); onOpenChange(false);}}>{command.icon}<div><strong>Open {command.top || command.label}</strong><small>Switch to the {command.label.toLowerCase()} workspace</small></div><kbd>↵</kbd></button>)}</div><footer><span>↑↓ Navigate</span><span>↵ Open</span><span>Esc Close</span></footer></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

function StatusBar({project, activity, productVersion}: {project: Project | null; activity: ActivityId; productVersion: string}) {
  const dataset = String(project?.active_dataset_profile || project?.default_dataset_profile || project?.selected_dataset || project?.default_dataset || "no dataset");
  const datasetLabel = dataset.includes("/") || dataset.includes("\\") ? dataset.split(/[\\/]/).filter(Boolean).at(-1) : dataset;
  return <footer className="status-bar"><div><span><GitBranch size={12} /> {String(project?.branch || "local")}</span><span title={dataset}><Database size={12} /> {datasetLabel}</span><span><Box size={12} /> {String(project?.active_model_version || "no active model")}</span></div><div><span><CircleCheckIcon /> Local</span><span>{activities.find((item) => item.id === activity)?.label}</span><ProductRelease version={productVersion} className="status-release" /></div></footer>;
}

function ModalityFooter({className = ""}: {className?: string}) {
  return <footer className={`modality-footer ${className}`.trim()}><img src="/modalitysystems.png" alt="Modality Systems" /></footer>;
}

function WorkbenchLoading({version}: {version: string}) {
  return <div className="workbench-boot"><PointCloudWave className="workbench-loading-wave" /><div className="workbench-loading-content"><div className="workbench-loading-brand"><ProductIdentity large /><ProductRelease version={version} /></div><LoadingState label="Opening local workbench…" /></div><ModalityFooter className="workbench-loading-modality" /></div>;
}

function initialComputeSelection(): ComputeSelection {
  const stored = localStorage.getItem("modelforge.compute.selection") || "";
  if (stored.startsWith("modal:")) return {target: "cloud", device: "cuda:0", modalGpu: stored.slice(6) || "L4"};
  if (stored === "local:gpu") return {target: "gpu", device: "0", modalGpu: "L4"};
  if (stored === "local:cpu") return {target: "cpu", device: "cpu", modalGpu: "L4"};
  return {target: "local", device: "auto", modalGpu: "L4"};
}

function AuthenticationGate({registrationAvailable, productVersion, onAuthenticated}: {registrationAvailable: boolean; productVersion: string; onAuthenticated: () => Promise<void>}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      if (mode === "register") await api.register(email, password, displayName);
      else await api.login(email, password);
      await onAuthenticated();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return <div className="auth-shell"><PointCloudWave className="auth-point-cloud" /><div className="auth-brand"><ProductIdentity large /><ProductRelease version={productVersion} /></div><div className="auth-card"><span className="eyebrow">Local engineering workspace</span><h1>{mode === "register" ? "Create the first local account" : "Welcome back"}</h1><p>Your projects, datasets, credentials, and assistant workspace stay bounded to this installation.</p>{error && <ErrorNotice message={error} />}<form className="auth-google" method="post" action="/api/commercial/login"><Button variant="primary" size="lg" type="submit"><span className="google-g" aria-hidden="true">G</span> Continue with Google</Button><small>Google authentication stays at modality.systems. Localhost receives only a revocable ModelForge installation authorization.</small></form><div className="auth-divider"><span>Offline local account</span></div><form className="auth-local" onSubmit={(event) => void submit(event)}>{mode === "register" && <label><span>Display name</span><input autoFocus value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" required /></label>}<label><span>Email</span><input autoFocus={mode === "login"} type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" required /></label><label><span>Password</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === "register" ? "new-password" : "current-password"} required /></label><Button variant="secondary" size="lg" busy={busy} type="submit">{mode === "register" ? "Create local account" : "Sign in locally"}</Button>{registrationAvailable && <button className="auth-mode" type="button" onClick={() => {setMode((current) => current === "login" ? "register" : "login"); setError("");}}>{mode === "login" ? "First launch? Create an offline local administrator" : "Already configured? Sign in locally"}</button>}</form></div><ModalityFooter className="auth-modality" /></div>;
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [activity, setActivity] = useState<ActivityId>(() => {
    const restored = (sessionStorage.getItem("modelforge.workbench.activity") as ActivityId) || "overview";
    return canonicalActivity(restored);
  });
  const [documents, setDocuments] = useState<OpenDocument[]>([]);
  const [activeDocumentKey, setActiveDocumentKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  const [existingProjectOpen, setExistingProjectOpen] = useState(false);
  const [cliffOpen, setCliffOpen] = useState(() => localStorage.getItem("modelforge.workbench.cliff") !== "closed");
  const [bottomOpen, setBottomOpen] = useState(() => localStorage.getItem("modelforge.workbench.output") !== "closed");
  const [logs, setLogs] = useState<string[]>([]);
  const [authentication, setAuthentication] = useState<Record<string, unknown> | null>(null);
  const [compute, setCompute] = useState<ComputeSelection>(initialComputeSelection);
  // A clean public-alpha launch opens the already registered project. Project
  // creation is a separate registration workflow and must never hide a usable
  // workspace behind controls that this backend has not authorized.
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [initialCliffTurn, setInitialCliffTurn] = useState<CliffInitialTurn | null>(null);
  const [inferenceTarget, setInferenceTarget] = useState<InferenceTarget | null>(null);

  const load = async () => {
    setLoading(true); setError("");
    try {
      const catalog = await api.projects();
      const available = catalog.projects || [];
      setProjects((current) => reconcileProjectCatalogOrder(current, available));
      if (!available.length) { setProject(null); setInferenceTarget(null); return; }
      const active = await api.project();
      const catalogProject = available.find((item) => item.id === active.id);
      setProject(catalogProject ? {...catalogProject, ...active, dataset_repository: catalogProject.dataset_repository || active.dataset_repository} : active);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  };
  useEffect(() => {
    const initialize = async () => {
      try {
        const status = await api.authStatus(); setAuthentication(status);
        if (status.authenticated || status.development_bypass) await load();
        else setLoading(false);
      } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setLoading(false); }
    };
    void initialize();
  }, []);
  useEffect(() => {
    const selection = compute.target === "cloud" ? `modal:${compute.modalGpu}` : compute.target === "gpu" ? "local:gpu" : compute.target === "cpu" ? "local:cpu" : "local:auto";
    localStorage.setItem("modelforge.compute.selection", selection);
    localStorage.setItem("modelforge.compute.target", compute.target);
  }, [compute]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setCommandOpen(true); } };
    window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (launcherOpen) return;
    if (activity === "jobs") {
      if (documents.some((candidate) => candidate.key === "workbench:jobs")) return;
      const document = activityDocument(project || {id: "workbench", name: "ModelForge"}, "jobs");
      setDocuments([document]);
      setActiveDocumentKey(document.key);
      return;
    }
    if (!project) return;
    if (documents.some((candidate) => candidate.key.startsWith(`${project.id}:`))) return;
    const document = activityDocument(project, activity);
    setDocuments([document]);
    setActiveDocumentKey(document.key);
  }, [project?.id, launcherOpen, activity]);

  const navigate = (next: ActivityId) => {
    const destination = canonicalActivity(next);
    setActivity(destination); sessionStorage.setItem("modelforge.workbench.activity", destination);
    const concrete = [...documents].reverse().find((candidate) => candidate.activity === destination && candidate.kind !== "source-collection" && candidate.kind !== "run-collection");
    const document = concrete || activityDocument(project || {id: "workbench", name: "ModelForge"}, destination);
    setDocuments((current) => current.some((candidate) => candidate.key === document.key) ? current : [...current, document]);
    setActiveDocumentKey(document.key);
  };
  const activateDocument = (document: OpenDocument) => {
    setLauncherOpen(false);
    setActivity(document.activity);
    setActiveDocumentKey(document.key);
    sessionStorage.setItem("modelforge.workbench.activity", document.activity);
  };
  const closeDocument = (key: string) => {
    const next = documents.filter((document) => document.key !== key);
    setDocuments(next);
    if (activeDocumentKey !== key) return;
    const fallback = next.at(-1);
    setActiveDocumentKey(fallback?.key || null);
    if (fallback) {
      setActivity(fallback.activity);
      sessionStorage.setItem("modelforge.workbench.activity", fallback.activity);
    }
  };
  const selectProject = async (id: string) => {
    if (id === project?.id) return;
    setLoading(true); setError("");
    try {
      const selected = await api.selectProject(id);
      const catalogProject = projects.find((item) => item.id === id);
      setProject(catalogProject ? {...catalogProject, ...selected, dataset_repository: catalogProject.dataset_repository || selected.dataset_repository} : selected);
      setInferenceTarget(null);
      if (activity === "jobs" && !launcherOpen) return;
      const overview = activityDocument(catalogProject ? {...catalogProject, ...selected} : selected, "overview");
      setDocuments([overview]); setActiveDocumentKey(overview.key); setActivity("overview"); setLogs([]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  };
  const removeProject = async (item: Project) => {
    const name = String(item.name || item.id);
    if (!window.confirm(`Remove ${name} from the project list?\n\nIts source files, datasets, and workspace will stay on disk.`)) return;
    setError("");
    try {
      const catalog = await api.removeProject(item.id);
      const available = catalog.projects || [];
      setProjects((current) => reconcileProjectCatalogOrder(current, available));
      if (project?.id === item.id) {
        setInferenceTarget(null);
        if (catalog.active_id) {
          const active = await api.project();
          const catalogProject = available.find((candidate) => candidate.id === active.id);
          setProject(catalogProject ? {...catalogProject, ...active, dataset_repository: catalogProject.dataset_repository || active.dataset_repository} : active);
        } else setProject(null);
        if (activity !== "jobs" || launcherOpen) {
          const overview = activityDocument((catalog.active_id ? available.find((candidate) => candidate.id === catalog.active_id) : null) || {id: "workbench", name: "ModelForge"}, "overview");
          setDocuments(catalog.active_id ? [overview] : []); setActiveDocumentKey(catalog.active_id ? overview.key : null); setActivity("overview"); setLogs([]);
        }
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const registerExistingProject = (registration: {project: Project; projects: Project[]}) => {
    const selected = registration.project;
    setProjects((current) => reconcileProjectCatalogOrder(current, registration.projects));
    setProject(selected); setInferenceTarget(null); setLauncherOpen(false);
    const overview = activityDocument(selected, "overview");
    setDocuments([overview]); setActiveDocumentKey(overview.key); setActivity("overview"); setLogs([]);
  };
  const toggleCliff = () => setCliffOpen((current) => { localStorage.setItem("modelforge.workbench.cliff", current ? "closed" : "open"); return !current; });
  const toggleBottom = () => setBottomOpen((current) => { localStorage.setItem("modelforge.workbench.output", current ? "closed" : "open"); return !current; });
  const contextLabel = activities.find((item) => item.id === activity)?.label || "Project";
  const productVersion = String(authentication?.product_version || "");
  const openWorkspace = (next: ActivityId) => {
    if (!project && next !== "github" && next !== "huggingface" && next !== "knowledge" && next !== "jobs") {
      setLauncherOpen(true); setActivity("overview"); return;
    }
    setLauncherOpen(false); navigate(next);
  };
  const finishProjectCreation = async (createdProject: Project, destination: "source" | "data", message: string) => {
    setProjects((current) => [...current.filter((candidate) => candidate.id !== createdProject.id), createdProject]);
    setProject(createdProject);
    setInferenceTarget(null);
    const document = activityDocument(createdProject, destination);
    setDocuments([document]); setActiveDocumentKey(document.key); setActivity(destination); setLogs([]);
    sessionStorage.setItem("modelforge.workbench.activity", destination);
    const id = globalThis.crypto?.randomUUID?.() || `project-start-${Date.now()}`;
    setInitialCliffTurn({id, projectId: createdProject.id, message});
    setCliffOpen(true); localStorage.setItem("modelforge.workbench.cliff", "open");
    setLauncherOpen(false);
  };
  const finishRepositoryImport = async (_imported: Project, destination: "source" | "data") => {
    await load(); setLauncherOpen(false); navigate(destination);
  };
  const activeDocument = documents.find((document) => document.key === activeDocumentKey) || null;
  const openObjectDocument = (document: OpenDocument) => {
    setDocuments((current) => replaceCollectionDocument(current, document));
    setActiveDocumentKey(document.key);
    setActivity(document.activity);
    sessionStorage.setItem("modelforge.workbench.activity", document.activity);
  };
  const updateProjectContext = (nextProject: Project) => {
    const previousDataset = String(project?.selected_dataset || project?.default_dataset || "");
    const nextDataset = String(nextProject.selected_dataset || nextProject.default_dataset || "");
    if (project?.id !== nextProject.id || previousDataset !== nextDataset) setInferenceTarget(null);
    setProject(nextProject);
    const document = activityDocument(nextProject, "data");
    setDocuments((current) => [...current.filter((candidate) => !["data", "runs", "inference"].includes(candidate.activity)), document]);
    setActiveDocumentKey(document.key);
  };
  const openInferenceTarget = (target: InferenceTarget) => {
    setInferenceTarget(target);
    navigate("inference");
  };
  const openJob = async (job: JobRecord) => {
    const owningProject = projects.find((candidate) => candidate.id === job.project_id);
    if (!owningProject) throw new Error(`Project ${job.project_id} is not registered in this workbench.`);
    let selectedProject = project;
    if (project?.id !== owningProject.id) {
      const selected = await api.selectProject(owningProject.id);
      selectedProject = {
        ...owningProject,
        ...selected,
        dataset_repository: owningProject.dataset_repository || selected.dataset_repository,
      };
      setProject(selectedProject);
      setInferenceTarget(null);
    }
    if (jobWorkspace(job) === "inference" && jobLocation(job) === "cloud") {
      try { localStorage.setItem(`modelforge.inference.cloud.job.${job.project_id}`, job.id); }
      catch { /* The server registry remains authoritative if browser storage is unavailable. */ }
    }
    const destination = jobWorkspace(job);
    const document = activityDocument(selectedProject || owningProject, destination);
    setDocuments([document]); setActiveDocumentKey(document.key); setActivity(destination); setLogs([]);
    sessionStorage.setItem("modelforge.workbench.activity", destination);
    setLauncherOpen(false);
  };
  const cliffRunConflict = error.includes("active Cliff agent run");
  const canShowActiveCliffRun = cliffRunConflict && Boolean(project);
  const showActiveCliffRun = () => {
    setLauncherOpen(false);
    setCliffOpen(true);
    localStorage.setItem("modelforge.workbench.cliff", "open");
    setError("");
  };
  const errorNotice = error && <ErrorNotice
    message={cliffRunConflict
      ? "Cliff is still working in this project. Stop the active run before changing projects or models."
      : error}
    action={canShowActiveCliffRun ? <Button size="sm" onClick={showActiveCliffRun}>Show Cliff</Button> : undefined}
  />;

  if (loading && !project) return <WorkbenchLoading version={productVersion} />;
  if (authentication && !authentication.authenticated && !authentication.development_bypass) return <AuthenticationGate registrationAvailable={Boolean(authentication.registration_available)} productVersion={productVersion} onAuthenticated={async () => {setAuthentication(await api.authStatus()); await load();}} />;
  if (error && !project) return <div className="workbench-boot"><ErrorNotice message={error} action={<Button onClick={() => void load()}>Retry</Button>} /></div>;
  const content = launcherOpen || !project && activity !== "github" && activity !== "huggingface" && activity !== "knowledge" && activity !== "jobs"
    ? <ProjectLauncher onCreated={finishProjectCreation} />
    : activity === "github" || activity === "huggingface" ? <RepositoryExplorerView key={activity} provider={activity} project={project} projects={projects} onImported={finishRepositoryImport} />
    : activity === "overview" ? <OverviewView project={project!} onNavigate={navigate} />
    : activity === "source" ? <SourceView project={project!} activeFile={activeDocument?.kind === "source" ? activeDocument.payload as SourceFile : null} onOpenFile={(file) => openObjectDocument(sourceDocument(project!, file))} />
    : activity === "data" ? <DatasetView project={project!} inferenceTarget={inferenceTarget} onRunInference={openInferenceTarget} onProjectChange={updateProjectContext} onOpenLlm={() => navigate("llm")} />
    : activity === "model" ? <Suspense fallback={<LoadingState label="Loading graph workspace…" />}><ArchitectureView project={project!} /></Suspense>
    : activity === "llm" ? <LlmStudioView project={project!} onOpenTraining={() => navigate("runs")} />
    : activity === "runs" ? <RunsView project={project!} selectedRunId={activeDocument?.kind === "run" ? String((activeDocument.payload as RunRecord | undefined)?.id || "") : ""} onSelectRun={(run) => openObjectDocument(runDocument(project!, run))} onChooseTrainingTarget={() => navigate("data")} onProjectChange={setProject} onLogs={setLogs} compute={compute} onComputeChange={setCompute} />
    : activity === "inference" ? <InferenceView project={project!} inferenceTarget={inferenceTarget} onChooseTarget={() => navigate("data")} onClearTarget={() => setInferenceTarget(null)} onLogs={setLogs} compute={compute} onComputeChange={setCompute} />
    : activity === "jobs" ? <JobsView projects={projects} activeProjectId={project?.id || ""} onOpenJob={openJob} />
    : activity === "calibration" ? <CalibrationView project={project!} />
    : activity === "deploy" ? <DeployView project={project!} />
    : activity === "monitor" ? <DeployView project={project!} />
    : activity === "knowledge" ? <KnowledgeBaseView />
    : <SettingsView project={project!} compute={compute} onComputeChange={setCompute} cliffOpen={cliffOpen} bottomOpen={bottomOpen} onToggleCliff={toggleCliff} onToggleBottom={toggleBottom} />;

  return <div className="workbench-shell">
    <TitleBar projects={projects} project={project} activity={activity} productVersion={productVersion} user={(authentication?.user as Record<string, unknown>) || {}} compute={compute} onComputeChange={setCompute} onSelectProject={(id) => {setLauncherOpen(false); void selectProject(id);}} onRemoveProject={(item) => void removeProject(item)} onAddExisting={() => setExistingProjectOpen(true)} onSelectActivity={openWorkspace} onHome={() => setLauncherOpen(true)} onCommand={() => setCommandOpen(true)} onToggleCliff={toggleCliff} />
    <div className="workbench-body">
      <ActivityRail active={activity} showProviders={launcherOpen} onSelect={openWorkspace} onCommand={() => setCommandOpen(true)} />
      <Group orientation="horizontal" className="workspace-group" id="modelforge-main-workspace">
        <Panel id="workbench-center" minSize="520px" defaultSize="76%">
          <div className={`center-stack ${launcherOpen ? "launcher-stack" : ""}`}>
            {launcherOpen
              ? <div className="document-tabs" role="tablist"><button role="tab" aria-selected="true" className="active"><Home /><span>New Project</span></button></div>
              : <DocumentTabs documents={documents} activeKey={activeDocumentKey} onActivate={activateDocument} onClose={closeDocument} onNew={() => setCommandOpen(true)} />}
            <div className="document-host">{errorNotice}{content}</div>
            {!launcherOpen && activity !== "knowledge" && activity !== "jobs" && <BottomPanel logs={logs} open={bottomOpen} onToggle={toggleBottom} />}
          </div>
        </Panel>
        {!launcherOpen && activity !== "knowledge" && activity !== "jobs" && project && cliffOpen && <><Separator className="panel-separator" /><Panel id="cliff-inspector" minSize="280px" maxSize="520px" defaultSize="24%" collapsible><CliffPanel project={project} context={contextLabel} initialTurn={initialCliffTurn} onInitialTurnConsumed={(id) => setInitialCliffTurn((current) => current?.id === id ? null : current)} /></Panel></>}
      </Group>
    </div>
    <StatusBar project={project} activity={activity} productVersion={productVersion} />
    <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} onSelect={openWorkspace} />
    <ExistingProjectPicker open={existingProjectOpen} initialPath={String(project?.repository || "")} onOpenChange={setExistingProjectOpen} onRegistered={registerExistingProject} />
  </div>;
}

function CircleCheckIcon() { return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></svg>; }
