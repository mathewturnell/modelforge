import type {
  AnnotationProject,
  AnnotationSample,
  ArtifactResponse,
  BrowseResponse,
  CliffDelegateRoleId,
  DescriptorSampleResponse,
  JsonMap,
  JobRecord,
  LlmExample,
  LlmEvaluation,
  LlmEvaluationSummary,
  LlmWorkspace,
  Project,
  ResearchCandidate,
  RunRecord,
  SourceFile,
  SourceTreeResponse, TrainingTarget,
} from "../types";

export class ApiError extends Error {
  status: number;
  payload: JsonMap;

  constructor(message: string, status: number, payload: JsonMap = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

export const TOKEN_KEY = "modelforge.public-alpha.token";

export function bootstrapSessionToken(
  locationValue: Pick<Location, "hash" | "pathname" | "search"> = window.location,
  storage: Pick<Storage, "getItem" | "setItem"> = sessionStorage,
  browserHistory: Pick<History, "replaceState"> = history,
): string {
  const fragmentToken = new URLSearchParams(locationValue.hash.replace(/^#/, ""))
    .get("token")?.trim() || "";
  if (fragmentToken && fragmentToken.length <= 512) {
    storage.setItem(TOKEN_KEY, fragmentToken);
    browserHistory.replaceState(null, "", `${locationValue.pathname}${locationValue.search}`);
  }
  return fragmentToken || storage.getItem(TOKEN_KEY) || "";
}

export function sessionToken(
  storage: Pick<Storage, "getItem"> = sessionStorage,
): string {
  return storage.getItem(TOKEN_KEY) || "";
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  bootstrapSessionToken();
  const headers = new Headers(init.headers);
  const token = sessionToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(path, {cache: "no-store", ...init, headers});
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json() as JsonMap
    : {text: await response.text()};
  if (!response.ok) {
    throw new ApiError(String(payload.error || payload.message || `Request failed (${response.status})`), response.status, payload);
  }
  return payload as T;
}

export function post<T>(path: string, body: JsonMap): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(body),
  });
}

const ACTIVE_PROJECT_KEY = "modelforge.public-alpha.active-project";

function normalizedProject(project: Project): Project {
  const actions = (Array.isArray(project.actions) ? project.actions : project.action ? [project.action] : []) as JsonMap[];
  const actionMap = Object.fromEntries(actions.map((action) => [String(action.kind || action.id), {
    ...action,
    registered: true,
    // This is a public capability marker, never a host executable path.
    executable: "managed-action",
  }]));
  const dataset = project.dataset && typeof project.dataset === "object" ? project.dataset as JsonMap : {};
  const datasetId = String(dataset.id || "");
  const hasPrompt = actions.some((action) => action.kind === "prompt");
  const bindings = (Array.isArray(project.bindings) ? project.bindings : []) as JsonMap[];
  const checkpointBinding = bindings.find((binding) => binding.id === "checkpoint");
  const checkpoint = checkpointBinding ? {
    id: String(checkpointBinding.id || "checkpoint"),
    name: String(checkpointBinding.name || "Registered checkpoint"),
    filename: "registered-checkpoint.pt",
    path: "registered-checkpoint.pt",
    status: "eligible",
    eligible: true,
    sha256: String(checkpointBinding.sha256 || ""),
    source: "registered binding",
  } : undefined;
  return {
    ...project,
    selected_dataset: datasetId,
    default_dataset: datasetId,
    default_dataset_profile: datasetId,
    active_dataset_profile: datasetId,
    dataset_profiles: datasetId ? [{
      id: datasetId,
      name: String(dataset.name || datasetId),
      root: datasetId,
      default: true,
      splits: {train: {count: Number(dataset.sample_count || 0)}},
    }] : [],
    project_type: hasPrompt ? "llm" : "vision",
    runtime: {actions: actionMap},
    adapters: actionMap,
    inference_target_contract: {
      kinds: datasetId ? ["artifact"] : [],
      transport: "managed_action",
      identity: ["dataset_id", "sample_id", "sha256"],
      requires_checkpoint: false,
    },
    training_target: datasetId ? {kind: "dataset", dataset_root: datasetId, path: ".", name: String(dataset.name || datasetId)} : undefined,
    model_checkpoints: checkpoint ? [checkpoint] : [],
    training_checkpoints: checkpoint ? [checkpoint] : [],
    active_checkpoint: checkpoint,
  };
}

async function publicProjects(): Promise<{projects: Project[]; active_id: string}> {
  const payload = await request<{projects: Project[]}>("/api/v1/projects");
  const projects = (payload.projects || []).map(normalizedProject);
  const stored = sessionStorage.getItem(ACTIVE_PROJECT_KEY) || "";
  const activeId = projects.some((project) => project.id === stored)
    ? stored
    : projects[0]?.id || "";
  if (activeId) sessionStorage.setItem(ACTIVE_PROJECT_KEY, activeId);
  return {projects, active_id: activeId};
}

async function publicProject(projectId?: string): Promise<Project> {
  const catalog = await publicProjects();
  const id = projectId || catalog.active_id;
  if (!id) throw new ApiError("No public project is registered", 404);
  return normalizedProject(await request<Project>(`/api/v1/projects/${encodeURIComponent(id)}`));
}

async function activeProjectId(): Promise<string> {
  const catalog = await publicProjects();
  if (!catalog.active_id) throw new ApiError("No public project is registered", 404);
  return catalog.active_id;
}

async function activeProject(): Promise<Project> {
  return publicProject(await activeProjectId());
}

function sampleIdentity(path: string): {projectId: string; datasetId: string; sampleId: string} | null {
  if (!path.startsWith("sample://")) return null;
  const values = path.slice("sample://".length).split("/").map(decodeURIComponent);
  return values.length === 3 ? {projectId: values[0], datasetId: values[1], sampleId: values[2]} : null;
}

function annotationIdentity(path: string): {projectId: string; datasetId: string} | null {
  if (!path.startsWith("annotation://")) return null;
  const values = path.slice("annotation://".length).split("/").map(decodeURIComponent);
  return values.length === 2 ? {projectId: values[0], datasetId: values[1]} : null;
}

const samplePath = (projectId: string, datasetId: string, sampleId: string) =>
  `sample://${[projectId, datasetId, sampleId].map(encodeURIComponent).join("/")}`;

function runKind(run: JsonMap): string {
  const configuration = run.configuration && typeof run.configuration === "object" ? run.configuration as JsonMap : {};
  const requestValue = run.request && typeof run.request === "object" ? run.request as JsonMap : {};
  return String(run.action_kind || configuration.action_kind || run.workflow || requestValue.workflow || "action").toLowerCase();
}

async function publicRuns(projectId?: string): Promise<JobRecord[]> {
  const id = projectId || await activeProjectId();
  const payload = await request<{runs: JobRecord[]}>(`/api/v1/runs?project_id=${encodeURIComponent(id)}`);
  return Promise.all((payload.runs || []).map(async (run) => {
    const artifacts = (Array.isArray(run.artifacts) ? run.artifacts : []) as JsonMap[];
    const projectedArtifacts = artifacts.map((artifact) => {
      const url = `/api/v1/runs/${encodeURIComponent(run.id)}/artifacts/${encodeURIComponent(String(artifact.id))}`;
      return {
        ...artifact,
        id: String(artifact.id || ""),
        name: String(artifact.name || artifact.id || "Artifact"),
        view_url: url,
        download_url: url,
        downloadable: true,
      };
    });
    let metrics = run.metrics && typeof run.metrics === "object" ? run.metrics as JsonMap : {};
    let history: JsonMap = {};
    const metricsArtifact = artifacts.find((artifact) => artifact.kind === "training-metrics" && String(artifact.content_type).includes("json"));
    if (metricsArtifact && !Object.keys(metrics).length) {
      try {
        const evidence = await request<JsonMap>(`/api/v1/runs/${encodeURIComponent(run.id)}/artifacts/${encodeURIComponent(String(metricsArtifact.id))}`);
        const series = (Array.isArray(evidence.series) ? evidence.series : []) as JsonMap[];
        const metricNames = [...new Set(series.flatMap((row) => Object.keys(row).filter((key) => key !== "epoch" && Number.isFinite(Number(row[key])))))];
        history = Object.fromEntries(metricNames.map((name) => [name, series.map((row, index) => ({step: Number(row.epoch || index + 1), value: Number(row[name])}))]));
        const terminal = series.at(-1) || {};
        metrics = Object.fromEntries(metricNames.map((name) => [name, Number(terminal[name])]));
      } catch { /* The run remains usable when optional metric presentation cannot be decoded. */ }
    }
    return {
      ...run,
      artifacts: projectedArtifacts,
      metrics,
      history,
      name: String(run.name || run.action_display_name || `${runKind(run)} · ${run.id.slice(0, 8)}`),
      workflow: runKind(run),
      modified: String(run.updated_at || run.completed_at || run.created_at || ""),
      compute_target: String(run.provider || "local"),
    } as JobRecord;
  }));
}

function activeStatus(kind: string, runs: JobRecord[]): JsonMap {
  const matching = runs.filter((run) => runKind(run) === kind);
  const run = matching.find((candidate) => ["queued", "running"].includes(String(candidate.status))) || matching[0];
  if (!run) return {running: false, starting: false, progress: {stage: "idle", percent: 0}, log: {lines: [], entries: []}};
  const running = run.status === "running";
  const starting = run.status === "queued";
  const live = run.live && typeof run.live === "object" ? run.live as JsonMap : {};
  const progress = live.progress && typeof live.progress === "object" ? live.progress as JsonMap : {};
  const stdout = String(live.stdout || "");
  const stderr = String(live.stderr || "");
  const lines = `${stdout}${stderr ? `\n${stderr}` : ""}`.split("\n").filter(Boolean).slice(-200);
  const artifacts = Array.isArray(run.artifacts) ? run.artifacts as JsonMap[] : [];
  const resultCandidates = run.status === "completed"
    ? artifacts.filter((artifact) => !["process-log", "result-envelope", "training-metrics", "checkpoint"].includes(String(artifact.kind || "")))
    : [];
  const firstArtifact = ["video", "image", "scene_3d", "text", "table", "json", "result"]
    .map((preferred) => resultCandidates.find((artifact) => String(artifact.kind || "") === preferred))
    .find(Boolean) || resultCandidates[0];
  return {
    ...run,
    running,
    starting,
    progress: {stage: running ? "running" : starting ? "queued" : String(run.status || "idle"), percent: Number(progress.percent || (run.status === "completed" ? 100 : 0)), ...progress},
    log: {lines, entries: lines.map((text, index) => ({id: index, text}))},
    return_code: run.status === "completed" ? 0 : run.status === "failed" ? 1 : null,
    result_error: run.status === "failed" ? String(run.error || "The registered action failed") : "",
    result_artifact: firstArtifact ? {...firstArtifact, playback_url: String(firstArtifact.view_url || "")} : {},
  };
}

async function statusFor(kind: string): Promise<JsonMap> {
  return activeStatus(kind, await publicRuns());
}

async function startManagedAction(kind: string, configuration: JsonMap): Promise<JsonMap> {
  const project = await activeProject();
  const actions = (Array.isArray(project.actions) ? project.actions : []) as JsonMap[];
  const action = actions.find((candidate) => String(candidate.kind) === kind);
  if (!action) throw new ApiError(`This project has no registered ${kind} action`, 400);
  const dataset = project.dataset && typeof project.dataset === "object" ? project.dataset as JsonMap : {};
  const datasetId = String(dataset.id || "");
  const target = sampleIdentity(String(configuration.artifact_path || ""));
  let input: JsonMap;
  if (kind === "training") {
    input = {
      dataset_id: datasetId,
      dataset_split: "train",
      parameters: {
        epochs: Number(configuration.epochs || 1),
        batch: Number(configuration.batch || 1),
        learning_rate: Number(configuration.learning_rate || .001),
        max_batches: Number(configuration.max_batches || 0),
      },
    };
  } else if (kind === "prompt") {
    input = {messages: configuration.messages || [], generation: configuration.generation || {}};
  } else {
    let sampleId = target?.sampleId || "";
    if (!sampleId && datasetId) {
      const samples = await request<{samples: JsonMap[]}>(`/api/v1/projects/${encodeURIComponent(project.id)}/datasets/${encodeURIComponent(datasetId)}/samples?limit=1`);
      sampleId = String(samples.samples?.[0]?.id || "");
    }
    input = {
      dataset_id: target?.datasetId || datasetId,
      sample_id: sampleId,
      parameters: Number.isInteger(configuration.max_frames)
        ? {max_frames: Number(configuration.max_frames)}
        : {},
    };
  }
  const executionTarget = configuration.compute_target === "cloud" ? "modal" : "local";
  if (executionTarget === "modal" && !window.confirm("Dispatch this registered action to Modal? Provider compute may be billable.")) {
    throw new ApiError("Modal dispatch was cancelled before submission", 400);
  }
  const execution: JsonMap = {target: executionTarget};
  let retryKey = "";
  if (executionTarget === "modal") {
    const targets = (Array.isArray(project.execution_targets) ? project.execution_targets : []) as JsonMap[];
    const target = targets.find((candidate) => candidate.target === "modal" && (!candidate.action_id || candidate.action_id === action.id));
    if (!target || target.readiness !== "ready" || target.ready === false) {
      throw new ApiError("This project action has no ready Modal binding", 400);
    }
    const bindingSha256 = String(target.binding_sha256 || "");
    if (!/^[a-f0-9]{64}$/i.test(bindingSha256)) throw new ApiError("The Modal binding identity is unavailable", 400);
    const fingerprint = JSON.stringify({project_id: project.id, action_id: action.id, binding_sha256: bindingSha256, input});
    retryKey = `modelforge.modal.retry.${project.id}.${String(action.id)}`;
    let retained: JsonMap = {};
    try { retained = JSON.parse(sessionStorage.getItem(retryKey) || "{}"); } catch { retained = {}; }
    const idempotencyKey = retained.fingerprint === fingerprint && typeof retained.idempotency === "string"
      ? retained.idempotency
      : crypto.randomUUID();
    sessionStorage.setItem(retryKey, JSON.stringify({fingerprint, idempotency: idempotencyKey}));
    Object.assign(execution, {billable_confirmed: true, binding_sha256: bindingSha256, idempotency_key: idempotencyKey});
  }
  let run = await post<JobRecord>(`/api/v1/projects/${encodeURIComponent(project.id)}/actions/${encodeURIComponent(String(action.id))}/runs`, {
    protocol: "modelforge.managed-action-request/v1",
    execution,
    input,
  });
  if (retryKey) sessionStorage.removeItem(retryKey);
  // A very short local action can finish between allocation and projection.
  // Re-read the durable record so terminal UI state always includes the
  // atomically committed checked artifacts rather than the allocation view.
  if (!["queued", "running"].includes(String(run.status))) {
    run = await request<JobRecord>(`/api/v1/runs/${encodeURIComponent(run.id)}`);
  }
  return activeStatus(kind, [run]);
}

async function runPublicPrompt(configuration: JsonMap): Promise<JsonMap> {
  const project = await activeProject();
  const actions = (Array.isArray(project.actions) ? project.actions : []) as JsonMap[];
  const action = actions.find((candidate) => candidate.kind === "prompt");
  if (!action) throw new ApiError("This project has no registered prompt action", 400);
  const messages = (Array.isArray(configuration.messages) ? configuration.messages : []).map((raw) => {
    const message = raw && typeof raw === "object" ? raw as JsonMap : {};
    return {role: String(message.role || "user"), content: String(message.content || "")};
  });
  let run = await post<JobRecord>(`/api/v1/projects/${encodeURIComponent(project.id)}/actions/${encodeURIComponent(String(action.id))}/runs`, {
    protocol: "modelforge.managed-action-request/v1",
    execution: {target: "local"},
    input: {
      messages,
      generation: {temperature: Number(configuration.temperature ?? .2), max_new_tokens: Math.min(2048, Number(configuration.max_tokens || 1024))},
    },
  });
  for (let attempt = 0; attempt < 240 && ["queued", "running"].includes(String(run.status)); attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    run = await request<JobRecord>(`/api/v1/runs/${encodeURIComponent(run.id)}`);
  }
  if (run.status !== "completed") throw new ApiError(String(run.error || `Prompt action ended ${run.status}`), 400, run);
  const artifacts = (Array.isArray(run.artifacts) ? run.artifacts : []) as JsonMap[];
  const envelope = artifacts.find((artifact) => artifact.kind === "result-envelope");
  if (!envelope) throw new ApiError("Prompt action completed without a checked result envelope", 500);
  const result = await request<JsonMap>(`/api/v1/runs/${encodeURIComponent(run.id)}/artifacts/${encodeURIComponent(String(envelope.id))}`);
  return {run, request: {messages}, result};
}

const annotationClasses: Record<string, string> = {"0": "object", "1": "vehicle", "2": "person"};

function markerNumber(value: unknown, fallback: number): number {
  const match = String(value || "").match(/\d+/);
  return match ? Number(match[0]) : fallback;
}

function annotationProjectProjection(
  projectId: string, datasetId: string, samples: JsonMap[], annotation: JsonMap, selectedIndex: number,
): AnnotationProject {
  const boxes = (Array.isArray(annotation.boxes) ? annotation.boxes : []) as JsonMap[];
  return {
    project: `annotation://${[projectId, datasetId].map(encodeURIComponent).join("/")}`,
    project_kind: "registered_dataset_sidecars",
    sample_count: samples.length,
    classes: annotationClasses,
    protected: /held|test/i.test(String(samples[selectedIndex]?.split || "")),
    protection_reason: "Held-out samples are protected from annotation writes.",
    export_supported: false,
    markers: boxes.map((box, index) => ({
      id: markerNumber(box.id, index + 1),
      class_id: Number(Object.entries(annotationClasses).find(([, label]) => label === box.label)?.[0] || 0),
      sample_index: selectedIndex + 1,
      bbox: [Number(box.x || 0) * 1280, Number(box.y || 0) * 720, Number(box.x || 0) * 1280 + Number(box.width || 0) * 1280, Number(box.y || 0) * 720 + Number(box.height || 0) * 720],
      keyframe_count: 1,
      source_track_id: String(box.id || index + 1),
    })),
  };
}

function annotationSampleProjection(
  projectHandle: string, index: number, sample: JsonMap, annotation: JsonMap,
): AnnotationSample {
  const boxes = (Array.isArray(annotation.boxes) ? annotation.boxes : []) as JsonMap[];
  return {
    project: projectHandle,
    sample_index: index,
    filename: String(sample.name || sample.id),
    width: 1280,
    height: 720,
    split: String(sample.split || ""),
    observations: Object.fromEntries(boxes.map((box, boxIndex) => {
      const markerId = markerNumber(box.id, boxIndex + 1);
      const x = Number(box.x || 0) * 1280;
      const y = Number(box.y || 0) * 720;
      return [String(box.id || markerId), {
        geometry_type: "bbox",
        bbox: [x, y, x + Number(box.width || 0) * 1280, y + Number(box.height || 0) * 720],
        marker_id: markerId,
        class_id: Number(Object.entries(annotationClasses).find(([, label]) => label === box.label)?.[0] || 0),
        class_name: String(box.label || "object"),
        is_keyframe: true,
        source_track_id: String(box.id || markerId),
      }];
    })),
  };
}

async function mutatePublicAnnotation(projectHandle: string, change: JsonMap): Promise<AnnotationProject> {
  const identity = annotationIdentity(projectHandle);
  if (!identity) throw new ApiError("Annotation project identity is invalid", 400);
  const sampleIndex = Math.max(1, Number(change.sample_index || 1));
  const page = await request<{samples: JsonMap[]}>(`/api/v1/projects/${encodeURIComponent(identity.projectId)}/datasets/${encodeURIComponent(identity.datasetId)}/samples?limit=100`);
  const sample = page.samples[sampleIndex - 1];
  if (!sample) throw new ApiError("Annotation sample was not found", 404);
  const endpoint = `/api/v1/projects/${encodeURIComponent(identity.projectId)}/datasets/${encodeURIComponent(identity.datasetId)}/samples/${encodeURIComponent(String(sample.id))}/annotations`;
  const annotation = await request<JsonMap>(endpoint);
  const boxes = [...((Array.isArray(annotation.boxes) ? annotation.boxes : []) as JsonMap[])];
  const action = String(change.action || "");
  const markerIndex = (marker: unknown) => boxes.findIndex((box, index) => markerNumber(box.id, index + 1) === Number(marker));
  const normalizedBox = (raw: unknown): JsonMap => {
    const values = Array.isArray(raw) ? raw.map(Number) : [];
    if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) throw new ApiError("A bounded box is required", 400);
    const x1 = Math.max(0, Math.min(1280, Math.min(values[0], values[2])));
    const y1 = Math.max(0, Math.min(720, Math.min(values[1], values[3])));
    const x2 = Math.max(x1 + 1, Math.min(1280, Math.max(values[0], values[2])));
    const y2 = Math.max(y1 + 1, Math.min(720, Math.max(values[1], values[3])));
    return {x: x1 / 1280, y: y1 / 720, width: (x2 - x1) / 1280, height: (y2 - y1) / 720};
  };
  if (action === "add_track") {
    boxes.push({id: `track-${Date.now().toString(36)}`, label: annotationClasses[String(change.class_id)] || "object", ...normalizedBox(change.bbox)});
  } else if (action === "set_keyframe") {
    const index = markerIndex(change.marker_id);
    if (index < 0) throw new ApiError("Annotation track was not found", 404);
    boxes[index] = {...boxes[index], ...normalizedBox(change.bbox)};
  } else if (action === "set_class") {
    const index = markerIndex(change.marker_id);
    if (index < 0) throw new ApiError("Annotation track was not found", 404);
    boxes[index] = {...boxes[index], label: annotationClasses[String(change.class_id)] || "object"};
  } else if (action === "delete_track") {
    const index = markerIndex(change.marker_id);
    if (index < 0) throw new ApiError("Annotation track was not found", 404);
    boxes.splice(index, 1);
  } else if (action === "merge") {
    const ids = Array.isArray(change.marker_ids) ? change.marker_ids.map(Number) : [];
    const selected = boxes.filter((box, index) => ids.includes(markerNumber(box.id, index + 1)));
    if (selected.length < 2) throw new ApiError("Select at least two annotation tracks to merge", 400);
    const x = Math.min(...selected.map((box) => Number(box.x)));
    const y = Math.min(...selected.map((box) => Number(box.y)));
    const x2 = Math.max(...selected.map((box) => Number(box.x) + Number(box.width)));
    const y2 = Math.max(...selected.map((box) => Number(box.y) + Number(box.height)));
    const retained = boxes.filter((box, index) => !ids.includes(markerNumber(box.id, index + 1)));
    boxes.splice(0, boxes.length, ...retained, {id: `track-${Date.now().toString(36)}`, label: String(selected[0].label || "object"), x, y, width: x2 - x, height: y2 - y});
  } else {
    throw new ApiError("This public annotation contract currently supports box tracks only", 400);
  }
  const labels = [...new Set(boxes.map((box) => String(box.label || "object")))];
  const updated = await post<JsonMap>(endpoint, {
    sample_sha256: String(annotation.sample_sha256 || sample.sha256 || ""),
    expected_revision: Number(annotation.revision || 0),
    labels,
    note: String(annotation.note || ""),
    boxes,
  });
  return annotationProjectProjection(identity.projectId, identity.datasetId, page.samples, updated, sampleIndex - 1);
}

const LLM_CURATION_PREFIX = "modelforge.llm-curation/v1\n";

function llmExampleFromSample(sample: JsonMap, source: JsonMap, annotation: JsonMap): LlmExample {
  let retained: JsonMap = {};
  const note = String(annotation.note || "");
  if (note.startsWith(LLM_CURATION_PREFIX)) {
    try {
      const parsed = JSON.parse(note.slice(LLM_CURATION_PREFIX.length));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) retained = parsed as JsonMap;
    } catch { /* A malformed optional projection never changes the checked source sample. */ }
  }
  const messages = Array.isArray(retained.messages)
    ? retained.messages
    : Array.isArray(source.messages) ? source.messages : [];
  return {
    id: String(sample.id || "conversation"),
    split: String(retained.split || sample.split || "train") === "validation" ? "validation" : "train",
    messages: messages.map((raw) => {
      const message = raw && typeof raw === "object" ? raw as JsonMap : {};
      const role = ["system", "user", "assistant", "tool"].includes(String(message.role))
        ? String(message.role) as "system" | "user" | "assistant" | "tool"
        : "user";
      return {role, content: String(message.content || ""), attachments: []};
    }),
    review_status: ["draft", "reviewed", "approved", "rejected"].includes(String(retained.review_status))
      ? retained.review_status as LlmExample["review_status"] : "draft",
    annotations: retained.annotations && typeof retained.annotations === "object" ? retained.annotations as LlmExample["annotations"] : {},
    tags: Array.isArray(retained.tags) ? retained.tags.map(String) : (Array.isArray(annotation.labels) ? annotation.labels.map(String) : []),
    notes: String(retained.notes || (note.startsWith(LLM_CURATION_PREFIX) ? "" : note)),
  };
}

async function publicLlmWorkspace(): Promise<LlmWorkspace> {
  const project = await activeProject();
  const actions = (Array.isArray(project.actions) ? project.actions : []) as JsonMap[];
  const prompt = actions.find((action) => action.kind === "prompt");
  const dataset = project.dataset && typeof project.dataset === "object" ? project.dataset as JsonMap : {};
  const datasetId = String(dataset.id || "");
  const page = datasetId
    ? await request<{samples: JsonMap[]}>(`/api/v1/projects/${encodeURIComponent(project.id)}/datasets/${encodeURIComponent(datasetId)}/samples?limit=100`)
    : {samples: []};
  const examples: LlmExample[] = [];
  let revision = 0;
  for (const sample of page.samples || []) {
    if (!String(sample.content_type || "").includes("json")) continue;
    const base = `/api/v1/projects/${encodeURIComponent(project.id)}/datasets/${encodeURIComponent(datasetId)}/samples/${encodeURIComponent(String(sample.id))}`;
    const [source, annotation] = await Promise.all([
      request<JsonMap>(`${base}/content`),
      request<JsonMap>(`${base}/annotations`),
    ]);
    examples.push(llmExampleFromSample(sample, source, annotation));
    revision = Math.max(revision, Number(annotation.revision || 0));
  }
  return {
    protocol: "modelforge.llm-workspace-projection/v1",
    project_id: project.id,
    revision,
    examples,
    counts: {
      examples: examples.length,
      messages: examples.reduce((total, example) => total + example.messages.length, 0),
      attachments: 0,
      train: examples.filter((example) => example.split === "train").length,
      validation: examples.filter((example) => example.split === "validation").length,
    },
    dataset_path: datasetId || "No curated conversation dataset",
    dataset_version: {revision, sha256: String((page.samples || [])[0]?.sha256 || ""), snapshot_path: datasetId},
    example_metadata_schema: {protocol: "modelforge.example-metadata-schema/v1", id: "public-alpha", version: 1, title: "Project metadata", fields: []},
    prompt_action: {
      available: Boolean(prompt),
      display_name: String(prompt?.display_name || "Registered prompt adapter"),
      interface: String(prompt?.interface || "prompt_process"),
      modalities: ["text"],
      default_model: String(((project.bindings as JsonMap[] | undefined) || []).find((item) => item.id === "model")?.revision || "project default"),
    },
    curation_write_available: Boolean(prompt && datasetId && examples.length),
  } as LlmWorkspace;
}

async function savePublicLlmExample(_projectId: string, example: Partial<LlmExample>): Promise<{example: LlmExample; workspace: LlmWorkspace}> {
  const project = await activeProject();
  const dataset = project.dataset && typeof project.dataset === "object" ? project.dataset as JsonMap : {};
  const datasetId = String(dataset.id || "");
  const page = await request<{samples: JsonMap[]}>(`/api/v1/projects/${encodeURIComponent(project.id)}/datasets/${encodeURIComponent(datasetId)}/samples?limit=100`);
  const sample = page.samples.find((candidate) => String(candidate.id) === String(example.id || "")) || page.samples[0];
  if (!sample || !String(sample.content_type || "").includes("json")) throw new ApiError("This project has no registered conversation sample to curate", 400);
  const base = `/api/v1/projects/${encodeURIComponent(project.id)}/datasets/${encodeURIComponent(datasetId)}/samples/${encodeURIComponent(String(sample.id))}`;
  const current = await request<JsonMap>(`${base}/annotations`);
  const retained = {
    split: example.split || "train",
    review_status: example.review_status || "draft",
    messages: example.messages || [],
    annotations: example.annotations || {},
    tags: example.tags || [],
    notes: example.notes || "",
  };
  const saved = await post<JsonMap>(`${base}/annotations`, {
    sample_sha256: String(current.sample_sha256 || sample.sha256 || ""),
    expected_revision: Number(current.revision || 0),
    labels: [...new Set((example.tags || []).map(String))],
    note: LLM_CURATION_PREFIX + JSON.stringify(retained),
    boxes: Array.isArray(current.boxes) ? current.boxes : [],
  });
  const source = await request<JsonMap>(`${base}/content`);
  const savedExample = llmExampleFromSample(sample, source, saved);
  return {example: savedExample, workspace: await publicLlmWorkspace()};
}

export const api = {
  authStatus: async () => {
    const readiness = await request<JsonMap>("/api/v1/ready");
    return {
      ...readiness,
      authenticated: true,
      development_bypass: true,
      registration_available: false,
      boundary: "authenticated-loopback-session",
    };
  },
  login: (username: string, password: string) => post<JsonMap>("/api/auth/login", {username, password}),
  register: (email: string, password: string, displayName: string) => post<JsonMap>("/api/auth/register", {email, password, display_name: displayName}),
  projects: publicProjects,
  project: () => publicProject(),
  createPromptProject: (prompt: string, specifications: Array<Record<string, unknown>>) => post<{
    project: Project;
    destination_panel?: string;
    actions?: JsonMap[];
    inputs?: JsonMap[];
    brief?: string;
  }>("/api/projects/from-prompt", {prompt, specifications}),
  searchGitHub: (query = "", sort = "stars", limit = 24) => request<{repositories?: JsonMap[]; count?: number}>(`/api/integrations/github/transformers?${new URLSearchParams({q: query, sort, limit: String(limit)})}`),
  inspectGitHub: async (repoId: string, revision = "") => (await post<{repository: JsonMap}>("/api/integrations/github/inspect", {repo_id: repoId, revision})).repository,
  importGitHub: (options: JsonMap) => post<{project: Project; repository: JsonMap; destination?: string}>("/api/integrations/github/import", options),
  searchHuggingFace: (query = "", sort = "trending_score", limit = 24) => request<{datasets?: JsonMap[]; count?: number}>(`/api/integrations/huggingface/datasets?${new URLSearchParams({q: query, sort, limit: String(limit)})}`),
  inspectHuggingFace: async (repoId: string, repoType = "dataset", revision = "") => (await post<{repository: JsonMap}>("/api/integrations/huggingface/inspect", {repo_id: repoId, repo_type: repoType, revision})).repository,
  importHuggingFace: (options: JsonMap) => post<{project: Project; repository: JsonMap; destination?: string}>("/api/integrations/huggingface/import", options),
  selectProject: async (projectId: string) => {
    const project = await publicProject(projectId);
    sessionStorage.setItem(ACTIVE_PROJECT_KEY, projectId);
    return project;
  },
  removeProject: async (_projectId: string) => publicProjects(),
  selectDataset: async (projectId: string, _dataset: string) => publicProject(projectId),
  selectDatasetProfile: async (projectId: string, _profileId: string) => publicProject(projectId),
  selectTrainingTarget: async (projectId: string, target: TrainingTarget) => (await post<{project: Project}>("/api/project/training-target", {project_id: projectId, target})).project,
  browse: (path: string, files = "") => request<BrowseResponse>(`/api/browse?${new URLSearchParams({path, details: "1", ...(files ? {files} : {})})}`),
  registerExistingProject: (path: string) => post<{project: Project; projects: Project[]; active_id: string}>("/api/projects/register-folder", {path}),
  overview: async () => request<JsonMap>(`/api/v1/projects/${encodeURIComponent(await activeProjectId())}/overview`),
  source: async (path = "") => request<SourceTreeResponse>(`/api/v1/projects/${encodeURIComponent(await activeProjectId())}/source?path=${encodeURIComponent(path)}`),
  sourceFile: async (path: string) => request<SourceFile>(`/api/v1/projects/${encodeURIComponent(await activeProjectId())}/source/file?path=${encodeURIComponent(path)}`),
  gitStatus: async () => request<JsonMap>(`/api/v1/projects/${encodeURIComponent(await activeProjectId())}/git`),
  gitAction: async (_operation: "commit" | "pull" | "push", _projectId: string, _paths: string[], _message: string, _confirm = false) => {
    throw new ApiError("Git mutations are not enabled in this public alpha service", 403);
  },
  artifacts: async (search = "", kind = "all", offset = 0, limit = 100, _folder?: string, _folderLimit = 24) => {
    const project = await activeProject();
    const dataset = project.dataset && typeof project.dataset === "object" ? project.dataset as JsonMap : {};
    const datasetId = String(dataset.id || "");
    if (!datasetId) return {available: false, artifacts: [], summary: {files: 0, bytes: 0, kinds: {}}} as ArtifactResponse;
    const page = await request<{samples: JsonMap[]; truncated?: boolean}>(`/api/v1/projects/${encodeURIComponent(project.id)}/datasets/${encodeURIComponent(datasetId)}/samples?cursor=${offset}&limit=${Math.min(100, limit)}`);
    const all = (page.samples || []).map((sample) => {
      const contentType = String(sample.content_type || "application/octet-stream");
      const mediaKind = contentType.startsWith("image/") ? "image" : contentType.startsWith("video/") ? "video" : contentType.startsWith("audio/") ? "audio" : contentType.includes("json") || contentType.startsWith("text/") ? "text" : "file";
      return {
        name: String(sample.name || sample.id),
        path: samplePath(project.id, datasetId, String(sample.id)),
        kind: mediaKind,
        extension: contentType.split("/")[1] || "",
        mime_type: contentType,
        size: Number(sample.size_bytes || 0),
        directory: String(sample.split || "unspecified"),
        details: {sample_id: sample.id, dataset_id: datasetId, sha256: sample.sha256, split: sample.split},
      };
    });
    const artifacts = all.filter((artifact) =>
      (!search || artifact.name.toLowerCase().includes(search.toLowerCase()))
      && (kind === "all" || artifact.kind === kind));
    const kinds = artifacts.reduce<Record<string, number>>((result, artifact) => ({...result, [artifact.kind]: (result[artifact.kind] || 0) + 1}), {});
    const splitCounts = artifacts.reduce<Record<string, number>>((result, artifact) => ({...result, [artifact.directory]: (result[artifact.directory] || 0) + 1}), {});
    return {
      available: true,
      name: String(dataset.name || datasetId),
      root: datasetId,
      total: artifacts.length,
      matched_total: artifacts.length,
      artifacts,
      summary: {files: artifacts.length, directories: Object.keys(splitCounts).length, bytes: artifacts.reduce((sum, item) => sum + Number(item.size || 0), 0), kinds, truncated: Boolean(page.truncated)},
      inventory: {
        name: String(dataset.name || datasetId),
        profile: datasetId,
        scope: "registered-catalog",
        completeness: page.truncated ? "bounded-page" : "complete",
        catalog_truncated: Boolean(page.truncated),
        split_plan: {protocol: "registered-catalog", editable: false, held_out_protected: true},
        totals: {files: artifacts.length, sequences: artifacts.length, frames: artifacts.length},
        splits: Object.entries(splitCounts).map(([id, count]) => ({id, sequences: count, frames: count, objects: 0})),
        sequences: artifacts.map((artifact) => ({id: String((artifact.details as JsonMap).sample_id), path: artifact.path, split: artifact.directory, frames: 1, objects: 0, tracks: 0, editable: !/held|test/i.test(artifact.directory), annotated: false, kind: artifact.kind, media_kind: artifact.kind, preview_path: artifact.path})),
      },
      annotations: {records: 0},
    } as ArtifactResponse;
  },
  rescanArtifacts: async () => ({rescanned: true, source: "registered immutable dataset catalog"}),
  llmWorkspace: publicLlmWorkspace,
  saveLlmExample: savePublicLlmExample,
  deleteLlmExample: async (_projectId: string, _id: string): Promise<{deleted: string; workspace: LlmWorkspace}> => {
    throw new ApiError("Removing the registered source conversation is not enabled; edit its owner-state curation instead", 403);
  },
  runLlmPrompt: (configuration: JsonMap) => runPublicPrompt(configuration),
  llmEvaluations: async () => ({evaluations: [] as LlmEvaluationSummary[], baseline_id: ""}),
  llmEvaluation: async (_id: string): Promise<LlmEvaluation> => { throw new ApiError("Prompt evaluation persistence is not enabled in this public alpha", 403); },
  runLlmEvaluation: async (_configuration: JsonMap): Promise<LlmEvaluation> => { throw new ApiError("Prompt evaluation persistence is not enabled in this public alpha", 403); },
  setLlmEvaluationBaseline: async (_evaluationId: string): Promise<{evaluations: LlmEvaluationSummary[]; baseline_id: string}> => { throw new ApiError("Prompt evaluation baselines are not enabled in this public alpha", 403); },
  updateDatasetSplits: (projectId: string, assignments: Record<string, string>) =>
    post<JsonMap>("/api/artifacts/splits", {project_id: projectId, assignments}),
  annotationFromArtifact: async (path: string) => {
    const identity = sampleIdentity(path);
    if (!identity) throw new ApiError("This object is not a registered dataset sample", 400);
    const page = await request<{samples: JsonMap[]}>(`/api/v1/projects/${encodeURIComponent(identity.projectId)}/datasets/${encodeURIComponent(identity.datasetId)}/samples?limit=100`);
    const index = Math.max(0, page.samples.findIndex((sample) => sample.id === identity.sampleId));
    const annotation = await request<JsonMap>(`/api/v1/projects/${encodeURIComponent(identity.projectId)}/datasets/${encodeURIComponent(identity.datasetId)}/samples/${encodeURIComponent(identity.sampleId)}/annotations`);
    return annotationProjectProjection(identity.projectId, identity.datasetId, page.samples, annotation, index);
  },
  annotationProject: async (path: string) => {
    const identity = annotationIdentity(path);
    if (!identity) throw new ApiError("Annotation project identity is invalid", 400);
    const page = await request<{samples: JsonMap[]}>(`/api/v1/projects/${encodeURIComponent(identity.projectId)}/datasets/${encodeURIComponent(identity.datasetId)}/samples?limit=100`);
    const sample = page.samples[0];
    const annotation = sample ? await request<JsonMap>(`/api/v1/projects/${encodeURIComponent(identity.projectId)}/datasets/${encodeURIComponent(identity.datasetId)}/samples/${encodeURIComponent(String(sample.id))}/annotations`) : {};
    return annotationProjectProjection(identity.projectId, identity.datasetId, page.samples, annotation, 0);
  },
  annotationSample: async (projectHandle: string, index: number) => {
    const identity = annotationIdentity(projectHandle);
    if (!identity) throw new ApiError("Annotation project identity is invalid", 400);
    const page = await request<{samples: JsonMap[]}>(`/api/v1/projects/${encodeURIComponent(identity.projectId)}/datasets/${encodeURIComponent(identity.datasetId)}/samples?cursor=${Math.max(0, index - 1)}&limit=1`);
    const sample = page.samples[0];
    if (!sample) throw new ApiError("Annotation sample was not found", 404);
    const annotation = await request<JsonMap>(`/api/v1/projects/${encodeURIComponent(identity.projectId)}/datasets/${encodeURIComponent(identity.datasetId)}/samples/${encodeURIComponent(String(sample.id))}/annotations`);
    return annotationSampleProjection(projectHandle, index, sample, annotation);
  },
  mutateAnnotation: async (projectHandle: string, change: JsonMap) => mutatePublicAnnotation(projectHandle, change),
  exportAnnotations: async (_project: string, _format: string): Promise<JsonMap> => {
    throw new ApiError("Annotation export is not enabled in the public alpha", 403);
  },
  architecture: async () => request<JsonMap>(`/api/v1/projects/${encodeURIComponent(await activeProjectId())}/architecture`),
  architectureSamples: (split = "test", offset = 0, limit = 48) => request<DescriptorSampleResponse>(`/api/architecture/samples?${new URLSearchParams({split, offset: String(offset), limit: String(limit)})}`),
  researchInferenceCandidates: async () => ({available: false, candidates: [] as ResearchCandidate[], allowed_splits: [], cloud_eligible: false as const, promotion_eligible: false as const}),
  startResearchInference: (configuration: JsonMap) => post<JsonMap>("/api/research-inference/start", configuration),
  inspectArchitecture: (configuration: JsonMap) => post<JsonMap>("/api/architecture/inspect", configuration),
  runtimeArchitecture: async () => request<JsonMap>(`/api/v1/projects/${encodeURIComponent(await activeProjectId())}/architecture`),
  inferenceDefaults: async (_path: string) => {
    const project = await activeProject();
    return {inference_defaults: {weights: String(project.active_checkpoint?.path || ""), dataset: project.selected_dataset || ""}};
  },
  startInference: (configuration: JsonMap) => startManagedAction("inference", configuration),
  stopInference: async () => {
    const active = (await publicRuns()).find((run) => runKind(run) === "inference" && ["queued", "running"].includes(String(run.status)));
    if (!active) return statusFor("inference");
    await post<JsonMap>(`/api/v1/runs/${encodeURIComponent(active.id)}/cancel`, {});
    return statusFor("inference");
  },
  jobs: async (projectId: string) => ({jobs: await publicRuns(projectId)}),
  organizationJobs: async () => ({jobs: await publicRuns()}),
  cancelJob: async (jobId: string) => ({job: await post<JobRecord>(`/api/v1/runs/${encodeURIComponent(jobId)}/cancel`, {})}),
  recoverJob: async (jobId: string) => ({job: await post<JobRecord>(`/api/v1/runs/${encodeURIComponent(jobId)}/recover`, {})}),
  startCloudInference: async (configuration: JsonMap) => ({job: await startManagedAction("inference", {...configuration, compute_target: "cloud"})}),
  cloudInferenceStatus: async (jobId: string) => {
    if (!jobId) return {job: {}};
    try { return {job: await request<JobRecord>(`/api/v1/runs/${encodeURIComponent(jobId)}`)}; }
    catch (reason) { if (reason instanceof ApiError && reason.status === 404) return {job: {}}; throw reason; }
  },
  stopCloudInference: async (jobId: string) => ({job: await post<JobRecord>(`/api/v1/runs/${encodeURIComponent(jobId)}/cancel`, {})}),
  runs: async (_path = "") => ({root: "registered-project", training_runs: (await publicRuns()).filter((run) => runKind(run) === "training") as RunRecord[]}),
  trainingStatus: () => statusFor("training"),
  startTraining: (configuration: JsonMap) => startManagedAction("training", configuration),
  stopTraining: async () => {
    const active = (await publicRuns()).find((run) => runKind(run) === "training" && ["queued", "running"].includes(String(run.status)));
    if (!active) return statusFor("training");
    await post<JsonMap>(`/api/v1/runs/${encodeURIComponent(active.id)}/cancel`, {});
    return statusFor("training");
  },
  replayTensorBoard: (runId: string) => post<JsonMap>("/api/training/tensorboard", {run_id: runId}),
  stopTensorBoard: () => post<JsonMap>("/api/training/tensorboard", {action: "stop"}),
  inferenceStatus: (_artifactPath?: string) => statusFor("inference"),
  systemMetrics: () => request<JsonMap>("/api/v1/system/metrics"),
  modalStatus: () => request<JsonMap>("/api/v1/providers/modal"),
  cloudDatasets: async (): Promise<JsonMap> => ({datasets: [], local_dataset_staging: false}),
  releases: async (): Promise<JsonMap> => ({available: false, releases: [], checkpoints: [], reason: "Release publication is outside the public local workbench boundary."}),
  buildRelease: (projectId: string, checkpoint: string, releaseName = "") => post<JsonMap>("/api/project/releases", {project_id: projectId, checkpoint, release_name: releaseName}),
  applicationDeployment: async (): Promise<JsonMap> => ({available: false, deployed: false, deployment: {}, reason: "Hosted application deployment is outside the public local workbench boundary."}),
  deployApplication: (projectId: string) => post<JsonMap>("/api/project/application-deployment", {project_id: projectId, visibility: "public", confirm_public: true}),
  cliffStatus: () => request<JsonMap>("/api/v1/assistant/status"),
  connectCodexAccount: () => post<{auth_url: string; login_id: string; message: string}>("/api/v1/assistant/account/login", {}),
  cliffHistory: (projectId: string) => request<JsonMap>(`/api/v1/projects/${encodeURIComponent(projectId)}/assistant/history`),
  startCliffRun: (
    projectId: string, sessionId: string | undefined, message: string, requestId: string,
    attachments: Array<{name: string; url: string}> = [],
    delegateRoleId?: CliffDelegateRoleId,
  ) => post<{run: JsonMap}>(`/api/v1/projects/${encodeURIComponent(projectId)}/assistant/runs`, {
    session_id: sessionId,
    request_id: requestId,
    message,
    action_context: {},
    images: attachments.map((attachment) => attachment.url),
    image_names: attachments.map((attachment) => attachment.name),
    delegate_role_id: delegateRoleId,
  }),
  cliffRun: (
    projectId: string, sessionId: string, runId: string, requestId: string, since = 0,
  ) => request<{run: JsonMap}>(`/api/v1/projects/${encodeURIComponent(projectId)}/assistant/runs/${encodeURIComponent(runId)}?${new URLSearchParams({
    session_id: sessionId,
    run_id: runId,
    request_id: requestId,
    since: String(since),
    limit: "100",
  })}`),
  activeCliffRun: async (projectId: string, sessionId: string, since = 0) => {
    try {
      return await request<{run: JsonMap}>(`/api/v1/projects/${encodeURIComponent(projectId)}/assistant/runs/active?${new URLSearchParams({
        session_id: sessionId,
        since: String(since),
        limit: "100",
      })}`);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 404) return {run: null};
      throw reason;
    }
  },
  cancelCliffRun: (
    projectId: string, sessionId: string, runId: string, requestId: string,
  ) => post<{run: JsonMap}>(`/api/v1/projects/${encodeURIComponent(projectId)}/assistant/runs/${encodeURIComponent(runId)}/cancel`, {
    session_id: sessionId,
    run_id: runId,
    request_id: requestId,
  }),
  cliffChat: (projectId: string, sessionId: string | undefined, message: string) => post<JsonMap>("/api/cliff/chat", {
    project_id: projectId,
    session_id: sessionId,
    message,
    allow_actions: false,
    action_context: {},
    images: [],
    image_names: [],
  }),
};

export const artifactUrl = (_kind: "raw" | "thumbnail" | "text", path: string) => {
  const sample = sampleIdentity(path);
  if (sample) return `/api/v1/projects/${encodeURIComponent(sample.projectId)}/datasets/${encodeURIComponent(sample.datasetId)}/samples/${encodeURIComponent(sample.sampleId)}/content`;
  return path;
};

export const annotationFrameUrl = (project: string, index: number) => {
  const identity = annotationIdentity(project);
  if (!identity) return "";
  return `/api/v1/projects/${encodeURIComponent(identity.projectId)}/datasets/${encodeURIComponent(identity.datasetId)}/samples/index/${index}/content`;
};
