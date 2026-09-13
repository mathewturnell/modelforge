import {describe, expect, it} from "vitest";
import {architectureCategory, graphFromArchitecture} from "./architecture-graph";

const linearArchitecture = {
  model: {name: "tracking_model"},
  inputs: [{id: "frames", type: "video_frames", shape: {frames: 8, channels: 3}}],
  nodes: [
    {id: "encoder", type: "rawnet3d_multiscale", input: "frames"},
    {id: "transformer", type: "deformable_transformer", input: "encoder"},
    {id: "memory", type: "learn_target_memory_queries", input: "transformer"},
    {id: "compatibility", type: "vehicle_compatibility", inputs: {query: "memory", features: "encoder"}},
  ],
  outputs: [{id: "tracks", type: "object_tracks", input: "compatibility"}],
};

describe("architecture graph projection", () => {
  it("keeps a linear dependency chain on one horizontal axis", () => {
    const graph = graphFromArchitecture(linearArchitecture);
    const chain = ["frames", "encoder", "transformer", "memory", "compatibility", "tracks"]
      .map((id) => graph.nodes.find((node) => node.id === id));

    expect(chain.every(Boolean)).toBe(true);
    expect(new Set(chain.map((node) => node?.position.y))).toEqual(new Set([190]));
    expect(chain.map((node) => node?.position.x)).toEqual([70, 410, 750, 1090, 1430, 1770]);
    expect(chain.every((node) => node?.origin?.[0] === 0 && node.origin[1] === .5)).toBe(true);
    expect(chain.every((node) => node?.initialWidth === 260 && node.initialHeight === 116)).toBe(true);
  });

  it("reads every named input port and categorizes visibly different component families", () => {
    const graph = graphFromArchitecture(linearArchitecture);

    expect(graph.edges.some((edge) => edge.source === "encoder" && edge.target === "compatibility")).toBe(true);
    expect(graph.edges.some((edge) => edge.source === "memory" && edge.target === "compatibility")).toBe(true);
    expect(architectureCategory(linearArchitecture.nodes[0], "component")).toBe("encoder");
    expect(architectureCategory(linearArchitecture.nodes[1], "component")).toBe("transformer");
    expect(architectureCategory(linearArchitecture.nodes[2], "component")).toBe("memory");
    expect(architectureCategory(linearArchitecture.nodes[3], "component")).toBe("logic");
  });

  it("centers parallel nodes within their shared dependency depth", () => {
    const graph = graphFromArchitecture({
      inputs: [{id: "input", type: "tensor", shape: {features: 4}}],
      nodes: [
        {id: "left", type: "feature_encoder", input: "input"},
        {id: "right", type: "feature_encoder", input: "input"},
        {id: "merge", type: "fusion", inputs: {left: "left", right: "right"}},
      ],
      outputs: [{id: "output", type: "tensor", input: "merge"}],
    });
    const left = graph.nodes.find((node) => node.id === "left");
    const right = graph.nodes.find((node) => node.id === "right");

    expect(left?.position.x).toBe(right?.position.x);
    expect(((left?.position.y || 0) + (right?.position.y || 0)) / 2).toBe(190);
  });

  it("renders display names preserved by the typed descriptor loader", () => {
    const graph = graphFromArchitecture({
      inputs: [{id: "history", type: "tensor", metadata: {name: "Runtime boundary · [18,9,25] in"}}],
      nodes: [{
        id: "signals_t_minus_12h",
        type: "input_tensor_view",
        input: "history",
        config: {
          signals: [
            {name: "temperature", visible_name: "Temperature", units: "K"},
            {name: "u_component_of_wind", visible_name: "Zonal wind", units: "m/s"},
          ],
          levels_hpa: [250, 500, 850],
          grid: {axes: ["latitude", "longitude"], shape: [9, 25]},
        },
        metadata: {
          name: "t−12 h · temperature (K) · zonal/u wind (m/s)",
          presentation: {title: "Atmospheric state · t−12 h", summary: "9 channels"},
        },
      }],
      outputs: [{id: "forecast", type: "tensor", input: "signals_t_minus_12h"}],
    });

    expect(graph.nodes.find((node) => node.id === "history")?.data.label)
      .toBe("Runtime boundary · [18,9,25] in");
    expect(graph.nodes.find((node) => node.id === "signals_t_minus_12h")?.data.label)
      .toBe("Atmospheric state · t−12 h");
    expect(graph.nodes.find((node) => node.id === "signals_t_minus_12h")?.data.summary)
      .toBe("9 channels");
    expect(graph.nodes.find((node) => node.id === "signals_t_minus_12h")?.data.detailGroups)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({label: "Signals", expanded: false, items: [
          {label: "Temperature", value: "K"},
          {label: "Zonal wind", value: "m/s"},
        ]}),
        expect.objectContaining({label: "Pressure levels", expanded: false}),
        expect.objectContaining({label: "Grid", expanded: false}),
      ]));
  });

  it("projects declared presentation groups with every row minimized by default", () => {
    const graph = graphFromArchitecture({
      inputs: [{
        id: "history",
        type: "tensor",
        metadata: {presentation: {title: "Atmospheric history", groups: [
          {title: "Signals", items: [{label: "Temperature", value: "K"}]},
          {title: "Pressure levels", items: [{label: "250", value: "hPa"}]},
        ]}},
      }],
      outputs: [{id: "forecast", type: "tensor", input: "history"}],
    });
    const groups = graph.nodes.find((node) => node.id === "history")?.data.detailGroups;

    expect(groups).toEqual([
      {label: "Signals", items: [{label: "Temperature", value: "K"}], expanded: false},
      {label: "Pressure levels", items: [{label: "250", value: "hPa"}], expanded: false},
    ]);
  });

  it("draws a labelled capsule only for a declared upstream source", () => {
    const graph = graphFromArchitecture(
      {...linearArchitecture, metadata: {model_source_id: "tracker-upstream"}},
      {
        project: {
          runtime: {actions: {inference: {}}},
          model_sources: [{id: "tracker-upstream", name: "Tracker", provider: "github", revision: "1234567890abcdef"}],
        },
      },
    );
    const boundary = graph.nodes.find((node) => node.type === "boundary");

    expect(graph.boundaryCount).toBe(1);
    expect(boundary?.data.label).toBe("Tracker");
    expect(boundary?.position.x).toBeLessThan(graph.nodes.find((node) => node.id === "encoder")!.position.x);
    expect(boundary?.initialWidth).toBe(boundary?.style?.width);
    expect(boundary?.initialHeight).toBe(boundary?.style?.height);
  });

  it("maps runtime bindings and input contracts to bounded project source candidates", () => {
    const graph = graphFromArchitecture(linearArchitecture, {
      project: {adapters: {architecture_summary: "bbqai.architecture:bbq_runtime_architecture_summary"}},
      component_catalog: {components: [{
        type: "deformable_transformer",
        runtime_binding: "bbqai.models.detector.model.DeformableTransformer",
      }]},
    });
    const transformer = graph.nodes.find((node) => node.id === "transformer");
    const input = graph.nodes.find((node) => node.id === "frames");

    expect(transformer?.data.sourceCandidates).toContainEqual(expect.objectContaining({path: "bbqai/models/detector/model.py", label: "Runtime implementation"}));
    expect(input?.data.sourceCandidates).toContainEqual(expect.objectContaining({path: "bbqai/architecture.py", label: "Input contract declaration"}));
  });

  it("maps declared model files and the project-relative descriptor without inventing absolute source access", () => {
    const graph = graphFromArchitecture({
      ...linearArchitecture,
      model: {
        name: "tracking_model",
        implementation: "src/tracker/model.py",
        adapter: "src/tracker/adapter.py",
      },
    }, {
      architecture_path: "/workspace/.modelforge/models/tracker/architecture.mforge.yaml",
      project: {
        repository: "/workspace",
        assistant_workspace: {source_root: "/workspace"},
      },
    });
    const transformer = graph.nodes.find((node) => node.id === "transformer");
    const input = graph.nodes.find((node) => node.id === "frames");

    expect(transformer?.data.sourceCandidates).toEqual(expect.arrayContaining([
      expect.objectContaining({path: "src/tracker/model.py", label: "Declared model implementation"}),
      expect.objectContaining({path: "src/tracker/adapter.py", label: "Declared model adapter"}),
      expect.objectContaining({path: ".modelforge/models/tracker/architecture.mforge.yaml", label: "Architecture descriptor"}),
    ]));
    expect(input?.data.sourceCandidates).toContainEqual(expect.objectContaining({
      path: ".modelforge/models/tracker/architecture.mforge.yaml",
      label: "Architecture descriptor",
    }));

    const external = graphFromArchitecture(linearArchitecture, {
      architecture_path: "/outside/architecture.mforge.yaml",
      project: {repository: "/workspace"},
    });
    expect(external.nodes.find((node) => node.id === "frames")?.data.sourceCandidates).toEqual([]);

    const escaping = graphFromArchitecture({
      ...linearArchitecture,
      model: {implementation: "../outside/model.py"},
    });
    expect(escaping.nodes.find((node) => node.id === "transformer")?.data.sourceCandidates).toEqual([]);
  });
});
