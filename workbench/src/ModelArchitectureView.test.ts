import {describe, expect, it} from "vitest";
import {architectureCategory, graphFromDescriptor, miniMapNodeColor, miniMapNodeStroke, type ModelDescriptor} from "./ModelArchitectureView";

const descriptor: ModelDescriptor = {name: "Model", model_id: "model", descriptor_sha256: "a".repeat(64), checkpoint: {sha256: "b".repeat(64)}, nodes: [
  {id: "frames", label: "Frames", kind: "input", type: "video_frames"},
  {id: "backbone", label: "Backbone", kind: "component", type: "convolutional_backbone"},
  {id: "memory", label: "Memory", kind: "component", type: "memotr_query_updater"},
  {id: "tracks", label: "Tracks", kind: "output"},
], edges: [{source: "frames", target: "backbone"}, {source: "backbone", target: "memory"}, {source: "memory", target: "tracks"}]};

describe("checked descriptor architecture presentation", () => {
  it("preserves every declared edge and restores dependency order without invented links", () => {
    const graph = graphFromDescriptor(descriptor);
    expect(graph.nodes.map(node => node.position.x)).toEqual([70, 410, 750, 1090]);
    expect(graph.edges.map(({source, target}) => ({source, target}))).toEqual(descriptor.edges);
    expect(graph.categories).toEqual(["input", "encoder", "memory", "output"]);
    expect(graph.nodes.filter(node => node.type === "architecture").find(node => node.id === "backbone")?.data.config).toEqual({});
    expect(graph.nodes[1].ariaLabel).toBe("Backbone");
  });
  it("keeps disconnected nodes disconnected and handles declared recurrent graphs", () => {
    const graph = graphFromDescriptor({...descriptor, edges: [{source: "memory", target: "backbone"}, {source: "backbone", target: "memory"}]});
    expect(graph.edges).toHaveLength(2);
    expect(graph.nodes.every(node => Number.isFinite(node.position.x))).toBe(true);
  });
  it("renders declared source capsules without obscuring actual model nodes in the minimap", () => {
    const graph = graphFromDescriptor({...descriptor, sources: [{id: "upstream", name: "Pinned model", revision: "abcdef12345678", node_ids: ["backbone", "memory"]}]});
    const boundary = graph.nodes[0];
    expect(boundary.type).toBe("boundary");
    expect(boundary.selectable).toBe(false);
    expect(miniMapNodeColor(boundary)).toBe("transparent");
    expect(miniMapNodeStroke(boundary)).toBe("transparent");
    expect(graph.objectCount).toBe(4);
    expect(graph.boundaryCount).toBe(1);
    expect(miniMapNodeColor(graph.nodes[1])).toBe("#38bdf8");
  });
  it("uses declared category over inference and keeps declared details intact", () => {
    expect(architectureCategory({id: "video_frames", label: "Input", kind: "video_frames", category: "input"})).toBe("input");
    const node = {...descriptor.nodes[1], detail: "[B, 256]", config: {layers: 6}, parameter_count: 100};
    const graph = graphFromDescriptor({...descriptor, nodes: [node], edges: []});
    expect(graph.nodes.find(node => node.type === "architecture")?.data.config).toEqual({layers: 6, parameter_count: 100});
    expect(graph.nodes[0].data.detail).toBe("[B, 256]");
  });
});
