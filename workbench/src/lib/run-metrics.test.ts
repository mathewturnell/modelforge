import {describe, expect, it} from "vitest";
import {runMetricSeries} from "./utils";
import type {RunRecord} from "../types";

describe("runMetricSeries", () => {
  it("keeps recorded curves and converts numeric terminal values without inventing points", () => {
    const run = {
      id: "run-1",
      metrics: {HOTA: "0.4187", note: "validation"},
      metric_series: {
        loss: [{epoch: 1, value: 0.8}, {epoch: 2, value: 0.4}],
      },
    } as RunRecord;

    expect(runMetricSeries(run)).toEqual({
      HOTA: [{step: 0, value: 0.4187}],
      loss: [{step: 1, value: 0.8}, {step: 2, value: 0.4}],
    });
  });
});
