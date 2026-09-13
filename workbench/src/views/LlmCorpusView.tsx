import {useEffect, useMemo, useState} from "react";
import {Braces, Database, FileText, Lock, MessagesSquare, Search} from "lucide-react";
import {api, artifactUrl} from "../lib/api";
import {humanize} from "../lib/utils";
import {parseCorpusPreview, type CorpusPreview, type CorpusRecord, type CorpusSplit} from "../lib/llm-corpus";
import type {Artifact, Project} from "../types";
import {Badge, Button, EmptyState, ErrorNotice, LoadingState} from "../components/ui";

const corpusExtensions = [".jsonl", ".ndjson", ".json", ".csv"];
const splitOrder: CorpusSplit[] = ["train", "validation", "held_out", "unassigned"];

function corpusCandidate(artifact: Artifact): boolean {
  const path = artifact.path.toLowerCase();
  return ["text", "table"].includes(artifact.kind) && corpusExtensions.some((extension) => path.endsWith(extension));
}

function recordSummary(record: CorpusRecord): string {
  return record.input || record.output || JSON.stringify(record.value);
}

function splitLabel(split: CorpusSplit): string {
  if (split === "held_out") return "Held out";
  if (split === "unassigned") return "Unassigned";
  return humanize(split);
}

export function LlmCorpusView({project, onOpenLlm}: {project: Project; onOpenLlm: () => void}) {
  const [previews, setPreviews] = useState<CorpusPreview[]>([]);
  const [sourceFiles, setSourceFiles] = useState<Artifact[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [search, setSearch] = useState("");
  const [split, setSplit] = useState<CorpusSplit | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(""); setPreviews([]); setSelectedKey("");
    void api.artifacts("", "all", 0, 100).then(async (catalog) => {
      const candidates = (catalog.artifacts || []).filter(corpusCandidate).slice(0, 16);
      const loaded = await Promise.all(candidates.map(async (artifact) => {
        try {
          const response = await fetch(artifactUrl("text", artifact.path), {cache: "no-store"});
          if (!response.ok) return null;
          const body = await response.json() as {text?: string; truncated?: boolean};
          return parseCorpusPreview(artifact.path, String(body.text || ""), Boolean(body.truncated));
        } catch { return null; }
      }));
      if (!cancelled) {
        setSourceFiles(candidates);
        setPreviews(loaded.filter((value): value is CorpusPreview => Boolean(value)));
      }
    }).catch((reason) => {if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));})
      .finally(() => {if (!cancelled) setLoading(false);});
    return () => {cancelled = true;};
  }, [project.id, project.selected_dataset, project.active_dataset_profile]);

  const records = useMemo(() => previews.flatMap((preview) => preview.records), [previews]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return records.filter((record) => (split === "all" || record.split === split) && (
      !needle || `${record.id} ${record.path} ${recordSummary(record)} ${record.fields.join(" ")}`.toLowerCase().includes(needle)
    ));
  }, [records, search, split]);
  const selected = records.find((record) => record.key === selectedKey) || filtered[0] || null;
  const counts = Object.fromEntries(splitOrder.map((role) => [role, records.filter((record) => record.split === role).length])) as Record<CorpusSplit, number>;
  const schemaFields = new Set(records.flatMap((record) => record.fields));
  const bounded = previews.some((preview) => preview.truncated);
  const parseErrors = previews.reduce((total, preview) => total + preview.parseErrors, 0);

  if (loading) return <LoadingState label="Reading bounded corpus previews…" />;
  return <div className="llm-corpus-workspace">
    <section className="llm-corpus-summary">
      <div className="llm-corpus-intro"><span><MessagesSquare size={18} /></span><div><strong>LLM corpus</strong><p>Inspect prompt/target pairs and conversational records without flattening them into vision sequences. Source files remain read-only.</p></div><Button variant="primary" onClick={onOpenLlm}><MessagesSquare size={13} /> Curate conversations</Button></div>
      <div className="llm-corpus-metrics">
        <div><span>Previewed records</span><strong>{bounded ? "≥" : ""}{records.length}</strong><small>{bounded ? "Bounded source preview" : "Across recognized files"}</small></div>
        <div className="train"><span>Training</span><strong>{counts.train}</strong><small>Iterative training records</small></div>
        <div className="validation"><span>Validation</span><strong>{counts.validation}</strong><small>Regression candidates</small></div>
        <div className="held-out"><span>Held out</span><strong>{counts.held_out}</strong><small><Lock size={10} /> Protected evidence</small></div>
        <div><span>Top-level fields</span><strong>{schemaFields.size}</strong><small>Observed record shape</small></div>
      </div>
      <div className="llm-corpus-sources"><span>Corpus sources</span>{sourceFiles.map((file) => {const preview = previews.find((item) => item.path === file.path); return <a key={file.path} href={artifactUrl("raw", file.path)} target="_blank" rel="noreferrer"><FileText size={12} /><strong>{file.name}</strong><small>{preview?.records.length ? `${preview.truncated ? "≥" : ""}${preview.records.length} records` : "metadata or unsupported shape"}</small></a>;})}</div>
      {bounded && <div className="llm-corpus-notice"><Database size={13} /><span>At least one source exceeds the bounded text preview. Counts and rows below intentionally describe only the retained preview, not the complete corpus.</span></div>}
      {Boolean(parseErrors) && <ErrorNotice message={`${parseErrors} malformed or incomplete record${parseErrors === 1 ? " was" : "s were"} omitted from this read-only preview.`} />}
      {error && <ErrorNotice message={error} />}
    </section>

    {records.length ? <section className="llm-corpus-browser">
      <header className="llm-corpus-toolbar"><div className="sidebar-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search IDs, prompts, targets, or fields" aria-label="Search corpus records" /></div><div className="llm-corpus-split-filter" role="group" aria-label="Filter corpus by split"><button type="button" className={split === "all" ? "active" : ""} onClick={() => setSplit("all")}>All <b>{records.length}</b></button>{splitOrder.map((role) => counts[role] > 0 && <button type="button" className={split === role ? "active" : ""} key={role} onClick={() => setSplit(role)}>{role === "held_out" && <Lock size={10} />}{splitLabel(role)} <b>{counts[role]}</b></button>)}</div></header>
      <div className="llm-corpus-layout">
        <div className="llm-corpus-table" role="list" aria-label="Corpus record preview">
          <div className="llm-corpus-table-head"><span>Split</span><span>Record</span><span>Prompt / input</span><span>Expected output</span><span>Shape</span></div>
          {filtered.slice(0, 250).map((record) => <button type="button" role="listitem" className={selected?.key === record.key ? "active" : ""} key={record.key} onClick={() => setSelectedKey(record.key)}><span><Badge tone={record.split === "train" ? "active" : record.split === "held_out" ? "warning" : "neutral"}>{record.split === "held_out" && <Lock size={9} />}{splitLabel(record.split)}</Badge></span><span><strong>{record.id}</strong><small>{record.path} · row {record.index + 1}</small></span><p>{record.input || "No conventional input field"}</p><p>{record.output || "No conventional output field"}</p><span><b>{record.messages ? `${record.messages} turns` : `${record.fields.length} fields`}</b><small>{record.fields.slice(0, 3).join(" · ")}</small></span></button>)}
          {!filtered.length && <EmptyState icon={<Search />} title="No matching records" description="Change the text or split filter to inspect another bounded corpus row." />}
        </div>
        <aside className="llm-corpus-inspector">
          {selected ? <><header><div><Braces size={15} /><span><strong>{selected.id}</strong><small>{selected.path} · row {selected.index + 1}</small></span></div><Badge tone={selected.split === "held_out" ? "warning" : "neutral"}>{selected.split === "held_out" && <Lock size={9} />}{splitLabel(selected.split)}</Badge></header><div className="llm-corpus-field-list">{selected.fields.map((field) => <span key={field}>{field}</span>)}</div>{selected.input && <section><small>Prompt / input</small><p>{selected.input}</p></section>}{selected.output && <section><small>Expected output</small><p>{selected.output}</p></section>}<details><summary>Raw record</summary><pre>{JSON.stringify(selected.value, null, 2)}</pre></details></> : <EmptyState icon={<Braces />} title="Select a record" description="The bounded structured record will appear here." />}
        </aside>
      </div>
    </section> : <EmptyState icon={<Database />} title="No previewable corpus records" description="ModelForge found no CSV rows, JSONL/NDJSON records, or JSON record arrays in the first 100 catalog artifacts. Manifests and formats such as Parquet remain available in Files & manifests." action={<Button onClick={onOpenLlm}>Open curated conversation data</Button>} />}
  </div>;
}
