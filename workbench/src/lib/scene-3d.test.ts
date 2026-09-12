import {describe, expect, it} from "vitest";
import {safeSceneAssetPath, sceneAssetUrl, sceneLayerLabel, seriesMarkerColor, sparseScalarUsesMarkers, visibleSceneLayerIds} from "./scene-3d";

describe("temporal geospatial scene helpers", () => {
  it("resolves retained scene assets through tenant-bound inference routes", () => {
    expect(sceneAssetUrl("/api/inference/result/scene?run_id=7", "maps/admin0.geojson"))
      .toBe("/api/inference/result/scene-asset?run_id=7&path=maps%2Fadmin0.geojson");
    expect(sceneAssetUrl("/api/jobs/job-7/artifacts/scene-1/view", "admin0.geojson"))
      .toBe("/api/jobs/job-7/scene-asset?path=admin0.geojson");
  });

  it("rejects paths that could escape the validated evidence root", () => {
    expect(safeSceneAssetPath("../map.geojson")).toBe("");
    expect(safeSceneAssetPath("/tmp/map.geojson")).toBe("");
    expect(sceneAssetUrl("/api/inference/result/scene?run_id=7", "../map.geojson")).toBe("");
  });

  it("derives reusable labels and default visibility from declared layers", () => {
    const layers = [
      {id: "map", kind: "polygon_map"},
      {id: "pressure", kind: "scalar_surfaces", label: "Pressure"},
      {id: "wind", kind: "vector_field"},
      {id: "markers", kind: "point_markers", visible: false},
    ];
    expect(sceneLayerLabel(layers[1])).toBe("Pressure");
    expect(sceneLayerLabel(layers[2])).toBe("wind");
    expect(visibleSceneLayerIds(layers)).toEqual(["pressure", "wind"]);
  });

  it("renders bounded sparse scalar evidence as markers with role-aware colors", () => {
    expect(sparseScalarUsesMarkers(2, 2_278, 1)).toBe(true);
    expect(sparseScalarUsesMarkers(400, 2_278, 1)).toBe(false);
    expect(sparseScalarUsesMarkers(1, 2_278, 0)).toBe(false);
    const layer = {style: {reference_color: "green", prediction_color: "yellow"}};
    expect(seriesMarkerColor(layer, "reference")).toBe("green");
    expect(seriesMarkerColor(layer, "prediction")).toBe("yellow");
  });
});
