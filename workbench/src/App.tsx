import {useEffect, useMemo, useRef, useState} from "react";
import {AnnotationView, ModelView, TelemetryView} from "./LifecycleViews";
import {ApiError, api} from "./lib/api";
import type {ActivityId, Artifact, ExecutionTarget, ModalStatus, Project, Run, Sample} from "./types";

type Activity = {id: ActivityId; label: string; state: "ready" | "partial" | "unavailable"; reason?: string};
const destinations: Array<Pick<Activity, "id" | "label">> = [
  {id: "overview", label: "Overview"}, {id: "source", label: "Source"},
  {id: "dataset", label: "Dataset"}, {id: "annotation", label: "Annotation"},
  {id: "architecture", label: "Models / Architecture"}, {id: "training", label: "Training"},
  {id: "inference", label: "Inference"}, {id: "runs", label: "Jobs / Runs"},
  {id: "assistant", label: "ModelForge Coding Assistant"}, {id: "settings", label: "Settings"},
];
const unavailable: Record<ActivityId, string> = {
  overview: "", dataset: "", inference: "", runs: "", settings: "",
  source: "The public source inspection and editing service is not delivered in this alpha slice.",
  annotation: "The local annotation service is not delivered in this alpha slice.",
  architecture: "Only authored capabilities are available; safe model inspection is not delivered yet.",
  training: "Local training and held-out evaluation services are not delivered yet.",
  assistant: "The local Coding Assistant host and write-authority controls are not delivered yet.",
};

export function activitiesFor(project: Project | null): Activity[] {
  return destinations.map((item) => {
    if (item.id === "dataset") return {...item, state: project?.dataset ? "ready" : "unavailable", reason: project?.dataset ? undefined : "This project declares no browser dataset."};
    if (item.id === "inference") return {...item, state: project?.action && project.action.kind !== "training" ? "ready" : "unavailable", reason: "This project does not declare an inference or prompt action."};
    if (item.id === "annotation") return {...item, state: project?.features?.annotation ? "ready" : "unavailable", reason: unavailable.annotation};
    if (item.id === "architecture") return {...item, state: project?.features?.model_inspection ? "ready" : "partial", reason: unavailable.architecture};
    if (item.id === "training") return {...item, state: project?.features?.training ? "ready" : "unavailable", reason: unavailable.training};
    if (["overview", "runs", "settings"].includes(item.id)) return {...item, state: "ready"};
    return {...item, state: "unavailable", reason: unavailable[item.id]};
  });
}
export function runStatus(run: Run | null): string {
  if (!run) return "No run selected";
  if (run.runtime_observation?.state === "unavailable") return `${run.status} · unavailable`;
  const requested = Boolean(run.configuration?.cancellation_requested_at);
  const confirmed = Boolean(run.configuration?.cancellation_confirmed_at);
  return requested && !confirmed ? `${run.status} · cancellation requested` : run.status;
}
export function createLatestRequestGuard() {
  let current = 0;
  return {begin: () => ++current, isCurrent: (value: number) => value === current, invalidate: () => ++current};
}
export function tableProjection(value: unknown): {columns: string[]; rows: Record<string, unknown>[]} {
  const candidates = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.values(value).filter(Array.isArray)
      : [];
  const rawRows: unknown[] = (Array.isArray(value) ? candidates : candidates[0] || []).slice(0, 100);
  const rows: Record<string, unknown>[] = rawRows.map((row: unknown) => row && typeof row === "object" && !Array.isArray(row) ? row as Record<string, unknown> : {value: row});
  const columns: string[] = [...new Set(rows.flatMap((row: Record<string, unknown>) => Object.keys(row)))].slice(0, 20);
  return {columns, rows};
}
const fmtBytes = (value?: number) => value === undefined ? "size unavailable" : value < 1024 ? `${value} B` : `${(value / 1024).toFixed(1)} KiB`;
const errorText = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);
const isActive = (run: Run | null) => Boolean(run && ["queued", "running"].includes(run.status));
const isModal = (run: Run | null) => Boolean(run?.provider === "modal" || run?.configuration?.modal);

function Badge({children, tone = "neutral"}: {children: React.ReactNode; tone?: string}) { return <span className={`badge ${tone}`}>{children}</span>; }
function UnavailableView({activity}: {activity: Activity}) { return <section className="unavailable-view"><Badge tone={activity.state}>{activity.state}</Badge><h2>{activity.label}</h2><p>{activity.reason}</p><div className="boundary-note">No placeholder data or action is exposed. This destination remains visible to show intended local-product scope.</div></section>; }

export default function App() {
  const [validationSample, setValidationSample] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState(() => sessionStorage.getItem("modelforge.public-alpha.project") || "");
  const [project, setProject] = useState<Project | null>(null);
  const [activity, setActivity] = useState<ActivityId>(() => (sessionStorage.getItem("modelforge.public-alpha.activity") as ActivityId) || "overview");
  const [samples, setSamples] = useState<Sample[]>([]); const [sampleError, setSampleError] = useState("");
  const [selectedSample, setSelectedSample] = useState<Sample | null>(null); const [samplePreview, setSamplePreview] = useState("");
  const [runs, setRuns] = useState<Run[]>([]); const [currentRun, setCurrentRun] = useState<Run | null>(null);
  const [artifact, setArtifact] = useState<Artifact | null>(null); const [artifactPreview, setArtifactPreview] = useState(""); const [artifactText, setArtifactText] = useState(""); const [artifactJson, setArtifactJson] = useState<unknown>(null);
  const [runLog, setRunLog] = useState("");
  const [modal, setModal] = useState<ModalStatus | null>(null); const [connection, setConnection] = useState("Connecting");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [prompt, setPrompt] = useState("");
  const [target, setTarget] = useState<ExecutionTarget | null>(null); const [billable, setBillable] = useState(false);
  const selectionEpoch = useRef(0); const sampleUrl = useRef(""); const artifactUrl = useRef("");
  const projectHeading = useRef<HTMLHeadingElement>(null);
  const sampleGuard = useRef(createLatestRequestGuard()); const artifactGuard = useRef(createLatestRequestGuard());
  const sampleRequest = useRef<AbortController | null>(null); const artifactRequest = useRef<AbortController | null>(null); const logRequest = useRef<AbortController | null>(null);
  const activities = useMemo(() => activitiesFor(project), [project]);
  const activeActivity = activities.find((item) => item.id === activity) || activities[0];

  const clearSampleBlob = () => { if (sampleUrl.current) URL.revokeObjectURL(sampleUrl.current); sampleUrl.current = ""; setSamplePreview(""); };
  const clearArtifactBlob = () => { if (artifactUrl.current) URL.revokeObjectURL(artifactUrl.current); artifactUrl.current = ""; setArtifactPreview(""); setArtifactText(""); setArtifactJson(null); };

  useEffect(() => () => { sampleRequest.current?.abort(); artifactRequest.current?.abort(); logRequest.current?.abort(); if (sampleUrl.current) URL.revokeObjectURL(sampleUrl.current); if (artifactUrl.current) URL.revokeObjectURL(artifactUrl.current); }, []);
  useEffect(() => {
    const controller = new AbortController();
    api.projects(controller.signal).then(({projects: values}) => {
      setProjects(values); const wanted = values.some((item) => item.id === selectedId) ? selectedId : values[0]?.id || ""; setSelectedId(wanted);
      setConnection("Connected");
    }).catch((reason) => { if (reason.name !== "AbortError") { setError(errorText(reason)); setConnection("Disconnected"); } });
    api.modal(controller.signal).then(setModal).catch(() => setModal(null));
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!selectedId) { setProject(null); return; }
    const epoch = ++selectionEpoch.current; const controller = new AbortController();
    sessionStorage.setItem("modelforge.public-alpha.project", selectedId);
    sampleRequest.current?.abort(); artifactRequest.current?.abort(); logRequest.current?.abort(); sampleGuard.current.invalidate(); artifactGuard.current.invalidate();
    clearSampleBlob(); clearArtifactBlob(); setRunLog(""); setProject(null); setSamples([]); setSelectedSample(null); setRuns([]); setCurrentRun(null); setArtifact(null); setPrompt(""); setError(""); setSampleError(""); setBillable(false);
    Promise.all([api.project(selectedId, controller.signal), api.runs(selectedId, controller.signal)]).then(([detail, history]) => {
      if (selectionEpoch.current !== epoch) return;
      setProject(detail); setRuns(history.runs); setCurrentRun(history.runs[0] || null);
      const targets = detail.execution_targets || []; setTarget(targets.find((item) => item.readiness === "ready" && !item.billable) || targets[0] || null); setConnection("Connected");
      if (detail.dataset) api.samples(detail.id, detail.dataset.id, controller.signal).then((value) => {
        if (selectionEpoch.current !== epoch) return; setSamples(value.samples || value.items || []);
      }).catch((reason) => { if (reason.name !== "AbortError" && selectionEpoch.current === epoch) setSampleError(errorText(reason)); });
    }).catch((reason) => { if (reason.name !== "AbortError" && selectionEpoch.current === epoch) { setError(errorText(reason)); setConnection("Disconnected"); } });
    return () => controller.abort();
  }, [selectedId]);
  useEffect(() => {
    sessionStorage.setItem("modelforge.public-alpha.activity", activity);
  }, [activity]);
  useEffect(() => { if (project) projectHeading.current?.focus(); }, [project?.id]);
  useEffect(() => { artifactRequest.current?.abort(); artifactGuard.current.invalidate(); clearArtifactBlob(); setArtifact(null); }, [currentRun?.id]);
  useEffect(() => {
    logRequest.current?.abort(); setRunLog("");
    const log = currentRun?.artifacts?.find((item) => item.kind === "process-log");
    if (!currentRun || !log || currentRun.live?.log_tail) return;
    const runId = currentRun.id; const epoch = selectionEpoch.current; const controller = new AbortController(); logRequest.current = controller;
    api.artifact(runId, log.id, controller.signal).then((blob) => blob.text()).then((text) => {
      if (selectionEpoch.current === epoch && currentRun.id === runId && !controller.signal.aborted) setRunLog(text);
    }).catch((reason) => { if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(`Checked process log unavailable. ${errorText(reason)}`); });
    return () => controller.abort();
  }, [currentRun?.id, currentRun?.status, currentRun?.artifacts?.length]);
  useEffect(() => {
    if (!isActive(currentRun) || currentRun?.runtime_observation?.state === "unavailable") return;
    const expectedProject = project?.id; const controller = new AbortController();
    const timer = window.setInterval(() => api.run(currentRun!.id, controller.signal).then((next) => {
      if (next.project_id !== expectedProject) return; setCurrentRun(next); setRuns((values) => [next, ...values.filter((item) => item.id !== next.id)]); setConnection("Connected");
    }).catch((reason) => { if (reason.name !== "AbortError") setConnection("Reconnecting"); }), 700);
    return () => { controller.abort(); clearInterval(timer); };
  }, [currentRun?.id, currentRun?.status, currentRun?.runtime_observation?.state, project?.id]);

  async function chooseSample(value: Sample) {
    if (!project?.dataset) return; const epoch = selectionEpoch.current; sampleRequest.current?.abort(); const controller = new AbortController(); sampleRequest.current = controller; const request = sampleGuard.current.begin();
    setSelectedSample(value); clearSampleBlob(); setError("");
    try { const blob = await api.sampleContent(project.id, project.dataset.id, value.id, controller.signal); if (epoch !== selectionEpoch.current || !sampleGuard.current.isCurrent(request)) return; const url = URL.createObjectURL(blob); if (!sampleGuard.current.isCurrent(request)) { URL.revokeObjectURL(url); return; } sampleUrl.current = url; setSamplePreview(url); }
    catch (reason) { if (reason instanceof DOMException && reason.name === "AbortError") return; if (epoch === selectionEpoch.current && sampleGuard.current.isCurrent(request)) setError(`Checked sample preview unavailable. ${errorText(reason)}`); }
  }
  async function launch() {
    if (!project || !target) return; setBusy(true); setError("");
    const input = project.action.kind === "training" ? {dataset_id: project.dataset?.id, sample_id: selectedSample?.id, validation_sample_id: validationSample} : project.action.kind === "prompt" ? {messages: [{role: "user", content: prompt}], generation: {max_new_tokens: 256, temperature: 0, top_p: 1}} : selectedSample && project.dataset ? {dataset_id: project.dataset.id, sample_id: selectedSample.id} : {};
    const fingerprint = JSON.stringify({project: project.id, action: project.action.id, target: target.target, binding: target.binding_sha256 || null, input});
    const key = `modelforge.public-alpha.launch.${project.id}`; let idempotency = crypto.randomUUID();
    try { const saved = JSON.parse(sessionStorage.getItem(key) || "null"); if (saved?.fingerprint === fingerprint) idempotency = saved.idempotency; } catch { /* replace malformed tab state */ }
    sessionStorage.setItem(key, JSON.stringify({fingerprint, idempotency}));
    try {
      const run = await api.launch(project.id, project.action.id, {protocol: "modelforge.managed-action-request/v1", execution: {target: target.target, idempotency_key: idempotency, binding_sha256: target.binding_sha256 || null, billable_confirmed: Boolean(target.billable) && billable}, input});
      sessionStorage.removeItem(key); setCurrentRun(run); setRuns((values) => [run, ...values.filter((item) => item.id !== run.id)]); setActivity("runs"); if (target.billable) setBillable(false);
    } catch (reason) { if (reason instanceof ApiError && reason.status < 500) sessionStorage.removeItem(key); setError(`${errorText(reason)}${reason instanceof ApiError && reason.status < 500 ? "" : " The launch outcome may be unknown; retrying unchanged reuses the same identity."}`); }
    finally { setBusy(false); }
  }
  async function mutateRun(kind: "cancel" | "recover") { if (!currentRun) return; setBusy(true); setError(""); try { const next = await api[kind](currentRun.id); setCurrentRun(next); setRuns((values) => [next, ...values.filter((item) => item.id !== next.id)]); } catch (reason) { setError(errorText(reason)); } finally { setBusy(false); } }
  async function openArtifact(value: Artifact) {
    if (!currentRun) return; const epoch = selectionEpoch.current; const runId = currentRun.id; artifactRequest.current?.abort(); const controller = new AbortController(); artifactRequest.current = controller; const request = artifactGuard.current.begin(); setArtifact(value); clearArtifactBlob(); setError("");
    try { const blob = await api.artifact(runId, value.id, controller.signal); if (epoch !== selectionEpoch.current || !artifactGuard.current.isCurrent(request)) return; if (blob.type.startsWith("text/") || blob.type.includes("json")) { const text = await blob.text(); if (!artifactGuard.current.isCurrent(request)) return; if (value.kind === "table" && blob.type.includes("json")) setArtifactJson(JSON.parse(text)); else setArtifactText(text); } else { const url = URL.createObjectURL(blob); if (!artifactGuard.current.isCurrent(request)) { URL.revokeObjectURL(url); return; } artifactUrl.current = url; setArtifactPreview(url); } }
    catch (reason) { if (reason instanceof DOMException && reason.name === "AbortError") return; if (epoch === selectionEpoch.current && artifactGuard.current.isCurrent(request)) setError(`Checked artifact unavailable. ${errorText(reason)}`); }
  }
  async function downloadArtifact(value: Artifact) {
    if (!currentRun) return; try { const blob = await api.artifact(currentRun.id, value.id); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = value.name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0); } catch (reason) { setError(`Download unavailable. ${errorText(reason)}`); }
  }

  const targetReady = Boolean(target && (target.readiness === "ready" || target.ready));
  const needsInput = project?.action.kind === "training" ? !selectedSample || !validationSample : project?.action.kind === "prompt" ? !prompt.trim() : Boolean(samples.length && !selectedSample);
  const launchBlocked = !targetReady ? "Execution target unavailable" : needsInput ? `Select ${project?.action.kind === "prompt" ? "a prompt" : "a sample"}` : target?.billable && !billable ? "Confirm this billable target" : "";
  return <div className="app-shell">
    <a className="skip-link" href="#workspace">Skip to workspace</a>
    <header className="title-bar"><button className="brand" onClick={() => setActivity("overview")}><span className="brand-mark">M</span><span>Model<strong>Forge</strong></span><Badge tone="alpha">PUBLIC ALPHA</Badge></button><label className="project-select"><span>Project</span><select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{projects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><div className="connection" aria-live="polite"><i className={connection.toLowerCase()} />{connection}</div></header>
    <nav className="activity-rail" aria-label="Workbench destinations">{activities.map((item) => <button key={item.id} aria-current={activity === item.id ? "page" : undefined} onClick={() => setActivity(item.id)} title={item.reason || item.label}><span className="rail-icon" aria-hidden="true">{item.label.slice(0, 1)}</span><span>{item.label}</span>{item.state !== "ready" && <small>{item.state}</small>}</button>)}</nav>
    <div className="document-tabs" role="tablist" aria-label="Open workbench documents"><button role="tab" aria-selected="true">{activeActivity.label}</button></div>
    <main id="workspace" className="workspace" tabIndex={-1}><h1 className="project-heading" ref={projectHeading} tabIndex={-1}>{project?.name || "ModelForge public workbench"}</h1>{error && <div className="error" role="alert">{error}<button aria-label="Dismiss error" onClick={() => setError("")}>×</button></div>}{!project ? <div className="loading">Opening local project…</div> : activeActivity.state !== "ready" ? <UnavailableView activity={activeActivity} /> : activity === "overview" ? <Overview project={project} modal={modal} /> : activity === "dataset" ? <Dataset project={project} samples={samples} selected={selectedSample} preview={samplePreview} error={sampleError} onSelect={chooseSample} /> : activity === "annotation" ? <AnnotationView key={`${project.id}-${selectedSample?.id}`} project={project} sample={selectedSample} preview={samplePreview} /> : activity === "architecture" ? <ModelView project={project} /> : activity === "training" ? <><label>Validation sample<select aria-label="Validation sample" value={validationSample} onChange={event => setValidationSample(event.target.value)}><option value="">Select a validation sample</option>{samples.filter(item => ["val", "validation"].includes(item.split || "")).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><Action project={project} target={target} setTarget={setTarget} prompt={prompt} setPrompt={setPrompt} selectedSample={selectedSample} billable={billable} setBillable={setBillable} blocked={launchBlocked} busy={busy} onLaunch={launch} /><TelemetryView runs={runs} /></> : activity === "inference" ? <Action project={project} target={target} setTarget={setTarget} prompt={prompt} setPrompt={setPrompt} selectedSample={selectedSample} billable={billable} setBillable={setBillable} blocked={launchBlocked} busy={busy} onLaunch={launch} /> : activity === "runs" ? <><RunHistory runs={runs} current={currentRun} onSelect={setCurrentRun} />{artifactPreview && <section className="result-stage"><h2>{artifact?.name}</h2>{artifact?.content_type?.startsWith("video/") ? <video controls aria-label="Main result playback" src={artifactPreview} /> : artifact?.content_type?.startsWith("image/") ? <img src={artifactPreview} alt="Checked result" /> : null}</section>}<TelemetryView runs={runs} /></> : <Settings modal={modal} />}</main>
    <aside className="run-inspector" aria-label="Current run"><RunDetail run={currentRun} runLog={runLog} busy={busy} onCancel={() => mutateRun("cancel")} onRecover={() => mutateRun("recover")} onOpen={openArtifact} onDownload={downloadArtifact} artifact={artifact} artifactPreview={artifactPreview} artifactText={artifactText} artifactJson={artifactJson} /></aside>
    <footer className="status-bar"><span>{project?.name || "No project"}</span><span>{project?.runtime_readiness || "not evaluated"}</span><span>Local-only · Apache public boundary</span></footer>
  </div>;
}

function Overview({project, modal}: {project: Project; modal: ModalStatus | null}) { return <section><span className="eyebrow">Local project</span><h1 tabIndex={-1}>{project.name}</h1><p className="lead">{project.description}</p><div className="card-grid"><article className="card"><h2>Readiness</h2><Badge tone={project.runtime_readiness === "ready" ? "success" : "warning"}>{project.runtime_readiness || "not evaluated"}</Badge><p>{project.readiness_reasons?.join(" · ") || "No readiness blocker reported."}</p></article><article className="card"><h2>Capabilities</h2><ul>{project.capabilities?.map((item) => <li key={item}><code>{item}</code></li>)}</ul></article><article className="card"><h2>Optional Modal</h2><Badge>{modal?.state || "unavailable"}</Badge><p>{modal?.message || "Provider readiness could not be read."}</p></article></div><div className="boundary-note">Trusted local code runs with your operating-system permissions. ModelForge isolates owned outputs; it is not a sandbox.</div></section>; }
function Dataset({project, samples, selected, preview, error, onSelect}: {project: Project; samples: Sample[]; selected: Sample | null; preview: string; error: string; onSelect: (sample: Sample) => void}) { return <section><span className="eyebrow">Checked project input</span><h1>{project.dataset?.name || "Dataset"}</h1>{error && <div className="boundary-note">Catalog unavailable: {error}. The action may own a bundled input that needs no browser selection.</div>}<div className="split"><div className="sample-list" role="listbox" aria-label="Dataset samples">{samples.length ? samples.map((item) => <button key={item.id} role="option" aria-selected={selected?.id === item.id} onClick={() => onSelect(item)}><strong>{item.name || item.id}</strong><small>{item.content_type || "unknown type"} · {item.split || "unspecified split"} · {fmtBytes(item.size_bytes)}</small><code>{item.sha256 || "digest unavailable"}</code></button>) : <p className="empty">No browser-selectable samples were returned.</p>}</div><div className="preview">{preview && selected?.content_type?.startsWith("video/") ? <video controls src={preview} /> : preview && selected?.content_type?.startsWith("image/") ? <img src={preview} alt={`Checked preview of ${selected.name || selected.id}`} /> : <p className="empty">Choose a sample to fetch its authenticated checked content.</p>}</div></div></section>; }
function Action({project, target, setTarget, prompt, setPrompt, selectedSample, billable, setBillable, blocked, busy, onLaunch}: {project: Project; target: ExecutionTarget | null; setTarget: (value: ExecutionTarget | null) => void; prompt: string; setPrompt: (value: string) => void; selectedSample: Sample | null; billable: boolean; setBillable: (value: boolean) => void; blocked: string; busy: boolean; onLaunch: () => void}) { const targets = project.execution_targets || []; return <section><span className="eyebrow">Managed action</span><h1>{project.action.kind === "training" ? "Training" : project.action.kind === "prompt" ? "Prompt" : "Inference"}</h1><div className="form-card"><label><span>Execution target</span><select value={target?.target || ""} onChange={(event) => {setTarget(targets.find((item) => item.target === event.target.value) || null); setBillable(false);}}>{targets.map((item) => <option key={item.target} value={item.target}>{item.target} · {item.readiness || "unknown"}{item.billable ? " · billable" : ""}</option>)}</select></label>{project.action.kind === "prompt" ? <label><span>Prompt</span><textarea rows={8} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Enter the user prompt" /></label> : <div><span className="label">Selected input</span><p>{selectedSample ? selectedSample.name || selectedSample.id : "No browser sample selected; the server will accept only actions with an owned implicit input."}</p></div>}{target?.billable && <label className="check"><input type="checkbox" checked={billable} onChange={(event) => setBillable(event.target.checked)} /><span>I confirm this exact user-owned Modal binding may incur charges.</span></label>}<button className="primary" disabled={Boolean(blocked) || busy} onClick={onLaunch}>{busy ? "Starting…" : project.action.display_name || "Start managed action"}</button>{blocked && <p className="blocker">{blocked}</p>}<dl><div><dt>Binding</dt><dd><code>{target?.binding_sha256 || "local target"}</code></dd></div><div><dt>Environment</dt><dd>{target?.environment || "local"}</dd></div></dl></div></section>; }
function RunHistory({runs, current, onSelect}: {runs: Run[]; current: Run | null; onSelect: (run: Run) => void}) { return <section><span className="eyebrow">Durable server truth</span><h1>Jobs / Runs</h1><div className="run-list">{runs.map((run) => <button key={run.id} aria-pressed={run.id === current?.id} onClick={() => onSelect(run)}><span><strong>{runStatus(run)}</strong><small>{run.created_at || "time unavailable"}</small></span><code>{run.id}</code></button>)}{!runs.length && <p className="empty">No runs exist for this project.</p>}</div></section>; }
function Settings({modal}: {modal: ModalStatus | null}) { return <section><span className="eyebrow">Read-only local status</span><h1>Settings</h1><div className="card"><h2>Browser security</h2><p>Bearer authentication is held in this tab’s session storage. Host, mutation Origin, CSP, and no-CORS controls are enforced by the loopback server.</p></div><div className="card"><h2>Modal readiness</h2><Badge>{modal?.state || "unavailable"}</Badge><p>{modal?.message || "Status unavailable."}</p><a href="/modal-setup.html" target="_blank" rel="noreferrer">Open owner setup guide</a></div><div className="boundary-note">Credential editing and filesystem settings are not exposed in the browser.</div></section>; }
function TablePreview({value, name}: {value: unknown; name: string}) { const {columns, rows} = tableProjection(value); if (!rows.length || !columns.length) return <pre aria-label={`Checked table result ${name}`}>{JSON.stringify(value, null, 2)}</pre>; return <div className="result-table-scroll"><table><caption>{name}</caption><thead><tr>{columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map((column) => { const value = row[column]; return <td key={column}>{value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value)}</td>; })}</tr>)}</tbody></table></div>; }
function RunDetail({run, runLog, busy, onCancel, onRecover, onOpen, onDownload, artifact, artifactPreview, artifactText, artifactJson}: {run: Run | null; runLog: string; busy: boolean; onCancel: () => void; onRecover: () => void; onOpen: (artifact: Artifact) => void; onDownload: (artifact: Artifact) => void; artifact: Artifact | null; artifactPreview: string; artifactText: string; artifactJson: unknown}) { const stale = run?.runtime_observation?.state === "unavailable"; const recoverable = Boolean(run && isModal(run) && stale && isActive(run)); return <><header><span className="eyebrow">Current run</span><Badge tone={run?.status === "failed" ? "error" : isActive(run) && !stale ? "running" : "neutral"}>{runStatus(run)}</Badge></header><div className="run-live" aria-live="polite">{run ? <><code>{run.id}</code>{run.error && <p className="failure">{run.error}</p>}<p>{stale ? run.runtime_observation?.reason : run.live?.progress ? `${run.live.progress.stage || "running"} · ${run.live.progress.percent ?? "?"}%` : "No live progress reported."}</p>{isActive(run) && !stale && <button disabled={busy} onClick={onCancel}>Request cancellation</button>}{recoverable && <button disabled={busy} onClick={onRecover}>Recover exact Modal call</button>}</> : <p className="empty">Start or select a project run.</p>}</div><section className="logs" aria-label="Run log"><h2>Output</h2><pre>{run?.live?.log_tail || runLog || "No live log attached."}</pre></section><section className="artifacts"><h2>Checked artifacts</h2>{run?.artifacts?.map((item) => <div key={item.id}><button onClick={() => onOpen(item)}><strong>{item.name}</strong><small>{item.kind || item.content_type || "artifact"}</small></button><button className="download" aria-label={`Download ${item.name}`} onClick={() => onDownload(item)}>↓</button></div>)}{artifact && <div className="artifact-preview"><h3>{artifact.name}</h3>{artifactJson !== null ? <TablePreview value={artifactJson} name={artifact.name} /> : artifactText ? <pre aria-label={artifact.kind === "assistant-text" ? "Checked assistant response" : `Checked text artifact ${artifact.name}`}>{artifactText}</pre> : artifactPreview && artifact.content_type?.startsWith("video/") ? <video controls aria-label={`${artifact.name} result preview`} src={artifactPreview} /> : artifactPreview && artifact.content_type?.startsWith("image/") ? <img src={artifactPreview} alt={`Checked artifact ${artifact.name}`} /> : <p className="empty">No inline preview for this checked artifact type.</p>}</div>}</section></>; }
