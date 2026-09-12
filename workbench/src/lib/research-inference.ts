import type {InferenceTarget, JsonMap, ResearchCandidate} from "../types";

export function eligibleResearchCandidates(value: unknown, profile: unknown): ResearchCandidate[] {
  if (!Array.isArray(value)) return [];
  return value.filter((candidate): candidate is ResearchCandidate => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return false;
    const item = candidate as Record<string, unknown>;
    return item.dataset_profile === String(profile || "")
      && item.research_inference_eligible === true
      && item.active === false
      && item.eligible === false
      && item.local_only === true
      && /^[a-f0-9]{64}$/.test(String(item.checkpoint_sha256 || ""));
  });
}

export function researchTargetReady(target: InferenceTarget | null, computeTarget: string): boolean {
  return computeTarget !== "cloud"
    && target?.targetType === "descriptor_sample"
    && ["train", "validation"].includes(String(target.split || ""));
}

export function hostResearchOnly(response: JsonMap): boolean {
  const result = response.result && typeof response.result === "object" && !Array.isArray(response.result)
    ? response.result as JsonMap
    : {};
  const authority = result.authority && typeof result.authority === "object" && !Array.isArray(result.authority)
    ? result.authority as JsonMap
    : {};
  return response.research_only === true
    && authority.research_only === true
    && authority.local_only === true
    && authority.evaluation_eligible === false
    && authority.promotion_eligible === false
    && authority.release_eligible === false
    && authority.deployment_eligible === false;
}

export function scoreDecisionPresentation(prediction: JsonMap, decision: JsonMap, expected: unknown, researchOnly = false) {
  const score = Number(prediction.score);
  const threshold = Number(decision.threshold);
  const calibrated = !researchOnly
    && decision.calibrated === true
    && typeof decision.positive === "boolean"
    && Number.isFinite(threshold);
  return {
    calibrated,
    tone: calibrated ? (decision.positive === true ? "danger" : "success") : "neutral",
    label: calibrated ? String(decision.label || "indeterminate") : researchOnly ? "Uncalibrated research score" : "Uncalibrated score",
    detail: calibrated
      ? `Model score ${Number.isFinite(score) ? score.toFixed(4) : "unavailable"} · calibrated threshold ${threshold.toFixed(4)} · expected ${String(expected || "unknown")}`
      : `${researchOnly ? "Research" : "Model"} score ${Number.isFinite(score) ? score.toFixed(4) : "unavailable"} · no calibrated defect/normal verdict`,
  } as const;
}
