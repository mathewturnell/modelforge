import {MarkerType, type Edge, type Node} from "@xyflow/react";
import type {JsonMap} from "../types";

export type ArchitectureCategory =
  | "input"
  | "encoder"
  | "transformer"
  | "memory"
  | "logic"
  | "external"
  | "component"
  | "output";

export type ArchitectureNodeData = JsonMap & {
  label: string;
  kind: "input" | "component" | "output";
  type: string;
  category: ArchitectureCategory;
  categoryLabel: string;
  detail?: string;
  config?: JsonMap;
  metadata?: JsonMap;
  summary?: string;
  detailGroups: ArchitectureDetailGroup[];
  sourceCandidates: ArchitectureSourceCandidate[];
};

export type ArchitectureDetailItem = {
  label: string;
  value?: string;
};

export type ArchitectureDetailGroup = {
  label: string;
  items: ArchitectureDetailItem[];
  expanded: boolean;
};

export type ArchitectureSourceCandidate = {
  path: string;
  label: string;
  symbols: string[];
};

export type ArchitectureBoundaryData = JsonMap & {
  label: string;
  detail: string;
  badge: string;
};

export type ArchitectureGraphNode = Node<ArchitectureNodeData, "architecture">;
export type ArchitectureBoundaryNode = Node<ArchitectureBoundaryData, "boundary">;

export type ArchitectureGraph = {
  nodes: Array<ArchitectureGraphNode | ArchitectureBoundaryNode>;
  edges: Edge[];
  objectCount: number;
  boundaryCount: number;
  categories: ArchitectureCategory[];
};

const NODE_WIDTH = 260;
const NODE_HEIGHT_ESTIMATE = 116;
const COLUMN_GAP = 340;
const ROW_GAP = 190;
const GRAPH_INSET_X = 70;
const GRAPH_CENTER_Y = 190;

export const ARCHITECTURE_CATEGORY_LABELS: Record<ArchitectureCategory, string> = {
  input: "Input contract",
  encoder: "Feature / encoder",
  transformer: "Attention / transformer",
  memory: "Learned memory",
  logic: "Matching / logic",
  external: "Project module",
  component: "Model component",
  output: "Output contract",
};

type GraphRecord = {
  item: JsonMap;
  id: string;
  kind: ArchitectureNodeData["kind"];
  sources: string[];
  order: number;
};

function asMap(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
}

function humanLabel(value: unknown): string {
  return String(value || "").replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayLabel(item: JsonMap): string {
  const metadata = asMap(item.metadata);
  const presentation = asMap(metadata.presentation);
  const declared = presentation.title || metadata.short_name || item.name || metadata.name || metadata.label;
  return declared ? String(declared) : humanLabel(item.id || item.type);
}

function detailItem(value: unknown): ArchitectureDetailItem | null {
  if (typeof value === "string" || typeof value === "number") return {label: String(value)};
  const item = asMap(value);
  const label = String(item.label || item.visible_name || item.name || item.id || "").trim();
  if (!label) return null;
  const detail = item.value ?? item.detail ?? item.units;
  return {label, ...(detail !== undefined && detail !== "" ? {value: String(detail)} : {})};
}

function detailGroups(item: JsonMap): ArchitectureDetailGroup[] {
  const metadata = asMap(item.metadata);
  const presentation = asMap(metadata.presentation);
  const declared = Array.isArray(presentation.groups) ? presentation.groups.map(asMap) : [];
  const declaredGroups = declared.map((group) => {
    const label = String(group.label || group.title || group.name || "Details");
    return {
      label,
      items: (Array.isArray(group.items) ? group.items : []).map(detailItem).filter((entry): entry is ArchitectureDetailItem => Boolean(entry)),
      expanded: false,
    };
  }).filter((group) => group.items.length > 0);
  if (declaredGroups.length) return declaredGroups;

  const config = asMap(item.config);
  const groups: ArchitectureDetailGroup[] = [];
  const signals = (Array.isArray(config.signals) ? config.signals : [])
    .map(detailItem).filter((entry): entry is ArchitectureDetailItem => Boolean(entry));
  if (signals.length) groups.push({label: "Signals", items: signals, expanded: false});

  const times = Array.isArray(config.time_offsets_hours)
    ? config.time_offsets_hours.map((value) => ({label: `${Number(value) > 0 ? "+" : ""}${String(value)} h`}))
    : Array.isArray(config.times)
      ? config.times.map(detailItem).filter((entry): entry is ArchitectureDetailItem => Boolean(entry))
      : [];
  if (times.length) groups.push({label: "Time positions", items: times, expanded: false});

  const levels = (Array.isArray(config.levels_hpa) ? config.levels_hpa : [])
    .map((value) => ({label: `${String(value)} hPa`}));
  if (levels.length) groups.push({label: "Pressure levels", items: levels, expanded: false});

  const grid = asMap(config.grid);
  const axes = Array.isArray(grid.axes) ? grid.axes : [];
  const dimensions = Array.isArray(grid.shape) ? grid.shape : [];
  const gridItems = axes.map((axis, index) => ({label: humanLabel(axis), value: dimensions[index] === undefined ? undefined : String(dimensions[index])}));
  if (gridItems.length) groups.push({label: "Grid", items: gridItems, expanded: false});

  const featureValues = Array.isArray(config.feature_order)
    ? config.feature_order
    : typeof config.feature_order === "string"
      ? config.feature_order.split(",").map((value) => value.trim()).filter(Boolean)
      : [];
  const features = featureValues.map(detailItem).filter((entry): entry is ArchitectureDetailItem => Boolean(entry));
  if (features.length) groups.push({label: "Feature vector", items: features, expanded: false});

  const mappings = (Array.isArray(config.coefficient_mappings) ? config.coefficient_mappings : []).map(asMap);
  const mappingsByLevel = new Map<string, ArchitectureDetailItem[]>();
  mappings.forEach((mapping) => {
    const level = mapping.level_hpa === undefined ? "Models" : `${String(mapping.level_hpa)} hPa`;
    const entry = detailItem({
      label: mapping.visible_signal || mapping.model_id || mapping.variable,
      value: Array.isArray(mapping.coefficients) ? `${mapping.coefficients.length} coefficients` : undefined,
    });
    if (entry) mappingsByLevel.set(level, [...(mappingsByLevel.get(level) || []), entry]);
  });
  mappingsByLevel.forEach((items, label) => groups.push({label, items, expanded: false}));
  return groups;
}

function referenceId(value: unknown): string {
  if (value && typeof value === "object") {
    const record = value as JsonMap;
    return String(record.id || record.source || "");
  }
  return String(value || "");
}

function references(item: JsonMap): string[] {
  const raw = item.inputs ?? item.input;
  const values = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object"
      ? Object.values(raw as JsonMap)
      : raw !== undefined && raw !== null
        ? [raw]
        : [];
  return [...new Set(values.map(referenceId).filter(Boolean))];
}

export function architectureCategory(item: JsonMap, kind: ArchitectureNodeData["kind"]): ArchitectureCategory {
  if (kind === "input") return "input";
  if (kind === "output") return "output";

  const metadata = asMap(item.metadata);
  const config = asMap(item.config);
  const identity = `${String(metadata.visual_group || "")} ${String(item.type || "")} ${String(item.id || "")}`.toLowerCase();
  if (identity.includes("external") || identity.includes("project_python") || config.source_root) return "external";
  if (/(transformer|attention|decoder)/.test(identity)) return "transformer";
  if (/(memory|quer(?:y|ies)|prototype|embedding)/.test(identity)) return "memory";
  if (/(compatib|match|associat|fusion|track|algorithm|decision|rule)/.test(identity)) return "logic";
  if (/(encoder|feature|backbone|resnet|rawnet|image|video|frame|token|conv|vision)/.test(identity)) return "encoder";
  return "component";
}

function shapeText(item: JsonMap, validation: JsonMap): string {
  const shapes = asMap(validation.shapes);
  const shape = asMap(shapes[String(item.id || "")]);
  if (Array.isArray(shape.dimensions)) return `[${shape.dimensions.map((value) => value ?? "?").join(", ")}]`;
  const declared = asMap(item.shape || asMap(item.metadata).shape);
  if (!Object.keys(declared).length) return "";
  const labels: Record<string, string> = {channels: "C", height: "H", width: "W", length: "L", features: "F", frames: "T", queries: "Q", memory: "M"};
  return Object.entries(declared).map(([key, value]) => `${labels[key] || key}=${String(value)}`).join(" · ");
}

function sourceIdentity(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function importedSources(architecture: JsonMap, response: JsonMap): JsonMap[] {
  const project = asMap(response.project);
  const metadata = asMap(architecture.metadata);
  const declared = [
    ...(Array.isArray(project.model_sources) ? project.model_sources : []),
    ...(Array.isArray(metadata.model_sources) ? metadata.model_sources : []),
  ];
  const sources = new Map<string, JsonMap>();
  declared.forEach((value, index) => {
    const source = asMap(value);
    if (!Object.keys(source).length || source.provider === "project") return;
    const id = String(source.id || `${String(source.provider || "upstream")}-${index}`);
    if (!sources.has(id)) sources.set(id, {...source, id});
  });
  return [...sources.values()];
}

function declaredSource(item: JsonMap, sources: JsonMap[]): JsonMap | undefined {
  const config = asMap(item.config);
  const metadata = asMap(item.metadata);
  const parameters = asMap(config.parameters);
  const declared = [
    metadata.model_source_id, metadata.model_source, metadata.source_id, metadata.upstream_source,
    config.model_source_id, config.model_source, config.source_id,
    parameters.model_source_id, parameters.model_source,
  ].find((value) => value !== undefined && value !== null && value !== "");
  if (declared) {
    const identity = sourceIdentity(typeof declared === "object" ? asMap(declared).id : declared);
    const exact = sources.find((source) => [source.id, source.name, source.repo_id, source.repository_name]
      .some((value) => sourceIdentity(value) === identity));
    if (exact) return exact;
  }
  const sourceRoot = String(config.source_root || "").replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (sourceRoot) {
    const pathMatch = sources.find((source) => {
      const sourcePath = String(source.source_path || "").replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
      return sourcePath && (sourceRoot === sourcePath || sourceRoot.endsWith(`/${sourcePath}`) || sourcePath.endsWith(`/${sourceRoot}`));
    });
    if (pathMatch) return pathMatch;
  }
  const componentIdentity = sourceIdentity(`${String(item.id || "")} ${String(item.type || "")}`);
  return sources.find((source) => {
    const identity = sourceIdentity(source.name || source.repository_name || source.repo_id);
    return identity.length >= 4 && componentIdentity.includes(identity);
  });
}

function sourceAssignments(architecture: JsonMap, response: JsonMap, records: GraphRecord[]) {
  const sources = importedSources(architecture, response);
  const assignments = new Map(sources.map((source) => [String(source.id), [] as string[]]));
  const assigned = new Set<string>();
  records.forEach((record) => {
    const source = declaredSource(record.item, sources);
    if (!source) return;
    assignments.get(String(source.id))?.push(record.id);
    assigned.add(record.id);
  });

  const metadata = asMap(architecture.metadata);
  const architectureSource = metadata.model_source_id || metadata.model_source || metadata.upstream_source;
  if (architectureSource) {
    const identity = sourceIdentity(architectureSource);
    const source = sources.find((candidate) => [candidate.id, candidate.name, candidate.repo_id, candidate.repository_name]
      .some((value) => sourceIdentity(value) === identity));
    if (source) records.filter((record) => record.kind !== "input" && !assigned.has(record.id)).forEach((record) => {
      assignments.get(String(source.id))?.push(record.id);
      assigned.add(record.id);
    });
  }

  const project = asMap(response.project);
  if (sources.length === 1 && !assignments.get(String(sources[0].id))?.length && (response.runtime || project.runtime)) {
    assignments.set(String(sources[0].id), records.filter((record) => record.kind !== "input").map((record) => record.id));
  }
  return sources.map((source) => ({source, itemIds: assignments.get(String(source.id)) || []})).filter(({itemIds}) => itemIds.length);
}

function dottedSourceCandidates(binding: unknown, label: string, symbols: unknown[] = []): ArchitectureSourceCandidate[] {
  const value = String(binding || "").trim();
  if (!value) return [];
  const [moduleValue, memberValue] = value.includes(":") ? value.split(":", 2) : [value, ""];
  const parts = moduleValue.split(".").filter(Boolean);
  const symbolValues = [...symbols, memberValue, ...parts.slice(-3)].map(String).filter(Boolean);
  const minimum = Math.min(2, parts.length);
  const candidates: ArchitectureSourceCandidate[] = [];
  for (let length = parts.length; length >= minimum; length -= 1) {
    const modulePath = parts.slice(0, length).join("/");
    candidates.push({path: `${modulePath}.py`, label, symbols: symbolValues});
    candidates.push({path: `${modulePath}/__init__.py`, label, symbols: symbolValues});
    if (memberValue) break;
  }
  return candidates;
}

function projectSourcePath(value: unknown, response: JsonMap): string {
  const raw = String(value || "").trim().replaceAll("\\", "/");
  if (!raw || /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(raw)) return "";
  if (!raw.startsWith("/") && !/^[A-Za-z]:\//.test(raw)) {
    const relative = raw.replace(/^\.\//, "");
    return relative.split("/").includes("..") ? "" : relative;
  }

  const project = asMap(response.project);
  const workspace = asMap(project.assistant_workspace);
  const roots = [workspace.source_root, project.repository]
    .map((root) => String(root || "").trim().replaceAll("\\", "/").replace(/\/$/, ""))
    .filter(Boolean);
  const root = roots.find((candidate) => raw.startsWith(`${candidate}/`));
  return root ? raw.slice(root.length + 1) : "";
}

function fileSourceCandidate(
  value: unknown,
  response: JsonMap,
  label: string,
  symbols: unknown[],
): ArchitectureSourceCandidate[] {
  const path = projectSourcePath(value, response);
  return path && /\.[A-Za-z0-9]+$/.test(path)
    ? [{path, label, symbols: symbols.map(String).filter(Boolean)}]
    : [];
}

function architectureAdapter(response: JsonMap): unknown {
  const project = asMap(response.project);
  const adapters = asMap(project.adapters);
  return adapters.architecture_summary || project.architecture_adapter;
}

function sourceCandidatesFor(record: GraphRecord, architecture: JsonMap, response: JsonMap): ArchitectureSourceCandidate[] {
  const projectCode = asMap(response.project_code);
  const entries = Array.isArray(projectCode.entries) ? projectCode.entries.map(asMap) : [];
  const exact = entries.find((entry) => String(entry.component || "") === record.id);
  const metadata = asMap(record.item.metadata);
  const config = asMap(record.item.config);
  const result: ArchitectureSourceCandidate[] = [];
  if (exact?.entrypoint) result.push({
    path: String(exact.entrypoint),
    label: "Declared project module",
    symbols: [String(exact.factory || ""), String(exact.module || "")].filter(Boolean),
  });

  for (const [key, value] of Object.entries({
    source_file: metadata.source_file || config.source_file,
    entrypoint: metadata.entrypoint || config.entrypoint,
    implementation: metadata.implementation_path || config.implementation_path,
  })) {
    const path = String(value || "").replaceAll("\\", "/").replace(/^\.\//, "");
    if (path && /\.[A-Za-z0-9]+$/.test(path)) result.push({path, label: `Declared ${key.replace("_", " ")}`, symbols: [record.id]});
  }

  if (config.source_root && config.module) {
    const root = String(config.source_root).replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
    const modulePath = String(config.module).replaceAll(".", "/");
    result.push({path: `${root}/${modulePath}.py`, label: "Project module", symbols: [String(config.factory || ""), record.id].filter(Boolean)});
    result.push({path: `${root}/${modulePath}/__init__.py`, label: "Project package", symbols: [String(config.factory || ""), record.id].filter(Boolean)});
  }

  const catalog = asMap(response.component_catalog);
  const definitions = [
    ...(Array.isArray(catalog.inputs) ? catalog.inputs : []),
    ...(Array.isArray(catalog.components) ? catalog.components : []),
  ].map(asMap);
  const definition = definitions.find((item) => String(item.type || "") === String(record.item.type || ""));
  const runtimeBinding = metadata.runtime_binding || definition?.runtime_binding;
  result.push(...dottedSourceCandidates(
    runtimeBinding,
    "Runtime implementation",
    [metadata.runtime_attribute, record.item.type, record.id],
  ));

  const model = asMap(architecture.model);
  if (record.kind !== "input") {
    result.push(...fileSourceCandidate(
      model.implementation || model.implementation_path || model.source_file || model.entrypoint,
      response,
      "Declared model implementation",
      [record.id, record.item.type],
    ));
    result.push(...fileSourceCandidate(
      model.adapter,
      response,
      "Declared model adapter",
      [record.id, record.item.type],
    ));
  }

  result.push(...dottedSourceCandidates(
    architectureAdapter(response),
    record.kind === "input" ? "Input contract declaration" : "Architecture declaration",
    [record.id, record.item.type],
  ));
  result.push(...fileSourceCandidate(
    response.architecture_path,
    response,
    "Architecture descriptor",
    [record.id, record.item.type],
  ));
  const seen = new Set<string>();
  return result.filter((candidate) => candidate.path && !seen.has(candidate.path) && Boolean(seen.add(candidate.path))).slice(0, 18);
}

export function graphFromArchitecture(architecture: JsonMap, response: JsonMap = {}): ArchitectureGraph {
  const inputs = (Array.isArray(architecture.inputs) ? architecture.inputs : []).map(asMap);
  const components = (Array.isArray(architecture.nodes) ? architecture.nodes : []).map(asMap);
  const outputs = (Array.isArray(architecture.outputs) ? architecture.outputs : []).map(asMap);
  const records: GraphRecord[] = [
    ...inputs.map((item, order) => ({item, id: String(item.id || `input-${order}`), kind: "input" as const, sources: [], order})),
    ...components.map((item, index) => ({item, id: String(item.id || `component-${index}`), kind: "component" as const, sources: references(item), order: inputs.length + index})),
    ...outputs.map((item, index) => ({item, id: String(item.id || `output-${index}`), kind: "output" as const, sources: references(item), order: inputs.length + components.length + index})),
  ];
  if (components.length && inputs.length && !records[inputs.length].sources.length) records[inputs.length].sources = [records[0].id];

  const byId = new Map(records.map((record) => [record.id, record]));
  const depths = new Map<string, number>();
  function depthFor(record: GraphRecord, visiting = new Set<string>()): number {
    if (record.kind === "input") return 0;
    const known = depths.get(record.id);
    if (known !== undefined) return known;
    if (visiting.has(record.id)) return 0;
    const nextVisiting = new Set(visiting).add(record.id);
    const sourceDepths = record.sources.map((source) => byId.get(source)).filter((source): source is GraphRecord => Boolean(source)).map((source) => depthFor(source, nextVisiting));
    const depth = 1 + (sourceDepths.length ? Math.max(...sourceDepths) : 0);
    depths.set(record.id, depth);
    return depth;
  }
  records.forEach((record) => depths.set(record.id, depthFor(record)));

  const levels = new Map<number, GraphRecord[]>();
  records.forEach((record) => {
    const depth = depths.get(record.id) || 0;
    levels.set(depth, [...(levels.get(depth) || []), record]);
  });
  levels.forEach((level) => level.sort((left, right) => left.order - right.order));

  const validation = asMap(response.validation);
  const positions = new Map<string, {x: number; y: number}>();
  const architectureNodes: ArchitectureGraphNode[] = records.map((record) => {
    const depth = depths.get(record.id) || 0;
    const level = levels.get(depth) || [record];
    const index = level.indexOf(record);
    const position = {
      x: GRAPH_INSET_X + depth * COLUMN_GAP,
      y: GRAPH_CENTER_Y + (index - (level.length - 1) / 2) * ROW_GAP,
    };
    positions.set(record.id, position);
    const category = architectureCategory(record.item, record.kind);
    const metadata = asMap(record.item.metadata);
    const presentation = asMap(metadata.presentation);
    return {
      id: record.id,
      type: "architecture",
      position,
      origin: [0, 0.5],
      initialWidth: NODE_WIDTH,
      initialHeight: NODE_HEIGHT_ESTIMATE,
      zIndex: 2,
      data: {
        label: displayLabel(record.item),
        kind: record.kind,
        type: String(record.item.type || record.kind),
        category,
        categoryLabel: ARCHITECTURE_CATEGORY_LABELS[category],
        detail: shapeText(record.item, validation),
        config: asMap(record.item.config),
        metadata,
        summary: String(presentation.summary || metadata.summary || "").trim() || undefined,
        detailGroups: detailGroups(record.item),
        sourceCandidates: sourceCandidatesFor(record, architecture, response),
      },
    };
  });

  const boundaryNodes: ArchitectureBoundaryNode[] = sourceAssignments(architecture, response, records).map(({source, itemIds}, index) => {
    const enclosed = itemIds.map((id) => positions.get(id)).filter((position): position is {x: number; y: number} => Boolean(position));
    const left = Math.min(...enclosed.map(({x}) => x)) - 28 - index * 7;
    const top = Math.min(...enclosed.map(({y}) => y)) - NODE_HEIGHT_ESTIMATE / 2 - 76 - index * 7;
    const right = Math.max(...enclosed.map(({x}) => x)) + NODE_WIDTH + 28 + index * 7;
    const bottom = Math.max(...enclosed.map(({y}) => y)) + NODE_HEIGHT_ESTIMATE / 2 + 28 + index * 7;
    const revision = String(source.revision_short || source.revision || "").slice(0, 12);
    const provider = humanLabel(source.provider || "source");
    const width = right - left;
    const height = bottom - top;
    return {
      id: `source-boundary-${String(source.id)}`,
      type: "boundary",
      position: {x: left, y: top},
      initialWidth: width,
      initialHeight: height,
      selectable: false,
      draggable: false,
      focusable: false,
      zIndex: 0,
      style: {width, height},
      data: {
        label: String(source.name || source.repository_name || source.repo_id || "Pinned upstream model"),
        detail: `${provider}${revision ? ` @ ${revision}` : ""}`,
        badge: source.working_copy ? "Pinned + adapted" : source.vendored ? "Pinned snapshot" : "Upstream dependency",
      },
    };
  });

  const ids = new Set(records.map((record) => record.id));
  const edges: Edge[] = records.flatMap((record) => record.sources.filter((source) => ids.has(source)).map((source) => ({
    id: `${source}-${record.id}`,
    source,
    target: record.id,
    type: "smoothstep",
    markerEnd: {type: MarkerType.ArrowClosed},
    animated: false,
  })));
  const categoryOrder = Object.keys(ARCHITECTURE_CATEGORY_LABELS) as ArchitectureCategory[];
  const usedCategories = new Set(architectureNodes.map((node) => node.data.category));
  return {
    nodes: [...boundaryNodes, ...architectureNodes],
    edges,
    objectCount: architectureNodes.length,
    boundaryCount: boundaryNodes.length,
    categories: categoryOrder.filter((category) => usedCategories.has(category)),
  };
}
