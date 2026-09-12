import {useEffect, useMemo, useRef, useState} from "react";
import {Activity, AppWindow, Crosshair, ExternalLink, File, FileImage, Film, Gauge, Maximize2, Minimize2, Music, Play, RefreshCw, Square, TerminalSquare} from "lucide-react";
import {ComputeTargetPicker, type ComputeSelection} from "../components/ComputeTargetPicker";
import {api, artifactUrl, request} from "../lib/api";
import {inferenceTargetKinds} from "../lib/inference-targets";
import {eligibleArchitectureCheckpointArtifacts, inferenceCheckpointChoices, trainingRunCheckpointArtifacts} from "../lib/inference-checkpoints";
import {inferenceProgressPresentation} from "../lib/inference-progress";
import {eligibleResearchCandidates, hostResearchOnly, researchTargetReady, scoreDecisionPresentation} from "../lib/research-inference";
import {humanize} from "../lib/utils";
import type {InferenceTarget, JsonMap, Project, ResearchCandidate} from "../types";
import {Badge, Button, Card, EmptyState, ErrorNotice, IconButton, LoadingState, ProgressBar, SectionHeader} from "../components/ui";
import {Scene3DViewer} from "../components/Scene3DViewer";
import {PointCloudInferenceViewer} from "../components/PointCloudInferenceViewer";

function objectAt(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
}

function pathName(path: string): string {
  const pieces = path.split(/[\\/]/).filter(Boolean);
  return pieces.slice(-3).join(" / ") || path;
}

function projectPath(project: Project, path: string): string {
  if (!path || path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) return path;
  return `${String(project.repository || "").replace(/[\\/]$/, "")}/${path}`;
}

function applicationUrl(status: JsonMap): string {
  const token = String(objectAt(status.application_gateway).token || "").toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(token)) return "";
  const url = new URL(window.location.origin);
  url.hostname = `${token}.runtime.localhost`;
  url.pathname = "/"; url.search = ""; url.hash = "";
  return url.href;
}

function cloudJobStorageKey(projectId: string): string {
  return `modelforge.inference.cloud.job.${projectId}`;
}

function restoredCloudJobId(projectId: string): string {
  try { return window.localStorage.getItem(cloudJobStorageKey(projectId)) || ""; }
  catch { return ""; }
}

function rememberCloudJob(projectId: string, jobId: string): void {
  try {
    if (jobId) window.localStorage.setItem(cloudJobStorageKey(projectId), jobId);
  } catch { /* Durable server state remains authoritative when browser storage is unavailable. */ }
}

function forgetCloudJob(projectId: string): void {
  try { window.localStorage.removeItem(cloudJobStorageKey(projectId)); }
  catch { /* Browser restoration is optional. */ }
}

function cloudJobActive(job: JsonMap | null): boolean {
  return job !== null && ["queued", "running"].includes(String(job.status || ""));
}

function JsonArtifactResult({value}: {value: unknown}) {
  const document = objectAt(value);
  const candidateRows = [document.top, document.results, document.predictions]
    .find(Array.isArray) as unknown[] | undefined;
  const rows = (candidateRows || []).filter((item) => item && typeof item === "object" && !Array.isArray(item)).map(objectAt).slice(0, 50);
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))].slice(0, 10);
  if (rows.length && columns.length) return <div className="inference-table-result"><table><thead><tr>{columns.map((column) => <th key={column}>{humanize(column)}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{columns.map((column) => <td key={column}>{typeof row[column] === "object" ? JSON.stringify(row[column]) : String(row[column] ?? "—")}</td>)}</tr>)}</tbody></table></div>;
  return <pre className="inference-json-result">{JSON.stringify(value, null, 2)}</pre>;
}

export function InferenceView({project, inferenceTarget, onChooseTarget, onClearTarget, onLogs, compute, onComputeChange}: {project: Project; inferenceTarget: InferenceTarget | null; onChooseTarget: () => void; onClearTarget: () => void; onLogs: (lines: string[]) => void; compute: ComputeSelection; onComputeChange: (selection: ComputeSelection) => void}) {
  const dataset = String(project.selected_dataset || project.default_dataset || "");
  const acceptedTargetKinds = inferenceTargetKinds(project);
  const target = inferenceTarget?.projectId === project.id && inferenceTarget.datasetRoot === dataset && acceptedTargetKinds.includes(inferenceTarget.targetType || "artifact") ? inferenceTarget : null;
  const clearSelectedTarget = onClearTarget;
  const [defaults, setDefaults] = useState<JsonMap | null>(null);
  const [architectureInfo, setArchitectureInfo] = useState<JsonMap>({});
  const [architectureResult, setArchitectureResult] = useState<JsonMap | null>(null);
  const [architectureResultResearchOnly, setArchitectureResultResearchOnly] = useState(false);
  const [researchCandidates, setResearchCandidates] = useState<ResearchCandidate[]>([]);
  const [researchCandidateId, setResearchCandidateId] = useState("");
  const [researchConfirmed, setResearchConfirmed] = useState(false);
  const [sampleSplit, setSampleSplit] = useState("test");
  const [sampleIndex, setSampleIndex] = useState(0);
  const [runtime, setRuntime] = useState<JsonMap | null>(null);
  const [status, setStatus] = useState<JsonMap>({});
  const [cloudJob, setCloudJob] = useState<JsonMap | null>(null);
  const [cloudPreviewUrl, setCloudPreviewUrl] = useState("");
  const [resultDocument, setResultDocument] = useState<unknown>(null);
  const [resultMediaFailed, setResultMediaFailed] = useState(false);
  const [weights, setWeights] = useState("");
  const [runCheckpoints, setRunCheckpoints] = useState<JsonMap[]>([]);
  const [maxFrames, setMaxFrames] = useState(0);
  const [confidence, setConfidence] = useState(.65);
  const [iou, setIou] = useState(.70);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const inferencePreviewRef = useRef<HTMLDivElement>(null);
  const fullscreenPendingRef = useRef(false);
  const nativeFullscreenWasActiveRef = useRef(false);
  const fullscreenMountedRef = useRef(true);
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  const [previewFullscreenFallback, setPreviewFullscreenFallback] = useState(false);
  const restorePreviewFocus = () => window.requestAnimationFrame(() => {
    inferencePreviewRef.current?.querySelector<HTMLButtonElement>("[data-inference-fullscreen]")?.focus();
  });
  useEffect(() => {
    const syncFullscreenState = () => {
      const active = document.fullscreenElement === inferencePreviewRef.current;
      if (nativeFullscreenWasActiveRef.current && !active) restorePreviewFocus();
      nativeFullscreenWasActiveRef.current = active;
      if (active) setPreviewFullscreenFallback(false);
      setPreviewFullscreen(active);
    };
    document.addEventListener("fullscreenchange", syncFullscreenState);
    return () => {
      document.removeEventListener("fullscreenchange", syncFullscreenState);
      if (document.fullscreenElement === inferencePreviewRef.current) void document.exitFullscreen().catch(() => undefined);
    };
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("has-inference-fullscreen-fallback", previewFullscreenFallback);
    if (!previewFullscreenFallback) return;
    const handleFallbackKeys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPreviewFullscreenFallback(false);
        setPreviewFullscreen(false);
        restorePreviewFocus();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = [...(inferencePreviewRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])') || [])];
      if (!controls.length) return;
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", handleFallbackKeys);
    return () => {
      window.removeEventListener("keydown", handleFallbackKeys);
      document.documentElement.classList.remove("has-inference-fullscreen-fallback");
    };
  }, [previewFullscreenFallback]);
  useEffect(() => {
    fullscreenMountedRef.current = true;
    return () => { fullscreenMountedRef.current = false; };
  }, []);

  const togglePreviewFullscreen = async () => {
    const preview = inferencePreviewRef.current;
    if (!preview || fullscreenPendingRef.current) return;
    if (previewFullscreenFallback) {
      setPreviewFullscreenFallback(false);
      setPreviewFullscreen(false);
      restorePreviewFocus();
      return;
    }
    fullscreenPendingRef.current = true;
    try {
      if (document.fullscreenElement === preview) await document.exitFullscreen();
      else if (preview.requestFullscreen) {
        await preview.requestFullscreen();
        if (fullscreenMountedRef.current) setPreviewFullscreen(true);
      } else if (fullscreenMountedRef.current) {
        setPreviewFullscreenFallback(true); setPreviewFullscreen(true);
      }
    } catch {
      // Embedded/restricted browsers may deny the native API; retain viewport-filling inspection.
      if (fullscreenMountedRef.current) {
        setPreviewFullscreenFallback(true);
        setPreviewFullscreen(true);
      }
    } finally {
      fullscreenPendingRef.current = false;
    }
  };
  useEffect(() => {
    if (target?.targetType !== "descriptor_sample") return;
    setSampleSplit(String(target.split || "test"));
    setSampleIndex(Math.max(0, Number(target.sampleIndex || 0)));
    setArchitectureResult(null);
  }, [target?.sampleId, target?.split, target?.sampleIndex]);

  const load = async () => {
    setLoading(true); setError("");
    try {
      const [nextDefaults, nextRuntime, nextStatus, nextRuns, nextArchitecture, nextResearch] = await Promise.all([
        api.inferenceDefaults(dataset), api.runtimeArchitecture().catch(() => ({} as JsonMap)), api.inferenceStatus(target?.targetType === "descriptor_sample" ? "" : target?.path || "").catch(() => ({} as JsonMap)),
        (dataset ? api.runs(dataset).catch(() => api.runs()) : api.runs()).catch(() => ({training_runs: []})),
        project.project_type === "architecture" ? api.architecture().catch(() => ({} as JsonMap)) : Promise.resolve({} as JsonMap),
        api.researchInferenceCandidates().catch(() => ({available: false, candidates: [] as ResearchCandidate[], allowed_splits: [], cloud_eligible: false as const, promotion_eligible: false as const})),
      ]);
      setDefaults(nextDefaults); setRuntime(nextRuntime); setStatus(nextStatus);
      setArchitectureInfo(nextArchitecture);
      setRunCheckpoints(trainingRunCheckpointArtifacts(nextRuns.training_runs));
      const candidates = eligibleResearchCandidates(nextResearch.candidates, project.active_dataset_profile);
      setResearchCandidates(candidates);
      setResearchCandidateId((current) => candidates.some((candidate) => candidate.id === current) ? current : candidates[0]?.id || "");
      setResearchConfirmed(false);
      const lines = objectAt(nextStatus.log).lines;
      if (Array.isArray(lines)) onLogs(lines.map(String));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [project.id, dataset, target?.path]);
  useEffect(() => {
    let cancelled = false;
    setCloudJob(null);
    const jobId = restoredCloudJobId(project.id);
    void api.cloudInferenceStatus(jobId).then((response) => {
      const job = objectAt(response.job);
      if (cancelled) return;
      if (String(job.project_id || "") !== project.id) { forgetCloudJob(project.id); return; }
      setCloudJob(job);
      rememberCloudJob(project.id, String(job.id || ""));
    }).catch(() => {
      if (!cancelled) forgetCloudJob(project.id);
    });
    return () => { cancelled = true; };
  }, [project.id]);
  useEffect(() => {
    if (!status.running && !status.starting && status.other_context_active !== true) return;
    const timer = window.setInterval(async () => {
      try {
        const next = await api.inferenceStatus(target?.path || ""); setStatus(next);
        const lines = objectAt(next.log).lines; if (Array.isArray(lines)) onLogs(lines.map(String));
      } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    }, 1200);
    return () => window.clearInterval(timer);
  }, [Boolean(status.running), Boolean(status.starting), Boolean(status.other_context_active), project.id, target?.path]);
  useEffect(() => {
    if (!cloudJobActive(cloudJob)) return;
    const timer = window.setInterval(async () => {
      try {
        const response = await api.cloudInferenceStatus(String(cloudJob?.id || ""));
        const job = objectAt(response.job);
        setCloudJob(job);
        const logTail = String(objectAt(job.progress).log_tail || "").trim();
        if (logTail) onLogs(logTail.split("\n"));
        if (!cloudJobActive(job) && job.status !== "completed") {
          forgetCloudJob(project.id);
          if (job.error) setError(String(job.error));
        }
      } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    }, 2000);
    return () => window.clearInterval(timer);
  }, [String(cloudJob?.id || ""), cloudJobActive(cloudJob), project.id]);
  useEffect(() => {
    if (!cloudJobActive(cloudJob) || objectAt(cloudJob?.configuration).live_preview !== true) {
      setCloudPreviewUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return ""; });
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/inference/cloud-batch/preview?job_id=${encodeURIComponent(String(cloudJob?.id || ""))}`, {cache: "no-store"});
        if (!response.ok || response.status === 204) return;
        const blob = await response.blob();
        if (!blob.size || cancelled) return;
        const next = URL.createObjectURL(blob);
        setCloudPreviewUrl((previous) => { if (previous) URL.revokeObjectURL(previous); return next; });
      } catch { /* Live preview is best-effort; durable job polling remains authoritative. */ }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [String(cloudJob?.id || ""), cloudJobActive(cloudJob)]);

  const inferenceDefaults = objectAt(defaults?.inference_defaults);
  const architectureInference = project.project_type === "architecture" && architectureInfo.training_ready !== false;
  const architectureDataset = objectAt(architectureInfo.dataset);
  const architectureSplits = objectAt(architectureDataset.splits);
  const splitOptions = Object.entries(architectureSplits).filter(([, value]) => Number(objectAt(value).count || 0) > 0);
  const sampleCount = Number(objectAt(architectureSplits[sampleSplit]).count || 0);
  useEffect(() => {
    if (splitOptions.length && !splitOptions.some(([name]) => name === sampleSplit)) setSampleSplit(splitOptions[0][0]);
    setSampleIndex((value) => Math.max(0, Math.min(value, Math.max(0, sampleCount - 1))));
    setArchitectureResult(null);
  }, [project.id, sampleSplit, sampleCount, splitOptions.map(([name]) => name).join("|")]);
  const runtimeActions = objectAt(objectAt(project.runtime).actions);
  const inferenceAction = objectAt(runtimeActions.inference);
  const modalInference = objectAt(objectAt(objectAt(project.deployment).modal).inference);
  const projectCloudInference = Boolean(modalInference.app && modalInference.function);
  const webApplication = inferenceAction.interface === "web_application";
  const inferenceProcess = inferenceAction.interface === "inference_process";
  const resultContract = objectAt(inferenceAction.result_contract);
  const reusesExistingResult = inferenceProcess && resultContract.reuse_existing === true;
  const inferenceRuntimeTemplates = JSON.stringify([
    ...(Array.isArray(inferenceAction.arguments) ? inferenceAction.arguments : []),
    ...Object.values(objectAt(inferenceAction.environment)),
  ]);
  const supportsMaxFrames = inferenceRuntimeTemplates.includes("{max_frames}");
  const supportsConfidence = inferenceRuntimeTemplates.includes("{conf}");
  const supportsIou = inferenceRuntimeTemplates.includes("{iou}");
  const supportsInferenceOptions = supportsMaxFrames || supportsConfidence || supportsIou;
  const projectCheckpoints = (architectureInference
    ? eligibleArchitectureCheckpointArtifacts(architectureInfo.weights)
    : [
      ...runCheckpoints,
      ...(project.model_checkpoints || []),
      ...(project.model_artifacts || []),
      ...(project.active_checkpoint ? [project.active_checkpoint] : []),
    ])
    .filter((artifact) => artifact.eligible !== false && artifact.status !== "rejected")
    .map((artifact) => ({...artifact, path: projectPath(project, String(artifact.path || artifact.filename || ""))}));
  const checkpointSelection = useMemo(
    () => inferenceCheckpointChoices(inferenceDefaults.weights, runtime, projectCheckpoints),
    [defaults, runtime, runCheckpoints, architectureInfo.weights, architectureInference, project.model_checkpoints, project.model_artifacts, project.active_checkpoint, project.repository],
  );
  const checkpoints = checkpointSelection.checkpoints;
  useEffect(() => {
    if (!checkpoints.some((checkpoint) => checkpoint.path === weights)) setWeights(checkpointSelection.recommended);
  }, [checkpointSelection.recommended, checkpoints.map((checkpoint) => checkpoint.path).join("|")]);
  const video = String(inferenceDefaults.video || "");
  const projectCloudJob = String(cloudJob?.project_id || "") === project.id ? cloudJob : null;
  const cloudSelected = compute.target === "cloud";
  const preservedFixedResult = reusesExistingResult && inferenceAction.dataset_binding !== "selected";
  const preservedTargetSelected = preservedFixedResult && Boolean(target);
  const cloudArtifactBlocked = cloudSelected && Boolean(target);
  const cloudRuntimeBlocked = cloudSelected && (architectureInference || (inferenceProcess && !projectCloudInference));
  const launchBlocked = preservedTargetSelected || cloudArtifactBlocked || cloudRuntimeBlocked;
  const visibleJob = cloudSelected || cloudJobActive(projectCloudJob) ? projectCloudJob : null;
  const progress = visibleJob ? objectAt(visibleJob.progress) : objectAt(status.progress);
  const logValue = objectAt(status.log).lines;
  const logLines = Array.isArray(logValue) ? logValue.map(String) : [];
  const starting = visibleJob ? visibleJob.status === "queued" : status.starting === true;
  const running = visibleJob ? visibleJob.status === "running" : status.running === true;
  const returnCode = visibleJob ? visibleJob.status === "completed" ? 0 : cloudJobActive(visibleJob) ? null : 1 : typeof status.return_code === "number" ? status.return_code : null;
  const active = running || starting || cloudJobActive(projectCloudJob);
  const otherContextActive = !visibleJob && status.other_context_active === true;
  const localBlockedByOtherContext = status.other_context_active === true && compute.target !== "cloud";
  const inferenceRegistered = architectureInference || Boolean(Object.keys(inferenceAction).length && (inferenceAction.executable || inferenceAction.module || inferenceAction.builder));
  const sourceReady = architectureInference ? sampleCount > 0 : webApplication || reusesExistingResult || Boolean(
    dataset && (
      compute.target !== "cloud"
      || (!target && (projectCloudInference || video))
    ),
  );
  const gateway = applicationUrl(status);
  const resultArtifact = objectAt(status.result_artifact);
  const cancelled = status.status === "cancelled";
  const resultVisualization = objectAt(resultArtifact.visualization);
  const resultSceneUrl = String(resultVisualization.scene_url || "");
  const sceneUrl = resultVisualization.format === "modelforge.scene-3d/v1"
    && resultVisualization.profile === "temporal_geospatial_layered_grid"
    && (resultSceneUrl.startsWith("/api/inference/result/scene?")
      || (resultSceneUrl.startsWith("/api/jobs/") && resultSceneUrl.endsWith("/view")))
    ? resultSceneUrl : "";
  const resultPlaybackUrl = String(resultArtifact.playback_url || "");
  const checkedArtifactUrl = resultPlaybackUrl.startsWith("/api/v1/runs/") && resultPlaybackUrl.includes("/artifacts/");
  const resultUrl = (
    resultPlaybackUrl.startsWith("/api/inference/result?")
    || (resultPlaybackUrl.startsWith("/api/jobs/") && resultPlaybackUrl.endsWith("/view"))
    || checkedArtifactUrl
  )
    ? resultPlaybackUrl
    : "";
  const resultContentType = String(resultArtifact.content_type || "");
  const imageResult = resultContentType.startsWith("image/") || resultArtifact.kind === "image";
  const jsonResult = resultContentType.includes("json") || ["table", "json"].includes(String(resultArtifact.kind || ""));
  useEffect(() => { setResultMediaFailed(false); }, [resultUrl]);
  useEffect(() => {
    let current = true;
    setResultDocument(null);
    if (!checkedArtifactUrl || !jsonResult) return () => { current = false; };
    void request<unknown>(resultUrl).then((value) => { if (current) setResultDocument(value); }).catch((reason) => { if (current) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { current = false; };
  }, [checkedArtifactUrl, jsonResult, resultUrl]);
  const preview = objectAt(status.preview);
  const previewReady = preview.available === true && preview.ready === true && Number(status.run_id) > 0;
  const previewUrl = previewReady
    ? `/api/inference/preview?run_id=${encodeURIComponent(String(status.run_id))}&sequence=${encodeURIComponent(String(preview.sequence || "latest"))}`
    : "";
  const cloudArtifacts = Array.isArray(visibleJob?.artifacts) ? visibleJob.artifacts.map(objectAt) : [];
  const cloudVideo = cloudArtifacts.find((artifact) => String(artifact.content_type || "").startsWith("video/") && String(artifact.view_url || "").startsWith("/api/jobs/"));
  const cloudResultUrl = String(cloudVideo?.view_url || "");
  const cloudDownloadUrl = String(cloudVideo?.download_url || "");
  const cloudLogTail = String(progress.log_tail || "").trim();
  const visibleLogLines = visibleJob ? (cloudLogTail ? cloudLogTail.split("\n") : []) : logLines;
  const visibleProcess = visibleJob ? String(visibleJob.provider_action_id || "Cloud") : String(status.pid || "—");
  const visibleSession = visibleJob ? String(visibleJob.id || "—") : String(status.run_id || "—");
  const jobConfiguration = objectAt(visibleJob?.configuration);
  const visibleStage = String(progress.phase || progress.stage || jobConfiguration.phase || (active ? starting ? "starting" : "processing" : visibleJob ? visibleJob.status : "Idle"));
  const progressPresentation = inferenceProgressPresentation(progress, active);
  const progressPercent = progressPresentation.percent;
  const waitingForInferenceProgress = active && progressPresentation.indeterminate;
  const stagingInference = cloudSelected && waitingForInferenceProgress && !["inference", "complete"].includes(String(jobConfiguration.phase || ""));
  const inferenceProgressLabel = cloudSelected
    ? stagingInference ? "Loading inference data to Modal" : waitingForInferenceProgress ? "Starting cloud inference" : `Cloud inference ${humanize(visibleStage)}`
    : waitingForInferenceProgress ? "Starting local inference" : `Local inference ${humanize(visibleStage)}`;
  const previewTone = webApplication
    ? (gateway ? "success" : inferenceRegistered ? "active" : "warning")
    : cloudSelected
      ? (cloudResultUrl ? "success" : active ? "active" : visibleJob && visibleJob.status !== "completed" ? "warning" : target ? "warning" : video ? "success" : "warning")
      : resultUrl ? "success" : previewReady ? "active" : target || dataset ? "success" : "warning";
  const previewLabel = webApplication
    ? (gateway ? "Connected" : active ? "Starting" : "Ready")
    : cloudSelected
      ? (cloudResultUrl ? "Result ready" : cloudPreviewUrl ? "Live cloud inference" : active ? "Cloud running" : visibleJob ? String(visibleJob.status || "Cloud job") : target ? "Local target selected" : video ? "Source ready" : "No video")
      : resultMediaFailed ? "Result unavailable" : resultUrl ? "Result ready" : previewReady ? active ? "Live inference" : "Inference frame" : target ? "Target selected" : dataset ? "Source ready" : inferenceProcess ? "Awaiting result" : "No source";
  const selectedTargetPreview = target?.targetType === "descriptor_sample"
    ? <div className="inference-sequence-preview">{target.previewPath && <img key={target.previewPath} className="inference-live-preview" src={artifactUrl("raw", target.previewPath)} alt={`RGB input for ${target.name}`} />}<span><Crosshair size={15} /> Complete descriptor sample · paired RGB + XYZ · expected label revealed with the prediction</span></div>
    : target?.targetType === "sequence"
    ? <div className="inference-sequence-preview">{target.previewPath && <img key={target.previewPath} className="inference-live-preview" src={artifactUrl("raw", target.previewPath)} alt={`Representative frame from ${target.name}`} />}<span><Film size={15} /> Image sequence · {Number(target.frames || 0).toLocaleString()} frames · {Number(target.fps || 0).toFixed(1)} FPS</span></div>
    : target?.kind === "video"
    ? <video key={target.path} src={artifactUrl("raw", target.path)} controls preload="metadata" />
    : target?.kind === "image"
      ? <img key={target.path} className="inference-live-preview" src={artifactUrl("raw", target.path)} alt={`Selected inference target ${target.name}`} />
      : target?.kind === "audio"
        ? <div className="inference-audio-target"><Music size={30} /><audio key={target.path} src={artifactUrl("raw", target.path)} controls preload="metadata" /></div>
        : target
          ? <EmptyState icon={<File />} title={target.name} description="This selected artifact has no native inference preview. Its catalog-bound path will still be passed to the registered adapter." />
          : null;
  const architecturePrediction = objectAt(architectureResult?.prediction);
  const architectureDecision = objectAt(architecturePrediction.decision);
  const architectureTarget = objectAt(architectureResult?.target);
  const architectureSample = objectAt(architectureResult?.sample);
  const architectureVisualizations = objectAt(architectureResult?.visualizations);
  const architectureCloud = objectAt(architectureVisualizations.xyz_point_cloud);
  const architecturePreviews = objectAt(architectureResult?.previews);
  const architectureDecisionPresentation = scoreDecisionPresentation(
    architecturePrediction, architectureDecision, architectureTarget.label, architectureResultResearchOnly,
  );
  const playbackContent = architectureInference
    ? architectureResult
      ? Object.keys(architectureCloud).length
        ? <div className="inference-result-stack"><PointCloudInferenceViewer cloud={architectureCloud} /><div className="inference-architecture-verdict"><Badge tone={architectureDecisionPresentation.tone}>{architectureDecisionPresentation.label}</Badge><strong>{String(architectureSample.id || `Sample ${sampleIndex + 1}`)} · {String(architectureSample.defect_type || architectureTarget.defect_type || "unknown type")}</strong><span>{architectureDecisionPresentation.detail}</span></div></div>
        : <div className="inference-result-stack"><img className="inference-live-preview" src={String(architecturePreviews.overlay || architecturePreviews.anomaly_map || architecturePreviews.rgb || "")} alt="Checkpoint anomaly-map result" /><div className="inference-architecture-verdict"><Badge tone={architectureDecisionPresentation.tone}>{architectureDecisionPresentation.label}</Badge><strong>{String(architectureSample.id || `Sample ${sampleIndex + 1}`)} · {String(architectureSample.defect_type || architectureTarget.defect_type || "unknown type")}</strong><span>{architectureDecisionPresentation.detail}</span></div></div>
      : selectedTargetPreview || <EmptyState icon={<Crosshair />} title="Choose a test sample" description="Select a complete logical sample in Datasets, or choose a descriptor split and index here, then run the eligible checkpoint." />
    : webApplication
    ? gateway
      ? <><iframe key={gateway} src={gateway} title="Running project inference application" sandbox="allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts" referrerPolicy="same-origin" /><a className="inference-open-application" href={gateway} target="_blank" rel="noreferrer"><ExternalLink size={13} /> Open result in a new window</a></>
      : <EmptyState icon={<AppWindow />} title={active ? "Starting checkpoint-backed application" : "Application ready to launch"} description={active ? "ModelForge is waiting for the isolated local application gateway." : "Launch inference to render the registered application experience."} />
    : cloudSelected
      ? cloudResultUrl
        ? <><video key={cloudResultUrl} aria-label="Cloud inference result playback" src={cloudResultUrl} controls preload="metadata" />{cloudDownloadUrl && <a className="inference-open-application" href={cloudDownloadUrl}><ExternalLink size={13} /> Download cloud result</a>}</>
        : cloudPreviewUrl
          ? <img key={cloudPreviewUrl} className="inference-live-preview" src={cloudPreviewUrl} alt="Latest cloud inference overlay preview" />
          : selectedTargetPreview || (video
              ? <video key={dataset} src={`/api/source/video?path=${encodeURIComponent(dataset)}`} controls preload="metadata" />
              : projectCloudInference && dataset
                ? <EmptyState icon={<Film />} title="Project dataset ready" description="Launch the declared project cloud runtime against this dataset." />
                : <EmptyState icon={<Film />} title="No playable MP4" description="Choose a target artifact in Datasets or select a dataset folder containing a video bundle before launching inference." />)
      : resultUrl
        ? resultMediaFailed
          ? <EmptyState icon={<Film />} title="Checked artifact unavailable" description="The registered result could not be loaded. Refresh the run before trusting or presenting it." />
        : sceneUrl
          ? <div className="inference-result-stack"><Scene3DViewer src={sceneUrl} title="3D Inference Viewer" /><details><summary>Native video fallback</summary><video key={resultUrl} aria-label="Inference result playback" src={resultUrl} controls preload="metadata" /></details></div>
          : jsonResult
            ? resultDocument === null ? <LoadingState label="Loading checked result…" /> : <JsonArtifactResult value={resultDocument} />
          : imageResult
            ? <img key={resultUrl} className="inference-live-preview" src={resultUrl} alt="Inference result" onError={() => {setResultMediaFailed(true); setError("Checked artifact unavailable; the registered result could not be loaded.");}} />
            : <video key={resultUrl} aria-label="Inference result playback" src={resultUrl} controls preload="metadata" />
        : previewUrl
          ? <img key={previewUrl} className="inference-live-preview" src={previewUrl} alt="Latest rendered inference frame" />
          : selectedTargetPreview || (video
            ? <video key={dataset} src={`/api/source/video?path=${encodeURIComponent(dataset)}`} controls preload="metadata" />
            : dataset
              ? <EmptyState icon={<Film />} title={inferenceProcess ? active ? "Validating inference result" : "Result ready to register" : "Project dataset ready"} description={inferenceProcess ? "Launch inference to validate and register the checkpoint-backed video for native playback." : "Launch inference to run the registered adapter against the selected project dataset."} />
              : <EmptyState icon={<Film />} title="No inference source" description="Choose a project dataset before launching inference." />);
  const processingOverlayVisible = !webApplication && active && !resultUrl && !cloudResultUrl
    && !previewUrl && !cloudPreviewUrl;
  const processingFinalizing = progressPresentation.total > 0
    && progressPresentation.completed >= progressPresentation.total;
  const processingTitle = processingFinalizing
    ? "Finalizing detection video"
    : starting ? "Preparing inference" : "Processing selected video";
  const processingDetail = progressPresentation.total > 0
    ? `${Math.min(progressPresentation.completed, progressPresentation.total).toLocaleString()} of ${progressPresentation.total.toLocaleString()} frames processed`
    : String(progress.message || "Waiting for measured frame progress from the inference runtime.");

  const start = async () => {
    if (localBlockedByOtherContext || launchBlocked || !sourceReady || (!weights && !webApplication)) return;
    setBusy(true); setError("");
    try {
      if (architectureInference) {
        const sampleId = target?.targetType === "descriptor_sample" && target.split === sampleSplit && target.sampleIndex === sampleIndex ? target.sampleId : undefined;
        const inspected = await api.inspectArchitecture({split: sampleSplit, index: sampleIndex, sample_id: sampleId, weights, device: compute.device, inspect_model: false});
        setArchitectureResultResearchOnly(false);
        setArchitectureResult(inspected);
        return;
      }
      if (compute.target === "cloud") {
        const response = await api.startCloudInference({
          dataset_root: dataset, artifact_path: target?.path || "", target_kind: target?.targetType || "artifact", weights, source_type: target?.kind || "mp4", record_mode: "overlay", show: false,
          sample_index: 0, device: "cuda:0", modal_gpu: compute.modalGpu, max_frames: maxFrames,
          conf: confidence, iou, live_preview: true, compute_target: "cloud",
        });
        const job = objectAt(response.job);
        setCloudJob(job);
        rememberCloudJob(project.id, String(job.id || ""));
        return;
      }
      const artifactPath = preservedFixedResult ? "" : target?.path || "";
      const next = await api.startInference({
        dataset_root: dataset, artifact_path: artifactPath, target_kind: target?.targetType || "artifact", weights, source_type: webApplication || inferenceProcess ? "project" : target?.kind || "mp4", show: false, record_mode: "none",
        sample_index: 0, device: compute.device, max_frames: maxFrames, conf: confidence, iou,
        live_preview: true,
        compute_target: webApplication || inferenceProcess ? "local" : compute.target,
      });
      setStatus(next);
      const lines = objectAt(next.log).lines; if (Array.isArray(lines)) onLogs(lines.map(String));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const startResearch = async () => {
    const candidate = researchCandidates.find((item) => item.id === researchCandidateId);
    if (!candidate || !researchConfirmed || !researchTargetReady(target, compute.target)) return;
    const researchTarget = target!;
    setBusy(true); setError("");
    try {
      const response = await api.startResearchInference({
        candidate_id: candidate.id,
        checkpoint_sha256: candidate.checkpoint_sha256,
        model_version_id: candidate.model_version_id,
        split: researchTarget.split,
        sample_index: researchTarget.sampleIndex,
        sample_id: researchTarget.sampleId,
        device: compute.device,
        compute_target: "local",
        confirm_research_only: true,
      });
      if (!hostResearchOnly(response)) throw new Error("The research result did not retain the host-enforced research-only authority boundary.");
      const result = objectAt(response.result);
      setArchitectureResultResearchOnly(true);
      setArchitectureResult(objectAt(result.presentation));
      onLogs([`Research inference ${String(response.output_id || "")} complete`, "Candidate remains inactive, ineligible, and local-only."]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const stop = async () => {
    setBusy(true); setError("");
    try {
      if (cloudJobActive(projectCloudJob)) {
        const response = await api.stopCloudInference(String(projectCloudJob?.id || ""));
        setCloudJob(objectAt(response.job));
        forgetCloudJob(project.id);
      } else {
        const next = await api.stopInference(); setStatus(next);
      }
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };

  if (loading && !defaults) return <LoadingState label="Resolving inference inputs…" />;
  return <div className="document-scroll inference-workspace">
      <SectionHeader eyebrow="Model execution" title="Inference studio" description={architectureInference ? "Classify registered dataset samples with the selected eligible checkpoint and inspect spatial anomaly scores on aligned 3D coordinates." : webApplication ? "Launch the active project's registered checkpoint-backed application through ModelForge's isolated local gateway." : inferenceProcess ? "Run the registered process and play its validated result artifact in ModelForge's native inference player." : "Run the active project's registered inference adapter against the selected dataset with explicit checkpoint and device choices."} actions={<Button onClick={() => void load()}><RefreshCw size={14} /> Refresh</Button>} />
    {error && <ErrorNotice message={error} />}
    <div className="inference-grid">
      <div ref={inferencePreviewRef} className={`mf-card inference-preview ${webApplication ? "project-application-preview" : ""} ${previewFullscreenFallback ? "is-fullscreen" : ""}`}>
        <div className="card-title"><span>{architectureInference ? <Crosshair size={16} /> : webApplication ? <AppWindow size={16} /> : <Film size={16} />} {architectureInference ? "Checkpoint prediction · 3D failure heatmap" : webApplication ? String(inferenceAction.display_name || "Project inference application") : inferenceProcess ? "Inference result playback" : cloudSelected ? "Cloud inference playback" : "Dataset playback"}</span><div className="inference-preview-actions"><Badge tone={architectureResult ? architectureDecisionPresentation.tone : previewTone}>{architectureResult ? architectureDecisionPresentation.label : previewLabel}</Badge>{!webApplication && <IconButton label={previewFullscreen ? "Restore inference preview" : "Expand inference preview to full screen"} variant="ghost" aria-pressed={previewFullscreen} data-inference-fullscreen onClick={() => void togglePreviewFullscreen()}>{previewFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</IconButton>}</div></div>
        <div className="inference-playback-stage">
          {playbackContent}
          {processingOverlayVisible && <div className="inference-processing-overlay" role="status" aria-live="polite"><div className="inference-processing-heading"><span><RefreshCw className="animate-spin" size={18} aria-hidden="true" /></span><div><strong>{processingTitle}</strong><small>{humanize(visibleStage)}</small></div><b>{progressPresentation.indeterminate ? "In progress" : `${progressPercent.toFixed(0)}%`}</b></div><p>{processingDetail}</p><ProgressBar value={progressPercent} indeterminate={progressPresentation.indeterminate} label={inferenceProgressLabel} /><small>The source remains visible while ModelForge works. Validated result playback replaces it when processing completes.</small></div>}
        </div>
        <div className="inference-source-copy"><strong>{target?.name || dataset.split(/[\\/]/).filter(Boolean).at(-1) || (webApplication ? "Project-managed source" : "No dataset selected")}</strong><small title={target?.path || dataset}>{target?.path || dataset || (webApplication ? "The registered application resolves its own bounded source." : "Choose a dataset in the Dataset workspace.")}</small>{target ? <span>{target.kind} · selected in Datasets</span> : video && <span>{pathName(video)}</span>}</div>
      </div>
      <Card className="inference-config">
        <div className="card-title"><span><Gauge size={16} /> Execution configuration</span><Badge tone={inferenceRegistered ? "success" : "warning"}>{inferenceRegistered ? "Adapter registered" : "Unavailable"}</Badge></div>
        <div className={`inference-target-summary ${target ? "selected" : ""}`}><span className="inference-target-icon">{target?.kind === "image" ? <FileImage size={17} /> : target?.kind === "video" ? <Film size={17} /> : <Crosshair size={17} />}</span><div><small>Inference target</small><strong>{target?.name || (architectureInference ? "Descriptor split / sample index" : "Adapter default / whole dataset")}</strong><span title={target?.path || dataset}>{target?.path || (architectureInference ? "Choose a complete logical sample in Datasets, or use the controls below." : "Choose an individual object in Datasets to override the adapter default.")}</span></div><Badge tone={target ? "success" : "neutral"}>{target ? "Selected" : "Default"}</Badge>{target && <Button size="sm" onClick={onClearTarget}>{target.targetType === "descriptor_sample" ? "Clear sample" : "Use whole dataset"}</Button>}<Button size="sm" onClick={onChooseTarget}>{target ? "Change" : architectureInference ? "Choose sample" : "Choose object"}</Button></div>
        <label><span>Checkpoint</span><select aria-label="Inference checkpoint" value={weights} onChange={(event) => setWeights(event.target.value)} disabled={busy || active}><option value="">Select a registered checkpoint…</option>{checkpoints.map((checkpoint) => <option key={checkpoint.path} value={checkpoint.path}>{pathName(checkpoint.path)}{checkpoint.path === checkpointSelection.recommended ? " · latest successful" : ""}</option>)}</select><small title={weights}>{weights || "No compatible checkpoint was discovered."}</small></label>
        {architectureInference && <div className="inference-sample-selection"><label><span>Dataset split</span><select aria-label="Inference sample split" value={sampleSplit} disabled={busy} onChange={(event) => { if (target?.targetType === "descriptor_sample") clearSelectedTarget(); setSampleSplit(event.target.value); setSampleIndex(0); setArchitectureResult(null); }}>{splitOptions.map(([name, value]) => <option key={name} value={name}>{humanize(name)} · {Number(objectAt(value).count || 0).toLocaleString()} samples</option>)}</select></label><label><span>Sample</span><input aria-label="Inference sample index" type="number" min="1" max={Math.max(1, sampleCount)} value={sampleIndex + 1} disabled={busy} onChange={(event) => { if (target?.targetType === "descriptor_sample") clearSelectedTarget(); setSampleIndex(Math.max(0, Math.min(Number(event.target.value || 1) - 1, Math.max(0, sampleCount - 1)))); setArchitectureResult(null); }} /><small>{sampleCount ? `${sampleIndex + 1} of ${sampleCount}` : "No samples in this split"}</small></label></div>}
        {researchCandidates.length > 0 && <div className="inference-options"><label><span>Inactive research candidate</span><select aria-label="Research candidate" value={researchCandidateId} disabled={busy || active} onChange={(event) => { setResearchCandidateId(event.target.value); setResearchConfirmed(false); }}>{researchCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.id} · inactive</option>)}</select><small>Local research only. This does not activate, promote, release, or deploy the checkpoint.</small></label><label><span>Explicit confirmation</span><span><input aria-label="Confirm research-only inference" type="checkbox" checked={researchConfirmed} disabled={busy || active} onChange={(event) => setResearchConfirmed(event.target.checked)} /> I understand this result is experimental, non-promotional, and non-deployable.</span></label><Button variant="secondary" busy={busy} disabled={!researchConfirmed || !researchTargetReady(target, compute.target)} onClick={() => void startResearch()}><Play size={14} fill="currentColor" /> Run inactive candidate locally</Button>{target?.targetType === "descriptor_sample" && !researchTargetReady(target, compute.target) && <p className="inference-boundary-note">Research candidates reject reserved test samples and cloud dispatch. Choose a complete Training or Validation sample and a local device.</p>}</div>}
        <ComputeTargetPicker value={compute} onChange={onComputeChange} disabled={busy || active} allowCloud={!architectureInference && !webApplication && (!inferenceProcess || projectCloudInference)} />
        {preservedTargetSelected && <p className="inference-boundary-note">This adapter only opens a saved detection result and cannot process the selected object. Use the whole dataset to clear the target before opening it.</p>}
        {cloudSelected && target && <p className="inference-boundary-note">Individual artifact targets are catalog-bound local inputs. Use the whole dataset to launch cloud batch inference, or choose a local device to run this object.</p>}
        {inferenceProcess && <p className="inference-boundary-note">{projectCloudInference ? "Local inference uses the registered process; Cloud uses this project's declared Modal composition with the same selected checkpoint and dataset." : "Registered inference processes currently run on this workstation. Cloud inference requires a packaged release and a registered cloud-batch adapter."}</p>}
        {!webApplication && !reusesExistingResult && supportsInferenceOptions && <div className="inference-options">{supportsMaxFrames && <label><span>Maximum frames</span><input aria-label="Maximum inference frames" type="number" min="0" value={maxFrames} disabled={busy || active} onChange={(event) => setMaxFrames(Number(event.target.value))} /><small>0 processes the full video.</small></label>}{supportsConfidence && <label><span>Confidence</span><input type="number" min="0" max="1" step="0.05" value={confidence} disabled={busy || active} onChange={(event) => setConfidence(Number(event.target.value))} /></label>}{supportsIou && <label><span>IoU threshold</span><input type="number" min="0" max="1" step="0.05" value={iou} disabled={busy || active} onChange={(event) => setIou(Number(event.target.value))} /></label>}</div>}
        <div className="inference-actions">{active ? <Button variant="danger" busy={busy} onClick={() => void stop()}><Square size={14} fill="currentColor" /> {webApplication ? "Stop application" : "Stop inference"}</Button> : <Button variant="primary" busy={busy} disabled={localBlockedByOtherContext || launchBlocked || !sourceReady || (!weights && !webApplication) || !inferenceRegistered} onClick={() => void start()}><Play size={14} fill="currentColor" /> {architectureInference ? "Predict sample" : webApplication ? "Run application" : preservedFixedResult ? "Play detection result" : "Launch inference"}</Button>}{cloudSelected && (busy || active) && <div className="cloud-transfer-progress"><div><strong>{stagingInference ? "Loading data to Modal" : humanize(visibleStage)}</strong><span>{waitingForInferenceProgress ? "In progress…" : `${progressPercent.toFixed(0)}%`}</span></div><ProgressBar value={progressPercent} indeterminate={waitingForInferenceProgress} label={inferenceProgressLabel} /></div>}<small>{localBlockedByOtherContext ? "Another project or dataset has an active local inference session. Return to that context to stop it before launching here." : preservedTargetSelected ? "Clear the selected object before opening this adapter's fixed saved result." : cloudArtifactBlocked ? "Use the whole dataset or switch to a local device before launching." : cloudRuntimeBlocked ? "Switch to a local device; this inference path currently runs on the selected local device." : compute.target === "cloud" ? "ModelForge content-addresses and stages the selected dataset and release before dispatching this cloud job." : architectureInference ? "Uses the framework's checkpoint-bound sample inference path; the heatmap scores are display-normalized separately from the calibrated sample decision." : webApplication ? "Runs the registered project application behind an isolated ModelForge gateway." : inferenceProcess ? "ModelForge validates and serves the registered result; the project supplies no player or transport." : "Runs through the project-owned adapter on the chosen local device."}</small></div>
      </Card>
    </div>
    <Card className="inference-status-card">
      <div className="card-title"><span><Activity size={16} /> Session status</span><Badge tone={architectureResult ? "success" : active ? "active" : otherContextActive ? "warning" : cancelled ? "warning" : returnCode === 0 ? "success" : returnCode !== null ? "danger" : "neutral"}>{architectureResult ? "Complete" : starting ? "Starting" : running ? "Running" : otherContextActive ? "Other context active" : cancelled ? "Cancelled" : returnCode === 0 ? "Complete" : returnCode !== null ? "Failed" : "Idle"}</Badge></div>
      <ProgressBar value={architectureResult ? 100 : progressPercent} indeterminate={!architectureResult && waitingForInferenceProgress} label={architectureResult ? "Checkpoint sample inference complete" : waitingForInferenceProgress ? inferenceProgressLabel : `Inference ${humanize(visibleStage)}`} className="inference-progress" />
      <div className="inference-status-facts"><span><b>{architectureResult ? "sample inference" : stagingInference ? "Loading data to Modal" : visibleStage}</b> Stage</span><span><b>{architectureResult ? "100%" : waitingForInferenceProgress ? "In progress" : `${progressPercent.toFixed(0)}%`}</b> Progress</span><span><b>{architectureResult ? "Framework" : visibleProcess}</b> Process</span><span><b>{architectureResult ? String(architectureSample.id || sampleIndex + 1) : visibleSession}</b> Session</span></div>
      {Boolean(visibleJob?.error) && <ErrorNotice message={String(visibleJob?.error)} />}
      {!visibleJob && Boolean(status.startup_error) && <ErrorNotice message={String(status.startup_error)} />}
      {!visibleJob && Boolean(status.result_error) && <ErrorNotice message={String(status.result_error)} />}
      <div className="inference-log-preview"><TerminalSquare size={14} /><pre>{visibleLogLines.length ? visibleLogLines.slice(-8).join("\n") : "Inference output will appear here and in the bottom terminal panel."}</pre></div>
    </Card>
  </div>;
}
