import type {JsonMap} from "../types";

export type CorpusSplit = "train" | "validation" | "held_out" | "unassigned";

export interface CorpusRecord {
  key: string;
  id: string;
  path: string;
  index: number;
  split: CorpusSplit;
  fields: string[];
  input: string;
  output: string;
  messages: number;
  value: JsonMap;
}

export interface CorpusPreview {
  path: string;
  format: "jsonl" | "json" | "csv";
  records: CorpusRecord[];
  truncated: boolean;
  parseErrors: number;
}

const recordCollections = ["records", "examples", "data", "rows", "items"];

function objectValue(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
}

function compact(value: unknown, maximum = 360): string {
  if (value === undefined || value === null || value === "") return "";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > maximum ? `${text.slice(0, maximum - 1)}…` : text;
}

function messageText(value: unknown, role: string): string {
  if (!Array.isArray(value)) return "";
  const message = [...value].reverse().find((candidate) => {
    const item = objectValue(candidate);
    return String(item.role || "").toLowerCase() === role && Boolean(item.content);
  });
  return compact(objectValue(message).content);
}

function firstValue(record: JsonMap, names: string[]): unknown {
  for (const name of names) {
    if (record[name] !== undefined && record[name] !== null && record[name] !== "") return record[name];
  }
  return undefined;
}

export function corpusSplitFromPath(path: string): CorpusSplit {
  const parts = path.toLowerCase().split(/[\\/._-]+/).filter(Boolean);
  if (parts.some((part) => ["test", "heldout", "held", "eval"].includes(part))) return "held_out";
  if (parts.some((part) => ["validation", "validate", "valid", "val", "dev"].includes(part))) return "validation";
  if (parts.some((part) => ["train", "training"].includes(part))) return "train";
  return "unassigned";
}

export function corpusRecord(path: string, value: unknown, index: number): CorpusRecord | null {
  const record = objectValue(value);
  if (!Object.keys(record).length) return null;
  const messages = Array.isArray(record.messages)
    ? record.messages
    : Array.isArray(objectValue(record.input).messages) ? objectValue(record.input).messages as unknown[] : [];
  const id = compact(firstValue(record, ["id", "example_id", "exampleId", "conversation_id", "conversationId"]), 120)
    || `${path.split("/").at(-1) || "record"}:${index + 1}`;
  const input = messageText(messages, "user") || compact(firstValue(record, ["input", "prompt", "instruction", "question", "text"]));
  const output = messageText(messages, "assistant") || compact(firstValue(record, ["output", "target", "response", "completion", "answer", "lyrics"]));
  return {
    key: `${path}:${index}`,
    id,
    path,
    index,
    split: corpusSplitFromPath(path),
    fields: Object.keys(record).sort(),
    input,
    output,
    messages: messages.length,
    value: record,
  };
}

function csvRecords(text: string, truncated: boolean, maximumRecords: number): {values: JsonMap[]; parseErrors: number; limited: boolean} {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let parseErrors = 0;
  let limited = false;
  const finishRow = () => {
    row.push(field);
    rows.push(row);
    row = [];
    field = "";
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
      continue;
    }
    if (character === '"' && !field.length) quoted = true;
    else if (character === ",") { row.push(field); field = ""; }
    else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      finishRow();
      if (rows.length > maximumRecords) { limited = true; break; }
    } else field += character;
  }

  if (!limited && !truncated) {
    if (quoted) parseErrors += 1;
    else if (field.length || row.length) finishRow();
  }
  const header = rows.shift() || [];
  if (!header.length) return {values: [], parseErrors, limited};
  const seen = new Map<string, number>();
  const fields = header.map((raw, index) => {
    const base = raw.replace(/^\uFEFF/, "").trim() || `column_${index + 1}`;
    const occurrence = (seen.get(base) || 0) + 1;
    seen.set(base, occurrence);
    return occurrence === 1 ? base : `${base}_${occurrence}`;
  });
  const values: JsonMap[] = [];
  for (const valuesRow of rows.slice(0, maximumRecords)) {
    if (valuesRow.length !== fields.length) { parseErrors += 1; continue; }
    values.push(Object.fromEntries(fields.map((name, index) => [name, valuesRow[index]])));
  }
  return {values, parseErrors, limited};
}

export function parseCorpusPreview(path: string, text: string, truncated = false, maximumRecords = 250): CorpusPreview {
  const lower = path.toLowerCase();
  const format = lower.endsWith(".csv") ? "csv" : lower.endsWith(".jsonl") || lower.endsWith(".ndjson") ? "jsonl" : "json";
  const values: unknown[] = [];
  let parseErrors = 0;
  let boundedByParser = false;
  if (format === "csv") {
    const parsed = csvRecords(text, truncated, maximumRecords);
    values.push(...parsed.values);
    parseErrors = parsed.parseErrors;
    boundedByParser = parsed.limited;
  } else if (format === "jsonl") {
    const lines = text.split(/\r?\n/);
    if (truncated && lines.length) lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try { values.push(JSON.parse(line)); }
      catch { parseErrors += 1; }
      if (values.length >= maximumRecords) break;
    }
  } else {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) values.push(...parsed.slice(0, maximumRecords));
      else {
        const root = objectValue(parsed);
        const collection = recordCollections.map((key) => root[key]).find(Array.isArray);
        if (Array.isArray(collection)) values.push(...collection.slice(0, maximumRecords));
      }
    } catch { parseErrors += 1; }
  }
  return {
    path,
    format,
    records: values.map((value, index) => corpusRecord(path, value, index)).filter((value): value is CorpusRecord => Boolean(value)),
    truncated: truncated || boundedByParser || values.length >= maximumRecords,
    parseErrors,
  };
}

export function isLlmCorpusProject(project: JsonMap): boolean {
  if (project.llm_workbench && typeof project.llm_workbench === "object") return true;
  const runtime = objectValue(project.runtime);
  const actions = objectValue(runtime.actions);
  const prompt = objectValue(actions.prompt);
  return String(prompt.interface || "").toLowerCase() === "prompt_process";
}
