import {describe, expect, it} from "vitest";
import {
  CALIBRATION_DEVICES,
  DEFAULT_CALIBRATION_WORKLOAD,
  estimateDevicePerformance,
  estimateSelectedDevices,
} from "./device-calibration";

describe("device calibration estimator", () => {
  it("keeps estimates deterministic and exposes the limiting resource", () => {
    const l4 = CALIBRATION_DEVICES.find((device) => device.id === "nvidia-l4")!;
    const result = estimateDevicePerformance(l4, DEFAULT_CALIBRATION_WORKLOAD);
    expect(result.fitsMemory).toBe(true);
    expect(result.fps).toBeGreaterThan(0);
    expect(result.latencyMs).toBeGreaterThan(0);
    expect(["compute", "bandwidth"]).toContain(result.limitingFactor);
    expect(result.lowFps).toBeCloseTo(result.fps * .72);
    expect(result.highFps).toBeCloseTo(result.fps * 1.28);
  });

  it("fails capacity honestly instead of projecting spill performance", () => {
    const edge = CALIBRATION_DEVICES.find((device) => device.id === "jetson-orin-nano")!;
    const result = estimateDevicePerformance(edge, {
      ...DEFAULT_CALIBRATION_WORKLOAD,
      weightsMb: 20_000,
      activationsMb: 10_000,
      batchSize: 4,
    });
    expect(result.fitsMemory).toBe(false);
    expect(result.limitingFactor).toBe("capacity");
    expect(result.fps).toBe(0);
    expect(result.latencyMs).toBe(Number.POSITIVE_INFINITY);
  });

  it("preserves catalog order when comparing a selected subset", () => {
    const estimates = estimateSelectedDevices(["nvidia-l4", "cpu-16-core"], DEFAULT_CALIBRATION_WORKLOAD);
    expect(estimates.map((estimate) => estimate.device.id)).toEqual(["cpu-16-core", "nvidia-l4"]);
  });
});
