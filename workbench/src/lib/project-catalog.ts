import type {Project} from "../types";

/**
 * Apply a refreshed catalog without moving projects that are already visible.
 *
 * Project creation intentionally appends to the chooser. Server catalog reads
 * use discovery order, so replacing the client array after a removal would
 * unexpectedly reshuffle every surviving row.
 */
export function reconcileProjectCatalogOrder(current: Project[], incoming: Project[]): Project[] {
  const incomingById = new Map(incoming.map((project) => [project.id, project]));
  const retained = current.flatMap((project) => {
    const updated = incomingById.get(project.id);
    return updated ? [{...project, ...updated}] : [];
  });
  const retainedIds = new Set(retained.map((project) => project.id));
  return [...retained, ...incoming.filter((project) => !retainedIds.has(project.id))];
}
