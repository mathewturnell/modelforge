import type {JsonMap} from "../types";

export type ArchitectureBriefContract = {
  id: string;
  label: string;
  type: string;
  shape: string;
};

export type ArchitectureBriefSource = {
  id: string;
  name: string;
  provider: string;
  role: string;
  revision: string;
  url: string;
};

export type ArchitectureBrief = {
  description: string;
  sources: ArchitectureBriefSource[];
  rationale: string[];
  goals: string[];
  inputs: ArchitectureBriefContract[];
  outputs: ArchitectureBriefContract[];
  keyAspects: string[];
  modifications: string[];
};

function asMap(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
}

function text(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function textItems(value: unknown, maximum = 6): string[] {
  const values = Array.isArray(value) ? value : value === undefined || value === null || value === "" ? [] : [value];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const item = asMap(raw);
    const normalized = text(Object.keys(item).length
      ? item.text || item.description || item.summary || item.label || item.name
      : raw);
    const identity = normalized.toLocaleLowerCase();
    if (!normalized || seen.has(identity)) continue;
    seen.add(identity);
    result.push(normalized);
    if (result.length >= maximum) break;
  }
  return result;
}

function firstItems(values: unknown[], maximum = 6): string[] {
  for (const value of values) {
    const items = textItems(value, maximum);
    if (items.length) return items;
  }
  return [];
}

function label(value: unknown): string {
  return text(value).replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayLabel(item: JsonMap): string {
  const metadata = asMap(item.metadata);
  const presentation = asMap(metadata.presentation);
  return text(presentation.title || metadata.short_name || item.name || metadata.name || metadata.label)
    || label(item.id || item.type || "Contract");
}

function shapeText(item: JsonMap): string {
  const shape = asMap(item.shape || asMap(item.metadata).shape);
  const labels: Record<string, string> = {
    channels: "C", height: "H", width: "W", length: "L", features: "F",
    frames: "T", queries: "Q", memory: "M",
  };
  return Object.entries(shape)
    .filter(([, value]) => typeof value === "string" || typeof value === "number")
    .map(([key, value]) => `${labels[key] || label(key)}=${String(value)}`)
    .join(" · ");
}

function contracts(value: unknown): ArchitectureBriefContract[] {
  return (Array.isArray(value) ? value : []).map(asMap).map((item, index) => ({
    id: text(item.id) || `contract-${index}`,
    label: displayLabel(item),
    type: label(item.type || "Declared contract"),
    shape: shapeText(item),
  })).slice(0, 8);
}

function safeSourceUrl(value: unknown): string {
  const url = text(value);
  return /^https:\/\/[^\s]+$/i.test(url) ? url : "";
}

function sourceModels(architecture: JsonMap, response: JsonMap): ArchitectureBriefSource[] {
  const metadata = asMap(architecture.metadata);
  const model = asMap(architecture.model);
  const project = asMap(response.project);
  const declared = [
    ...(Array.isArray(project.model_sources) ? project.model_sources : []),
    ...(Array.isArray(metadata.model_sources) ? metadata.model_sources : []),
  ].map(asMap);
  if (!declared.length && model.upstream_repository) declared.push({
    id: "upstream-model",
    name: model.upstream_name || model.base_model || "Upstream model",
    provider: "upstream",
    repository_url: model.upstream_repository,
    revision: model.upstream_revision,
    role: model.upstream_role || "Source model",
  });

  const selectedId = text(metadata.model_source_id || metadata.model_source || metadata.upstream_source);
  const seen = new Set<string>();
  return declared.map((source, index) => {
    const url = safeSourceUrl(
      source.repository_url || source.repository || source.revision_url || source.source_url,
    );
    return {
      id: text(source.id) || `source-${index}`,
      name: text(source.name || source.repo_id || source.repository_name) || "Declared model source",
      provider: label(source.provider || "source"),
      role: text(source.role) || "Source model",
      revision: text(source.revision_short || source.revision),
      url,
    };
  }).sort((left, right) => Number(right.id === selectedId) - Number(left.id === selectedId)).filter((source) => {
    const identity = source.url || `${source.id}:${source.name}`;
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  }).slice(0, 4);
}

function derivedAspects(architecture: JsonMap): string[] {
  const nodes = Array.isArray(architecture.nodes) ? architecture.nodes.map(asMap) : [];
  return nodes.map((node) => {
    const metadata = asMap(node.metadata);
    const presentation = asMap(metadata.presentation);
    const summary = text(presentation.summary || metadata.summary);
    const name = displayLabel(node);
    const type = label(node.type);
    return summary ? `${name}: ${summary}` : type && type !== name ? `${name} · ${type}` : name;
  }).filter(Boolean).slice(0, 5);
}

function listPhrase(items: string[]): string {
  if (items.length < 2) return items[0] || "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function summarizedLabels(value: unknown, maximum = 3): {labels: string[]; hidden: number} {
  const items = Array.isArray(value) ? value.map(asMap) : [];
  return {
    labels: items.slice(0, maximum).map(displayLabel).filter(Boolean),
    hidden: Math.max(0, items.length - maximum),
  };
}

function labelPhrase(value: unknown, fallback: string): string {
  const {labels, hidden} = summarizedLabels(value);
  const visible = listPhrase(labels);
  if (!visible) return fallback;
  return hidden ? `${visible}, and ${hidden} more` : visible;
}

function generatedSummary(architecture: JsonMap): string {
  const inputs = labelPhrase(architecture.inputs, "its declared inputs");
  const outputs = labelPhrase(architecture.outputs, "its declared outputs");
  const inputCount = Array.isArray(architecture.inputs) ? architecture.inputs.length : 0;
  const nodes = summarizedLabels(architecture.nodes);
  if (!nodes.labels.length) return `${inputs} ${inputCount === 1 ? "maps" : "map"} directly to ${outputs}.`;
  const components = nodes.hidden
    ? `${listPhrase(nodes.labels)}, and ${nodes.hidden} more components`
    : listPhrase(nodes.labels);
  return `${inputs} ${inputCount === 1 ? "flows" : "flow"} through ${components} to produce ${outputs}.`;
}

function isLoaderFallback(value: string): boolean {
  return /^Executable architecture for .+\.$/.test(value);
}

export function architectureBrief(architecture: JsonMap, response: JsonMap = {}): ArchitectureBrief {
  const model = asMap(architecture.model);
  const metadata = asMap(architecture.metadata);
  const intent = asMap(architecture.intent);
  const sources = sourceModels(architecture, response);
  const explicitModifications = firstItems([
    model.project_modifications, metadata.project_modifications,
    model.modifications, metadata.modifications,
    model.adaptations, metadata.adaptations,
  ]);
  const explicitAspects = firstItems([
    model.key_aspects, metadata.key_aspects, model.highlights, metadata.highlights,
  ]);
  const declaredDescription = text(intent.description || model.description || architecture.summary || metadata.summary);
  const modifications = explicitModifications.length ? explicitModifications : sources.some((source) => {
    const raw = [
      ...(Array.isArray(asMap(response.project).model_sources) ? asMap(response.project).model_sources as unknown[] : []),
      ...(Array.isArray(metadata.model_sources) ? metadata.model_sources as unknown[] : []),
    ].map(asMap).find((item) => text(item.id) === source.id);
    return raw?.working_copy === true || raw?.vendored === true;
  }) ? ["A pinned source copy is retained in this project, but its specific adaptations are not declared in the architecture metadata."] : [];

  return {
    description: declaredDescription && !isLoaderFallback(declaredDescription)
      ? declaredDescription
      : generatedSummary(architecture),
    sources,
    rationale: firstItems([intent.reasoning, model.rationale, metadata.rationale]),
    goals: firstItems([intent.goals, model.goals, metadata.goals]),
    inputs: contracts(architecture.inputs),
    outputs: contracts(architecture.outputs),
    keyAspects: (explicitAspects.length ? explicitAspects : derivedAspects(architecture)).slice(0, 6),
    modifications,
  };
}
