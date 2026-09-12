import {describe, expect, it} from "vitest";
import {inferenceProgressPresentation} from "./inference-progress";

describe("inferenceProgressPresentation", () => {
  it("shows an honest indeterminate state before worker telemetry arrives", () => {
    expect(inferenceProgressPresentation({stage: "starting", percent: 0, completed: 0, total: 0}, true)).toEqual({
      completed: 0, total: 0, percent: 0, indeterminate: true,
    });
  });

  it("derives measured frame progress when the worker reports counts", () => {
    expect(inferenceProgressPresentation({stage: "inference", completed: 51, total: 202}, true)).toEqual({
      completed: 51, total: 202, percent: 51 / 202 * 100, indeterminate: false,
    });
  });

  it("retains terminal completion", () => {
    expect(inferenceProgressPresentation({stage: "complete", percent: 100}, false)).toEqual({
      completed: 0, total: 0, percent: 100, indeterminate: false,
    });
  });
});
