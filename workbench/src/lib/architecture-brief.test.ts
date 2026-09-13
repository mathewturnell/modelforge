import {describe, expect, it} from "vitest";
import {architectureBrief} from "./architecture-brief";

describe("architecture model brief", () => {
  it("projects the declared summary, provenance, rationale, interfaces, aspects, and adaptations", () => {
    const brief = architectureBrief({
      model: {
        name: "adapted_tracker",
        description: "A temporal tracker built around a pinned upstream detector.",
        key_aspects: ["Temporal memory preserves identities across occlusion."],
        project_modifications: ["Replaced class logits with the project's vehicle ontology."],
      },
      intent: {
        description: "Fallback description.",
        goals: ["Track delivery vehicles through crowded junctions."],
        reasoning: ["The upstream detector provides the best fit for small moving objects."],
      },
      metadata: {model_source_id: "base-tracker"},
      inputs: [{
        id: "frames", type: "video_frames", shape: {frames: 8, channels: 3},
        metadata: {presentation: {title: "Eight-frame camera window"}},
      }],
      nodes: [{id: "memory", type: "temporal_memory", input: "frames"}],
      outputs: [{id: "tracks", type: "object_tracks", input: "memory", shape: {features: 7}}],
    }, {
      project: {model_sources: [{
        id: "base-tracker", provider: "github", name: "Upstream Tracker",
        repository_url: "https://github.com/acme/tracker", revision_short: "abc123",
        role: "Backbone and tracking baseline",
      }]},
    });

    expect(brief.description).toBe("Fallback description.");
    expect(brief.sources[0]).toEqual(expect.objectContaining({
      name: "Upstream Tracker", url: "https://github.com/acme/tracker", revision: "abc123",
    }));
    expect(brief.rationale).toEqual(["The upstream detector provides the best fit for small moving objects."]);
    expect(brief.goals).toEqual(["Track delivery vehicles through crowded junctions."]);
    expect(brief.inputs[0]).toEqual(expect.objectContaining({
      label: "Eight-frame camera window", type: "Video Frames", shape: "T=8 · C=3",
    }));
    expect(brief.outputs[0]).toEqual(expect.objectContaining({label: "Tracks", type: "Object Tracks"}));
    expect(brief.keyAspects).toEqual(["Temporal memory preserves identities across occlusion."]);
    expect(brief.modifications).toEqual(["Replaced class logits with the project's vehicle ontology."]);
  });

  it("derives bounded component aspects but does not invent provenance or project changes", () => {
    const brief = architectureBrief({
      model: {name: "project_model"},
      intent: {description: "Project-owned baseline.", goals: ["Classify samples."], reasoning: []},
      inputs: [],
      nodes: [{id: "feature_encoder", type: "resnet_encoder"}],
      outputs: [],
    });

    expect(brief.sources).toEqual([]);
    expect(brief.modifications).toEqual([]);
    expect(brief.keyAspects).toEqual(["Feature Encoder · Resnet Encoder"]);
  });

  it("synthesizes a fact-only overview when the descriptor contains loader boilerplate", () => {
    const brief = architectureBrief({
      model: {name: "wb2_seven_point_ridge_stencil"},
      intent: {description: "Executable architecture for wb2_seven_point_ridge_stencil."},
      inputs: [{id: "history", type: "tensor", metadata: {name: "Packed history"}}],
      nodes: [
        {id: "features", type: "feature_encoder", metadata: {name: "Seven-point feature construction"}},
        {id: "stencils", type: "ridge_models", metadata: {name: "Nine independent ridge stencils"}},
      ],
      outputs: [{id: "forecast", type: "tensor", metadata: {name: "Packed forecast"}}],
    });

    expect(brief.description).toBe(
      "Packed history flows through Seven-point feature construction and Nine independent ridge stencils to produce Packed forecast.",
    );
  });

  it("rejects non-HTTPS source links from untrusted runtime summaries", () => {
    const brief = architectureBrief({
      model: {name: "unsafe_source", upstream_repository: "javascript:alert(1)"},
      intent: {description: "Unsafe link fixture.", goals: ["Remain safe."], reasoning: ["Test URL filtering."]},
      inputs: [], nodes: [], outputs: [],
    });

    expect(brief.sources[0].url).toBe("");
  });
});
