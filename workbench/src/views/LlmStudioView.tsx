import {useEffect, useMemo, useRef, useState} from "react";
import {
  Bot, CheckCircle2, Clock3, Database, FilePlus2, FlaskConical,
  GitCompareArrows, Image, ListChecks, MessageSquarePlus, Paperclip,
  Play, Plus, Save, Send, Sparkles, Trash2, UserRound, X, XCircle,
} from "lucide-react";
import {ApiError, api} from "../lib/api";
import type {
  JsonMap, LlmAnnotationSource, LlmAnnotationValue, LlmAttachment, LlmEvaluation,
  LlmEvaluationSummary, LlmExample, LlmMessage, LlmMetadataField,
  LlmMetadataSchema, LlmWorkspace, Project,
} from "../types";
import {Badge, Button, EmptyState, ErrorNotice, LoadingState, SectionHeader} from "../components/ui";

const blankMessages = (): LlmMessage[] => [
  {role: "system", content: "You are a helpful assistant.", attachments: []},
  {role: "user", content: "", attachments: []},
];

function objectAt(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")), {once: true});
    reader.addEventListener("error", () => reject(reader.error || new Error(`Could not read ${file.name}`)), {once: true});
    reader.readAsDataURL(file);
  });
}

async function prepareAttachments(files: File[]): Promise<LlmAttachment[]> {
  if (files.length > 8) throw new Error("Attach no more than eight files to one message.");
  if (files.some((file) => file.size > 8_000_000)) throw new Error("Each attachment must be 8 MB or smaller.");
  if (files.reduce((total, file) => total + file.size, 0) > 20_000_000) throw new Error("Attachments exceed the 20 MB combined limit.");
  return Promise.all(files.map(async (file) => ({
    name: file.name,
    media_type: file.type || "application/octet-stream",
    data: await readAsDataUrl(file),
    size: file.size,
  })));
}

function attachmentLabel(attachment: LlmAttachment): string {
  const size = Number(attachment.size || 0);
  const formatted = size > 1_000_000 ? `${(size / 1_000_000).toFixed(1)} MB` : `${(size / 1_000).toFixed(1)} KB`;
  return `${attachment.name}${size ? ` · ${formatted}` : ""}`;
}

const sourceLabels: Record<LlmAnnotationSource, string> = {
  manual: "Manual",
  automatic: "Automatic estimate",
  manual_reviewed: "Manually reviewed",
  imported: "Imported",
};

function AnnotationInput({field, entry, onChange}: {
  field: LlmMetadataField;
  entry?: LlmAnnotationValue;
  onChange: (entry?: LlmAnnotationValue) => void;
}) {
  const source = entry?.source || "manual";
  const update = (value: string | number | boolean | undefined) => {
    if (value === undefined || value === "") onChange(undefined);
    else onChange({value, source});
  };
  const common = {"aria-label": field.label, title: field.description || undefined};
  const control = field.type === "enum"
    ? <select {...common} value={String(entry?.value ?? "")} onChange={(event) => update(event.target.value)}><option value="">Not set</option>{(field.options || []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
    : field.type === "boolean"
      ? <select {...common} value={entry === undefined ? "" : String(Boolean(entry.value))} onChange={(event) => update(event.target.value === "" ? undefined : event.target.value === "true")}><option value="">Not set</option><option value="true">Yes</option><option value="false">No</option></select>
      : field.type === "textarea"
        ? <textarea {...common} rows={3} value={String(entry?.value ?? "")} placeholder={field.placeholder} onChange={(event) => update(event.target.value)} />
        : <input {...common} type={field.type === "number" || field.type === "integer" ? "number" : field.type === "date" ? "date" : "text"} value={String(entry?.value ?? "")} placeholder={field.placeholder} min={field.minimum} max={field.maximum} step={field.step ?? (field.type === "integer" ? 1 : undefined)} onChange={(event) => update(field.type === "number" || field.type === "integer" ? (event.target.value === "" ? undefined : Number(event.target.value)) : event.target.value)} />;
  return <label className={field.type === "textarea" ? "wide" : ""}>
    <span>{field.label}{field.unit ? ` (${field.unit})` : ""}{field.required_for_approval ? <b title="Required before approval">*</b> : null}</span>
    {control}
    <select className="llm-annotation-source" aria-label={`${field.label} source`} value={source} onChange={(event) => entry && onChange({...entry, source: event.target.value as LlmAnnotationSource})}>{Object.entries(sourceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
    {field.description && <small>{field.description}</small>}
  </label>;
}

function AnnotationEditor({schema, annotations, onChange}: {
  schema: LlmMetadataSchema;
  annotations: Record<string, LlmAnnotationValue>;
  onChange: (annotations: Record<string, LlmAnnotationValue>) => void;
}) {
  if (!schema.fields.length) return null;
  const groups = [...new Set(schema.fields.map((field) => field.group || "Annotations"))];
  return <section className="llm-annotations">
    <header><div><strong>{schema.title}</strong><small>{schema.description}</small></div><Badge>{schema.id} · v{schema.version}</Badge></header>
    {groups.map((group) => <fieldset key={group}><legend>{group}</legend><div>{schema.fields.filter((field) => (field.group || "Annotations") === group).map((field) => <AnnotationInput key={field.id} field={field} entry={annotations[field.id]} onChange={(entry) => {const next = {...annotations}; if (entry) next[field.id] = entry; else delete next[field.id]; onChange(next);}} />)}</div></fieldset>)}
  </section>;
}

function MessageEditor({message, index, canRemove, onChange, onRemove}: {
  message: LlmMessage;
  index: number;
  canRemove: boolean;
  onChange: (message: LlmMessage) => void;
  onRemove: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const attach = async (files: File[]) => {
    const attachments = await prepareAttachments(files);
    onChange({...message, attachments: [...(message.attachments || []), ...attachments].slice(0, 8)});
    if (input.current) input.current.value = "";
  };
  return <article className={`llm-message-editor role-${message.role}`}>
    <header>
      <span>{message.role === "assistant" ? <Bot size={14} /> : <UserRound size={14} />}</span>
      <select aria-label={`Role for message ${index + 1}`} value={message.role} onChange={(event) => onChange({...message, role: event.target.value as LlmMessage["role"]})}>
        <option value="system">System</option><option value="user">User</option><option value="assistant">Assistant</option><option value="tool">Tool</option>
      </select>
      <small>Message {index + 1}</small>
      {canRemove && <button type="button" aria-label={`Remove message ${index + 1}`} onClick={onRemove}><Trash2 size={13} /></button>}
    </header>
    <textarea rows={message.role === "system" ? 3 : 5} value={message.content} maxLength={64_000} onChange={(event) => onChange({...message, content: event.target.value})} placeholder={message.role === "assistant" ? "Ideal model response" : message.role === "system" ? "System behavior and constraints" : "User prompt"} />
    <footer>
      <input ref={input} type="file" multiple hidden onChange={(event) => void attach(Array.from(event.target.files || [])).catch((reason) => window.alert(String(reason)))} />
      <Button type="button" size="sm" onClick={() => input.current?.click()}><Paperclip size={12} /> Attach</Button>
      <div className="llm-attachment-list">{(message.attachments || []).map((attachment, attachmentIndex) => <span key={`${attachment.name}-${attachmentIndex}`}><Paperclip size={10} />{attachmentLabel(attachment)}<button type="button" aria-label={`Remove ${attachment.name}`} onClick={() => onChange({...message, attachments: (message.attachments || []).filter((_, candidate) => candidate !== attachmentIndex)})}><X size={10} /></button></span>)}</div>
    </footer>
  </article>;
}

function CurationWorkspace({project, workspace, onWorkspace, onOpenTraining}: {
  project: Project;
  workspace: LlmWorkspace;
  onWorkspace: (workspace: LlmWorkspace) => void;
  onOpenTraining: () => void;
}) {
  const curationWriteAvailable = workspace.curation_write_available !== false;
  const [selectedId, setSelectedId] = useState<string>("");
  const [messages, setMessages] = useState<LlmMessage[]>(blankMessages);
  const [split, setSplit] = useState<"train" | "validation">("train");
  const [reviewStatus, setReviewStatus] = useState<"draft" | "reviewed" | "approved" | "rejected">("draft");
  const [annotations, setAnnotations] = useState<Record<string, LlmAnnotationValue>>({});
  const [tags, setTags] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const examples = workspace.examples || [];
  const select = (example?: LlmExample) => {
    setSelectedId(example?.id || "");
    setMessages(example ? example.messages.map((message) => ({...message, attachments: [...(message.attachments || [])]})) : blankMessages());
    setSplit(example?.split || "train"); setReviewStatus(example?.review_status || "draft"); setAnnotations({...example?.annotations}); setTags((example?.tags || []).join(", ")); setNotes(example?.notes || ""); setError("");
  };
  useEffect(() => {
    if (selectedId && !examples.some((example) => example.id === selectedId)) select();
    else if (!selectedId && examples.length) select(examples[0]);
  }, [workspace.revision]);
  const updateMessage = (index: number, message: LlmMessage) => setMessages((current) => current.map((candidate, candidateIndex) => candidateIndex === index ? message : candidate));
  const save = async () => {
    setBusy(true); setError("");
    try {
      const response = await api.saveLlmExample(project.id, {id: selectedId || undefined, split, review_status: reviewStatus, annotations, messages, tags: tags.split(",").map((tag) => tag.trim()).filter(Boolean), notes});
      onWorkspace(response.workspace); select(response.example);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!selectedId || !window.confirm("Delete this curated conversation example? Attachments and source data are retained.")) return;
    setBusy(true); setError("");
    try { const response = await api.deleteLlmExample(project.id, selectedId); onWorkspace(response.workspace); select(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return <div className="llm-curation-layout">
    <aside className="llm-example-list">
      <div className="pane-heading"><span>Examples</span><Button size="sm" onClick={() => select()}><Plus size={12} /> New</Button></div>
      <div className="llm-example-scroll">{examples.map((example, index) => <button key={example.id} type="button" className={selectedId === example.id ? "active" : ""} onClick={() => select(example)}><span><strong>{example.messages.find((message) => message.role === "user")?.content || `Example ${index + 1}`}</strong><small>{example.messages.length} messages · {example.messages.reduce((total, message) => total + (message.attachments?.length || 0), 0)} files · {example.review_status || "draft"}</small></span><Badge tone={example.split === "train" ? "active" : "neutral"}>{example.split}</Badge></button>)}{!examples.length && <EmptyState icon={<Database />} title="No examples yet" description="Create a conversation or save a successful console exchange." />}</div>
    </aside>
    <section className="llm-example-editor">
      <div className="llm-editor-toolbar"><div><strong>{selectedId ? "Edit example" : "New example"}</strong><small>{curationWriteAvailable ? `Stored in ${workspace.dataset_path}` : "Curation persistence is not enabled in the public alpha"}</small></div><label>Split<select value={split} onChange={(event) => setSplit(event.target.value as typeof split)}><option value="train">Training</option><option value="validation">Validation</option></select></label><label>Review<select value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value as typeof reviewStatus)}><option value="draft">Draft</option><option value="reviewed">Reviewed</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></label><Button onClick={() => setMessages((current) => [...current, {role: "user", content: "", attachments: []}])}><MessageSquarePlus size={13} /> Add message</Button>{selectedId && <Button variant="danger" disabled={!curationWriteAvailable} onClick={() => void remove()}><Trash2 size={13} /> Delete</Button>}<Button variant="primary" busy={busy} disabled={!curationWriteAvailable} title={curationWriteAvailable ? undefined : "A server-owned curation persistence port is not enabled"} onClick={() => void save()}><Save size={13} /> Save example</Button></div>
      {error && <ErrorNotice message={error} />}
      <div className="llm-message-stack">{messages.map((message, index) => <MessageEditor key={index} message={message} index={index} canRemove={messages.length > 1} onChange={(next) => updateMessage(index, next)} onRemove={() => setMessages((current) => current.filter((_, candidate) => candidate !== index))} />)}</div>
      <AnnotationEditor schema={workspace.example_metadata_schema} annotations={annotations} onChange={setAnnotations} />
      <div className="llm-example-metadata"><label>Tags<input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="instruction-following, résumé, extraction" /></label><label>Curator notes<textarea rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Why this example belongs in the set" /></label><div><span>Ready to fine-tune?</span><Button onClick={onOpenTraining}><Play size={13} /> Open Training</Button></div></div>
    </section>
  </div>;
}

function PromptConsole({project, workspace, onWorkspace}: {project: Project; workspace: LlmWorkspace; onWorkspace: (workspace: LlmWorkspace) => void}) {
  const input = useRef<HTMLInputElement>(null);
  const [system, setSystem] = useState("You are a helpful assistant.");
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<LlmAttachment[]>([]);
  const [temperature, setTemperature] = useState(.2);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [model, setModel] = useState(workspace.prompt_action.default_model || "");
  const [response, setResponse] = useState<JsonMap | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const assistantMessages = (objectAt(response?.result).messages as LlmMessage[] | undefined) || [];
  const requestMessages = (objectAt(response?.request).messages as LlmMessage[] | undefined) || [];
  const run = async () => {
    if (!prompt.trim() && !attachments.length) { setError("Enter a prompt or attach a file first."); return; }
    setBusy(true); setError(""); setResponse(null);
    try {
      const messages: LlmMessage[] = [
        ...(system.trim() ? [{role: "system" as const, content: system.trim(), attachments: []}] : []),
        {role: "user", content: prompt.trim(), attachments},
      ];
      setResponse(await api.runLlmPrompt({project_id: project.id, model, messages, temperature, max_tokens: maxTokens}));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const saveExchange = async () => {
    setSaving(true); setError("");
    try {
      const saved = await api.saveLlmExample(project.id, {split: "train", messages: [...requestMessages, ...assistantMessages], tags: ["prompt-console"]});
      onWorkspace(saved.workspace);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  };
  const attach = async (files: File[]) => {
    setError("");
    try { setAttachments(await prepareAttachments(files)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    if (input.current) input.current.value = "";
  };
  if (!workspace.prompt_action.available) return <EmptyState icon={<FlaskConical />} title="Register a prompt runtime" description="This project can curate conversation data now. To run the console, declare runtime.actions.prompt as a prompt_process that consumes the versioned request and writes a ModelForge prompt result." />;
  return <div className="llm-console-layout">
    <section className="llm-console-thread">
      <header><div><Sparkles size={16} /><span><strong>{workspace.prompt_action.display_name}</strong><small>{workspace.prompt_action.modalities.join(" + ")} · local project runtime</small></span></div><Badge tone="success">Adapter ready</Badge></header>
      <div className="llm-console-messages">{!response && !busy && <div className="llm-console-welcome"><Bot size={22} /><strong>Test the model as your users will</strong><span>Compose a bounded text prompt and exercise the registered project adapter.</span></div>}{busy && <div className="llm-console-welcome"><Sparkles className="animate-spin" size={22} /><strong>Running prompt adapter…</strong><span>The project runtime is loading the model and generating a bounded response.</span></div>}{response && <><article className="llm-chat-message user"><UserRound size={16} /><div><small>User</small><p>{requestMessages.find((message) => message.role === "user")?.content}</p>{attachments.length > 0 && <span>{attachments.length} attachment{attachments.length === 1 ? "" : "s"}</span>}</div></article>{assistantMessages.map((message, index) => <article className="llm-chat-message assistant" key={index}><Bot size={16} /><div><small>Assistant</small><p>{message.content}</p></div></article>)}<div className="llm-console-result-actions"><span>{Number(objectAt(objectAt(response.result).usage).total_tokens || 0) ? `${Number(objectAt(objectAt(response.result).usage).total_tokens)} tokens` : "Token usage unavailable"}{objectAt(response.result).model ? ` · ${String(objectAt(response.result).model)}` : ""}</span><Button busy={saving} disabled={workspace.curation_write_available === false} title={workspace.curation_write_available === false ? "Curation persistence is not enabled in the public alpha" : undefined} onClick={() => void saveExchange()}><Save size={13} /> Save exchange to training data</Button></div></>}</div>
      {error && <ErrorNotice message={error} />}
      <div className="llm-composer">
        <textarea rows={4} value={prompt} maxLength={64_000} onChange={(event) => setPrompt(event.target.value)} placeholder="Ask the model about the attached résumé, image, document, audio, or video…" onKeyDown={(event) => {if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) void run();}} />
        <div className="llm-composer-files">{attachments.map((attachment, index) => <span key={`${attachment.name}-${index}`}>{attachment.media_type.startsWith("image/") ? <Image size={11} /> : <Paperclip size={11} />}{attachment.name}<button type="button" onClick={() => setAttachments((current) => current.filter((_, candidate) => candidate !== index))}><X size={10} /></button></span>)}</div>
        <footer><input ref={input} type="file" multiple hidden onChange={(event) => void attach(Array.from(event.target.files || []))} /><Button disabled title="The current public prompt contract is text-only" onClick={() => input.current?.click()}><FilePlus2 size={13} /> Attach files</Button><span>⌘ Enter to run</span><Button variant="primary" busy={busy} disabled={!workspace.prompt_action.available} onClick={() => void run()}><Send size={13} /> Run prompt</Button></footer>
      </div>
    </section>
    <aside className="llm-console-settings"><div className="pane-heading">Generation</div><label>System prompt<textarea rows={7} value={system} onChange={(event) => setSystem(event.target.value)} /></label><label>Model<input value={model} onChange={(event) => setModel(event.target.value)} placeholder="Adapter default" /></label><label>Temperature <output>{temperature.toFixed(1)}</output><input type="range" min="0" max="2" step="0.1" value={temperature} onChange={(event) => setTemperature(Number(event.target.value))} /></label><label>Maximum tokens<input type="number" min="1" max="32768" value={maxTokens} onChange={(event) => setMaxTokens(Number(event.target.value))} /></label><div className="llm-console-note"><Paperclip size={13} /><span>Attachments are content-addressed beneath project state. The adapter receives validated local paths; the browser never supplies arbitrary host paths.</span></div></aside>
  </div>;
}

function percentage(value: unknown): string {
  return `${(Number(value || 0) * 100).toFixed(0)}%`;
}

function EvaluationWorkspace({project, workspace}: {project: Project; workspace: LlmWorkspace}) {
  const [evaluations, setEvaluations] = useState<LlmEvaluationSummary[]>([]);
  const [selected, setSelected] = useState<LlmEvaluation | null>(null);
  const [name, setName] = useState("");
  const [model, setModel] = useState(workspace.prompt_action.default_model || "");
  const [temperature, setTemperature] = useState(0);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [busy, setBusy] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [error, setError] = useState("");
  const eligible = (workspace.examples || []).filter((example) => {
    const finalMessage = example.messages[example.messages.length - 1];
    return example.split === "validation"
      && ["reviewed", "approved"].includes(example.review_status || "draft")
      && finalMessage?.role === "assistant"
      && Boolean(finalMessage.content.trim());
  });
  const refresh = async () => {
    const result = await api.llmEvaluations();
    setEvaluations(result.evaluations);
    return result;
  };
  useEffect(() => {
    void refresh().catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  }, [project.id]);
  const open = async (summary: LlmEvaluationSummary) => {
    setDetailBusy(true); setError("");
    try { setSelected(await api.llmEvaluation(summary.id)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setDetailBusy(false); }
  };
  const run = async () => {
    setBusy(true); setError("");
    try {
      const evaluation = await api.runLlmEvaluation({project_id: project.id, name: name.trim() || undefined, model, temperature, max_tokens: maxTokens});
      setSelected(evaluation);
      await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const makeBaseline = async () => {
    if (!selected) return;
    setBusy(true); setError("");
    try {
      const result = await api.setLlmEvaluationBaseline(selected.id);
      setEvaluations(result.evaluations);
      setSelected({...selected, baseline: true});
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  if (!workspace.prompt_action.available) return <EmptyState icon={<FlaskConical />} title="Register a prompt runtime" description="Evaluation uses the same project-owned prompt_process as the console. Curated Validation examples remain available while the adapter is being implemented." />;
  return <div className="llm-evaluation-layout">
    <aside className="llm-evaluation-sidebar">
      <div className="pane-heading"><span>Experiments</span><Badge>{evaluations.length}</Badge></div>
      <section className="llm-evaluation-config">
        <header><ListChecks size={15} /><div><strong>Run validation suite</strong><small>{eligible.length} eligible · dataset r{workspace.dataset_version.revision}</small></div></header>
        <label>Name<input value={name} maxLength={160} onChange={(event) => setName(event.target.value)} placeholder="Candidate prompt or model" /></label>
        <label>Model<input value={model} onChange={(event) => setModel(event.target.value)} placeholder="Adapter default" /></label>
        <div><label>Temperature<input type="number" min="0" max="2" step="0.1" value={temperature} onChange={(event) => setTemperature(Number(event.target.value))} /></label><label>Max tokens<input type="number" min="1" max="32768" value={maxTokens} onChange={(event) => setMaxTokens(Number(event.target.value))} /></label></div>
        <p>The final assistant message is the reference. Only reviewed or approved Validation examples run, with a 20-example local limit.</p>
        <Button variant="primary" busy={busy} disabled={!eligible.length || eligible.length > 20} onClick={() => void run()}><Play size={13} /> Run experiment</Button>
      </section>
      <div className="llm-evaluation-list">{evaluations.map((evaluation) => <button key={evaluation.id} type="button" className={selected?.id === evaluation.id ? "active" : ""} onClick={() => void open(evaluation)}><span><strong>{evaluation.name}</strong><small>r{evaluation.dataset.revision} · {evaluation.model || "adapter default"}</small></span><span><Badge tone={evaluation.baseline ? "active" : evaluation.metrics.failed ? "warning" : "success"}>{evaluation.baseline ? "Baseline" : percentage(evaluation.metrics.exact_match_rate)}</Badge>{evaluation.comparison?.compatible && evaluation.comparison.exact_match_rate_delta !== undefined && <small>{Number(evaluation.comparison.exact_match_rate_delta) >= 0 ? "+" : ""}{percentage(evaluation.comparison.exact_match_rate_delta)} match</small>}</span></button>)}{!evaluations.length && <EmptyState icon={<GitCompareArrows />} title="No experiments" description="Run the reviewed Validation suite to create a reproducible baseline." />}</div>
    </aside>
    <section className="llm-evaluation-detail">
      {error && <ErrorNotice message={error} />}
      {detailBusy && <LoadingState label="Loading experiment evidence…" />}
      {!selected && !detailBusy && <div className="llm-evaluation-welcome"><GitCompareArrows size={28} /><strong>Evaluation-driven development</strong><p>Run the same dataset revision against candidate prompts or models, inspect every output, then choose an explicit baseline for regression comparison.</p><span>Strict reference match is a deterministic diagnostic—not a semantic or CVFit compatibility score.</span></div>}
      {selected && !detailBusy && <>
        <header className="llm-evaluation-header"><div><span><GitCompareArrows size={16} /><strong>{selected.name}</strong>{selected.baseline && <Badge tone="active">Baseline</Badge>}</span><small>{selected.model || "Adapter default"} · dataset r{selected.dataset.revision} · {selected.dataset.sha256.slice(0, 12)}</small></div>{!selected.baseline && <Button busy={busy} onClick={() => void makeBaseline()}><CheckCircle2 size={13} /> Set as baseline</Button>}</header>
        <div className="llm-evaluation-metrics"><div><span>Completed</span><strong>{selected.metrics.completed || 0}/{selected.metrics.examples || 0}</strong></div><div><span>Exact reference</span><strong>{percentage(selected.metrics.exact_match_rate)}</strong></div><div><span>Mean latency</span><strong>{Math.round(Number(selected.metrics.mean_latency_ms || 0))} ms</strong></div><div><span>Total tokens</span><strong>{selected.metrics.total_tokens || 0}</strong></div></div>
        <p className="llm-evaluation-disclaimer">Exact reference match normalizes case and whitespace only. Project-owned scorers and acceptance gates remain authoritative for semantic quality.</p>
        <div className="llm-evaluation-cases">{selected.cases.map((item, index) => <article key={item.example_id} className={item.status === "failed" ? "failed" : item.exact_reference_match ? "matched" : "different"}><header><span>{item.status === "failed" ? <XCircle size={14} /> : <CheckCircle2 size={14} />}<strong>Case {index + 1}</strong><code>{item.example_id.slice(0, 10)}</code></span><span><Clock3 size={12} /> {Math.round(item.duration_ms)} ms · {item.usage.total_tokens || 0} tokens <Badge tone={item.status === "failed" ? "danger" : item.exact_reference_match ? "success" : "warning"}>{item.status === "failed" ? "Failed" : item.exact_reference_match ? "Exact" : "Review"}</Badge></span></header>{item.error ? <ErrorNotice message={item.error} /> : <><div className="llm-evaluation-input"><small>Input</small><p>{[...item.input].reverse().find((message) => message.role === "user")?.content || "Multimodal input"}</p></div><div className="llm-evaluation-output"><section><small>Actual output</small><p>{item.actual_output}</p></section><section><small>Reference output</small><p>{item.reference_output}</p></section></div></>}</article>)}</div>
      </>}
    </section>
  </div>;
}

export function LlmStudioView({project, onOpenTraining}: {project: Project; onOpenTraining: () => void}) {
  const [workspace, setWorkspace] = useState<LlmWorkspace | null>(null);
  const [tab, setTab] = useState<"curation" | "evaluation" | "console">("curation");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false; setLoading(true); setError(""); setWorkspace(null);
    void api.llmWorkspace().then((value) => {if (!cancelled) setWorkspace(value);}).catch((reason) => {if (!cancelled) setError(reason instanceof ApiError && reason.status === 404 ? "The LLM Lab client is newer than the running ModelForge server. Restart the local server, then reload this page." : reason instanceof Error ? reason.message : String(reason));}).finally(() => {if (!cancelled) setLoading(false);});
    return () => {cancelled = true;};
  }, [project.id]);
  const stats = useMemo(() => workspace ? [
    ["Training", workspace.counts.train], ["Validation", workspace.counts.validation],
    ["Messages", workspace.counts.messages], ["Attachments", workspace.counts.attachments],
  ] : [], [workspace]);
  if (loading) return <LoadingState label="Opening LLM workspace…" />;
  if (error || !workspace) return <ErrorNotice message={error || "LLM workspace is unavailable"} />;
  return <div className="document-scroll llm-workspace">
    <SectionHeader eyebrow="Language model workbench" title="Curate, train, and test conversational models" description="Build reviewable multimodal examples, run dataset-bound regression experiments, and exercise the project-owned prompt adapter." actions={<div className="llm-header-actions"><Button variant={tab === "curation" ? "primary" : "secondary"} onClick={() => setTab("curation")}><Database size={13} /> Training data</Button><Button variant={tab === "evaluation" ? "primary" : "secondary"} onClick={() => setTab("evaluation")}><GitCompareArrows size={13} /> Evaluation</Button><Button variant={tab === "console" ? "primary" : "secondary"} onClick={() => setTab("console")}><Bot size={13} /> Prompt console</Button></div>} />
    <div className="llm-stat-strip">{stats.map(([label, value]) => <div key={String(label)}><span>{label}</span><strong>{value}</strong></div>)}<div className="llm-adapter-stat"><span>Prompt runtime</span><strong>{workspace.prompt_action.available ? "Ready" : "Not registered"}</strong></div></div>
    {tab === "curation" ? <CurationWorkspace project={project} workspace={workspace} onWorkspace={setWorkspace} onOpenTraining={onOpenTraining} /> : tab === "evaluation" ? <EvaluationWorkspace project={project} workspace={workspace} /> : <PromptConsole project={project} workspace={workspace} onWorkspace={setWorkspace} />}
  </div>;
}
