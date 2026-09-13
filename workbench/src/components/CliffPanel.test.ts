import {describe, expect, it} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {
  CliffRunActivity,
  CliffDelegationFeedback,
  cliffClipboardImageFiles,
  cliffImageFileError,
  cliffReasoningSummaries,
  cliffRunActivities,
  cliffRunAnswer,
  cliffRunChanges,
  cliffRunDelegations,
} from "./CliffPanel";

describe("compiled Cliff project runs", () => {
  it("extracts pasted clipboard images from items and the file fallback", () => {
    const screenshot = {name: "screenshot.png", type: "image/png", size: 120} as File;
    const text = {name: "notes.txt", type: "text/plain", size: 20} as File;

    expect(cliffClipboardImageFiles({
      items: [
        {kind: "string", type: "text/plain", getAsFile: () => null},
        {kind: "file", type: "image/png", getAsFile: () => screenshot},
      ],
      files: [text],
    })).toEqual([screenshot]);
    expect(cliffClipboardImageFiles({files: [text, screenshot]})).toEqual([screenshot]);
  });

  it("keeps Cliff image inputs within the established browser bounds", () => {
    expect(cliffImageFileError({name: "sample.png", type: "image/png", size: 20_000_000})).toBe("");
    expect(cliffImageFileError({name: "sample.gif", type: "image/gif", size: 10})).toContain("JPEG, PNG, or WebP");
    expect(cliffImageFileError({name: "sample.webp", type: "image/webp", size: 20_000_001})).toContain("20 MB");
  });

  it("projects the agent answer and authoritative file changes", () => {
    const run = {
      status: "completed",
      result: {
        answer: "Built and verified the requested project.",
        changes: [
          {path: "src/model.py", status: "added"},
          {path: "tests/test_model.py", status: "added"},
          {status: "ignored because it has no path"},
        ],
      },
    };

    expect(cliffRunAnswer(run)).toBe("Built and verified the requested project.");
    expect(cliffRunChanges(run)).toEqual([
      {path: "src/model.py", status: "added"},
      {path: "tests/test_model.py", status: "added"},
    ]);
  });

  it("projects only the bounded Maya consultation with separate read-only attribution", () => {
    const delegations = cliffRunDelegations({
      result: {delegations: [
        {
          id: "maya-1", parent_run_id: "cliff-1", depth: 1, status: "completed",
          role: {id: "ml_systems_engineer", display_name: "Maya", authority: "read_only_diagnostic"},
          result: {feedback: "Maya feedback: inspect validation cohort drift.", provider: "codex", mode: "read_only"},
        },
        {id: "unknown", role: {id: "platform_architect"}, status: "completed"},
      ]},
    });
    const markup = renderToStaticMarkup(createElement(CliffDelegationFeedback, {delegations}));

    expect(delegations).toHaveLength(1);
    expect(delegations[0].role).toEqual({
      id: "ml_systems_engineer", display_name: "Maya", authority: "read_only_diagnostic",
    });
    expect(markup).toContain("Maya feedback");
    expect(markup).toContain("Read-only diagnostic");
    expect(markup).toContain("inspect validation cohort drift");
    expect(markup).not.toContain("platform_architect");
  });

  it("keeps bounded public progress, command, and file events visible", () => {
    const activities = cliffRunActivities({events: [
      {sequence: 1, type: "status", label: "Preparing the tracker"},
      {sequence: 2, type: "command_started", command_text: "python -m pytest"},
      {sequence: 3, type: "file_change", path: "src/tracker.py", status: "added"},
      {sequence: 4, type: "status", heartbeat: true, label: "still working"},
    ]});

    expect(activities).toHaveLength(3);
    expect(activities[0]).toMatchObject({key: "status:1", category: "progress", label: "Preparing the tracker"});
    expect(activities[1]).toMatchObject({
      key: "command:python -m pytest", category: "command", label: "Checking tests", command: "python -m pytest",
    });
    expect(activities[2]).toMatchObject({
      key: "file:src/tracker.py", category: "files", label: "Updated 1 file",
      files: [{path: "src/tracker.py", status: "added", diff: ""}],
    });
  });

  it("groups streaming deltas and command phases while defensively redacting capabilities", () => {
    const activities = cliffRunActivities({events: [
      {sequence: 1, type: "assistant_delta", phase: "reasoning", item_id: "reason-1", detail: "Checking "},
      {sequence: 2, type: "assistant_delta", phase: "reasoning", item_id: "reason-2", detail: "the adapter"},
      {sequence: 3, type: "status", label: "Cliff update", detail: "Reviewing "},
      {sequence: 4, type: "status", label: "Cliff update", detail: "the contract"},
      {sequence: 4.5, type: "progress", label: "Cliff update", detail: "carefully"},
      {sequence: 5, type: "command", phase: "started", item_id: "cmd-1",
        command: "curl -H 'X-ModelForge-Cliff-Run-Token: secret-capability' /action"},
      {sequence: 6, type: "command", phase: "completed", item_id: "cmd-1",
        command: "curl -H 'X-ModelForge-Cliff-Run-Token: secret-capability' /action"},
    ]});

    expect(activities[0].key).toBe("assistant:reason-1");
    expect(activities[1].key).toBe("assistant:reason-2");
    expect(activities[2].key).toBe("assistant:current");
    expect(activities[3].key).toBe("assistant:current");
    expect(activities[4].key).toBe("assistant:current");
    expect(activities[4].label).toBe("carefully");
    expect(activities[5].key).toBe("command:cmd-1");
    expect(activities[6].key).toBe("command:cmd-1");
    expect(JSON.stringify(activities)).not.toContain("secret-capability");
    expect(JSON.stringify(activities)).toContain("[redacted]");
  });

  it("turns provider reasoning markup into concise public summaries", () => {
    expect(cliffReasoningSummaries(
      "**Preparing the implementation** **Inspecting the current renderer.** **Designing the disclosure rows.**",
    )).toEqual([
      "Preparing the implementation",
      "Inspecting the current renderer.",
      "Designing the disclosure rows.",
    ]);
  });

  it("keeps commands and metadata in closed disclosure rows", () => {
    const activities = cliffRunActivities({events: [
      {sequence: 1, type: "assistant_delta", phase: "reasoning", detail: "Checking the activity renderer."},
      {sequence: 2, type: "command", phase: "completed", item_id: "cmd-1", command: "npm test", output: "3 passed", exit_code: 0, duration_ms: 1250, cwd: "."},
      {sequence: 3, type: "file_change", phase: "completed", item_id: "edit-1", changes: [{path: "src/panel.tsx", kind: "update", diff: "+details"}]},
    ]});
    const markup = renderToStaticMarkup(createElement(CliffRunActivity, {activities}));

    expect(markup).toContain("Checking the activity renderer.");
    expect(markup.match(/<details/g)).toHaveLength(2);
    expect(markup).not.toContain("<details open");
    expect(markup.indexOf("Checked tests")).toBeLessThan(markup.indexOf("npm test"));
    expect(markup.indexOf("Updated 1 file")).toBeLessThan(markup.indexOf("src/panel.tsx"));
  });
});
