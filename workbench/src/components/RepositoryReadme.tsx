import {CliffMarkdown} from "./CliffMarkdown";

type FrontMatterField = {label: string; values: string[]};

const frontMatterLabels: Record<string, string> = {
  pretty_name: "Name",
  language: "Language",
  license: "License",
  size_categories: "Size",
  task_categories: "Tasks",
  tags: "Tags",
};

function cleanYamlScalar(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1);
  return trimmed;
}

function stripReadmeHtmlSegment(source: string): string {
  return source
    // Provider comments and active/embedded HTML are not README prose.
    .replace(/<!--[\s\S]*?(?:-->|$)/g, "")
    .replace(/<(script|style|template|iframe|object|embed|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    // Keep text inside ordinary layout tags, but discard the tags themselves.
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(?:p|div|section|article|header|footer|main|aside|nav|h[1-6]|ul|ol|li|blockquote|pre|table|thead|tbody|tfoot|tr|td|th|details|summary|figure|figcaption|picture|hr)\b[^>]*>/gi, "\n")
    .replace(/<\/?[A-Za-z][^>\n]*>/g, "")
    .replace(/<!(?:DOCTYPE|\[CDATA\[)[^>]*>/gi, "")
    .replace(/<\?[^>]*\?>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/\n[ \t]+\n/g, "\n\n")
    .replace(/\n{3,}/g, "\n\n");
}

export function normalizeReadmeMarkdown(source: string): string {
  const normalized = String(source || "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  const output: string[] = [];
  let prose: string[] = [];
  let fenced = false;

  const flushProse = () => {
    if (prose.length) output.push(stripReadmeHtmlSegment(prose.join("\n")));
    prose = [];
  };

  for (const line of lines) {
    if (/^\s{0,3}```/.test(line)) {
      flushProse();
      output.push(line);
      fenced = !fenced;
    } else if (fenced) {
      output.push(line);
    } else {
      prose.push(line);
    }
  }
  flushProse();
  return output.join("\n");
}

export function splitReadmeFrontMatter(source: string): {body: string; frontMatter: string; fields: FrontMatterField[]} {
  const normalized = String(source || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
  if (lines[0]?.trim() !== "---") return {body: normalized, frontMatter: "", fields: []};
  const closingIndex = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/.test(line));
  if (closingIndex < 0) return {body: normalized, frontMatter: "", fields: []};

  const metadataLines = lines.slice(1, closingIndex);
  const values = new Map<string, string[]>();
  let activeKey = "";
  for (const line of metadataLines) {
    const property = line.match(/^([A-Za-z][A-Za-z0-9_-]*):(?:\s*(.*))?$/);
    if (property) {
      activeKey = Object.hasOwn(frontMatterLabels, property[1]) ? property[1] : "";
      const scalar = cleanYamlScalar(property[2] || "");
      if (activeKey && scalar && !["|", ">", "[]", "{}"].includes(scalar)) values.set(activeKey, [scalar]);
      continue;
    }
    const item = activeKey ? line.match(/^\s*-\s+([^:#][^#]*)$/) : null;
    if (!item) continue;
    const scalar = cleanYamlScalar(item[1]);
    if (scalar) values.set(activeKey, [...(values.get(activeKey) || []), scalar]);
  }

  const fields = Object.keys(frontMatterLabels).flatMap((key) => {
    const unique = [...new Set(values.get(key) || [])];
    return unique.length ? [{label: frontMatterLabels[key], values: unique}] : [];
  });
  return {
    body: lines.slice(closingIndex + 1).join("\n").trimStart(),
    frontMatter: metadataLines.join("\n").trim(),
    fields,
  };
}

export function RepositoryReadme({source, path, dataset = false, resolveImage}: {
  source: string;
  path: string;
  dataset?: boolean;
  resolveImage?: (source: string) => string;
}) {
  const parsed = dataset ? splitReadmeFrontMatter(source) : {body: source, frontMatter: "", fields: [] as FrontMatterField[]};
  const body = normalizeReadmeMarkdown(parsed.body).trim() || "This repository does not expose a README description.";
  return <section className="repository-readme" aria-label="Repository README">
    <header><span>Project description</span><strong>{path}</strong></header>
    {parsed.frontMatter && <div className="repository-card-metadata">
      <div><strong>Dataset card metadata</strong><span>{parsed.fields.length ? `${parsed.fields.length} summaries` : "YAML"}</span></div>
      {parsed.fields.length > 0 && <dl>{parsed.fields.map((field) => <div key={field.label}>
        <dt>{field.label}</dt>
        <dd>{field.values.slice(0, 4).map((value) => <span key={value}>{value.replace(/_/g, " ")}</span>)}{field.values.length > 4 && <span>+{field.values.length - 4}</span>}</dd>
      </div>)}</dl>}
      <details><summary>View raw YAML</summary><pre aria-label="Raw dataset card metadata"><code data-language="yaml">{parsed.frontMatter}</code></pre></details>
    </div>}
    <CliffMarkdown source={body} resolveImage={resolveImage} />
  </section>;
}
