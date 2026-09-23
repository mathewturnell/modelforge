import {describe, expect, it} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {buildTrainingChartEvidence, TelemetryView} from "./TrainingTelemetryView";
import type {Run} from "./types";
const run = (id: string, points: [number, number][], split = "train"): Run => ({id, project_id: "project", status: "completed", telemetry: {status: "available", events: points.map(([step,value]) => ({step,value,split,name: "loss"}))}});
describe("recorded comparison evidence", () => {
  it("preserves different numeric step schedules and leaves missing coordinates null", () => {
    const evidence=buildTrainingChartEvidence([run("a", [[0, 4], [10, 2]]), run("b", [[0, 3], [1, 2], [10, 1]])], "train/loss");
    expect(evidence.rows).toEqual([{step:0,a:4,b:3},{step:1,a:null,b:2},{step:10,a:2,b:1}]);
    expect(evidence.pointCount).toBe(5);
    expect(evidence.latestStep).toBe(10);
    expect(evidence.latestValue).toBeNull();
    expect(evidence.terminalOnly).toBe(false);
  });
  it("never substitutes a training value for an absent validation metric", () => {
    const evidence=buildTrainingChartEvidence([run("a", [[0, 0]]), run("b", [[0, 7]], "validation")], "validation/loss");
    expect(evidence.rows).toEqual([{step:0,a:null,b:7}]);
    expect(evidence.terminalRows).toEqual([{name:"b",value:7}]);
    expect(evidence.terminalOnly).toBe(true);
  });
  it("preserves zero and full numeric precision without manufacturing intermediate values", () => {
    const evidence=buildTrainingChartEvidence([run("a", [[0, 0], [100, 2.5600000000000005]])], "train/loss");
    expect(evidence.rows).toEqual([{step:0,a:0},{step:100,a:2.5600000000000005}]);
    expect(evidence.latestValue).toBe(2.5600000000000005);
  });
  it("does not manufacture an optimizer step when no metric was recorded", () => {
    const evidence=buildTrainingChartEvidence([], "train/loss");
    expect(evidence.rows).toEqual([]);
    expect(evidence.latestStep).toBeNull();
    expect(evidence.latestValue).toBeNull();
    expect(evidence.pointCount).toBe(0);
  });
});


describe("comparison presentation", () => {
  it("uses sidebar selection without duplicating its controls and retains exact values", () => {
    const html = renderToStaticMarkup(createElement(TelemetryView, {
      runs: [run("a", [[0, 2.5600000000000005]]), run("b", [[0, 0]])],
      selectedRunIds: ["a"], onSelectionChange: () => {},
    }));
    expect(html).toContain("Compare 1 recorded results");
    expect(html).not.toContain('aria-label="Runs to compare"');
    expect(html).toContain('aria-label="Remove a"');
    expect(html).not.toContain('aria-label="Remove b"');
    expect(html).toContain("2.5600000000000005");
    expect(html).toContain("<details");
    expect(html).toContain("Metric summary");
  });
  it("renders no fabricated metric card for a run without scalar evidence", () => {
    const html = renderToStaticMarkup(createElement(TelemetryView, {runs: [run("a", [])]}));
    expect(html).toContain("No scientific telemetry is available for these runs.");
    expect(html).not.toContain("Metric summary");
  });
});


describe("single-run essential curves", () => {
  it("does not manufacture learning rate or gradient history from loss samples", () => {
    const html = renderToStaticMarkup(createElement(TelemetryView, {runs: [run("a", [[1, 4],[2, 2]])], mode: "inspect", inspectedRunId: "a"}));
    expect(html).toContain("Essential training curves");
    expect(html).toContain("This run did not retain learning rate samples.");
    expect(html).toContain("This run did not retain gradient norm samples.");
    expect(html).toContain("This run did not retain validation loss samples.");
    expect(html).not.toContain("This run did not retain training loss samples.");
    expect(html).toContain("Advanced metric explorer");
  });
});
