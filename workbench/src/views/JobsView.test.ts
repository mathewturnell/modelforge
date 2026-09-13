import {describe, expect, it} from "vitest";
import {
  jobDuration, jobIsActive, jobKind, jobLocation, jobPeriod, jobProjectLabel, jobTargetLabel, jobWorkspace,
} from "./JobsView";
import type {JobRecord} from "../types";

const base: JobRecord = {
  id: "job-1", project_id: "demo", status: "queued", provider: "local",
  compute_target: "gpu", created_at: "2026-08-10T10:00:00Z", request: {},
};

describe("Jobs lifecycle projection", () => {
  it("maps durable states to scheduled, ongoing, and past buckets", () => {
    expect(jobPeriod(base)).toBe("scheduled");
    expect(jobPeriod({...base, status: "running"})).toBe("ongoing");
    expect(jobPeriod({...base, status: "completed"})).toBe("past");
    expect(jobPeriod({...base, status: "failed"})).toBe("past");
    expect(jobPeriod({...base, status: "cancelled"})).toBe("past");
  });

  it("uses explicit workflow evidence to separate inference from training", () => {
    expect(jobKind({...base, request: {workflow: "inference"}})).toBe("inference");
    expect(jobKind({...base, configuration: {workflow: "inference"}})).toBe("inference");
    expect(jobKind({...base, request: {workflow: "architecture"}})).toBe("training");
    expect(jobWorkspace({...base, request: {workflow: "inference"}})).toBe("inference");
    expect(jobWorkspace(base)).toBe("runs");
  });

  it("offers cancellation only for non-terminal durable states", () => {
    expect(jobIsActive(base)).toBe(true);
    expect(jobIsActive({...base, status: "running"})).toBe(true);
    expect(jobIsActive({...base, status: "completed"})).toBe(false);
    expect(jobIsActive({...base, status: "cancelled"})).toBe(false);
  });

  it("distinguishes local devices from managed cloud accelerators", () => {
    expect(jobLocation(base)).toBe("local");
    expect(jobTargetLabel(base)).toBe("Local GPU");
    expect(jobTargetLabel({...base, compute_target: "cpu", request: {device: "cpu"}})).toBe("Local CPU");
    const cloud = {...base, provider: "modal", compute_target: "cloud", request: {modal_gpu: "L4"}};
    expect(jobLocation(cloud)).toBe("cloud");
    expect(jobTargetLabel(cloud)).toBe("Cloud · L4");
  });

  it("derives duration only from authoritative timestamps", () => {
    expect(jobDuration({...base, started_at: "2026-08-10T10:00:00Z", completed_at: "2026-08-10T11:02:05Z"})).toBe("1h 2m");
    expect(jobDuration({...base, started_at: "2026-08-10T10:00:00Z", status: "running"}, Date.parse("2026-08-10T10:03:12Z"))).toBe("3m 12s");
  });

  it("shows the owning registered project and retains orphaned project identity", () => {
    expect(jobProjectLabel(base, [{id: "demo", name: "Demo Lab"}])).toBe("Demo Lab");
    expect(jobProjectLabel({...base, project_id: "archived"}, [{id: "demo", name: "Demo Lab"}])).toBe("archived");
  });
});
