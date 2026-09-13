import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {ChevronRight, FileImage, FilePenLine, Paperclip, Plus, Send, Square, Terminal, User, X} from "lucide-react";
import {api} from "../lib/api";
import type {CliffDelegateRoleId, CliffDelegation, JsonMap, Project} from "../types";
import {Badge, Button, ErrorNotice} from "./ui";
import {CliffMark} from "./CliffMark";
import {CliffMarkdown} from "./CliffMarkdown";

type FileChange = {path: string; status: string};
export type CliffImageAttachment = {name: string; url: string};
type Message = {
  role: "user" | "assistant";
  content: string;
  changes?: FileChange[];
  attachments?: CliffImageAttachment[];
  attachmentNames?: string[];
  delegations?: CliffDelegation[];
};
type ActiveRun = {id: string; requestId: string; sessionId: string};
type ActivityFile = {path: string; status: string; diff: string};
export type RunActivity = {
  key: string;
  kind: string;
  category: "reasoning" | "progress" | "command" | "files";
  label: string;
  detail: string;
  append?: boolean;
  command?: string;
  output?: string;
  cwd?: string;
  phase?: string;
  exitCode?: string;
  durationMs?: number;
  files?: ActivityFile[];
};

export type CliffInitialTurn = {
  id: string;
  projectId: string;
  message: string;
};

const terminalStatuses = new Set([
  "complete", "completed", "success", "succeeded", "failed", "error",
  "cancelled", "canceled", "stopped", "startup_failed", "startup_timeout",
]);

export const cliffMaximumImages = 3;
const cliffImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

type ClipboardImageItem = {
  kind: string;
  type: string;
  getAsFile: () => File | null;
};

export function cliffClipboardImageFiles(data: {
  files?: ArrayLike<File>;
  items?: ArrayLike<ClipboardImageItem>;
} | null): File[] {
  const itemFiles = Array.from(data?.items || [])
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  return itemFiles.length
    ? itemFiles
    : Array.from(data?.files || []).filter((file) => file.type.startsWith("image/"));
}

export function cliffImageFileError(file: Pick<File, "name" | "size" | "type">): string {
  const name = file.name || "Picture";
  if (!cliffImageTypes.has(file.type)) return `${name} must be a JPEG, PNG, or WebP image.`;
  if (file.size > 20_000_000) return `${name} is larger than 20 MB.`;
  return "";
}

async function prepareCliffImage(file: File): Promise<CliffImageAttachment> {
  const validationError = cliffImageFileError(file);
  if (validationError) throw new Error(validationError);
  const source = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1600 / Math.max(source.width, source.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(source.width * scale));
    canvas.height = Math.max(1, Math.round(source.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error(`Could not process ${file.name || "picture"}.`);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", .88));
    if (!blob) throw new Error(`Could not process ${file.name || "picture"}.`);
    if (blob.size > 3_000_000) throw new Error(`${file.name || "Picture"} remains larger than 3 MB after processing.`);
    const url = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error(`Could not read ${file.name || "picture"}.`));
      reader.readAsDataURL(blob);
    });
    return {name: file.name || "Pasted image", url};
  } finally {
    source.close?.();
  }
}

function runResult(run: JsonMap): JsonMap {
  return run.result && typeof run.result === "object" && !Array.isArray(run.result)
    ? run.result as JsonMap
    : {};
}

export function cliffRunAnswer(run: JsonMap): string {
  const result = runResult(run);
  for (const key of ["answer", "final_answer", "message", "text", "output"]) {
    const value = result[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function cliffRunChanges(run: JsonMap): FileChange[] {
  const changes = runResult(run).changes;
  if (!Array.isArray(changes)) return [];
  return changes.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const change = value as JsonMap;
    const path = String(change.path || change.file || "").trim();
    if (!path) return [];
    return [{path, status: String(change.status || change.kind || "changed")}];
  }).slice(0, 60);
}

export function cliffRunDelegations(run: JsonMap): CliffDelegation[] {
  const result = runResult(run);
  const values = Array.isArray(run.delegations)
    ? run.delegations
    : Array.isArray(result.delegations) ? result.delegations : [];
  return values.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const delegation = value as JsonMap;
    const role = delegation.role && typeof delegation.role === "object" && !Array.isArray(delegation.role)
      ? delegation.role as JsonMap
      : {};
    if (String(role.id || "") !== "ml_systems_engineer") return [];
    const rawResult = delegation.result && typeof delegation.result === "object" && !Array.isArray(delegation.result)
      ? delegation.result as JsonMap
      : {};
    return [{
      id: String(delegation.id || ""),
      parent_run_id: String(delegation.parent_run_id || ""),
      depth: 1,
      role: {
        id: "ml_systems_engineer" as const,
        display_name: String(role.display_name || "Maya"),
        authority: "read_only_diagnostic" as const,
      },
      status: String(delegation.status || "failed"),
      task_label: String(delegation.task_label || "Diagnose ML system performance"),
      result: Object.keys(rawResult).length ? {
        name: String(rawResult.name || "Maya"),
        feedback: String(rawResult.feedback || ""),
        provider: String(rawResult.provider || ""),
        mode: String(rawResult.mode || ""),
      } : null,
      error: delegation.error ? String(delegation.error) : null,
    }];
  }).slice(0, 1);
}

export function CliffDelegationFeedback({delegations}: {delegations: CliffDelegation[]}) {
  if (!delegations.length) return null;
  return <div className="cliff-delegations" aria-label="Maya read-only diagnostic feedback">
    {delegations.map((delegation) => {
      const feedback = String(delegation.result?.feedback || "").trim();
      return <section key={delegation.id || delegation.role.id}>
        <header><strong>{delegation.role.display_name} feedback</strong><Badge>Read-only diagnostic</Badge></header>
        {feedback
          ? <CliffMarkdown source={feedback} />
          : <p>{delegation.status === "cancelled" ? "The Maya consultation was cancelled." : delegation.error || "Maya did not return diagnostic feedback."}</p>}
      </section>;
    })}
  </div>;
}

function runProgress(run: JsonMap): string {
  const events = Array.isArray(run.events) ? run.events : [];
  const event = [...events].reverse().find((value) => value && typeof value === "object") as JsonMap | undefined;
  const kind = String(event?.type || event?.kind || "").toLowerCase().replace(/[.-]/g, "_");
  const phase = String(event?.phase || run.phase || run.status || "running").toLowerCase();
  if (kind.startsWith("command")) return phase === "completed" ? "Codex finished a project command…" : "Codex is running a project command…";
  if (kind.startsWith("file_change")) return "Codex is updating project files…";
  if (kind === "assistant_delta" || kind === "assistant" || kind.includes("reasoning")) return "Codex is reasoning…";
  const label = activityText(event?.label || event?.message, 180);
  if (label && label.toLowerCase() !== "cliff update") return label;
  const readablePhase = String(run.phase || run.status || "running").replace(/_/g, " ");
  return readablePhase === "completed" ? "Codex finished." : `Codex is ${readablePhase}…`;
}

function activityText(value: unknown, limit: number): string {
  const text = typeof value === "string" ? value : value == null ? "" : String(value);
  return text
    .replace(/(X-ModelForge-Cliff-Run-Token\s*:\s*)\[redacted run capability\]/gi, "$1[redacted]")
    .replace(/(X-ModelForge-Cliff-Run-Token\s*:\s*)[^\s'";,]+/gi, "$1[redacted]")
    .replace(/(Authorization\s*:\s*Bearer\s+)[^\s'";,]+/gi, "$1[redacted]")
    .replace(/\s+/g, " ").trim().slice(0, limit);
}

function activityDetailText(value: unknown, limit: number): string {
  const text = typeof value === "string" ? value : value == null ? "" : String(value);
  return text
    .replace(/(X-ModelForge-Cliff-Run-Token\s*:\s*)\[redacted run capability\]/gi, "$1[redacted]")
    .replace(/(X-ModelForge-Cliff-Run-Token\s*:\s*)[^\s'";,]+/gi, "$1[redacted]")
    .replace(/(Authorization\s*:\s*Bearer\s+)[^\s'";,]+/gi, "$1[redacted]")
    .replace(/\r\n?/g, "\n").trim().slice(0, limit);
}

function appendedActivityText(previous: string, addition: string, limit = 2_400): string {
  const joined = `${previous}${/\s$/.test(previous) || /^[\s.,;:!?)}\]]/.test(addition) ? "" : " "}${addition}`;
  if (joined.length <= limit) return joined;
  const tail = joined.slice(-limit);
  const boundary = tail.search(/\s/);
  return boundary >= 0 ? tail.slice(boundary + 1) : tail;
}

function readableActivityText(value: string, limit = 260): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  const prefix = text.slice(0, limit + 1);
  const sentenceEnd = Math.max(prefix.lastIndexOf(". "), prefix.lastIndexOf("! "), prefix.lastIndexOf("? "));
  const wordEnd = prefix.lastIndexOf(" ");
  const end = sentenceEnd >= Math.floor(limit * .55) ? sentenceEnd + 1 : wordEnd;
  return `${prefix.slice(0, end > 0 ? end : limit).trimEnd()}…`;
}

export function cliffReasoningSummaries(value: string): string[] {
  const normalized = value
    .replace(/\r\n?/g, "\n")
    .replace(/\*\*\s+\*\*/g, "\n")
    .replace(/\*{3,}/g, "\n")
    .replace(/\*\*/g, "")
    .replace(/(?:^|\n)\s{0,3}#{1,6}\s+/g, "\n")
    .replace(/(?:^|\n)\s*[-*+•]\s+/g, "\n")
    .replace(/([.!?…])(?=\s+[A-Z0-9]|[A-Z][a-z])/g, "$1\n");
  return normalized.split(/\n+/)
    .map((item) => item.replace(/^\s*(?:current|update|plan)\s*:\s*/i, "").trim())
    .filter((item) => item && !/^[\s,[\]{}:"]+$/.test(item))
    .filter((item) => !/^[{,]?\s*"?(?:answer|outcome|acceptance_checks|criterion|status|evidence)"?\s*:/i.test(item))
    .filter((item) => !/^(?:cliff is )?(?:working|thinking|reasoning|continuing)(?: on it)?[.!?…]*$/i.test(item))
    .map((item) => readableActivityText(item));
}

function commandActivitySummary(command: string, phase: string, exitCode: string): string {
  const normalized = command.toLowerCase();
  const running = !["completed", "complete", "success", "succeeded", "failed", "error"].includes(phase);
  const failed = ["failed", "error"].includes(phase) || (exitCode !== "" && exitCode !== "0");
  const action = /(?:^|\s)(?:pytest|vitest|jest|mocha|cargo test|go test|npm (?:run )?test|pnpm (?:run )?test|yarn test)(?:\s|$)/.test(normalized)
    ? "tests"
    : /(?:^|\s)(?:rg|grep|find|ls|cat|sed|head|tail)(?:\s|$)/.test(normalized)
      ? "project files"
      : /(?:^|\s)(?:tsc|vite build|npm run build|pnpm build|yarn build|cargo build)(?:\s|$)/.test(normalized)
        ? "the project"
        : /(?:^|\s)git\s+(?:status|diff|log|show)(?:\s|$)/.test(normalized)
          ? "repository state"
          : "a project command";
  if (failed) return action === "a project command" ? "Project command reported an issue" : `Checked ${action} with an issue`;
  if (running) return action === "a project command" ? "Running a project command" : `Checking ${action}`;
  return action === "a project command" ? "Ran a project command" : `Checked ${action}`;
}

function eventFiles(value: unknown, fallback: JsonMap): ActivityFile[] {
  const raw = Array.isArray(value) ? value : value ? [value] : (fallback.path || fallback.file ? [fallback] : []);
  return raw.flatMap((item) => {
    const change = item && typeof item === "object" && !Array.isArray(item) ? item as JsonMap : {};
    const path = activityText(typeof item === "string" ? item : change.path ?? change.file ?? change.name, 220);
    if (!path) return [];
    return [{
      path,
      status: activityText(change.status ?? change.kind ?? fallback.status ?? fallback.phase ?? "changed", 40),
      diff: activityDetailText(change.diff, 12_000),
    }];
  }).slice(0, 60);
}

function fileActivitySummary(files: ActivityFile[], phase: string): string {
  const running = phase === "started" || phase === "running";
  const count = files.length;
  if (!count) return running ? "Updating project files" : "Updated project files";
  const noun = count === 1 ? "file" : "files";
  return `${running ? "Updating" : "Updated"} ${count} ${noun}`;
}

export function cliffRunActivities(run: JsonMap): RunActivity[] {
  const events = Array.isArray(run.events) ? run.events : [];
  return events.flatMap((value, index) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const event = value as JsonMap;
    const kind = String(event.type || event.kind || "status").toLowerCase().replace(/[.-]/g, "_");
    if (event.heartbeat === true) return [];
    const data = event.data && typeof event.data === "object" && !Array.isArray(event.data)
      ? event.data as JsonMap
      : {};
    const field = (name: string) => data[name] ?? event[name];
    const itemId = activityText(field("item_id") ?? field("id"), 160);
    const phase = activityText(field("phase"), 80).toLowerCase();
    let label = activityText(field("label") ?? field("message"), 180);
    let detail = activityText(field("detail") ?? field("description"), 500);
    let category: RunActivity["category"] = "progress";
    let command = "";
    let output = "";
    let cwd = "";
    let exitCode = "";
    let durationMs: number | undefined;
    let files: ActivityFile[] | undefined;
    if (kind.startsWith("command")) {
      category = "command";
      command = activityDetailText(field("command_text") ?? field("command") ?? field("cmd"), 4_000);
      output = activityDetailText(field("output") ?? field("text") ?? field("delta"), 12_000);
      cwd = activityText(field("cwd"), 220);
      exitCode = field("exit_code") == null ? "" : activityText(field("exit_code"), 20);
      const rawDuration = Number(field("duration_ms"));
      durationMs = Number.isFinite(rawDuration) && rawDuration >= 0 ? rawDuration : undefined;
      label = commandActivitySummary(command, phase || (kind.endsWith("completed") ? "completed" : "started"), exitCode);
      detail = "";
    } else if (kind.startsWith("file_change")) {
      category = "files";
      files = eventFiles(field("changes") ?? field("files") ?? field("change"), {...event, ...data});
      label = fileActivitySummary(files, phase);
      detail = "";
    } else if (kind === "assistant_delta" || kind === "assistant" || kind.includes("reasoning")) {
      category = "reasoning";
      label = activityText(field("summary") ?? field("content") ?? field("text") ?? field("delta") ?? field("detail"), 2_400);
      detail = "";
    } else if (["cliff update", "codex update"].includes(label.toLowerCase()) && detail) {
      category = "reasoning";
      label = detail;
      detail = "";
    }
    if (!label && !detail) return [];
    const sequence = String(event.sequence ?? event.seq ?? event.cursor ?? index);
    const stableItem = itemId || command || files?.map((file) => file.path).join("|") || label || sequence;
    const append = kind === "assistant_delta" || kind.includes("reasoning")
      || ["cliff update", "codex update"].includes(activityText(field("label") ?? field("message"), 180).toLowerCase());
    return [{
      key: kind.startsWith("command") ? `command:${stableItem}`
        : kind.startsWith("file_change") ? `file:${stableItem}`
          : append ? `assistant:${itemId || (phase === "reasoning" ? "reasoning" : "current")}`
            : `${kind}:${sequence}`,
      kind,
      category,
      label: label || "Codex update",
      detail,
      append,
      command,
      output,
      cwd,
      phase,
      exitCode,
      durationMs,
      files,
    }];
  });
}

function activityDuration(milliseconds?: number): string {
  if (milliseconds == null) return "";
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`;
  return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;
}

function activitySummaries(activities: RunActivity[]): string[] {
  const updates: string[] = [];
  for (const activity of activities) {
    if (activity.category !== "reasoning" && activity.category !== "progress") continue;
    for (const summary of cliffReasoningSummaries(activity.label || activity.detail)) {
      if (updates.at(-1) !== summary) updates.push(summary);
    }
  }
  return updates.slice(-6);
}

export function CliffRunActivity({activities}: {activities: RunActivity[]}) {
  const summaries = activitySummaries(activities);
  const currentSummary = summaries.at(-1);
  const earlierSummaries = summaries.slice(0, -1);
  const operations = activities.filter((activity) => activity.category === "command" || activity.category === "files");
  if (!currentSummary && !operations.length) return null;
  return <section className="cliff-run-activity" aria-label="ModelForge Coding Assistant project activity">
    {currentSummary && <div className="cliff-run-reasoning">
      <p>{currentSummary}</p>
      {Boolean(earlierSummaries.length) && <details>
        <summary><ChevronRight size={12} /> Earlier updates <small>{earlierSummaries.length}</small></summary>
        <ol>{earlierSummaries.map((summary, index) => <li key={`${index}:${summary}`}>{summary}</li>)}</ol>
      </details>}
    </div>}
    {operations.map((activity) => <details className={`cliff-run-operation ${activity.category}`} key={activity.key}>
      <summary>
        <ChevronRight className="cliff-run-disclosure" size={13} aria-hidden="true" />
        {activity.category === "command" ? <Terminal size={13} aria-hidden="true" /> : <FilePenLine size={13} aria-hidden="true" />}
        <span>{activity.label}</span>
        {activity.category === "command" && activity.exitCode !== "" && <small>exit {activity.exitCode}</small>}
      </summary>
      <div className="cliff-run-operation-detail">
        {activity.category === "command" ? <>
          {activity.command && <div><small>Command</small><pre>{activity.command}</pre></div>}
          {activity.output && <div><small>Output</small><pre>{activity.output}</pre></div>}
          <footer>{activity.cwd && <span>cwd {activity.cwd}</span>}{activityDuration(activity.durationMs) && <span>{activityDuration(activity.durationMs)}</span>}</footer>
        </> : <div className="cliff-run-file-list">{activity.files?.map((file) => <div key={`${file.status}:${file.path}`}>
          <span><b>{file.status}</b><code>{file.path}</code></span>
          {file.diff && <pre>{file.diff}</pre>}
        </div>)}</div>}
      </div>
    </details>)}
  </section>;
}

function requestId(): string {
  return globalThis.crypto?.randomUUID?.() || `cliff-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

export function CliffPanel({project, context, initialTurn, onInitialTurnConsumed}: {
  project: Project;
  context: string;
  initialTurn?: CliffInitialTurn | null;
  onInitialTurnConsumed?: (id: string) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<string>();
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<CliffImageAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState("");
  const [processingAttachments, setProcessingAttachments] = useState(false);
  const [delegateRoleId, setDelegateRoleId] = useState<CliffDelegateRoleId | "">("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [recoveryChecked, setRecoveryChecked] = useState(false);
  const [error, setError] = useState("");
  const [provider, setProvider] = useState("Checking agent…");
  const [runStatus, setRunStatus] = useState("");
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);
  const [activities, setActivities] = useState<RunActivity[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const processingAttachmentsRef = useRef(false);
  const busyRef = useRef(false);
  const lifecycleRef = useRef(0);
  const initialTurnsRef = useRef(new Set<string>());

  useEffect(() => {
    const lifecycle = ++lifecycleRef.current;
    let active = true;
    busyRef.current = false;
    setMessages([]); setSessionId(undefined); setError(""); setReady(false); setRecoveryChecked(false);
    setAttachments([]); setAttachmentError(""); setProcessingAttachments(false); setDelegateRoleId("");
    processingAttachmentsRef.current = false;
    setBusy(false); setRunStatus(""); setActiveRun(null); setActivities([]);
    void Promise.all([api.cliffStatus(), api.cliffHistory(project.id)]).then(([status, history]) => {
      if (!active || lifecycleRef.current !== lifecycle) return;
      setProvider(String(status.provider || status.status || "Codex ready"));
      const sessions = (Array.isArray(history.sessions) ? history.sessions : []) as JsonMap[];
      const session = sessions.find((item) => item.id === history.active_session_id) || sessions[0];
      if (session) {
        setSessionId(String(session.id));
        setMessages((Array.isArray(session.messages) ? session.messages : []).map((item) => ({
          role: (item as JsonMap).role === "user" ? "user" : "assistant",
          content: String((item as JsonMap).content || ""),
          attachmentNames: Array.isArray((item as JsonMap).attachments)
            ? ((item as JsonMap).attachments as unknown[]).map(String).slice(0, cliffMaximumImages)
            : [],
        })));
      } else setRecoveryChecked(true);
      setReady(true);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { active = false; lifecycleRef.current += 1; };
  }, [project.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({block: "nearest"});
  }, [messages, busy, runStatus]);

  const suggestions = useMemo(() => [
    `Explain the selected ${context.toLowerCase()} in this project`,
    "Summarize the model and dataset lineage",
    "Compare the most recent recorded results",
  ], [context]);

  const addImages = useCallback(async (files: ArrayLike<File>) => {
    if (busyRef.current || processingAttachmentsRef.current) return;
    const pictures = Array.from(files).filter((file) => file.type.startsWith("image/"));
    if (!pictures.length) return;
    if (attachments.length + pictures.length > cliffMaximumImages) {
      setAttachmentError(`ModelForge Coding Assistant accepts up to ${cliffMaximumImages} pictures per message.`);
      return;
    }
    processingAttachmentsRef.current = true;
    setProcessingAttachments(true);
    setAttachmentError("");
    try {
      const prepared: CliffImageAttachment[] = [];
      for (const file of pictures) prepared.push(await prepareCliffImage(file));
      setAttachments((current) => [...current, ...prepared]);
    } catch (reason) {
      setAttachmentError(reason instanceof Error ? reason.message : "Could not process that picture.");
    } finally {
      processingAttachmentsRef.current = false;
      setProcessingAttachments(false);
    }
  }, [attachments.length]);

  const adoptActivities = useCallback((run: JsonMap) => {
    const additions = cliffRunActivities(run);
    if (!additions.length) return;
    setActivities((current) => {
      const next = [...current];
      for (const addition of additions) {
        const index = next.findIndex((activity) => activity.key === addition.key);
        if (index < 0) {
          next.push(addition);
          continue;
        }
        const previous = next[index];
        const streamedOutput = addition.kind === "command_output" || addition.kind.endsWith("_output");
        next[index] = {
          ...previous,
          ...addition,
          label: addition.append
            ? appendedActivityText(previous.label, addition.label)
            : addition.command || addition.files?.length ? addition.label : previous.label || addition.label,
          detail: addition.detail || previous.detail,
          command: addition.command || previous.command,
          output: streamedOutput && addition.output
            ? `${previous.output || ""}${addition.output}`.slice(-12_000)
            : addition.output || previous.output,
          cwd: addition.cwd || previous.cwd,
          exitCode: addition.exitCode || previous.exitCode,
          durationMs: addition.durationMs ?? previous.durationMs,
          files: addition.files?.length ? addition.files : previous.files,
        };
      }
      return next.slice(-12);
    });
  }, []);

  const finishRun = useCallback((run: JsonMap) => {
    const status = String(run.status || "").toLowerCase();
    const answer = cliffRunAnswer(run);
    const changes = cliffRunChanges(run);
    const delegations = cliffRunDelegations(run);
    const failed = ["failed", "error", "startup_failed", "startup_timeout"].includes(status);
    if (failed && !answer) throw new Error(String(run.error || "The Codex project turn failed."));
    setMessages((current) => [...current, {
      role: "assistant",
      content: answer || (status.startsWith("cancel") || status === "stopped"
        ? "The project task was stopped."
        : "Codex completed the project task."),
      changes,
      delegations,
    }]);
    const result = runResult(run);
    setProvider(result.provider ? `${String(result.provider)} · authenticated project agent` : "Codex · authenticated project agent");
  }, []);

  const monitorRun = useCallback(async (
    initialRun: JsonMap, stableRequestId: string, lifecycle: number,
  ) => {
    let run = initialRun;
    let runId = String(run.id || run.run_id || "");
    let resolvedSessionId = String(run.session_id || sessionId || "");
    if (!runId || !resolvedSessionId) throw new Error("Codex started without a run or conversation identifier.");
    setSessionId(resolvedSessionId);
    setActiveRun({id: runId, requestId: stableRequestId, sessionId: resolvedSessionId});
    let cursor = Number(run.event_cursor || 0);
    let failures = 0;
    adoptActivities(run);
    setRunStatus(runProgress(run));
    while (!terminalStatuses.has(String(run.status || "").toLowerCase())) {
      await wait(failures ? Math.min(4_000, 650 * (failures + 1)) : 550);
      if (lifecycleRef.current !== lifecycle) return;
      try {
        const response = await api.cliffRun(project.id, resolvedSessionId, runId, stableRequestId, cursor);
        run = response.run;
        runId = String(run.id || run.run_id || runId);
        resolvedSessionId = String(run.session_id || resolvedSessionId);
        cursor = Number(run.event_cursor ?? cursor);
        failures = 0;
        adoptActivities(run);
        setRunStatus(runProgress(run));
      } catch (reason) {
        failures += 1;
        if (failures >= 6) throw reason;
        setRunStatus(`Live updates paused. Reconnecting (${failures}/6)…`);
      }
    }
    if (lifecycleRef.current === lifecycle) finishRun(run);
  }, [adoptActivities, finishRun, project.id, sessionId]);

  const send = useCallback(async (
    prompt = input, stableRequestId = requestId(), onAccepted?: () => void,
  ) => {
    const submittedAttachments = attachments.map((attachment) => ({...attachment}));
    const message = prompt.trim() || (submittedAttachments.length
      ? "Analyze the attached image in the context of this project."
      : "");
    if (!message || busyRef.current || processingAttachmentsRef.current || !ready || !recoveryChecked) return;
    const lifecycle = lifecycleRef.current;
    busyRef.current = true;
    setInput(""); setBusy(true); setError("");
    setActivities([]);
    setMessages((current) => [...current, {role: "user", content: message, attachments: submittedAttachments}]);
    setRunStatus("Starting the authenticated Codex turn…");
    try {
      const response = await api.startCliffRun(
        project.id, sessionId, message, stableRequestId, submittedAttachments,
        delegateRoleId || undefined,
      );
      const runId = String(response.run.id || response.run.run_id || "");
      const resolvedSessionId = String(response.run.session_id || sessionId || "");
      if (!runId || !resolvedSessionId) throw new Error("Codex started without a run or conversation identifier.");
      setAttachments([]); setAttachmentError(""); setDelegateRoleId("");
      onAccepted?.();
      await monitorRun(response.run, stableRequestId, lifecycle);
    } catch (reason) {
      if (lifecycleRef.current === lifecycle) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (lifecycleRef.current === lifecycle) {
        busyRef.current = false;
        setBusy(false); setRunStatus(""); setActiveRun(null);
      }
    }
  }, [attachments, delegateRoleId, input, monitorRun, project.id, ready, recoveryChecked, sessionId]);

  useEffect(() => {
    if (!ready || recoveryChecked || !sessionId || busyRef.current) return;
    const lifecycle = lifecycleRef.current;
    void api.activeCliffRun(project.id, sessionId).then(async ({run}) => {
      if (!run || lifecycleRef.current !== lifecycle) return;
      const stableRequestId = String(run.request_id || "");
      if (!stableRequestId) throw new Error("The active Codex turn has no recovery identity.");
      busyRef.current = true;
      setBusy(true); setError(""); setActivities([]);
      setRunStatus("Restoring the active Codex project turn…");
      await monitorRun(run, stableRequestId, lifecycle);
    }).catch((reason) => {
      if (lifecycleRef.current === lifecycle) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (lifecycleRef.current === lifecycle) {
        if (busyRef.current) {
          busyRef.current = false;
          setBusy(false); setRunStatus(""); setActiveRun(null);
        }
        // Keep a queued first turn behind active-run recovery. Otherwise the
        // recovery request can clear the new run's busy state or monitor it a
        // second time while the creation handoff is starting.
        setRecoveryChecked(true);
      }
    });
  }, [monitorRun, project.id, ready, recoveryChecked, sessionId]);

  useEffect(() => {
    if (!ready || !recoveryChecked || busyRef.current || !initialTurn || initialTurn.projectId !== project.id) return;
    if (initialTurnsRef.current.has(initialTurn.id)) return;
    initialTurnsRef.current.add(initialTurn.id);
    void send(initialTurn.message, initialTurn.id, () => onInitialTurnConsumed?.(initialTurn.id));
  }, [initialTurn, onInitialTurnConsumed, project.id, ready, recoveryChecked, send]);

  const stop = async () => {
    if (!activeRun) return;
    setRunStatus("Stopping the Codex project turn…");
    try {
      await api.cancelCliffRun(project.id, activeRun.sessionId, activeRun.id, activeRun.requestId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const latestAssistantIndex = messages.reduce(
    (latest, message, index) => message.role === "assistant" ? index : latest,
    -1,
  );

  return <aside className="cliff-panel">
    <header><div className="cliff-title"><span><CliffMark /></span><div><strong>ModelForge Coding Assistant</strong><small>{provider}</small></div></div>{busy && activeRun ? <Button size="sm" variant="ghost" onClick={() => void stop()}><Square size={12} /> Stop</Button> : <Button size="sm" variant="ghost" onClick={() => { setMessages([]); setSessionId(undefined); setAttachments([]); setAttachmentError(""); setDelegateRoleId(""); }}><Plus size={14} /> New</Button>}</header>
    <div className="cliff-context"><span>Context</span><Badge>{context}</Badge></div>
    <div className="cliff-messages">
      {!messages.length && !busy && <div className="cliff-intro"><span><CliffMark animated /></span><strong>Your authenticated Codex agent</strong><p>Ask ModelForge Coding Assistant about the selected project. It uses the Codex account shown in Settings and runs in a project-scoped read-only sandbox.</p><div>{suggestions.map((suggestion) => <button key={suggestion} onClick={() => void send(suggestion)}>{suggestion}</button>)}</div></div>}
      {messages.map((message, index) => <article key={index} className={`cliff-message ${message.role}`}><span>{message.role === "user" ? <User size={14} /> : <CliffMark animated={index === latestAssistantIndex} />}</span><div><strong>{message.role === "user" ? "You" : "Codex"}</strong>{message.role === "assistant" ? <><CliffDelegationFeedback delegations={message.delegations || []} /><CliffMarkdown source={message.content} />{Boolean(message.changes?.length) && <div className="cliff-run-changes"><small>Project changes</small>{message.changes!.map((change) => <span key={`${change.status}:${change.path}`}><b>{change.status}</b><code>{change.path}</code></span>)}</div>}</> : <><p>{message.content}</p>{Boolean(message.attachments?.length) && <div className="cliff-message-images">{message.attachments!.map((attachment, attachmentIndex) => <img key={`${attachment.name}:${attachmentIndex}`} src={attachment.url} alt={attachment.name} />)}</div>}{Boolean(message.attachmentNames?.length) && <div className="cliff-message-attachment-names">{message.attachmentNames!.map((name, attachmentIndex) => <span key={`${name}:${attachmentIndex}`}><FileImage size={11} />{name}</span>)}</div>}</>}</div></article>)}
      {busy && Boolean(activities.length) && <CliffRunActivity activities={activities} />}
      {busy && <div className="cliff-thinking"><i /><i /><i /><span>{runStatus || "Codex is working in the project…"}</span></div>}
      {error && <ErrorNotice message={error} />}
      <div ref={bottomRef} />
    </div>
    <form className="cliff-composer" onSubmit={(event) => { event.preventDefault(); void send(); }}>
      {Boolean(attachments.length) && <div className="cliff-composer-attachments">{attachments.map((attachment, index) => <div key={`${attachment.name}:${index}`}><img src={attachment.url} alt="" /><span title={attachment.name}>{attachment.name}</span><button type="button" onClick={() => setAttachments((current) => current.filter((_, candidate) => candidate !== index))} aria-label={`Remove ${attachment.name}`}><X size={11} /></button></div>)}</div>}
      <div className="cliff-composer-row">
        <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(event) => { void addImages(event.target.files || []); event.target.value = ""; }} />
        <Button variant="ghost" size="icon" type="button" disabled title="Image analysis is not enabled in the public assistant contract" onClick={() => imageInputRef.current?.click()} aria-label="Attach pictures to ModelForge Coding Assistant"><Paperclip size={15} /></Button>
        <textarea rows={2} value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} placeholder={`Ask Codex about ${context.toLowerCase()}…`} aria-label="Ask ModelForge Coding Assistant" />
        <Button variant="primary" size="icon" type="submit" disabled={(!input.trim() && !attachments.length) || busy || processingAttachments || !ready || !recoveryChecked} aria-label="Send to ModelForge Coding Assistant"><Send size={15} /></Button>
      </div>
      <label className="cliff-specialist-select"><span>Specialist for this turn</span><select value={delegateRoleId} disabled title="Specialist delegation is not enabled in the public assistant contract" onChange={(event) => setDelegateRoleId(event.target.value === "ml_systems_engineer" ? "ml_systems_engineer" : "")}><option value="">Codex only</option><option value="ml_systems_engineer">Ask Maya (read-only)</option></select></label>
      {attachmentError && <small className="cliff-attachment-error" role="alert">{attachmentError}</small>}
    </form>
  </aside>;
}
