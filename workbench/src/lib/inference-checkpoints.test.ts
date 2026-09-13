import {describe, expect, it} from "vitest";
import {eligibleArchitectureCheckpointArtifacts, inferenceCheckpointChoices, trainingRunCheckpointArtifacts} from "./inference-checkpoints";

describe("inferenceCheckpointChoices", () => {
  it("defaults to best.pt from the newest successful run", () => {
    const result = inferenceCheckpointChoices("/dataset/legacy/best.pt", {
      runtime: {checkpoint: "/runs/new/weights/best.pt"},
      weights: [
        {path: "/runs/incomplete/weights/best.pt", run_status: "incomplete", modified: "2026-08-09T14:00:00Z"},
        {path: "/runs/new/weights/best-cook.pt", run_status: "complete", modified: "2026-08-09T13:01:00Z"},
        {path: "/runs/new/weights/best.pt", run_status: "complete", modified: "2026-08-09T13:00:00Z"},
        {path: "/runs/old/weights/best.pt", run_status: "complete", modified: "2026-08-08T13:00:00Z"},
      ],
    }, []);

    expect(result.recommended).toBe("/runs/new/weights/best.pt");
    expect(result.checkpoints[0].path).toBe(result.recommended);
  });

  it("prefers a successful registered artifact over a dataset fallback", () => {
    const result = inferenceCheckpointChoices("/dataset/legacy/best.pt", {weights: []}, [
      {path: "/project/models/promoted.pt", eligible: true, modified: "2026-08-09T12:00:00Z"},
    ]);

    expect(result.recommended).toBe("/project/models/promoted.pt");
  });

  it("projects pt and pth checkpoints from completed durable training runs", () => {
    expect(trainingRunCheckpointArtifacts([
      {status: "complete", modified: "2026-08-09T15:00:00Z", artifacts: [
        {path: "/runs/smoke/checkpoint.pth", kind: "checkpoint"},
        {path: "/runs/smoke/training_summary.json", kind: "metadata"},
      ]},
      {status: "failed", artifacts: [{path: "/runs/failed/checkpoint.pt"}]},
    ])).toEqual([{
      path: "/runs/smoke/checkpoint.pth",
      kind: "checkpoint",
      run_status: "complete",
      modified: "2026-08-09T15:00:00Z",
    }]);
  });

  it("projects only backend-eligible architecture checkpoints", () => {
    expect(eligibleArchitectureCheckpointArtifacts([
      {path: "/runs/frozen/weights/promoted.pt", promotion: {status: "eligible", passed: true}},
      {path: "/runs/frozen/weights/best.pt", promotion: {status: "eligible", passed: true}},
      {path: "/runs/candidate/weights/best.pt", promotion: {status: "candidate", passed: true}},
      {path: "/runs/rejected/weights/best.pt", promotion: {status: "rejected", passed: false}},
      {path: "/runs/frozen/weights/last.pt", promotion: {status: "eligible", passed: true}},
    ]).map((artifact) => artifact.path)).toEqual([
      "/runs/frozen/weights/promoted.pt",
      "/runs/frozen/weights/best.pt",
    ]);
  });
});
