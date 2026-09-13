import {describe, expect, it} from "vitest";
import {descriptorSampleInferenceTarget, inferenceTargetKinds} from "./inference-targets";

describe("inference target eligibility", () => {
  it("uses the server-advertised framework contract instead of a legacy runtime default", () => {
    expect(inferenceTargetKinds({
      id: "architecture",
      inference_target_contract: {kinds: ["descriptor_sample"], transport: "architecture_inspect"},
      runtime: {actions: {inference: {target_contract: {kinds: ["artifact"]}}}},
    })).toEqual(["descriptor_sample"]);
    expect(inferenceTargetKinds({id: "unavailable", inference_target_contract: {kinds: []}})).toEqual([]);
  });

  it("retains a complete descriptor sample identity for revalidation", () => {
    const target = descriptorSampleInferenceTarget({id: "architecture"}, "/datasets/demo", {
      id: "test_crack_007", kind: "descriptor_sample", split: "test", index: 7,
      inputs: {rgb: "test/crack/rgb/007.png", xyz: "test/crack/xyz/007.tiff"},
      targets: {anomaly_mask: "test/crack/gt/007.png"},
      labels: {anomalous: true, defect_type: "crack"},
      preview_path: "test/crack/rgb/007.png",
    });

    expect(target).toMatchObject({
      targetType: "descriptor_sample", split: "test", sampleIndex: 7,
      sampleId: "test_crack_007",
      kind: "paired RGB + XYZ sample",
    });
  });
});
