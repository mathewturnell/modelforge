import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vitest";
import {PointCloudInferenceViewer} from "./PointCloudInferenceViewer";

describe("PointCloudInferenceViewer", () => {
  it("exposes anomaly heatmap controls and physical score coordinates", () => {
    const html = renderToStaticMarkup(<PointCloudInferenceViewer cloud={{
      type: "point_cloud",
      positions: [0, 0, 0, .2, .1, .3],
      colors: [80, 90, 100, 120, 130, 140],
      anomaly: [5, 255],
      axes: ["x", "y", "z"],
      point_count: 2,
      source_point_count: 2,
      anomaly_range: {minimum: .1, maximum: .9, normalization: "valid_xyz_percentile_02_98"},
      spatial_score_coordinates: {
        status: "available",
        axes: ["X", "Y", "Z"],
        unit: "mm",
        unit_declared: true,
        peak: {position: [10, 20, 30], source_score: .9234, display_score: 1},
        weighted_centroid: [11, 21, 31],
        high_score_region: {coordinate_count: 4, centroid: [12, 22, 32]},
      },
    }} />);

    expect(html).toContain("Failure heatmap");
    expect(html).toContain("Interactive XYZ point cloud with anomaly-score coloring");
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("arrow keys to orbit");
    expect(html).toContain("Source coordinate unit: mm");
    expect(html).toContain("Peak: X 10.000");
    expect(html).toContain("mm · model score 0.9234 · display score");
    expect(html).toContain("not the calibrated sample operating point");
  });

  it("discloses when the source coordinate unit is undeclared", () => {
    const html = renderToStaticMarkup(<PointCloudInferenceViewer cloud={{
      positions: [0, 0, 0], colors: [80, 90, 100], anomaly: [255], point_count: 1,
      spatial_score_coordinates: {
        status: "available", axes: ["x", "y", "z"], unit: null, unit_declared: false,
        peak: {position: [1, 2, 3], display_score: 1},
      },
    }} />);
    expect(html).toContain("Source coordinate unit: undeclared");
  });
});
