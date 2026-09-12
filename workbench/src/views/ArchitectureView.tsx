import {lazy, Suspense, useEffect, useMemo, useState} from "react";
import {
  Background, Controls, Handle, MiniMap, Position, ReactFlow, useNodesState,
  type Node, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {ArrowRight, Box, Braces, CheckCircle2, ChevronDown, Code2, Cpu, ExternalLink, FileCode2, GitFork, Layers3, ListChecks, PencilRuler, RefreshCw, ShieldCheck, Target, TriangleAlert} from "lucide-react";
import {api} from "../lib/api";
import {formatBytes, humanize, languageForPath, statusTone} from "../lib/utils";
import type {JsonMap, Project, SourceFile} from "../types";
import {useRequest} from "../hooks/use-request";
import {Badge, Button, EmptyState, ErrorNotice, LoadingState, Modal, SectionHeader} from "../components/ui";
import {
  ARCHITECTURE_CATEGORY_LABELS, graphFromArchitecture,
  type ArchitectureBoundaryData, type ArchitectureGraph, type ArchitectureGraphNode, type ArchitectureNodeData, type ArchitectureSourceCandidate,
} from "../lib/architecture-graph";
import {architectureBrief, type ArchitectureBrief as ArchitectureBriefData, type ArchitectureBriefContract} from "../lib/architecture-brief";

const MonacoEditor = lazy(() => import("../components/MonacoSourceEditor"));

const MINIMAP_NODE_COLORS: Record<string, string> = {
  input: "#38bdf8",
  encoder: "#62c8f4",
  transformer: "#4f9fc7",
  memory: "#f4b95f",
  logic: "#8fd36b",
  external: "#f0c55f",
  component: "#a7b2c0",
  output: "#f08ab8",
};

export function miniMapNodeColor(node: Node): string {
  // Source capsules are decorative containers. Filling their full bounds makes
  // the actual architecture nodes disappear in the miniature projection.
  if (node.type === "boundary") return "transparent";
  return MINIMAP_NODE_COLORS[String(node.data?.category)] || "#a7b2c0";
}

export function miniMapNodeStroke(node: Node): string {
  return node.type === "boundary" ? "transparent" : "#e4edf5";
}

function metadataValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function ArchitectureNode({data, selected}: NodeProps<Node<ArchitectureNodeData>>) {
  const icon = data.kind === "input" ? <Braces size={15} /> : data.kind === "output" ? <ExternalLink size={15} /> : <Cpu size={15} />;
  const metafields = Object.entries(data.config || {});
  return <div className={`architecture-node architecture-node-${data.kind} architecture-node-category-${data.category} ${selected ? "selected" : ""}`} aria-label={`${data.categoryLabel}: ${data.label}`} title={data.label}>
    <Handle type="target" position={Position.Left} />
    <div className="architecture-node-title"><span>{icon}</span><div><strong>{data.label}</strong><small>{humanize(data.type)}</small></div><em>{data.categoryLabel}</em></div>
    {data.detail && <p>{data.detail}</p>}
    {data.summary && <div className="architecture-node-summary">{data.summary}</div>}
    {data.detailGroups.length > 0 && <div className="architecture-node-groups nodrag nopan nowheel">
      {data.detailGroups.map((group, index) => <details key={`${group.label}-${index}`} open={group.expanded} onClick={(event) => event.stopPropagation()}>
        <summary><span>{group.label}</span><em>{group.items.length}</em><ChevronDown size={11} /></summary>
        <div>{group.items.map((item, itemIndex) => <span key={`${item.label}-${itemIndex}`}><b>{item.label}</b>{item.value && <code>{item.value}</code>}</span>)}</div>
      </details>)}
    </div>}
    {metafields.length > 0 && <details className="architecture-node-metadata nodrag nopan nowheel" onClick={(event) => event.stopPropagation()}>
      <summary><span>Full contract · {metafields.length} fields</span><ChevronDown size={11} /></summary>
      <div>{metafields.map(([key, value]) => <span key={key}><b>{humanize(key)}</b><code>{metadataValue(value)}</code></span>)}</div>
    </details>}
    <Handle type="source" position={Position.Right} />
  </div>;
}

function ArchitectureBoundary({data}: NodeProps<Node<ArchitectureBoundaryData>>) {
  return <div className="architecture-boundary">
    <span>Encapsulated upstream model</span>
    <strong>{data.label}</strong>
    <small>{data.detail}</small>
    <em>{data.badge}</em>
  </div>;
}

const architectureNodeTypes = {architecture: ArchitectureNode, boundary: ArchitectureBoundary};

export function ArchitectureMiniMap() {
  return <MiniMap
    pannable
    zoomable
    ariaLabel="Architecture overview and visible viewport"
    bgColor="#111820"
    nodeColor={miniMapNodeColor}
    nodeStrokeColor={miniMapNodeStroke}
    nodeStrokeWidth={1.5}
    maskColor="rgba(2,5,8,.32)"
    maskStrokeColor="#a8bacb"
    maskStrokeWidth={1.5}
  />;
}

function ArchitectureFlow({graph, onNodeSelect}: {graph: ArchitectureGraph; onNodeSelect: (node: ArchitectureGraphNode) => void}) {
  const [nodes, setNodes, onNodesChange] = useNodesState(graph.nodes);
  useEffect(() => {
    setNodes(graph.nodes);
  }, [graph.nodes, setNodes]);

  return <ReactFlow nodes={nodes} edges={graph.edges} nodeTypes={architectureNodeTypes} onNodesChange={onNodesChange} fitView fitViewOptions={{padding: .18}} minZoom={.2} maxZoom={1.8} nodesDraggable={false} nodesConnectable={false} elementsSelectable onNodeClick={(_event, node) => { if (node.type === "architecture") onNodeSelect(node as ArchitectureGraphNode); }} proOptions={{hideAttribution: true}}>
    <Background gap={22} size={1} color="#272b32" />
    <Controls showInteractive={false} />
    <ArchitectureMiniMap />
  </ReactFlow>;
}

function ContractList({label, items}: {label: string; items: ArchitectureBriefContract[]}) {
  return <div className="architecture-brief-contracts"><strong>{label}</strong>{items.length ? items.map((item) => <span key={item.id} title={`${item.label} · ${item.type}${item.shape ? ` · ${item.shape}` : ""}`}><b>{item.label}</b><small>{item.type}{item.shape ? ` · ${item.shape}` : ""}</small></span>) : <em>None declared</em>}</div>;
}

function BriefList({items, empty}: {items: string[]; empty: string}) {
  return items.length ? <ul>{items.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}</ul> : <p className="architecture-brief-missing">{empty}</p>;
}

function ArchitectureBriefPanel({brief}: {brief: ArchitectureBriefData}) {
  return <section className="architecture-brief" aria-labelledby="architecture-brief-title">
    <div className="architecture-brief-intro">
      <div><span>Model brief</span><h3 id="architecture-brief-title">Architecture summary</h3><p>{brief.description}</p></div>
      <div className="architecture-brief-sources"><span><GitFork size={13} /> Source model</span>{brief.sources.length ? brief.sources.map((source) => <div key={source.id}><strong>{source.name}</strong><small>{source.provider}{source.revision ? ` · ${source.revision}` : ""} · {source.role}</small>{source.url && <a href={source.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer">Open source <ExternalLink size={11} /></a>}</div>) : <p className="architecture-brief-missing">No upstream source model is declared; this architecture is presented as project-owned.</p>}</div>
    </div>
    <div className="architecture-brief-details">
      <article><h4><Target size={13} /> Why this model</h4><BriefList items={brief.rationale} empty="No model-selection rationale is declared." /></article>
      <article><h4><ArrowRight size={13} /> Inputs &amp; outputs</h4><div className="architecture-brief-io"><ContractList label="Inputs" items={brief.inputs} /><ContractList label="Outputs" items={brief.outputs} /></div></article>
      <article><h4><ListChecks size={13} /> Key aspects</h4><BriefList items={brief.keyAspects} empty="No key architecture aspects are declared." /></article>
      <article><h4><PencilRuler size={13} /> Project goal &amp; changes</h4><div className="architecture-brief-project"><strong>Goal</strong>{brief.goals.length > 0 ? <div className="architecture-brief-goals">{brief.goals.map((goal, index) => <span key={`${goal}-${index}`}>{goal}</span>)}</div> : <p className="architecture-brief-missing">No project goal is declared.</p>}<strong>Changes from source</strong><BriefList items={brief.modifications} empty="No project-specific modifications are declared." /></div></article>
    </div>
  </section>;
}

function sourceMatch(file: SourceFile, candidate: ArchitectureSourceCandidate): {line: number; matched: boolean} {
  const lines = file.content.split("\n");
  for (const symbol of candidate.symbols) {
    if (!symbol || symbol.includes(".")) continue;
    const index = lines.findIndex((line) => line.includes(symbol));
    if (index >= 0) return {line: index + 1, matched: true};
    const identity = symbol.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (identity.length < 4) continue;
    const normalizedIndex = lines.findIndex((line) => line.toLowerCase().replace(/[^a-z0-9]+/g, "").includes(identity));
    if (normalizedIndex >= 0) return {line: normalizedIndex + 1, matched: true};
  }
  return {line: 1, matched: false};
}

export default function ArchitectureView({project}: {project: Project}) {
  const {data, error, loading, reload} = useRequest(async () => {
    const standard = await api.architecture();
    if (standard.available !== false) return standard;
    const runtime = await api.runtimeArchitecture();
    return runtime.available === false ? standard : runtime;
  }, [project.id]);
  const [selected, setSelected] = useState<Node<ArchitectureNodeData> | null>(null);
  const [source, setSource] = useState<SourceFile | null>(null);
  const [sourceCandidate, setSourceCandidate] = useState<ArchitectureSourceCandidate | null>(null);
  const [sourceLine, setSourceLine] = useState(1);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState("");
  const [sourceOpen, setSourceOpen] = useState(false);
  const architecture = (data?.architecture && typeof data.architecture === "object" ? data.architecture : data?.graph && typeof data.graph === "object" ? data.graph : {}) as JsonMap;
  const graph = useMemo(() => graphFromArchitecture(architecture, data || {}), [architecture, data]);
  const validation = (data?.validation && typeof data.validation === "object" ? data.validation : {}) as JsonMap;
  const model = (architecture.model && typeof architecture.model === "object" ? architecture.model : {}) as JsonMap;
  const checkpointBinding = (data?.checkpoint_binding && typeof data.checkpoint_binding === "object" ? data.checkpoint_binding : {}) as JsonMap;
  const checkpointPath = String(model.checkpoint || checkpointBinding.declared_path || checkpointBinding.path || "").trim();
  const checkpointState = !checkpointPath
    ? "Unbound"
    : checkpointBinding.valid === false
      ? "Invalid"
      : checkpointBinding.registered === true
        ? "Bound"
        : "Declared";
  const intent = (architecture.intent && typeof architecture.intent === "object" ? architecture.intent : {}) as JsonMap;
  const brief = useMemo(() => architectureBrief(architecture, data || {}), [architecture, data]);
  useEffect(() => {
    setSelected(null);
  }, [project.id]);
  useEffect(() => {
    let active = true;
    setSource(null); setSourceCandidate(null); setSourceLine(1); setSourceError(""); setSourceOpen(false);
    if (!selected) { setSourceLoading(false); return () => { active = false; }; }
    const candidates = selected.data.sourceCandidates || [];
    if (!candidates.length) {
      setSourceLoading(false);
      setSourceError("This graph object does not declare a project source binding.");
      return () => { active = false; };
    }
    setSourceLoading(true);
    void (async () => {
      let fallback: {file: SourceFile; candidate: ArchitectureSourceCandidate; line: number} | null = null;
      for (const candidate of candidates) {
        try {
          const file = await api.sourceFile(candidate.path);
          if (!active) return;
          const match = sourceMatch(file, candidate);
          fallback ||= {file, candidate, line: match.line};
          if (match.matched) {
            setSource(file); setSourceCandidate(candidate); setSourceLine(match.line); setSourceLoading(false);
            return;
          }
        } catch { /* Candidate module paths are tried from most to least specific. */ }
      }
      if (active && fallback) {
        setSource(fallback.file); setSourceCandidate(fallback.candidate); setSourceLine(fallback.line); setSourceLoading(false);
        return;
      }
      if (active) {
        setSourceLoading(false);
        setSourceError("The declared implementation was not found inside the active project's bounded source viewer.");
      }
    })();
    return () => { active = false; };
  }, [project.id, selected]);

  if (loading && !data) return <LoadingState label="Validating and projecting the model graph…" />;
  if (error && !data) return <ErrorNotice message={error} action={<Button onClick={() => void reload()}>Retry</Button>} />;
  if (!Object.keys(architecture).length) return <EmptyState icon={<Layers3 />} title="No architecture descriptor" description={String(data?.training_unavailable_reason || "Register a project architecture to inspect its graph and checkpoint binding.")} />;

  return <><div className="architecture-workspace">
    <div className="architecture-header">
      <SectionHeader eyebrow="Model architecture" title={String(model.name || architecture.name || project.name || "Registered model")} description={String(model.description || intent.description || "Validated project model graph")} actions={<><Badge tone={statusTone(validation.valid === false ? "failed" : "ready")}>{validation.valid === false ? "Invalid" : "Structurally valid"}</Badge><Button onClick={() => void reload()}><RefreshCw size={14} /> Revalidate</Button></>} />
      <div className="architecture-facts"><span><strong>{graph.objectCount}</strong> graph objects</span><span><strong>{graph.edges.length}</strong> typed connections</span>{graph.boundaryCount > 0 && <span><strong>{graph.boundaryCount}</strong> source {graph.boundaryCount === 1 ? "boundary" : "boundaries"}</span>}<span><strong>{checkpointState}</strong> checkpoint</span><span><strong>{String(data?.training_ready === false ? "Inspect only" : "Runnable")}</strong> lifecycle</span></div>
      <div className="architecture-type-legend" aria-label="Architecture box types">{graph.categories.map((category) => <span key={category} className={`architecture-legend-${category}`}><i />{ARCHITECTURE_CATEGORY_LABELS[category]}</span>)}{graph.boundaryCount > 0 && <span className="architecture-legend-boundary"><i />Pinned source boundary</span>}</div>
    </div>
    <div className="architecture-main">
      <div className="architecture-canvas">
        <ArchitectureFlow graph={graph} onNodeSelect={setSelected} />
      </div>
      <aside className="architecture-inspector">
        <div className="pane-heading"><span>Inspector</span>{selected && <Badge>{selected.data.kind}</Badge>}</div>
        {selected ? <div className="node-inspector-content"><span className={`node-inspector-icon architecture-node-category-${selected.data.category}`}><Box size={20} /></span><h3>{selected.data.label}</h3><p>{selected.data.categoryLabel} · {humanize(selected.data.type)}</p>{selected.data.detail && <div className="inspector-fact"><span>Shape</span><strong>{selected.data.detail}</strong></div>}
          <details className="inspector-metadata" open><summary>Configuration <span>{Object.keys(selected.data.config || {}).length}</span></summary><dl>{Object.entries(selected.data.config || {}).map(([key, value]) => <div key={key}><dt>{humanize(key)}</dt><dd>{metadataValue(value)}</dd></div>)}</dl></details>
          {Object.keys(selected.data.metadata || {}).length > 0 && <details className="inspector-metadata"><summary>Descriptor metadata <span>{Object.keys(selected.data.metadata || {}).length}</span></summary><dl>{Object.entries(selected.data.metadata || {}).map(([key, value]) => <div key={key}><dt>{humanize(key)}</dt><dd>{metadataValue(value)}</dd></div>)}</dl></details>}
          <section className="architecture-source-inspector"><div><FileCode2 size={14} /><strong>Declared source</strong></div>{sourceLoading ? <span className="architecture-source-state">Resolving declared source binding…</span> : source ? <><button onClick={() => setSourceOpen(true)} title={source.path}><code>{source.path}</code><small>{sourceCandidate?.label} · line {sourceLine}</small><ExternalLink size={12} /></button><pre>{source.content.split("\n").slice(Math.max(0, sourceLine - 3), sourceLine + 6).join("\n")}</pre><Button size="sm" onClick={() => setSourceOpen(true)}><Code2 size={13} /> Inspect source code</Button></> : <span className="architecture-source-state">{sourceError}</span>}</section>
        </div> : <EmptyState icon={<MouseCursorIcon />} title="Inspect a node" description="Select an input, component or output to examine its declared contract and implementation source." />}
        <div className="binding-summary"><div><ShieldCheck size={15} /><strong>Checkpoint binding</strong></div><span>{checkpointPath || "No checkpoint declared"}</span>{Boolean(model.checkpoint_sha256) && <code>{String(model.checkpoint_sha256).slice(0, 24)}…</code>}</div>
        {(Array.isArray(validation.errors) && validation.errors.length > 0) ? <div className="validation-list danger"><TriangleAlert size={15} />{validation.errors.map((item, index) => <span key={index}>{String(item)}</span>)}</div> : <div className="validation-list success"><CheckCircle2 size={15} /><span>No blocking graph errors reported.</span></div>}
      </aside>
    </div>
    <ArchitectureBriefPanel brief={brief} />
  </div><Modal open={sourceOpen} onOpenChange={setSourceOpen} title={source?.name || selected?.data.label || "Component source"} description={source ? `${source.path} · ${formatBytes(source.size)} · ${sourceCandidate?.label || "Declared source"}` : undefined} wide>
    <div className="architecture-source-modal">{source && <><div className="editor-breadcrumbs"><FileCode2 size={13} />{source.path.split("/").map((part, index) => <span key={`${part}-${index}`}>{part}</span>)}<Badge>{languageForPath(source.path)}</Badge><small>Binding near line {sourceLine}</small></div><Suspense fallback={<LoadingState label="Loading source viewer…" />}><MonacoEditor path={`${project.id}/${source.path}`} value={source.content} language={languageForPath(source.path)} theme="vs-dark" onMount={(editor) => { editor.revealLineInCenter(sourceLine); editor.setPosition({lineNumber: sourceLine, column: 1}); }} options={{readOnly: true, minimap: {enabled: true}, fontSize: 13, lineHeight: 21, fontLigatures: true, renderWhitespace: "selection", padding: {top: 14}, scrollBeyondLastLine: false, automaticLayout: true}} /></Suspense></>}</div>
  </Modal></>;
}

function MouseCursorIcon() { return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m5 3 14 9-6 2-3 6Z"/></svg>; }
