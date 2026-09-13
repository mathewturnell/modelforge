import {describe, expect, it} from "vitest";
import {formatInferenceDuration} from "./InferenceView";

describe("Inference result timing", () => {
  it("does not round sub-second checked media to zero", () => {
    expect(formatInferenceDuration(.4)).toBe("0.40s");
    expect(formatInferenceDuration(6.027)).toBe("6.0s");
    expect(formatInferenceDuration(65)).toBe("1m 5s");
  });
});
