import {describe, expect, it} from "vitest";
import type {Project, RunRecord, SourceFile} from "../types";
import {activityDocument, replaceCollectionDocument, runDocument, sourceDocument} from "./documents";

const project: Project = {
  id: "vision-lab",
  name: "Vision Lab",
  selected_dataset: "/datasets/city-sequences",
  active_dataset_profile: "training",
  dataset_profiles: [{id: "training", name: "City sequences", root: "/datasets/city-sequences"}],
  active_model_version: "v7",
  architecture_descriptor: {name: "Tracker"},
};

describe("typed workbench documents", () => {
  it("names dataset and model tabs after their active objects", () => {
    expect(activityDocument(project, "data")).toMatchObject({
      key: "vision-lab:dataset:training",
      kind: "dataset",
      title: "City sequences",
    });
    expect(activityDocument(project, "model")).toMatchObject({
      key: "vision-lab:model:v7",
      kind: "architecture",
      title: "Tracker · v7",
    });
  });

  it("uses project-scoped source and run identities", () => {
    const file: SourceFile = {name: "trainer.py", path: "src/trainer.py", content: "pass"};
    const run = {id: "run-42", name: "Baseline 42", status: "completed"} as RunRecord;
    expect(sourceDocument(project, file)).toMatchObject({key: "vision-lab:source:src/trainer.py", title: "trainer.py", payload: file});
    expect(runDocument(project, run)).toMatchObject({key: "vision-lab:run:run-42", title: "Baseline 42", payload: run});
  });

  it("keeps shell documentation independent of project identity", () => {
    expect(activityDocument(project, "knowledge")).toMatchObject({
      key: "workbench:knowledge",
      kind: "knowledge",
      title: "Knowledge Base",
    });
    expect(activityDocument({id: "another-project"}, "knowledge").key).toBe("workbench:knowledge");
  });

  it("keeps tool-wide Jobs independent of project identity", () => {
    expect(activityDocument(project, "jobs")).toMatchObject({
      key: "workbench:jobs",
      kind: "jobs",
      title: "Jobs",
      subtitle: "Tool-wide execution history",
    });
    expect(activityDocument({id: "another-project"}, "jobs").key).toBe("workbench:jobs");
  });

  it("replaces collection placeholders when a concrete object opens", () => {
    const placeholder = activityDocument(project, "source");
    const file = sourceDocument(project, {name: "model.py", path: "src/model.py", content: "pass"});
    expect(replaceCollectionDocument([activityDocument(project, "overview"), placeholder], file).map((document) => document.kind))
      .toEqual(["overview", "source"]);
  });
});
