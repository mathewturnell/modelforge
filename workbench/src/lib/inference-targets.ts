import type {DescriptorSample, InferenceTarget, Project} from "../types";

export function inferenceTargetKinds(project: Project): string[] {
  const advertised = project.inference_target_contract;
  if (advertised && Array.isArray(advertised.kinds)) return advertised.kinds.map(String);
  const runtime = project.runtime && typeof project.runtime === "object" ? project.runtime as Record<string, unknown> : {};
  const actions = runtime.actions && typeof runtime.actions === "object" ? runtime.actions as Record<string, unknown> : {};
  const inference = actions.inference && typeof actions.inference === "object" ? actions.inference as Record<string, unknown> : {};
  const contract = inference.target_contract && typeof inference.target_contract === "object" ? inference.target_contract as Record<string, unknown> : {};
  return Array.isArray(contract.kinds) && contract.kinds.length ? contract.kinds.map(String) : ["artifact"];
}

export function descriptorSampleInferenceTarget(
  project: Project, datasetRoot: string, sample: DescriptorSample,
): InferenceTarget {
  return {
    projectId: project.id,
    datasetRoot,
    path: `${sample.split}/${sample.id}`,
    name: sample.id,
    kind: "paired RGB + XYZ sample",
    targetType: "descriptor_sample",
    previewPath: sample.preview_path,
    split: sample.split,
    sampleIndex: sample.index,
    sampleId: sample.id,
  };
}
