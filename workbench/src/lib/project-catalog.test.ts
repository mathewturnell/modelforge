import {describe, expect, it} from "vitest";
import type {Project} from "../types";
import {reconcileProjectCatalogOrder} from "./project-catalog";

const project = (id: string, name = id): Project => ({id, name});

describe("reconcileProjectCatalogOrder", () => {
  it("removes a project without reshuffling the surviving rows", () => {
    const current = [project("recent"), project("charlie"), project("alpha")];
    const incoming = [project("alpha"), project("charlie")];

    expect(reconcileProjectCatalogOrder(current, incoming).map(({id}) => id)).toEqual([
      "charlie",
      "alpha",
    ]);
  });

  it("keeps existing order, refreshes metadata, and appends newly discovered projects", () => {
    const current = [project("charlie"), project("alpha", "Old name")];
    const incoming = [project("alpha", "Updated name"), project("bravo"), project("charlie")];

    const reconciled = reconcileProjectCatalogOrder(current, incoming);
    expect(reconciled.map(({id}) => id)).toEqual(["charlie", "alpha", "bravo"]);
    expect(reconciled[1].name).toBe("Updated name");
  });
});
