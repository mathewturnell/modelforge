import type {ActivityId, OpenDocument, Project, RunRecord, SourceFile} from "../types";

function leaf(value: unknown): string {
  const text = String(value || "").trim();
  return text.split(/[\\/]/).filter(Boolean).at(-1) || text;
}

function datasetIdentity(project: Project): {id: string; title: string} {
  const profileId = String(project.active_dataset_profile || project.default_dataset_profile || "").trim();
  const profile = project.dataset_profiles?.find((candidate) => candidate.id === profileId);
  const path = String(project.selected_dataset || project.default_dataset || profile?.root || "").trim();
  return {
    id: profileId || path || "catalog",
    title: profile?.name || leaf(path) || "Dataset catalog",
  };
}

function modelIdentity(project: Project): {id: string; title: string} {
  const version = String(project.active_model_version || "").trim();
  const descriptor = typeof project.architecture_descriptor === "object" && project.architecture_descriptor
    ? project.architecture_descriptor as Record<string, unknown>
    : {};
  const name = String(descriptor.name || project.model_name || "").trim();
  return {
    id: version || name || "architecture",
    title: version ? `${name || "Model"} · ${version}` : name || `${project.name || project.id} model`,
  };
}

/** Build the document representing an activity's current typed project object. */
export function activityDocument(project: Project, activity: ActivityId): OpenDocument {
  const projectName = project.name || project.id;
  if (activity === "knowledge") return {key: "workbench:knowledge", activity, kind: "knowledge", title: "Knowledge Base", subtitle: "ModelForge documentation", closeable: true};
  if (activity === "jobs") return {key: "workbench:jobs", activity, kind: "jobs", title: "Jobs", subtitle: "Tool-wide execution history", closeable: true};
  if (activity === "overview") return {key: `${project.id}:overview`, activity, kind: "overview", title: projectName, subtitle: "Project overview"};
  if (activity === "data") {
    const dataset = datasetIdentity(project);
    return {key: `${project.id}:dataset:${dataset.id}`, activity, kind: "dataset", title: dataset.title, subtitle: "Dataset", closeable: true};
  }
  if (activity === "model") {
    const model = modelIdentity(project);
    return {key: `${project.id}:model:${model.id}`, activity, kind: "architecture", title: model.title, subtitle: "Model architecture", closeable: true};
  }

  const details: Record<Exclude<ActivityId, "overview" | "data" | "model" | "knowledge" | "jobs">, {kind: OpenDocument["kind"]; title: string; subtitle: string}> = {
    source: {kind: "source-collection", title: `${projectName} source`, subtitle: "Project files"},
    github: {kind: "repository", title: "GitHub explorer", subtitle: "Repository search"},
    huggingface: {kind: "repository", title: "Hugging Face explorer", subtitle: "Dataset search"},
    runs: {kind: "run-collection", title: `${projectName} training`, subtitle: "Training history"},
    inference: {kind: "inference", title: `${projectName} inference`, subtitle: "Inference session"},
    llm: {kind: "llm", title: `${projectName} LLM lab`, subtitle: "Conversation data and prompts"},
    calibration: {kind: "calibration", title: `${projectName} capacity`, subtitle: "Simulation"},
    deploy: {kind: "deployment", title: `${projectName} releases`, subtitle: "Deployments"},
    monitor: {kind: "monitor", title: `${projectName} runtime`, subtitle: "Monitoring"},
    settings: {kind: "settings", title: "Workbench preferences", subtitle: "Settings"},
  };
  const detail = details[activity];
  return {key: `${project.id}:${activity}:workspace`, activity, ...detail, closeable: true};
}

export function sourceDocument(project: Project, file: SourceFile): OpenDocument {
  return {
    key: `${project.id}:source:${file.path}`,
    activity: "source",
    kind: "source",
    title: file.name || leaf(file.path),
    subtitle: file.path,
    payload: file,
    closeable: true,
  };
}

export function runDocument(project: Project, run: RunRecord): OpenDocument {
  const id = String(run.id || run.relative_path || run.path || run.name || "run");
  return {
    key: `${project.id}:run:${id}`,
    activity: "runs",
    kind: "run",
    title: String(run.name || run.id || "Training run"),
    subtitle: String(run.model || run.status || "Recorded run"),
    payload: run,
    closeable: true,
  };
}

export function replaceCollectionDocument(documents: OpenDocument[], document: OpenDocument): OpenDocument[] {
  const withoutPlaceholder = documents.filter((candidate) => !(
    candidate.activity === document.activity
    && (candidate.kind === "source-collection" || candidate.kind === "run-collection")
  ));
  const index = withoutPlaceholder.findIndex((candidate) => candidate.key === document.key);
  if (index < 0) return [...withoutPlaceholder, document];
  return withoutPlaceholder.map((candidate, candidateIndex) => candidateIndex === index ? document : candidate);
}
