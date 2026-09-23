import {describe, expect, it} from "vitest";
import {activitiesFor, createLatestRequestGuard, runProgressMessage, runStatus, tableProjection} from "./App";
import type {Project, Run} from "./types";

const project: Project = {
  id: "fixture", name: "Fixture", capabilities: ["action.inference", "dataset.default"],
  action: {id: "inference", kind: "inference"}, dataset: {id: "default"},
};

describe("public activity projection", () => {
  it("keeps intended local destinations visible without marking absent services ready", () => {
    const activities = activitiesFor(project);
    expect(activities.map((item) => item.label)).toEqual([
      "Overview", "Source", "Dataset", "Annotation", "Models / Architecture", "Training",
      "Inference", "Jobs / Runs", "ModelForge Coding Assistant", "Settings",
    ]);
    expect(activities.find((item) => item.id === "dataset")?.state).toBe("ready");
    expect(activities.find((item) => item.id === "source")?.state).toBe("unavailable");
    expect(activities.find((item) => item.id === "architecture")?.state).toBe("partial");
    expect(activities.find((item) => item.id === "assistant")?.reason).toContain("not delivered");
  });

  it("does not advertise a dataset when the project declares none", () => {
    expect(activitiesFor({...project, dataset: undefined}).find((item) => item.id === "dataset")).toMatchObject({state: "unavailable"});
  });
});

describe("durable run status", () => {
  it("marks unattached work unavailable instead of presenting it as live", () => {
    const run = {id: "run", project_id: "fixture", status: "running", runtime_observation: {state: "unavailable"}} as Run;
    expect(runStatus(run)).toBe("running · unavailable");
  });
  it("distinguishes requested cancellation", () => {
    const run = {id: "run", project_id: "fixture", status: "running", configuration: {cancellation_requested_at: "now"}} as Run;
    expect(runStatus(run)).toBe("running · cancellation requested");
  });
});

describe("authenticated preview request ordering", () => {
  it("invalidates late sample and artifact responses", () => {
    const guard = createLatestRequestGuard();
    const first = guard.begin(); const second = guard.begin();
    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
    guard.invalidate();
    expect(guard.isCurrent(second)).toBe(false);
  });
});

describe("bounded checked table projection", () => {
  it("projects at most 100 rows and 20 observed columns", () => {
    const value = {predictions: Array.from({length: 105}, (_, index) => ({rank: index, label: `item-${index}`}))};
    const table = tableProjection(value);
    expect(table.rows).toHaveLength(100);
    expect(table.columns).toEqual(["rank", "label"]);
  });
});

// Responsive run access is exercised in first-use.spec.js and
// visual-restoration.spec.js against the rendered browser at desktop and 390px.

describe("observed progress", () => {
  it("keeps missing progress distinct from zero", () => {
    expect(runProgressMessage({id:"r",project_id:"p",status:"running"})).toBe("Waiting for recorded progress.");
    expect(runProgressMessage({id:"r",project_id:"p",status:"running",live:{progress:{percent:0}}})).toBe("running · 0%");
  });
  it("preserves failed terminal and unavailable states", () => {
    expect(runProgressMessage({id:"r",project_id:"p",status:"failed"})).toBe("Recorded status: failed.");
    expect(runProgressMessage({id:"r",project_id:"p",status:"running",runtime_observation:{state:"unavailable",reason:"Disconnected"}})).toBe("Disconnected");
  });
});
