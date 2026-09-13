import {lazy, Suspense, useEffect, useMemo, useState} from "react";
import {BarChart3, ChevronDown, ChevronRight, Database, ExternalLink, File, FileArchive, Folder, GitCompareArrows, Play, RefreshCw, Search, Square, X} from "lucide-react";
import {api} from "../lib/api";
import {formatBytes, formatDate, humanize, runConfiguration, runMetricSeries, statusTone} from "../lib/utils";
import type {JsonMap, ModelArtifact, Project, RunRecord, TrainingTarget} from "../types";
import {useRequest} from "../hooks/use-request";
import {Badge, Button, Card, EmptyState, ErrorNotice, IconButton, LoadingState, Modal, ProgressBar, SectionHeader} from "../components/ui";
import {ComputeTargetPicker, type ComputeSelection} from "../components/ComputeTargetPicker";

const ComparisonChart = lazy(() => import("./RunComparisonChart"));

function selectedTrainingTarget(project: Project): TrainingTarget {
  const datasetRoot = String(project.selected_dataset || project.default_dataset || "");
  return project.training_target?.dataset_root === datasetRoot
    ? project.training_target
    : {kind: "dataset", dataset_root: datasetRoot, path: ".", name: datasetRoot.split(/[\\/]/).filter(Boolean).at(-1) || "Selected dataset"};
}

type TrainingCheckpointChoice = {
  path: string;
  name: string;
  source: string;
  recommended: boolean;
};

export function isLocalComputeTarget(target: unknown): boolean {
  return target === "local" || target === "cpu" || target === "gpu";
}

export function trainingActionCheckpointMode(actionValue: unknown): {consumed: boolean; required: boolean} {
  const action = actionValue && typeof actionValue === "object" && !Array.isArray(actionValue) ? actionValue as JsonMap : {};
  const environment = action.environment && typeof action.environment === "object" && !Array.isArray(action.environment) ? action.environment as JsonMap : {};
  const templates = [
    ...(Array.isArray(action.arguments) ? action.arguments : []),
    ...Object.values(environment),
  ].map(String);
  return {
    consumed: templates.some((value) => value.includes("{checkpoint}")) || templates.some((value) => value.includes("{checkpoint?}")),
    required: templates.some((value) => value.includes("{checkpoint}")),
  };
}

export function trainingCheckpointChoices(project: Project): TrainingCheckpointChoice[] {
  const found = new Map<string, TrainingCheckpointChoice>();
  for (const raw of project.training_checkpoints || []) {
    const path = String(raw.path || "").trim();
    if (!path) continue;
    const previous = found.get(path);
    found.set(path, {
      path,
      name: String(previous?.name || raw.name || raw.filename || path.split(/[\\/]/).filter(Boolean).at(-1) || "Checkpoint"),
      source: String(previous?.source || raw.source || "registered"),
      recommended: Boolean(previous?.recommended || raw.recommended === true),
    });
  }
  return [...found.values()];
}

function TrainingTargetSummary({project, onChoose}: {project: Project; onChoose: () => void}) {
  const target = selectedTrainingTarget(project);
  const icon = target.kind === "folder" ? <Folder size={18} /> : target.kind === "artifact" ? <File size={18} /> : <Database size={18} />;
  return <section className="training-target-summary" aria-label="Selected training target"><span className="training-target-icon">{icon}</span><div><small>Training target · {humanize(target.kind)}</small><strong>{target.name}</strong><span title={target.path === "." ? target.dataset_root : target.path}>{target.path === "." ? target.dataset_root : target.path}</span></div><Badge tone="success">Bound</Badge><Button size="sm" onClick={onChoose}>Change in Datasets</Button></section>;
}

function evidenceRuns(project: Project): RunRecord[] {
  return (project.model_artifacts || []).flatMap((artifact: ModelArtifact) => {
    const base = String(artifact.id || artifact.filename || "artifact");
    const rows: RunRecord[] = [];
    if (artifact.validation?.metrics) rows.push({id: `${base}-validation`, name: `${artifact.filename || base} · validation`, status: artifact.validation.passed ? "completed" : "failed", metrics: artifact.validation.metrics, model: artifact.filename, evidence_kind: "validation", artifacts: [artifact]});
    if (artifact.evaluation?.metrics) rows.push({id: `${base}-evaluation`, name: `${artifact.filename || base} · frozen evaluation`, status: artifact.evaluation.passed ? "completed" : "failed", metrics: artifact.evaluation.metrics, model: artifact.filename, evidence_kind: "frozen evaluation", artifacts: [artifact]});
    return rows;
  });
}

function metricValue(value: unknown): string {
  const number = Number(value);
  if (Number.isFinite(number)) return Math.abs(number) < 10 ? number.toFixed(4).replace(/0+$/, "").replace(/\.$/, "") : number.toLocaleString(undefined, {maximumFractionDigits: 2});
  return typeof value === "string" ? value : "—";
}

export function loopbackTensorBoardUrl(value: unknown): string {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname) ? url.href : "";
  } catch {
    return "";
  }
}

export function tensorBoardVisibleForRun(state: JsonMap, runId: string): boolean {
  const retainedRunId = String(state.tensorboard_run_id || "");
  return Boolean(
    (state.tensorboard_running || state.tensorboard_ready)
    && (!retainedRunId || retainedRunId === runId)
  );
}

function TensorBoardPanel({state, run, onStop}: {state: JsonMap; run: RunRecord | null; onStop: () => void}) {
  const [expanded, setExpanded] = useState(true);
  const ready = state.tensorboard_ready === true;
  const running = state.tensorboard_running === true;
  const url = ready ? loopbackTensorBoardUrl(state.tensorboard_url) : "";
  if (!running && !url) return null;
  const historic = Boolean(state.tensorboard_run_id);
  return <section className={`tensorboard-panel${expanded ? " expanded" : ""}`} aria-label="TensorBoard dashboard">
    <header><div><BarChart3 size={16} /><div><strong>TensorBoard{historic && run ? ` · ${run.name || run.id}` : ""}</strong><small>{url ? historic ? "Retained scalar, graph, distribution, and profiler evidence" : "Live scalar, graph, distribution, and profiler evidence" : "Starting the local dashboard…"}</small></div></div><div className="tensorboard-actions"><Badge tone={url ? "success" : "active"}>{url ? historic ? "Historic" : "Live" : "Starting"}</Badge>{url && <a className="mf-button mf-button-secondary mf-button-sm" href={url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open in new tab</a>}<Button size="sm" variant="ghost" onClick={() => setExpanded((current) => !current)}><ChevronDown className={expanded ? "is-expanded" : ""} size={14} /> {expanded ? "Collapse" : "Expand"}</Button><Button size="sm" variant="ghost" onClick={onStop}>Stop TensorBoard</Button></div></header>
    {expanded && (url ? <iframe src={url} title="TensorBoard" referrerPolicy="no-referrer" /> : <LoadingState label="Starting TensorBoard…" />)}
  </section>;
}

function RunDetails({run, onReplayTensorBoard, replaying, trainingActive}: {run: RunRecord; onReplayTensorBoard: (run: RunRecord) => void; replaying: boolean; trainingActive: boolean}) {
  const configuration = runConfiguration(run);
  const metrics = Object.entries(run.metrics || {}).filter(([, value]) => (typeof value === "number" || (typeof value === "string" && value.trim())) && Number.isFinite(Number(value)));
  const metricSeries = useMemo(() => runMetricSeries(run), [run]);
  const metricNames = Object.keys(metricSeries);
  const [metric, setMetric] = useState("");
  useEffect(() => { if (!metricNames.includes(metric)) setMetric(metricNames[0] || ""); }, [metric, metricNames.join("|")]);
  const artifacts = [...(run.weights || []), ...(run.visual_artifacts || []), ...(run.artifacts || [])];
  return <div className="run-detail document-scroll">
    <SectionHeader eyebrow={humanize(run.evidence_kind || run.workflow || "Recorded run")} title={run.name || run.id} description={`${run.provider || "Local"} · ${formatDate(run.modified)}`} actions={<Badge tone={statusTone(run.status)}>{humanize(run.status || "Unknown")}</Badge>} />
    <Card className="retained-tensorboard-card"><div><BarChart3 size={16} /><div><strong>{Number(run.tensorboard_events || 0) > 0 ? "TensorBoard event history" : "TensorBoard history unavailable"}</strong><small>{Number(run.tensorboard_events || 0) > 0 ? `${Number(run.tensorboard_events)} retained event ${Number(run.tensorboard_events) === 1 ? "file" : "files"}` : "This run did not retain a local TensorBoard event log."}</small></div></div>{run.tensorboard_replay_available ? <Button size="sm" busy={replaying} disabled={trainingActive} onClick={() => onReplayTensorBoard(run)}><Play size={13} fill="currentColor" /> {trainingActive ? "Live session active" : "Open TensorBoard"}</Button> : <Badge>{Number(run.tensorboard_events || 0) > 0 ? "Recorded charts available below" : "Not recorded"}</Badge>}</Card>
    <div className="run-metric-grid">{metrics.slice(0, 12).map(([name, value]) => <Card key={name}><span>{humanize(name)}</span><strong>{metricValue(value)}</strong><small>Recorded terminal value</small></Card>)}{!metrics.length && <EmptyState icon={<BarChart3 />} title="No scalar metrics" description="This run did not retain scalar metric evidence." />}</div>
    <Card className="comparison-chart-card run-history-card"><div className="chart-heading"><div><BarChart3 size={16} /><strong>Recorded metric history</strong></div>{metricNames.length ? <select value={metric} onChange={(event) => setMetric(event.target.value)} aria-label="Run metric"><option value="" disabled>Select a metric</option>{metricNames.map((name) => <option key={name} value={name}>{humanize(name)}</option>)}</select> : <Badge>0 recorded metrics</Badge>}</div>{metric ? <Suspense fallback={<LoadingState label="Loading metric chart…" />}><ComparisonChart runs={[run]} metric={metric} /></Suspense> : <EmptyState icon={<BarChart3 />} title="No recorded metric history" description="This run retained no scalar series or terminal metric values to graph." />}</Card>
    <div className="run-detail-columns">
      <Card><h3>Resolved configuration</h3><dl className="detail-list">{Object.entries(configuration).map(([key, value]) => <div key={key}><dt>{humanize(key)}</dt><dd>{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd></div>)}</dl></Card>
      <Card><h3>Artifacts and checkpoints</h3><div className="run-artifact-list">{artifacts.map((artifact, index) => { const row = artifact as Record<string, unknown>; const href = String(row.download_url || row.view_url || ""); return <a key={`${String(row.id || row.path || row.name)}-${index}`} href={href || undefined} target={href ? "_blank" : undefined} rel="noreferrer"><FileArchive size={14} /><div><strong>{String(row.name || row.filename || row.path || `Artifact ${index + 1}`)}</strong><span>{humanize(row.kind || "artifact")} · {formatBytes(Number(row.size_bytes || row.bytes || row.size || 0))}</span></div><ChevronRight size={14} /></a>; })}{!artifacts.length && <span className="quiet-state">No artifact references were retained for this run.</span>}</div></Card>
    </div>
    {run.error && <ErrorNotice message={run.error} />}
  </div>;
}

function CompareView({runs, onRemove}: {runs: RunRecord[]; onRemove: (id: string) => void}) {
  const metricNames = useMemo(() => [...new Set(runs.flatMap((run) => Object.keys(runMetricSeries(run))))], [runs]);
  const [metric, setMetric] = useState("");
  useEffect(() => { if (!metricNames.includes(metric)) setMetric(metricNames[0] || ""); }, [metricNames.join("|")]);
  const configurations = runs.map((run) => runConfiguration(run));
  const configurationKeys = [...new Set(configurations.flatMap(Object.keys))];
  const changedKeys = configurationKeys.filter((key) => new Set(configurations.map((config) => JSON.stringify(config[key] ?? null))).size > 1);
  return <div className="compare-view document-scroll">
    <SectionHeader eyebrow="Run comparison" title={`Compare ${runs.length} recorded results`} description="Curves use recorded values only; missing and terminal-only evidence remains explicit." actions={<select value={metric} onChange={(event) => setMetric(event.target.value)} aria-label="Comparison metric">{metricNames.map((name) => <option key={name} value={name}>{humanize(name)}</option>)}</select>} />
    <div className="compare-run-chips">{runs.map((run) => <span key={run.id}><i />{run.name || run.id}<button aria-label={`Remove ${run.name || run.id}`} onClick={() => onRemove(run.id)}><X size={12} /></button></span>)}</div>
    <Card className="comparison-chart-card"><div className="chart-heading"><div><BarChart3 size={16} /><strong>{humanize(metric || "Metric")}</strong></div><Badge>{metricNames.length} recorded metrics</Badge></div>{metric ? <Suspense fallback={<LoadingState label="Loading comparison chart…" />}><ComparisonChart runs={runs} metric={metric} /></Suspense> : <EmptyState icon={<BarChart3 />} title="No common scalar evidence" description="Select runs that retained metric values or metric series." />}</Card>
    <Card className="comparison-table-card"><h3>Metric summary</h3><div className="comparison-table-scroll"><table><thead><tr><th>Metric</th>{runs.map((run) => <th key={run.id}>{run.name || run.id}</th>)}</tr></thead><tbody>{metricNames.map((name) => <tr key={name}><th>{humanize(name)}</th>{runs.map((run) => { const points = runMetricSeries(run)[name] || []; return <td key={run.id}>{points.length ? metricValue(points[points.length - 1].value) : <span className="missing-value">Missing</span>}</td>; })}</tr>)}</tbody></table></div></Card>
    <Card className="comparison-table-card"><h3>Changed configuration</h3><div className="comparison-table-scroll"><table><thead><tr><th>Parameter</th>{runs.map((run) => <th key={run.id}>{run.name || run.id}</th>)}</tr></thead><tbody>{changedKeys.map((key) => <tr key={key}><th>{humanize(key)}</th>{configurations.map((configuration, index) => <td key={runs[index].id}><code>{configuration[key] === undefined ? "—" : typeof configuration[key] === "object" ? JSON.stringify(configuration[key]) : String(configuration[key])}</code></td>)}</tr>)}</tbody></table>{!changedKeys.length && <span className="quiet-state">The selected runs have no differing recorded configuration fields.</span>}</div></Card>
  </div>;
}

function RunLauncher({project, descriptor, open, onOpenChange, onStarted, onProjectChange, compute, onComputeChange}: {project: Project; descriptor: JsonMap | null; open: boolean; onOpenChange: (open: boolean) => void; onStarted: (status: JsonMap) => void; onProjectChange: (project: Project) => void; compute: ComputeSelection; onComputeChange: (selection: ComputeSelection) => void}) {
  const [epochs, setEpochs] = useState(1);
  const [batch, setBatch] = useState(1);
  const [learningRate, setLearningRate] = useState(.001);
  const [device, setDevice] = useState("auto");
  const [maxBatches, setMaxBatches] = useState(0);
  const [cloudDataset, setCloudDataset] = useState("");
  const [checkpoint, setCheckpoint] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cloudDatasets = useRequest(() => api.cloudDatasets(), [project.id]);
  const systemMetrics = useRequest(() => api.systemMetrics(), []);
  const registeredCloudDatasets = (Array.isArray(cloudDatasets.data?.datasets) ? cloudDatasets.data.datasets : []) as JsonMap[];
  const cloudMetrics = (systemMetrics.data?.cloud && typeof systemMetrics.data.cloud === "object" ? systemMetrics.data.cloud : {}) as JsonMap;
  const localDatasetStaging = cloudMetrics.local_dataset_staging === true;
  const runtimeActions = project.runtime && typeof project.runtime === "object" ? (project.runtime.actions as JsonMap | undefined) : undefined;
  const trainingAction = runtimeActions?.training;
  const checkpointMode = trainingActionCheckpointMode(trainingAction);
  const checkpointChoices = trainingCheckpointChoices(project);
  const checkpointChoiceKey = checkpointChoices.map((item) => `${item.path}:${item.recommended}`).join("|");
  const checkpointAvailable = checkpointChoices.some((item) => item.path === checkpoint);
  const localCompute = isLocalComputeTarget(compute.target);
  const localCheckpointRequired = localCompute && checkpointMode.required;
  useEffect(() => {
    setCheckpoint((current) => checkpointChoices.some((item) => item.path === current)
      ? current
      : checkpointChoices.find((item) => item.recommended)?.path || checkpointChoices[0]?.path || "");
  }, [project.id, checkpointChoiceKey]);
  const adapterReady = Boolean((project.adapters as JsonMap | undefined)?.training_command || runtimeActions?.training);
  const descriptorReady = descriptor?.training_ready === true;
  const useArchitectureWorkflow = descriptorReady && !adapterReady;
  const ready = descriptorReady || adapterReady;
  const trainingTarget = selectedTrainingTarget(project);
  const targetReady = trainingTarget.kind === "dataset" ? ready : adapterReady;
  const targetedCloudUnsupported = compute.target === "cloud" && trainingTarget.kind !== "dataset";
  const architecture = (descriptor?.architecture && typeof descriptor.architecture === "object" ? descriptor.architecture : {}) as JsonMap;
  const task = (descriptor?.task_contract && typeof descriptor.task_contract === "object" ? descriptor.task_contract : {}) as JsonMap;
  const useCompleteDataset = async () => {
    const datasetRoot = String(project.selected_dataset || project.default_dataset || "");
    if (!datasetRoot) return;
    setBusy(true); setError("");
    try {
      const name = datasetRoot.split(/[\\/]/).filter(Boolean).at(-1) || "Selected dataset";
      onProjectChange(await api.selectTrainingTarget(project.id, {kind: "dataset", dataset_root: datasetRoot, path: ".", name}));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const launch = async () => {
    const selectedDataset = String(project.selected_dataset || project.default_dataset || "");
    if (!targetReady || targetedCloudUnsupported || (localCheckpointRequired && !checkpointAvailable) || (compute.target === "cloud" && !cloudDataset && (!localDatasetStaging || !selectedDataset))) return;
    setBusy(true); setError("");
    try {
      const repository = String((descriptor?.project as JsonMap | undefined)?.repository || project.repository || "").replace(/\/$/, "");
      const common = {compute_target: compute.target, modal_gpu: compute.target === "cloud" ? compute.modalGpu : undefined, epochs, batch, workers: 0, device: compute.device === "auto" ? device : compute.device, learning_rate: learningRate, max_batches: maxBatches, training_target: trainingTarget, weights: localCompute && checkpointAvailable ? checkpoint : undefined};
      const configuration = useArchitectureWorkflow && trainingTarget.kind === "dataset" ? {
        ...common, workflow: "architecture", architecture: descriptor?.architecture_path, architecture_version: project.active_model_version || "",
        dataset: descriptor?.dataset_path, project: `${repository}/.modelforge/runs`, task_contract: descriptor?.task_contract_path,
        name: `${String(task.id || architecture.name || "architecture-training")}-run`.replace(/[^A-Za-z0-9_.-]/g, "-"),
        dataset_profile: project.active_dataset_profile || project.default_dataset_profile || "", source: "architecture",
      } : {
        ...common,
        dataset_root: compute.target === "cloud" && cloudDataset ? undefined : selectedDataset,
        dataset_ref: compute.target === "cloud" ? cloudDataset : undefined,
        name: `${project.id}-workbench-run`, model: "official", detector_cook_epochs: epochs, motr_epochs: epochs,
        imgsz: 640, fraction: 1, source: "workbench",
      };
      const result = await api.startTraining(configuration);
      onStarted(result); onOpenChange(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return <Modal open={open} onOpenChange={onOpenChange} title="Start a registered training run" description="ModelForge validates the selected target, registered project trainer, compute target, and server-owned output root before execution."><div className="run-launcher">{!targetReady && <ErrorNotice message={trainingTarget.kind !== "dataset" ? "This project needs a registered training adapter to consume a folder or artifact target." : String(descriptor?.training_unavailable_reason || "This project does not expose a compatible registered training action.")} />}{targetedCloudUnsupported && <ErrorNotice message="Folder and artifact training targets are local inputs. Select the complete dataset for cloud training." action={<Button size="sm" busy={busy} onClick={() => void useCompleteDataset()}>Use complete dataset</Button>} />}{localCheckpointRequired && !checkpointChoices.length && <ErrorNotice message="This trainer needs a base checkpoint, but no project-owned model or completed-run checkpoint is available." />}{error && <ErrorNotice message={error} />}<div className="selected-context-card"><span>Training target · {humanize(trainingTarget.kind)}</span><strong>{trainingTarget.name}</strong><small>{trainingTarget.path === "." ? trainingTarget.dataset_root : trainingTarget.path}</small></div><ComputeTargetPicker value={compute} onChange={onComputeChange} disabled={busy} />{localCompute && checkpointMode.consumed && <label className="training-checkpoint-field"><span>Starting model (checkpoint)</span><select aria-label="Training base checkpoint" value={checkpointAvailable ? checkpoint : ""} onChange={(event) => setCheckpoint(event.target.value)} disabled={busy}><option value="">Select a project checkpoint…</option>{checkpointChoices.map((item) => <option key={item.path} value={item.path}>{item.name} · {humanize(item.source)}{item.recommended ? " · recommended" : ""}</option>)}</select><small title={checkpointAvailable ? checkpoint : ""}>{checkpointAvailable ? checkpoint : "Training starts from this model's saved weights and tokenizer state."}</small></label>}{compute.target === "cloud" && <label className="cloud-dataset-field"><span>Cloud dataset source</span><select aria-label="Cloud training dataset" value={cloudDataset} onChange={(event) => setCloudDataset(event.target.value)}><option value="">{localDatasetStaging ? "Stage the selected local dataset automatically" : "Select an uploaded dataset…"}</option>{registeredCloudDatasets.map((item) => <option key={String(item.dataset_ref || item.id)} value={String(item.dataset_ref || item.id)}>{String(item.name || item.dataset_ref || item.id)}</option>)}</select><small>{localDatasetStaging ? "ModelForge validates and uploads the selected dataset with the existing local Modal login." : "Hosted training accepts a project-bound immutable upload."}</small></label>}<div className="run-launch-grid"><label><span>Epochs per stage</span><input type="number" min="1" value={epochs} onChange={(event) => setEpochs(Number(event.target.value))} /></label><label><span>Batch size</span><input type="number" min="-1" value={batch} onChange={(event) => setBatch(Number(event.target.value))} /><small>Use -1 when the project trainer supports auto-batching.</small></label><label><span>Learning rate</span><input type="number" min="0.000001" step="0.0001" value={learningRate} onChange={(event) => setLearningRate(Number(event.target.value))} /></label><label><span>Runtime device override</span><select value={device} onChange={(event) => setDevice(event.target.value)} disabled={compute.target !== "local"}><option value="auto">Automatic</option><option value="cpu">CPU</option><option value="0">CUDA device 0</option></select></label><label><span>Maximum batches</span><input aria-label="Maximum training batches" type="number" min="0" value={maxBatches} onChange={(event) => setMaxBatches(Number(event.target.value))} /><small>0 uses the complete selected target.</small></label></div><div className="modal-actions"><Button onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" busy={busy} disabled={!targetReady || targetedCloudUnsupported || (localCheckpointRequired && !checkpointAvailable) || !String(project.selected_dataset || project.default_dataset || cloudDataset) || (compute.target === "cloud" && !cloudDataset && !localDatasetStaging)} onClick={() => void launch()}><Play size={14} fill="currentColor" /> Validate and start training</Button></div></div></Modal>;
}

export function RunsView({project, selectedRunId = "", onSelectRun, onChooseTrainingTarget, onProjectChange, onLogs, compute, onComputeChange}: {project: Project; selectedRunId?: string; onSelectRun?: (run: RunRecord) => void; onChooseTrainingTarget: () => void; onProjectChange: (project: Project) => void; onLogs: (lines: string[]) => void; compute: ComputeSelection; onComputeChange: (selection: ComputeSelection) => void}) {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [selectedRun, setSelectedRun] = useState<RunRecord | null>(null);
  const [comparison, setComparison] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [launcherOpen, setLauncherOpen] = useState(false);
  const [trainingState, setTrainingState] = useState<JsonMap>({});
  const [replayingTensorBoard, setReplayingTensorBoard] = useState("");
  const descriptor = useRequest(async () => { const standard = await api.architecture(); return standard.available === false ? api.runtimeArchitecture() : standard; }, [project.id, project.selected_dataset]);
  const load = async () => {
    setLoading(true); setError("");
    try {
      const datasetPath = String(project.selected_dataset || project.default_dataset || "");
      const runsRequest = datasetPath ? api.runs(datasetPath).catch(() => api.runs()) : api.runs();
      const [response, active] = await Promise.all([runsRequest, api.trainingStatus().catch(() => ({} as Record<string, unknown>))]);
      const descriptorRuns = Array.isArray(descriptor.data?.training_runs) ? descriptor.data.training_runs as RunRecord[] : [];
      const combined = [...(response.training_runs || []), ...descriptorRuns, ...evidenceRuns(project)];
      const identified = combined.map((run) => ({...run, id: String(run.id || run.relative_path || run.path || run.name)}));
      const unique = [...new Map(identified.map((run) => [run.id, run])).values()];
      setRuns(unique);
      setSelectedRun((current) => current
        ? unique.find((run) => run.id === current.id) || unique[0] || null
        : unique.find((run) => run.id === selectedRunId) || unique[0] || null);
      setTrainingState(active as JsonMap);
      const log = (active as Record<string, unknown>).log as Record<string, unknown> | undefined;
      if (Array.isArray(log?.lines)) onLogs(log.lines.map(String));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  };
  useEffect(() => { setRuns([]); setSelectedRun(null); setComparison(new Set()); void load(); }, [project.id, project.selected_dataset, descriptor.data]);
  useEffect(() => { if (!trainingState.running && !(trainingState.tensorboard_running && !trainingState.tensorboard_ready)) return; const timer = window.setInterval(() => void load(), 1500); return () => window.clearInterval(timer); }, [Boolean(trainingState.running), Boolean(trainingState.tensorboard_running), Boolean(trainingState.tensorboard_ready), project.id]);
  useEffect(() => {
    if (!selectedRunId) return;
    const selected = runs.find((run) => run.id === selectedRunId);
    if (selected && selectedRun?.id !== selected.id) setSelectedRun(selected);
  }, [selectedRunId, runs]);
  useEffect(() => { if (selectedRun) onSelectRun?.(selectedRun); }, [selectedRun?.id]);
  const filtered = runs.filter((run) => (!search || `${run.name} ${run.id} ${run.model}`.toLowerCase().includes(search.toLowerCase())) && (status === "all" || run.status === status));
  const compared = runs.filter((run) => comparison.has(run.id));
  const trainingProgress = trainingState.progress && typeof trainingState.progress === "object" ? trainingState.progress as JsonMap : {};
  const trainingConfiguration = trainingState.configuration && typeof trainingState.configuration === "object" ? trainingState.configuration as JsonMap : {};
  const trainingPercent = Math.max(0, Math.min(100, Number(trainingProgress.percent || 0)));
  const trainingStage = humanize(trainingProgress.stage || "Preparing data");
  const trainingRunning = trainingState.running === true;
  const tensorBoardVisible = tensorBoardVisibleForRun(trainingState, selectedRun?.id || "");
  const waitingForTrainingProgress = trainingRunning && trainingPercent <= 0;
  const cloudTraining = trainingConfiguration.provider === "modal" || trainingConfiguration.compute_target === "cloud";
  const stagingTraining = cloudTraining && waitingForTrainingProgress && ["", "initializing", "staging-data"].includes(String(trainingProgress.stage || ""));
  const trainingProgressLabel = stagingTraining ? "Loading training data to Modal" : waitingForTrainingProgress ? `Starting ${cloudTraining ? "cloud " : ""}training` : `Training ${trainingStage}`;
  const stopTraining = async () => {
    try {
      const result = await api.stopTraining();
      setTrainingState(result);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  const replayTensorBoard = async (run: RunRecord) => {
    setReplayingTensorBoard(run.id); setError("");
    try {
      setTrainingState(await api.replayTensorBoard(run.id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setReplayingTensorBoard("");
    }
  };
  const stopTensorBoard = async () => {
    try {
      setTrainingState(await api.stopTensorBoard());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return <div className="runs-workspace">
    <aside className="runs-sidebar">
      <div className="pane-heading"><span>Training runs</span><div className="pane-heading-actions"><IconButton label="Refresh runs" onClick={() => void load()}><RefreshCw size={14} /></IconButton></div></div>
      <div className="execution-sidebar-action">{trainingRunning ? <Button variant="danger" onClick={() => void stopTraining()}><Square size={13} fill="currentColor" /> Stop training</Button> : <Button variant="primary" onClick={() => setLauncherOpen(true)}><Play size={13} fill="currentColor" /> Start training</Button>}<small>{trainingRunning ? stagingTraining ? "Loading data to Modal…" : waitingForTrainingProgress ? String(trainingProgress.message || "Waiting for training telemetry…") : `${trainingStage} · ${trainingPercent.toFixed(0)}%` : "Registered project trainer"}</small></div>
      <div className="sidebar-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter runs" aria-label="Filter runs" /></div>
      <div className="run-filter-row"><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">All states</option><option value="complete">Complete</option><option value="completed">Completed</option><option value="running">Running</option><option value="failed">Failed</option></select><Button variant={compared.length >= 2 ? "primary" : "ghost"} disabled={compared.length < 2} onClick={() => setSelectedRun(null)}><GitCompareArrows size={14} /> Compare {compared.length || ""}</Button></div>
      {error && <ErrorNotice message={error} />}
      {loading && !runs.length && <LoadingState label="Loading runs…" />}
      <div className="run-list">{filtered.map((run) => <button key={run.id} className={selectedRun?.id === run.id ? "active" : ""} onClick={() => setSelectedRun(run)}><input type="checkbox" checked={comparison.has(run.id)} onClick={(event) => event.stopPropagation()} onChange={(event) => setComparison((current) => { const next = new Set(current); event.target.checked ? next.add(run.id) : next.delete(run.id); return next; })} aria-label={`Compare ${run.name || run.id}`} /><span className={`status-dot tone-${statusTone(run.status)}`} /><div><strong>{run.name || run.id}</strong><small>{run.model || humanize(run.evidence_kind || run.workflow || "run")}</small></div><Badge tone={statusTone(run.status)}>{humanize(run.status || "Unknown")}</Badge></button>)}</div>
      {!loading && !filtered.length && <EmptyState icon={<BarChart3 />} title="No runs found" description="Recorded training jobs and evaluation evidence appear here." />}
    </aside>
    <main className="runs-main"><TrainingTargetSummary project={project} onChoose={onChooseTrainingTarget} />{trainingRunning && <div className="cloud-transfer-progress training-run-progress"><div><strong>{stagingTraining ? "Loading data to Modal" : trainingStage}</strong><span>{waitingForTrainingProgress ? "In progress…" : `${trainingPercent.toFixed(0)}%`}</span></div><ProgressBar value={trainingPercent} indeterminate={waitingForTrainingProgress} label={trainingProgressLabel} /><small>{stagingTraining ? "The training job will begin after cloud staging completes." : String(trainingProgress.message || (waitingForTrainingProgress ? "Waiting for training telemetry…" : `${trainingPercent.toFixed(0)}% complete`))}</small></div>}<div className={`runs-main-content${tensorBoardVisible ? " has-tensorboard" : ""}`}>{tensorBoardVisible && <TensorBoardPanel state={trainingState} run={selectedRun} onStop={() => void stopTensorBoard()} />}<div className="runs-evidence-content">{!selectedRun && compared.length >= 2 ? <CompareView runs={compared} onRemove={(id) => setComparison((current) => { const next = new Set(current); next.delete(id); return next; })} /> : selectedRun ? <RunDetails run={selectedRun} onReplayTensorBoard={(run) => void replayTensorBoard(run)} replaying={replayingTensorBoard === selectedRun.id} trainingActive={trainingRunning} /> : <EmptyState icon={<GitCompareArrows />} title="Select a run" description="Inspect one result or select at least two runs to compare recorded evidence." />}</div></div></main>
    <RunLauncher project={project} descriptor={descriptor.data || null} open={launcherOpen} onOpenChange={setLauncherOpen} onStarted={(result) => {setTrainingState(result); const log = result.log as JsonMap | undefined; if (Array.isArray(log?.lines)) onLogs(log.lines.map(String)); void load(); window.setTimeout(() => void load(), 1_000); window.setTimeout(() => void load(), 2_500);}} onProjectChange={onProjectChange} compute={compute} onComputeChange={onComputeChange} />
  </div>;
}
