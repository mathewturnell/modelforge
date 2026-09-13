import {describe, expect, it} from "vitest";
import {overviewTextList} from "./OverviewView";

describe("living project overview", () => {
  it("renders structured rationale points as their human text", () => {
    expect(overviewTextList([
      {keyword: "Data", text: "Use a synthetic contract smoke test."},
      {description: "Keep official benchmark claims separate."},
      null,
    ])).toEqual([
      "Use a synthetic contract smoke test.",
      "Keep official benchmark claims separate.",
    ]);
  });
});
