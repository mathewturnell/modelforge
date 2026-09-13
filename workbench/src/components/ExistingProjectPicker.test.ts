import {describe, expect, it} from "vitest";
import {browseResponseIsCurrent} from "./ExistingProjectPicker";

describe("ExistingProjectPicker browse ordering", () => {
  it("keeps immediate authored paths and newer Enter submissions ahead of the initial browse", () => {
    expect(browseResponseIsCurrent(1, 1, "/initial", "/authored/project")).toBe(false);
    expect(browseResponseIsCurrent(1, 2, "/initial", "/authored/project")).toBe(false);
    expect(browseResponseIsCurrent(2, 2, "/authored/project", "/authored/project")).toBe(true);
  });
});
