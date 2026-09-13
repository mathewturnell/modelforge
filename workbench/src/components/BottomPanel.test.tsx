import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vitest";
import {BottomPanel, reconcileConsoleLines, timestampConsoleLines} from "./BottomPanel";

describe("bottom console timestamps", () => {
  it("timestamps every non-empty line without replacing recorded timestamps", () => {
    const entries = ["Starting\n\n  Loading", "[07:08:09] Recorded", "   "];

    expect(timestampConsoleLines(entries, new Date(2026, 7, 11, 14, 5, 6))).toEqual([
      "[14:05:06] Starting",
      "",
      "[14:05:06]   Loading",
      "[07:08:09] Recorded",
      "   ",
    ]);
    expect(entries).toEqual(["Starting\n\n  Loading", "[07:08:09] Recorded", "   "]);
  });

  it("retains timestamps across polling snapshots and timestamps only new or changed rows", () => {
    const first = reconcileConsoleLines(
      ["Starting\n\nLoading", "[07:08:09] Recorded"],
      [],
      new Date(2026, 7, 11, 14, 5, 6),
    );
    const appended = reconcileConsoleLines(
      ["Starting\n\nLoading", "[07:08:09] Recorded", "Complete"],
      first,
      new Date(2026, 7, 11, 14, 6, 7),
    );
    const changed = reconcileConsoleLines(
      ["Starting\n\nLoading data", "[07:08:09] Recorded", "Complete"],
      appended,
      new Date(2026, 7, 11, 14, 7, 8),
    );

    expect(appended.map((line) => line.rendered)).toEqual([
      "[14:05:06] Starting",
      "",
      "[14:05:06] Loading",
      "[07:08:09] Recorded",
      "[14:06:07] Complete",
    ]);
    expect(changed.map((line) => line.rendered)).toEqual([
      "[14:05:06] Starting",
      "",
      "[14:07:08] Loading data",
      "[07:08:09] Recorded",
      "[14:06:07] Complete",
    ]);
  });

  it("limits the flattened display to the latest 250 rows", () => {
    const lines = reconcileConsoleLines(
      [`first\n${Array.from({length: 250}, (_, index) => `row ${index}`).join("\n")}`],
      [],
      new Date(2026, 7, 11, 14, 5, 6),
    );

    expect(lines).toHaveLength(250);
    expect(lines[0]).toEqual({raw: "row 0", rendered: "[14:05:06] row 0"});
    expect(lines.at(-1)).toEqual({raw: "row 249", rendered: "[14:05:06] row 249"});
  });

  it("timestamps the visible empty output message", () => {
    const html = renderToStaticMarkup(<BottomPanel logs={[]} open onToggle={() => undefined} />);

    expect(html).toMatch(/\[\d{2}:\d{2}:\d{2}\] ModelForge output is ready\./);
  });
});
