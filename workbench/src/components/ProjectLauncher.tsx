import {useRef, useState} from "react";
import {ArrowRight, FilePlus2} from "lucide-react";
import {api} from "../lib/api";
import type {Project} from "../types";
import {PointCloudWave} from "./PointCloudWave";

type ProjectInput = {
  name: string;
  media_type: string;
  content?: string;
  data?: string;
};

const textSuffixes = new Set(["txt", "md", "markdown", "json", "yaml", "yml", "toml", "csv"]);

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")), {once: true});
    reader.addEventListener("error", () => reject(reader.error || new Error(`Could not read ${file.name}`)), {once: true});
    reader.readAsDataURL(file);
  });
}

async function prepareInputs(files: File[]): Promise<ProjectInput[]> {
  return Promise.all(files.map(async (file) => {
    const suffix = file.name.toLowerCase().split(".").pop() || "";
    if (textSuffixes.has(suffix)) {
      return {name: file.name, content: await file.text(), media_type: file.type || "text/plain"};
    }
    return {name: file.name, data: await readAsDataUrl(file), media_type: file.type || "application/octet-stream"};
  }));
}

export function ProjectLauncher({onCreated}: {
  onCreated: (project: Project, destination: "source" | "data", cliffRequest: string) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);
  const [prompt, setPrompt] = useState("");
  const [inputs, setInputs] = useState<ProjectInput[]>([]);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");

  const selectFiles = async (files: File[]) => {
    setError(""); setStatus("");
    if (files.length > 8) { setError("Attach no more than eight source files."); return; }
    const oversized = files.find((file) => file.size > 8_000_000);
    if (oversized) { setError(`${oversized.name} exceeds the 8 MB project input limit.`); return; }
    if (files.reduce((total, file) => total + file.size, 0) > 20_000_000) {
      setError("Project inputs exceed the 20 MB combined limit."); return;
    }
    setReading(true);
    try { setInputs(await prepareInputs(files)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setReading(false); }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submittingRef.current) return;
    setError(""); setStatus("");
    if (!prompt.trim() && !inputs.length) { setError("Describe the project or add a source file first."); return; }
    submittingRef.current = true;
    setBusy(true);
    setStatus("Preserving source material, resolving pinned sources, and preparing the Coding Assistant workspace…");
    try {
      const result = await api.createPromptProject(prompt.trim(), inputs);
      const destination = result.destination_panel === "data" ? "data" : "source";
      setStatus(`${result.project.name || result.project.id} is ready. Opening the project workspace…`);
      // This is the user's first ModelForge Coding Assistant turn. Platform commissioning rules live
      // in trusted context; never make an internal checklist look user-authored.
      const cliffRequest = prompt.trim() || "Please build the project described in PROJECT_BRIEF.md.";
      setPrompt(""); setInputs([]);
      if (inputRef.current) inputRef.current.value = "";
      await onCreated(result.project, destination, cliffRequest);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason)); setStatus("");
    } finally { submittingRef.current = false; setBusy(false); }
  };

  const fileLabel = reading
    ? "Reading source files…"
    : inputs.length
      ? `${inputs.length} ${inputs.length === 1 ? "source file" : "source files"} ready`
      : "PDF, DOCX, images, or text";

  return <main className="project-launcher">
    <PointCloudWave className="project-launcher-wave" />
    <section className="project-launcher-content" aria-labelledby="project-launcher-title">
      <div className="project-launcher-kicker"><i /><span>New workspace</span></div>
      <h1 id="project-launcher-title">Start with an <strong>idea.</strong></h1>
      <p>Describe what you want to build and attach the source material a user would naturally start with. ModelForge preserves it in a project workspace where the Coding Assistant can inspect the result.</p>
      <form className="project-launcher-prompt" onSubmit={(event) => void submit(event)}>
        <label className="sr-only" htmlFor="project-launcher-request">Describe a new ModelForge project</label>
        <textarea id="project-launcher-request" autoFocus maxLength={32_000} rows={5} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Build a visual inspection project using https://huggingface.co/datasets/… and the model code from https://github.com/…" />
        <div className="project-launcher-prompt-footer">
          <input ref={inputRef} type="file" accept=".txt,.md,.markdown,.json,.yaml,.yml,.toml,.csv,.pdf,.docx,.odt,.rtf,.png,.jpg,.jpeg,.webp,text/plain,text/markdown,application/json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,image/webp" multiple hidden onChange={(event) => void selectFiles(Array.from(event.target.files || []))} />
          <button className="project-launcher-upload" type="button" disabled={busy || reading} onClick={() => inputRef.current?.click()}><FilePlus2 size={15} /> Add source files</button>
          <span className={inputs.length ? "has-files" : ""}>{fileLabel}</span>
          <button className="project-launcher-start" type="submit" disabled={busy || reading}>{busy ? "Creating…" : <>Create project <ArrowRight size={14} /></>}</button>
        </div>
      </form>
      {error && <div className="project-launcher-feedback error" role="alert">{error}</div>}
      {status && <div className="project-launcher-feedback" role="status" aria-live="polite">{status}</div>}
      <div className="project-launcher-hints" aria-label="Supported project sources"><span>Prompt</span><span>Documents</span></div>
    </section>
  </main>;
}
