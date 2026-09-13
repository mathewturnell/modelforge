import type {JsonMap} from "../types";

export type InferenceCheckpoint = {
  path: string;
  name: string;
  modified: string;
  successful: boolean;
};

export function trainingRunCheckpointArtifacts(value: unknown): JsonMap[] {
  if (!Array.isArray(value)) return [];
  const found = new Map<string, JsonMap>();
  for (const rawRun of value) {
    const run = objectAt(rawRun);
    const status = String(run.status || "").toLowerCase();
    if (!["complete", "completed", "success", "succeeded"].includes(status)) continue;
    const candidates = [
      ...(Array.isArray(run.weights) ? run.weights : []),
      ...(Array.isArray(run.artifacts) ? run.artifacts : []),
    ];
    for (const rawArtifact of candidates) {
      const artifact = objectAt(rawArtifact);
      const path = checkpointPath(artifact.path || artifact.storage_ref);
      if (!path) continue;
      found.set(path, {
        ...artifact,
        path,
        run_status: status,
        modified: String(artifact.modified || run.modified || ""),
      });
    }
  }
  return [...found.values()];
}

export function eligibleArchitectureCheckpointArtifacts(value: unknown): JsonMap[] {
  if (!Array.isArray(value)) return [];
  return value.map(objectAt).filter((artifact) => {
    const path = checkpointPath(artifact.path || artifact.artifact_ref);
    const promotion = objectAt(artifact.promotion);
    return Boolean(path)
      && ["best.pt", "promoted.pt"].includes(basename(path))
      && String(promotion.status || "").toLowerCase() === "eligible"
      && promotion.passed === true;
  });
}

function objectAt(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
}

function checkpointPath(value: unknown): string {
  return typeof value === "string" && /\.(pt|pth|onnx|safetensors)$/i.test(value) ? value : "";
}

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1)?.toLowerCase() || "";
}

function successfulCheckpoint(value: JsonMap): boolean {
  const promotion = String(objectAt(value.promotion).status || "").toLowerCase();
  const runStatus = String(value.run_status || value.runStatus || "").toLowerCase();
  const artifactStatus = String(value.status || "").toLowerCase();
  return ["eligible", "promoted"].includes(promotion)
    || ["complete", "completed", "success", "succeeded"].includes(runStatus)
    || value.eligible === true
    || artifactStatus === "eligible";
}

function modifiedTime(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function inferenceCheckpointChoices(
  defaultWeight: unknown,
  runtimeValue: unknown,
  projectArtifacts: unknown[],
): {checkpoints: InferenceCheckpoint[]; recommended: string} {
  const runtime = objectAt(runtimeValue);
  const found = new Map<string, InferenceCheckpoint>();

  const add = (raw: unknown) => {
    const value = objectAt(raw);
    const path = checkpointPath(typeof raw === "string" ? raw : value.path || value.artifact_ref);
    if (!path) return;
    const previous = found.get(path);
    found.set(path, {
      path,
      name: String(value.name || previous?.name || basename(path)),
      modified: String(value.modified || previous?.modified || ""),
      successful: Boolean(previous?.successful || successfulCheckpoint(value)),
    });
  };

  const runtimeWeights = Array.isArray(runtime.weights) ? runtime.weights : [];
  runtimeWeights.forEach(add);
  projectArtifacts.forEach(add);
  const runtimeCheckpoint = checkpointPath(objectAt(runtime.runtime).checkpoint);
  if (runtimeCheckpoint) add(runtimeCheckpoint);
  add(defaultWeight);

  const checkpoints = [...found.values()];
  const successful = checkpoints.filter((checkpoint) => checkpoint.successful);
  const successfulPrimary = successful.filter((checkpoint) =>
    ["promoted.pt", "best.pt"].includes(basename(checkpoint.path)),
  );
  const ranked = (successfulPrimary.length ? successfulPrimary : successful).sort((left, right) =>
    modifiedTime(right.modified) - modifiedTime(left.modified)
      || Number(basename(right.path) === "promoted.pt") - Number(basename(left.path) === "promoted.pt"),
  );
  const recommended = ranked[0]?.path
    || runtimeCheckpoint
    || checkpointPath(defaultWeight)
    || checkpoints[0]?.path
    || "";
  return {
    checkpoints: [
      ...checkpoints.filter((checkpoint) => checkpoint.path === recommended),
      ...checkpoints.filter((checkpoint) => checkpoint.path !== recommended),
    ],
    recommended,
  };
}
