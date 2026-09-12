import {describe, expect, it} from "vitest";
import {sceneCameraAfterKey} from "./Scene3DViewer";

describe("Scene3DViewer keyboard camera controls", () => {
  const initial = {azimuth: -24, elevation: 36, zoom: 1};

  it("orbits, zooms, and resets with bounded keyboard actions", () => {
    expect(sceneCameraAfterKey("ArrowLeft", initial, initial)).toEqual({...initial, azimuth: -30});
    expect(sceneCameraAfterKey("ArrowDown", {...initial, elevation: 76}, initial)?.elevation).toBe(78);
    expect(sceneCameraAfterKey("+", {...initial, zoom: 2.55}, initial)?.zoom).toBe(2.6);
    expect(sceneCameraAfterKey("-", {...initial, zoom: .56}, initial)?.zoom).toBe(.55);
    expect(sceneCameraAfterKey("0", {azimuth: 10, elevation: 50, zoom: 2}, initial)).toEqual(initial);
    expect(sceneCameraAfterKey("Enter", initial, initial)).toBeNull();
  });
});
