import {useEffect, useMemo, useRef, useState} from "react";
import {
  ArrowRight, BookOpen, Box, Braces, Check, ChevronRight, Clipboard,
  Code2, Database, FileText, Layers3, Play, Rocket, Search,
  ShieldCheck, Sparkles, TerminalSquare,
} from "lucide-react";

type ArticleSection = "Start here" | "How-to guides" | "Core concepts" | "API reference";

interface KnowledgeArticle {
  id: string;
  section: ArticleSection;
  title: string;
  description: string;
  readTime: string;
  tags: string[];
}

export const knowledgeArticles: KnowledgeArticle[] = [
  {id: "welcome", section: "Start here", title: "What is ModelForge?", description: "A practical introduction to the local-first ML workbench and its project lifecycle.", readTime: "4 min", tags: ["overview", "local-first", "workflow"]},
  {id: "first-project", section: "Start here", title: "Create your first project", description: "Move from an idea to a bounded project workspace with Cliff.", readTime: "6 min", tags: ["project", "cliff", "quickstart"]},
  {id: "data-to-inference", section: "How-to guides", title: "Dataset to inference", description: "Import data, choose a training target, run a model, and inspect the result.", readTime: "9 min", tags: ["dataset", "training", "inference"]},
  {id: "annotations", section: "How-to guides", title: "Review and edit annotations", description: "Inspect visual datasets and work with boxes, tracks, masks, and keyframes.", readTime: "7 min", tags: ["annotations", "video", "images"]},
  {id: "release", section: "How-to guides", title: "Build a release", description: "Turn evaluated evidence into an immutable application release.", readTime: "8 min", tags: ["deploy", "release", "cloud"]},
  {id: "projects", section: "Core concepts", title: "Projects and contracts", description: "Understand manifests, descriptors, project-owned adapters, and framework boundaries.", readTime: "6 min", tags: ["manifest", "contracts", "architecture"]},
  {id: "provenance", section: "Core concepts", title: "Runs, artifacts, and provenance", description: "How ModelForge keeps source, data, checkpoints, and results traceable.", readTime: "5 min", tags: ["runs", "artifacts", "reproducibility"]},
  {id: "rest-api", section: "API reference", title: "Workbench API", description: "The authenticated loopback endpoints used by the trusted workbench.", readTime: "10 min", tags: ["api", "rest", "localhost"]},
  {id: "cli-api", section: "API reference", title: "CLI and workspace API", description: "Discover workspaces and run registered project actions with versioned JSON envelopes.", readTime: "8 min", tags: ["cli", "automation", "json"]},
];

const sectionOrder: ArticleSection[] = ["Start here", "How-to guides", "Core concepts", "API reference"];

export function filterKnowledgeArticles(query: string): KnowledgeArticle[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return knowledgeArticles;
  return knowledgeArticles.filter((article) =>
    [article.title, article.description, article.section, ...article.tags].join(" ").toLowerCase().includes(needle),
  );
}

function CopyButton({value}: {value: string}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };
  return <button className="knowledge-copy" type="button" onClick={() => void copy()} aria-label="Copy code to clipboard">{copied ? <Check /> : <Clipboard />}{copied ? "Copied" : "Copy"}</button>;
}

function CodeBlock({children}: {children: string}) {
  return <div className="knowledge-code"><header><span><i /><i /><i /></span><small>Terminal</small><CopyButton value={children} /></header><pre><code>{children}</code></pre></div>;
}

function WorkflowSteps({items}: {items: Array<{title: string; text: string}>}) {
  return <ol className="knowledge-steps">{items.map((item, index) => <li key={item.title}><span>{index + 1}</span><div><strong>{item.title}</strong><p>{item.text}</p></div></li>)}</ol>;
}

function Callout({children}: {children: React.ReactNode}) {
  return <aside className="knowledge-callout"><ShieldCheck /><div><strong>Keep the boundary clear</strong><p>{children}</p></div></aside>;
}

function ArticleBody({id}: {id: string}) {
  if (id === "first-project") return <>
    <p className="knowledge-lead">A ModelForge project is a bounded repository plus typed metadata. Start with a plain-language outcome; the workbench creates the workspace and passes your original request to Cliff.</p>
    <h2>Start from the workbench</h2>
    <WorkflowSteps items={[
      {title: "Return to New Project", text: "Select the ModelForge identity in the title bar to open the trusted project launcher."},
      {title: "Describe the outcome", text: "Name the data, task, and result you want. Attach small source inputs when they clarify the request."},
      {title: "Review the generated workspace", text: "ModelForge selects the new project and opens Cliff. Confirm the Overview explains the goal and that Source contains a project manifest."},
      {title: "Follow the visible lifecycle", text: "Use Datasets, Model, Training, and Inference in order. Each workspace shows its own prerequisites and evidence."},
    ]} />
    <h2>A useful first prompt</h2>
    <CodeBlock>{`Create an image anomaly-detection project for product photos.\nUse a train/validation split, show explainable inference overlays,\nand keep held-out evaluation separate.`}</CodeBlock>
    <Callout>Project source and domain logic stay in the project repository. ModelForge owns the reusable contracts, validation, workspaces, and execution boundaries.</Callout>
  </>;

  if (id === "data-to-inference") return <>
    <p className="knowledge-lead">The standard lifecycle keeps every result tied to its dataset, model, checkpoint, and execution record.</p>
    <h2>Prepare and inspect data</h2>
    <WorkflowSteps items={[
      {title: "Open Datasets", text: "Choose an imported dataset or collection and inspect its inventory, split summary, media, and annotations."},
      {title: "Set the training target", text: "Select the complete dataset, a folder, or a compatible artifact. Held-out data cannot be selected for training."},
      {title: "Review the model", text: "Open Model to inspect the declared architecture, shape flow, parameters, and available checkpoints."},
      {title: "Start Training", text: "Choose local or configured cloud compute, validate the launch summary, and follow recorded metrics and checkpoints."},
      {title: "Run Inference", text: "Select Run inference from an artifact or sequence, then verify the target identity before launching."},
    ]} />
    <h2>What to verify</h2>
    <div className="knowledge-check-grid"><span><Check />The selected dataset and split are correct</span><span><Check />The checkpoint belongs to the active project</span><span><Check />The result opens in a native viewer</span><span><Check />The job retains logs and artifact links</span></div>
  </>;

  if (id === "annotations") return <>
    <p className="knowledge-lead">ModelForge normalizes visual annotations through a versioned interchange while preserving source-format provenance and unsupported fields.</p>
    <h2>Editing workflow</h2>
    <WorkflowSteps items={[
      {title: "Open a media artifact", text: "Use Dataset folders or sequence shortcuts to find a representative image or video."},
      {title: "Launch the annotation editor", text: "Available tools derive from the media and normalized annotation capabilities."},
      {title: "Edit with stable identity", text: "Create or adjust geometry, labels, tracks, keyframes, attributes, and relations where supported."},
      {title: "Export a sidecar", text: "Choose ModelForge JSONL or a supported external format and review the machine-readable fidelity report."},
    ]} />
    <Callout>Imports are non-destructive. Export creates a new sidecar package; it does not rewrite the original annotation source.</Callout>
  </>;

  if (id === "release") return <>
    <p className="knowledge-lead">Deployment starts from retained evidence. A release is immutable and carries the source, model, compatibility, and application metadata needed for controlled activation.</p>
    <h2>Release checklist</h2>
    <WorkflowSteps items={[
      {title: "Confirm evaluation evidence", text: "Use a checkpoint with the required validation or protected evaluation record for the project."},
      {title: "Open Deployments", text: "Review readiness, application metadata, target bindings, and any explicit blockers."},
      {title: "Build the immutable release", text: "ModelForge validates the project-owned application composition and records its content identity."},
      {title: "Activate deliberately", text: "A configured commercial plane admits publication and binds the final route only after required resources exist."},
    ]} />
    <Callout>The browser never receives provider credentials. Cloud work crosses explicit entitlement, admission, and tenant boundaries.</Callout>
  </>;

  if (id === "projects") return <>
    <p className="knowledge-lead">Projects own the differentiating ML implementation. The framework supplies stable interfaces around that code.</p>
    <h2>Ownership at a glance</h2>
    <div className="knowledge-compare"><div><span>PROJECT OWNS</span><strong>Domain behavior</strong><ul><li>Task and model implementations</li><li>Dataset semantics and adapters</li><li>Metrics and acceptance thresholds</li><li>Application composition</li></ul></div><div><span>MODELFORGE OWNS</span><strong>Platform contracts</strong><ul><li>Validation and orchestration</li><li>Workspace and artifact boundaries</li><li>Execution and provenance</li><li>Release machinery</li></ul></div></div>
    <h2>Core files</h2>
    <p><code>project.json</code> declares project identity, repository location, descriptors, adapters, runtime actions, and deployment composition. Typed descriptors define datasets, architectures, tasks, and registered actions without granting browser authority.</p>
  </>;

  if (id === "provenance") return <>
    <p className="knowledge-lead">A credible result is more than a metric. ModelForge keeps the chain of evidence visible from source and data through the selected checkpoint and output.</p>
    <h2>Evidence chain</h2>
    <div className="knowledge-flow"><span>Project source</span><ChevronRight /><span>Dataset revision</span><ChevronRight /><span>Run</span><ChevronRight /><span>Checkpoint</span><ChevronRight /><span>Result / release</span></div>
    <h2>Durable records</h2>
    <p>Training and inference jobs retain workload identity, compute target, timestamps, lifecycle state, metrics, errors, and authenticated artifact links. Browser state is only a convenience; the server record remains authoritative.</p>
    <Callout>Validation evidence guides iteration. Protected held-out evaluation is a separate authority and cannot be reassigned through the dataset split editor.</Callout>
  </>;

  if (id === "rest-api") return <>
    <p className="knowledge-lead">The compiled workbench talks to an authenticated, loopback-bound HTTP API. These routes project existing ModelForge owners; they do not grant arbitrary filesystem, shell, or provider access.</p>
    <h2>Common endpoints</h2>
    <div className="knowledge-endpoints">
      <Endpoint method="GET" path="/api/project" text="Active project metadata and bounded selection context." />
      <Endpoint method="GET" path="/api/artifacts" text="A bounded, project-scoped artifact inventory." />
      <Endpoint method="POST" path="/api/training/start" text="Validate and start the registered local training action." />
      <Endpoint method="POST" path="/api/inference/start" text="Start registered local inference for the validated target." />
      <Endpoint method="GET" path="/api/jobs?scope=organization" text="Organization-wide durable execution records; project_id remains available for filtered clients." />
    </div>
    <h2>Request shape</h2>
    <CodeBlock>{`const response = await fetch("/api/jobs?scope=organization", {\n  credentials: "same-origin",\n  headers: {Accept: "application/json"},\n});\nconst jobs = await response.json();`}</CodeBlock>
    <Callout>The browser carries the installation's HttpOnly session cookie automatically, and mutations are same-origin checked. Do not expose the loopback API to another network or treat internal workbench routes as an unauthenticated public API.</Callout>
  </>;

  if (id === "cli-api") return <>
    <p className="knowledge-lead">The headless API lets people, scripts, and agents discover workspace capabilities and invoke only registered project actions.</p>
    <h2>Discover before running</h2>
    <CodeBlock>{`modelforge cli workspace show training --json\nmodelforge cli action list --json\nmodelforge cli action prepare training --input '{"epochs": 5}' --json\nmodelforge cli action run training --input '{"epochs": 5}' --json`}</CodeBlock>
    <h2>Contract guarantees</h2>
    <div className="knowledge-check-grid"><span><Check />Versioned JSON envelopes</span><span><Check />Shell-free process launch</span><span><Check />Bounded output capture</span><span><Check />Redacted environment evidence</span></div>
    <p>The server validates the active repository, registered action, arguments, working directory, environment additions, and timeout. The CLI is not a general command runner.</p>
  </>;

  return <>
    <p className="knowledge-lead">ModelForge is a local-first framework and workbench for designing, validating, training, evaluating, releasing, and deploying multimodal machine-learning systems.</p>
    <div className="knowledge-hero-diagram" aria-label="ModelForge lifecycle"><div><Database /><span>Data</span></div><ArrowRight /><div><Layers3 /><span>Model</span></div><ArrowRight /><div><Play /><span>Train</span></div><ArrowRight /><div><Sparkles /><span>Infer</span></div><ArrowRight /><div><Rocket /><span>Deploy</span></div></div>
    <h2>Why it exists</h2>
    <p>ModelForge connects typed ML contracts, visual workspaces, local execution, admitted cloud compute, durable artifacts, and a project-scoped engineering agent. The aim is to move from data and an explicit task to a reproducible application without losing provenance or crossing security boundaries implicitly.</p>
    <h2>Local first, cloud when chosen</h2>
    <p>The primary workbench runs on your machine. Project source, mutable workspaces, ordinary datasets, credentials, and local Cliff execution stay within that trusted installation. Managed cloud services handle narrower concerns such as admitted GPU jobs, immutable storage, application publication, entitlement, and billing.</p>
    <Callout>A project can provide Python implementations and typed metadata, but it cannot inject browser code, replace trusted shell controls, or acquire platform credentials.</Callout>
  </>;
}

function Endpoint({method, path, text}: {method: string; path: string; text: string}) {
  return <div><span>{method}</span><code>{path}</code><p>{text}</p></div>;
}

const sectionIcons: Record<ArticleSection, React.ReactNode> = {
  "Start here": <Sparkles />, "How-to guides": <Play />, "Core concepts": <Layers3 />, "API reference": <Braces />,
};

export function KnowledgeBaseView() {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState("welcome");
  const [feedback, setFeedback] = useState<"yes" | "no" | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => filterKnowledgeArticles(query), [query]);
  const active = knowledgeArticles.find((article) => article.id === activeId) || knowledgeArticles[0];
  const selectArticle = (id: string) => { setActiveId(id); setFeedback(null); };
  const openArticle = (id: string) => { selectArticle(id); setQuery(""); };
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== "/" || target?.matches("input, textarea, select, [contenteditable=true]")) return;
      event.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  return <div className="knowledge-base">
    <header className="knowledge-header">
      <div><span className="eyebrow"><BookOpen /> ModelForge documentation</span><h1>Knowledge Base</h1><p>Learn the platform, follow practical workflows, and explore the interfaces behind the workbench.</p></div>
      <label className="knowledge-search"><Search /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search documentation…" aria-label="Search documentation" /><kbd>/</kbd></label>
    </header>

    {query ? <main className="knowledge-results">
      <div className="knowledge-results-heading"><div><span className="eyebrow">Search results</span><h2>{matches.length} {matches.length === 1 ? "article" : "articles"} for “{query}”</h2></div><button type="button" onClick={() => setQuery("")}>Clear search</button></div>
      {matches.length ? <div className="knowledge-result-list">{matches.map((article) => <button type="button" key={article.id} onClick={() => openArticle(article.id)}><span>{sectionIcons[article.section]}</span><div><small>{article.section} · {article.readTime}</small><strong>{article.title}</strong><p>{article.description}</p></div><ArrowRight /></button>)}</div> : <div className="knowledge-no-results"><Search /><strong>No matching documentation</strong><p>Try a broader term such as training, API, dataset, project, or deployment.</p></div>}
    </main> : <div className="knowledge-layout">
      <aside className="knowledge-nav" aria-label="Documentation navigation">
        <div className="knowledge-nav-title"><BookOpen /><span><strong>Documentation</strong><small>ModelForge Alpha</small></span></div>
        {sectionOrder.map((section) => <section key={section}><h2>{section}</h2>{knowledgeArticles.filter((article) => article.section === section).map((article) => <button type="button" key={article.id} className={active.id === article.id ? "active" : ""} onClick={() => selectArticle(article.id)} aria-current={active.id === article.id ? "page" : undefined}>{article.title}<ChevronRight /></button>)}</section>)}
      </aside>

      <main className="knowledge-article">
        <div className="knowledge-breadcrumb"><BookOpen /><span>Knowledge Base</span><ChevronRight /><span>{active.section}</span></div>
        <article>
          <header id="article-top"><span className="knowledge-article-icon">{active.section === "API reference" ? <Code2 /> : active.section === "How-to guides" ? <Play /> : active.section === "Core concepts" ? <Box /> : <FileText />}</span><div><span className="eyebrow">{active.section} · {active.readTime} read</span><h1>{active.title}</h1><p>{active.description}</p></div></header>
          <div className="knowledge-article-body" id="article-content"><ArticleBody id={active.id} /></div>
          <footer><span>{feedback ? <Check /> : <BookOpen />}{feedback ? "Thanks for the feedback." : "Was this page useful?"}</span><div><button type="button" className={feedback === "yes" ? "active" : ""} aria-pressed={feedback === "yes"} onClick={() => setFeedback("yes")}>Yes</button><button type="button" className={feedback === "no" ? "active" : ""} aria-pressed={feedback === "no"} onClick={() => setFeedback("no")}>Not yet</button></div></footer>
        </article>
      </main>

      <aside className="knowledge-toc"><span>ON THIS PAGE</span><a href="#article-top">Overview</a><a href="#article-content">Details</a><div><TerminalSquare /><p><strong>Need project help?</strong>Ask Cliff about the active project, selected dataset, or current run.</p></div></aside>
    </div>}
  </div>;
}
