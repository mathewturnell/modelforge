import {describe, expect, it} from "vitest";
import {isLocalComputeTarget, loopbackTensorBoardUrl, tensorBoardVisibleForRun, trainingActionCheckpointMode, trainingCheckpointChoices} from "./RunsView";

describe("loopbackTensorBoardUrl", () => {
  it("accepts only local HTTP TensorBoard origins", () => {
    expect(loopbackTensorBoardUrl("http://127.0.0.1:6006/")).toBe("http://127.0.0.1:6006/");
    expect(loopbackTensorBoardUrl("http://localhost:49152/experiments")).toBe("http://localhost:49152/experiments");
    expect(loopbackTensorBoardUrl("https://attacker.example/tensorboard")).toBe("");
    expect(loopbackTensorBoardUrl("javascript:alert(1)")).toBe("");
  });
});

describe("tensorBoardVisibleForRun", () => {
  it("keeps retained dashboards bound to their owning run", () => {
    const retained = {tensorboard_running: true, tensorboard_run_id: "run-a"};
    expect(tensorBoardVisibleForRun(retained, "run-a")).toBe(true);
    expect(tensorBoardVisibleForRun(retained, "run-b")).toBe(false);
    expect(tensorBoardVisibleForRun({tensorboard_running: true}, "run-b")).toBe(true);
  });
});

describe("registered training checkpoints", () => {
  it("treats automatic, CPU, and GPU device selections as local execution", () => {
    expect(isLocalComputeTarget("local")).toBe(true);
    expect(isLocalComputeTarget("cpu")).toBe(true);
    expect(isLocalComputeTarget("gpu")).toBe(true);
    expect(isLocalComputeTarget("cloud")).toBe(false);
  });

  it("distinguishes required and optional checkpoint templates", () => {
    expect(trainingActionCheckpointMode({arguments: ["--base", "{checkpoint}"]})).toEqual({consumed: true, required: true});
    expect(trainingActionCheckpointMode({environment: {BASE_MODEL: "{checkpoint?}"}})).toEqual({consumed: true, required: false});
    expect(trainingActionCheckpointMode({arguments: ["--epochs", "{epochs}"]})).toEqual({consumed: false, required: false});
  });

  it("projects and deduplicates server-owned training choices", () => {
    expect(trainingCheckpointChoices({
      id: "demo",
      training_checkpoints: [
        {path: "/project/.modelforge/models/base", name: "Base model", source: "project-model", recommended: true},
        {path: "/project/.modelforge/models/base", name: "Duplicate"},
        {path: "/project/.modelforge/runs/run-1/model", source: "training-run"},
      ],
    })).toEqual([
      {path: "/project/.modelforge/models/base", name: "Base model", source: "project-model", recommended: true},
      {path: "/project/.modelforge/runs/run-1/model", name: "model", source: "training-run", recommended: false},
    ]);
  });
});
