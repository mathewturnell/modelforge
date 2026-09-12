import {describe, expect, it} from "vitest";
import {readFileSync} from "node:fs";
import {activitiesFor, createLatestRequestGuard, runStatus, tableProjection} from "./App";
import type {Project, Run} from "./types";

const project: Project = {
  id: "fixture", name: "Fixture", capabilities: ["action.training", "action.inference", "dataset.default"],
  action: {id: "inference", kind: "inference"},
  actions: [{id: "training", kind: "training"}, {id: "inference", kind: "inference"}],
  dataset: {id: "default"},
};

describe("public activity projection", () => {
  it("keeps intended local destinations visible without marking absent services ready", () => {
    const activities = activitiesFor(project);
    expect(activities.map((item) => item.label)).toEqual([
      "Overview", "Source", "Dataset", "Annotation", "Models / Architecture", "Training",
      "Inference", "Jobs / Runs", "ModelForge Coding Assistant", "Settings",
    ]);
    expect(activities.find((item) => item.id === "dataset")?.state).toBe("ready");
    expect(activities.find((item) => item.id === "annotation")?.state).toBe("ready");
    expect(activities.find((item) => item.id === "training")?.state).toBe("ready");
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

describe("responsive run access", () => {
  it("keeps the six-region shell and run evidence available at narrow widths", () => {
    const css = readFileSync(new URL("./styles.css", import.meta.url), "utf-8");
    expect(css).toContain('"title title title"');
    expect(css).toContain('"rail workspace assistant"');
    expect(css).toContain('"rail bottom assistant"');
    expect(css).toContain('"status status status"');
    expect(css).toContain(".run-detail");
    expect(css).not.toContain(".run-inspector {\n  display: none");
  });
});
