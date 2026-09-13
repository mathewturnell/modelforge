import {describe, expect, it} from "vitest";
import {eligibleResearchCandidates, hostResearchOnly, researchTargetReady, scoreDecisionPresentation} from "./research-inference";
import type {InferenceTarget} from "../types";

describe("research candidate inference boundary", () => {
  it("keeps inactive local research candidates separate by profile", () => {
    const exact = {id: "candidate", model_version_id: "v2", dataset_profile: "potato", checkpoint_sha256: "a".repeat(64), research_inference_eligible: true, active: false, eligible: false, local_only: true};
    expect(eligibleResearchCandidates([exact, {...exact, eligible: true}, {...exact, dataset_profile: "tire"}], "potato")).toEqual([exact]);
  });

  it("accepts only local train or validation descriptor samples", () => {
    const target: InferenceTarget = {projectId: "p", datasetRoot: "/data", path: "train/a", name: "a", kind: "paired", targetType: "descriptor_sample", split: "train"};
    expect(researchTargetReady(target, "local")).toBe(true);
    expect(researchTargetReady({...target, split: "validation"}, "local")).toBe(true);
    expect(researchTargetReady({...target, split: "test"}, "local")).toBe(false);
    expect(researchTargetReady(target, "cloud")).toBe(false);
  });

  it("never presents an uncalibrated research score as a normal verdict", () => {
    const response = {
      research_only: true,
      result: {authority: {
        research_only: true, local_only: true, evaluation_eligible: false,
        promotion_eligible: false, release_eligible: false, deployment_eligible: false,
      }},
    };
    expect(hostResearchOnly(response)).toBe(true);
    expect(scoreDecisionPresentation(
      {score: 95.875},
      {label: "Normal", positive: false, threshold: 0, calibrated: true},
      "research-only",
      hostResearchOnly(response),
    )).toEqual({
      calibrated: false,
      tone: "neutral",
      label: "Uncalibrated research score",
      detail: "Research score 95.8750 · no calibrated defect/normal verdict",
    });
    expect(hostResearchOnly({...response, research_only: false})).toBe(false);
  });
});
