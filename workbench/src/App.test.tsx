import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vitest";
import {CompactActivityMenu, compactActivities} from "./App";

describe("compact workbench navigation", () => {
  it("projects the existing activity registry, including Jobs, behind an accessible menu trigger", () => {
    expect(compactActivities.map((activity) => activity.id)).toEqual([
      "overview", "source", "data", "model", "llm", "runs", "inference",
      "calibration", "deploy", "jobs", "knowledge", "settings",
    ]);
    const markup = renderToStaticMarkup(<CompactActivityMenu active="jobs" onSelect={() => undefined} />);
    expect(markup).toContain('aria-label="Open workspace navigation"');
    expect(markup).toContain('aria-haspopup="menu"');
  });
});
