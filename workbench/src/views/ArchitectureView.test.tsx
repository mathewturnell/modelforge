import {renderToStaticMarkup} from "react-dom/server";
import {applyNodeChanges, ReactFlow} from "@xyflow/react";
import {describe, expect, it} from "vitest";
import {graphFromArchitecture} from "../lib/architecture-graph";
import {ArchitectureMiniMap} from "./ArchitectureView";

describe("architecture minimap", () => {
  it("renders nonzero semantic rectangles while keeping source boundaries transparent", () => {
    const graph = graphFromArchitecture({
      metadata: {model_source_id: "upstream"},
      inputs: [{id: "input", type: "tensor"}],
      nodes: [{id: "encoder", type: "feature_encoder", input: "input"}],
      outputs: [{id: "output", type: "tensor", input: "encoder"}],
    }, {
      project: {
        runtime: {actions: {inference: {}}},
        model_sources: [{id: "upstream", name: "Upstream", provider: "github", revision: "abc123"}],
      },
    });

    const html = renderToStaticMarkup(
      <ReactFlow nodes={graph.nodes} edges={graph.edges} width={800} height={500}>
        <ArchitectureMiniMap />
      </ReactFlow>,
    );
    const rectangles = [...html.matchAll(/<rect[^>]*class="react-flow__minimap-node"[^>]*>/g)].map(([rect]) => rect);
    const semanticRectangles = rectangles.filter((rect) => !rect.includes("fill:transparent"));
    const boundaryRectangle = rectangles.find((rect) => rect.includes("fill:transparent"));

    expect(rectangles).toHaveLength(graph.nodes.length);
    expect(semanticRectangles).toHaveLength(graph.objectCount);
    expect(semanticRectangles.every((rect) => !rect.includes('width="0"') && !rect.includes('height="0"'))).toBe(true);
    expect(boundaryRectangle).toContain("stroke:transparent");
  });

  it("renders the latest measured node dimensions after a controlled update", () => {
    const graph = graphFromArchitecture({inputs: [{id: "input", type: "tensor"}]});
    const measuredNodes = applyNodeChanges([{
      id: "input",
      type: "dimensions",
      dimensions: {width: 333, height: 177},
    }], graph.nodes);

    const html = renderToStaticMarkup(
      <ReactFlow nodes={measuredNodes} edges={graph.edges} width={800} height={500}>
        <ArchitectureMiniMap />
      </ReactFlow>,
    );
    const rectangle = html.match(/<rect[^>]*class="react-flow__minimap-node"[^>]*>/)?.[0];

    expect(rectangle).toContain('width="333"');
    expect(rectangle).toContain('height="177"');
  });
});
