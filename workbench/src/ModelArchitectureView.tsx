// Presentation adapted from ArchitectureView.tsx and architecture-graph.ts in the
// identified ModelForge React donor. Public data comes only from the checked
// model descriptor port; no donor backend, runtime import, or source API is used.
import {useCallback, useEffect, useMemo, useState} from "react";
import {Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, useNodesState, type Edge, type Node, type NodeProps} from "@xyflow/react";
import {ArrowRight, Box, Braces, CheckCircle2, ChevronDown, Cpu, ExternalLink, FileCode2, GitFork, ListChecks, MousePointer2, PencilRuler, RefreshCw, ShieldCheck, Target} from "lucide-react";
import "@xyflow/react/dist/style.css";
import "./ModelArchitectureView.css";
import {Button, Paper, Tooltip} from "@mui/material";
import {request} from "./lib/api";
import type {Project} from "./types";

type Category = "input" | "encoder" | "transformer" | "memory" | "logic" | "external" | "component" | "output";
type Fields = Record<string, string | number | boolean | null>;
type Group = {label: string; items: {label: string; value?: string}[]};
export type ModelDescriptor = {
  name: string; model_id: string; descriptor_sha256: string; checkpoint: {sha256?: string; revision?: string}; description?: string;
  nodes: {id: string; label: string; kind: string; parameter_count?: number; type?: string; category?: Category; detail?: string; summary?: string; config?: Fields; groups?: Group[]}[];
  edges: {source: string; target: string}[];
  sources?: {id: string; name: string; revision?: string; node_ids: string[]}[];
  brief?: {description?: string; rationale?: string[]; key_aspects?: string[]; goals?: string[]; modifications?: string[]};
};
type ArchitectureNodeData = Record<string, unknown> & {label: string; kind: string; type: string; category: Category; categoryLabel: string; detail?: string; summary?: string; config: Fields; detailGroups: Group[]};
type GraphNode = Node<ArchitectureNodeData, "architecture">;
type BoundaryNode = Node<{label: string; detail: string; badge: string}, "boundary">;
const CATEGORY_LABELS: Record<Category, string> = {input: "Input contract", encoder: "Feature / encoder", transformer: "Attention / transformer", memory: "Learned memory", logic: "Matching / logic", external: "Project module", component: "Model component", output: "Output contract"};
const COLORS: Record<Category, string> = {input: "#38bdf8", encoder: "#62c8f4", transformer: "#4f9fc7", memory: "#f4b95f", logic: "#8fd36b", external: "#f0c55f", component: "#a7b2c0", output: "#f08ab8"};
const humanize = (value: string) => value.replace(/[_-]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
const display = (value: unknown) => value === undefined || value === null ? "—" : String(value);
export function architectureCategory(item: ModelDescriptor["nodes"][number]): Category {
  if (item.category && item.category in CATEGORY_LABELS) return item.category;
  if (item.kind === "input" || item.kind === "output") return item.kind;
  const identity = `${item.type || item.kind} ${item.id}`.toLowerCase();
  if (/(external|project_python)/.test(identity)) return "external";
  if (/(transformer|attention|decoder)/.test(identity)) return "transformer";
  if (/(memory|quer(?:y|ies)|prototype|embedding)/.test(identity)) return "memory";
  if (/(compatib|match|associat|fusion|track|algorithm|decision|rule)/.test(identity)) return "logic";
  if (/(encoder|feature|backbone|resnet|rawnet|image|video|frame|token|conv|vision)/.test(identity)) return "encoder";
  return "component";
}
export function miniMapNodeColor(node: Node): string {return node.type === "boundary" ? "transparent" : COLORS[node.data.category as Category] || COLORS.component;}
export function miniMapNodeStroke(node: Node): string {return node.type === "boundary" ? "transparent" : "#e4edf5";}

// Preserve the original left-to-right dependency layout. Edges are exclusively
// the declared edges, including branches and cycles; no connections are invented.
export function graphFromDescriptor(model: ModelDescriptor) {
  const depths = new Map<string, number>();
  const byId = new Map(model.nodes.map(node => [node.id, node]));
  function depthFor(id: string, visiting = new Set<string>()): number {
    if (depths.has(id)) return depths.get(id)!;
    if (visiting.has(id)) return 0;
    const next = new Set(visiting).add(id);
    const sources = model.edges.filter(edge => edge.target === id && byId.has(edge.source));
    const depth = sources.length ? 1 + Math.max(...sources.map(edge => depthFor(edge.source, next))) : 0;
    depths.set(id, depth); return depth;
  }
  model.nodes.forEach(node => depthFor(node.id));
  const levels = new Map<number, string[]>();
  model.nodes.forEach(node => {const depth = depths.get(node.id)!; levels.set(depth, [...(levels.get(depth) || []), node.id]);});
  const nodes: GraphNode[] = model.nodes.map(item => {
    const depth = depths.get(item.id)!, level = levels.get(depth)!;
    const category = architectureCategory(item);
    return {id: item.id, type: "architecture", position: {x: 70 + depth * 340, y: 190 + (level.indexOf(item.id) - (level.length - 1) / 2) * 190}, origin: [0, .5], initialWidth: 260, initialHeight: 116, zIndex: 2, deletable: false, ariaLabel: item.label,
      data: {label: item.label, kind: item.kind, type: item.type || item.kind, category, categoryLabel: CATEGORY_LABELS[category], detail: item.detail, summary: item.summary, config: {...item.config, ...(item.parameter_count === undefined ? {} : {parameter_count: item.parameter_count})}, detailGroups: item.groups || []}};
  });
  const boundaries: BoundaryNode[] = (model.sources || []).flatMap((source, index) => {
    const enclosed = nodes.filter(node => source.node_ids.includes(node.id));
    if (!enclosed.length) return [];
    const left = Math.min(...enclosed.map(node => node.position.x)) - 28 - index * 7;
    const top = Math.min(...enclosed.map(node => node.position.y)) - 58 - 76 - index * 7;
    const width = Math.max(...enclosed.map(node => node.position.x)) + 260 + 28 + index * 7 - left;
    const height = Math.max(...enclosed.map(node => node.position.y)) + 58 + 28 + index * 7 - top;
    return [{id: `source-boundary:${source.id}`, type: "boundary" as const, position: {x: left, y: top}, initialWidth: width, initialHeight: height, style: {width, height}, selectable: false, draggable: false, focusable: false, zIndex: 0, data: {label: source.name, detail: source.revision ? `Revision ${source.revision.slice(0, 12)}` : "Declared source", badge: source.revision ? "Pinned source" : "Declared source"}}];
  });
  const edges: Edge[] = model.edges.map((edge, index) => ({...edge, id: `connection-${index}`, type: "smoothstep", markerEnd: {type: MarkerType.ArrowClosed}, animated: false}));
  return {nodes: [...boundaries, ...nodes], edges, objectCount: nodes.length, boundaryCount: boundaries.length, categories: (Object.keys(CATEGORY_LABELS) as Category[]).filter(category => nodes.some(node => node.data.category === category))};
}

function ArchitectureNode({data, selected}: NodeProps<GraphNode>) {
  const icon = data.category === "input" ? <Braces size={15}/> : data.category === "output" ? <ExternalLink size={15}/> : <Cpu size={15}/>;
  const fields = Object.entries(data.config);
  return <div className={`architecture-node architecture-node-${data.kind} architecture-node-category-${data.category} ${selected ? "selected" : ""}`} title={data.label}>
    <Handle type="target" position={Position.Left}/>
    <div className="architecture-node-title"><span>{icon}</span><div><strong>{data.label}</strong><small>{humanize(data.type)}</small></div><em>{data.categoryLabel}</em></div>
    {data.detail && <p>{data.detail}</p>}{data.summary && <div className="architecture-node-summary">{data.summary}</div>}
    {data.detailGroups.length > 0 && <div className="architecture-node-groups nodrag nopan nowheel">{data.detailGroups.map((group, index) => <details key={`${group.label}-${index}`} onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}><summary><span>{group.label}</span><em>{group.items.length}</em><ChevronDown size={11}/></summary><div>{group.items.map((item, itemIndex) => <span key={itemIndex}><b>{item.label}</b>{item.value && <code>{item.value}</code>}</span>)}</div></details>)}</div>}
    {fields.length > 0 && <details className="architecture-node-metadata nodrag nopan nowheel" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}><summary><span>Full contract · {fields.length} fields</span><ChevronDown size={11}/></summary><div>{fields.map(([key, value]) => <span key={key}><b>{humanize(key)}</b><code>{display(value)}</code></span>)}</div></details>}
    <Handle type="source" position={Position.Right}/>
  </div>;
}
function ArchitectureBoundary({data}: NodeProps<BoundaryNode>) {return <div className="architecture-boundary"><span>Encapsulated upstream model</span><strong>{data.label}</strong><small>{data.detail}</small><em>{data.badge}</em></div>;}
const nodeTypes = {architecture: ArchitectureNode, boundary: ArchitectureBoundary};
function ArchitectureFlow({graph, onSelect}: {graph: ReturnType<typeof graphFromDescriptor>; onSelect: (node: GraphNode) => void}) {
  const [nodes, setNodes, onNodesChange] = useNodesState(graph.nodes);
  useEffect(() => {setNodes(graph.nodes);}, [graph.nodes, setNodes]);
  const selectionChanged = useCallback(({nodes: selectedNodes}: {nodes: (GraphNode | BoundaryNode)[]}) => {const selected = selectedNodes.find(node => node.type === "architecture"); if (selected) onSelect(selected as GraphNode);}, [onSelect]);
  return <ReactFlow deleteKeyCode={null} onSelectionChange={selectionChanged} nodes={nodes} edges={graph.edges} nodeTypes={nodeTypes} onNodesChange={onNodesChange} fitView fitViewOptions={{padding: .18}} minZoom={.2} maxZoom={1.8} nodesDraggable={false} nodesConnectable={false} elementsSelectable onNodeClick={(_event, node) => {if (node.type === "architecture") onSelect(node as GraphNode);}} proOptions={{hideAttribution: true}}>
    <Background gap={22} size={1} color="#272b32"/><Controls showInteractive={false}/><MiniMap pannable zoomable ariaLabel="Architecture overview and visible viewport" bgColor="#111820" nodeColor={miniMapNodeColor} nodeStrokeColor={miniMapNodeStroke} nodeStrokeWidth={1.5} maskColor="rgba(2,5,8,.32)" maskStrokeColor="#a8bacb" maskStrokeWidth={1.5}/>
  </ReactFlow>;
}
function BriefList({items, empty}: {items?: string[]; empty: string}) {return items?.length ? <ul>{items.map((item, index) => <li key={index}>{item}</li>)}</ul> : <p className="architecture-brief-missing">{empty}</p>;}
function ModelBrief({model}: {model: ModelDescriptor}) {
  const brief = model.brief;
  return <section className="architecture-brief" aria-labelledby="architecture-brief-title"><div className="architecture-brief-intro"><div><span>Model brief</span><h3 id="architecture-brief-title">Architecture summary</h3><p>{brief?.description || model.description || "Owner-authored structure bound to the registered checkpoint."}</p></div><div className="architecture-brief-sources"><span><GitFork size={13}/> Source model</span>{model.sources?.length ? model.sources.map(source => <div key={source.id}><strong>{source.name}</strong>{source.revision && <small>{source.revision}</small>}</div>) : <p className="architecture-brief-missing">No source model is declared in this descriptor.</p>}</div></div><div className="architecture-brief-details"><article><h4><Target size={13}/> Why this model</h4><BriefList items={brief?.rationale} empty="No model-selection rationale is declared."/></article><article><h4><ArrowRight size={13}/> Inputs &amp; outputs</h4><div className="architecture-brief-io">{(["input", "output"] as const).map(kind => <div className="architecture-brief-contracts" key={kind}><strong>{kind === "input" ? "Inputs" : "Outputs"}</strong>{model.nodes.filter(node => architectureCategory(node) === kind).length ? model.nodes.filter(node => architectureCategory(node) === kind).map(node => <span key={node.id}><b>{node.label}</b><small>{node.type || node.kind}{node.detail ? ` · ${node.detail}` : ""}</small></span>) : <em>None declared</em>}</div>)}</div></article><article><h4><ListChecks size={13}/> Key aspects</h4><BriefList items={brief?.key_aspects} empty="No key architecture aspects are declared."/></article><article><h4><PencilRuler size={13}/> Project goal &amp; changes</h4><div className="architecture-brief-project"><strong>Goal</strong>{brief?.goals?.length ? <div className="architecture-brief-goals">{brief.goals.map((goal, index) => <span key={index}>{goal}</span>)}</div> : <p className="architecture-brief-missing">No project goal is declared.</p>}<strong>Changes from source</strong><BriefList items={brief?.modifications} empty="No project-specific modifications are declared."/></div></article></div></section>;
}

export function ModelView({project}: {project: Project}) {
  const [model, setModel] = useState<ModelDescriptor | null>(null);
  const [error, setError] = useState(""); const [selected, setSelected] = useState<GraphNode | null>(null); const [revision, setRevision] = useState(0);
  useEffect(() => {
    const abort = new AbortController(); setModel(null); setSelected(null); setError("");
    request<ModelDescriptor>(`/api/v1/projects/${encodeURIComponent(project.id)}/model`, {signal: abort.signal}).then(value => {if (!abort.signal.aborted) setModel(value);}).catch(reason => {if (!abort.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason));});
    return () => abort.abort();
  }, [project.id, revision]);
  const graph = useMemo(() => model ? graphFromDescriptor(model) : null, [model]);
  if (!model || !graph) return <section className="model-architecture-view architecture-loading"><h1>Models / Architecture</h1><p role={error ? "alert" : "status"}>{error || "Validating and projecting the model graph…"}</p>{error && <Button variant="outlined" onClick={() => setRevision(value => value + 1)}>Retry</Button>}</section>;
  return <div className="model-architecture-view architecture-workspace">
    <div className="architecture-header"><div className="architecture-section-header"><div><span className="architecture-eyebrow">Model architecture</span><h1>{model.name}</h1><p>{model.description || "Validated project model graph"}</p></div><div className="architecture-actions"><span className="architecture-badge architecture-valid">Structurally valid</span><Tooltip title="Re-read and validate the checkpoint-bound descriptor"><Button variant="outlined" size="small" startIcon={<RefreshCw size={14}/>} onClick={() => setRevision(value => value + 1)}>Revalidate</Button></Tooltip></div></div><div className="architecture-facts"><span><strong>{graph.objectCount}</strong> graph objects</span><span><strong>{graph.edges.length}</strong> connections</span>{graph.boundaryCount > 0 && <span><strong>{graph.boundaryCount}</strong> source {graph.boundaryCount === 1 ? "boundary" : "boundaries"}</span>}<span><strong>Bound</strong> checkpoint</span><span><strong>Inspect only</strong> lifecycle</span></div><div className="architecture-type-legend" aria-label="Architecture box types">{graph.categories.map(category => <span key={category} className={`architecture-legend-${category}`}><i/>{CATEGORY_LABELS[category]}</span>)}{graph.boundaryCount > 0 && <span className="architecture-legend-boundary"><i/>Pinned source boundary</span>}</div></div>
    <div className="architecture-main"><div className="architecture-canvas" aria-label={`${model.name} architecture graph`}><ArchitectureFlow graph={graph} onSelect={setSelected}/></div><Paper component="aside" elevation={0} square className="architecture-inspector"><div className="pane-heading"><span>Inspector</span>{selected && <span className="architecture-badge">{selected.data.kind}</span>}</div>{selected ? <div className="node-inspector-content"><span className={`node-inspector-icon architecture-node-category-${selected.data.category}`}><Box size={20}/></span><h3>{selected.data.label}</h3><p>{selected.data.categoryLabel} · {humanize(selected.data.type)}</p>{selected.data.detail && <div className="inspector-fact"><span>Shape</span><strong>{selected.data.detail}</strong></div>}<details className="inspector-metadata" open><summary>Configuration <span>{Object.keys(selected.data.config).length}</span></summary>{Object.keys(selected.data.config).length ? <dl>{Object.entries(selected.data.config).map(([key, value]) => <div key={key}><dt>{humanize(key)}</dt><dd>{display(value)}</dd></div>)}</dl> : <p>No configuration fields declared.</p>}</details><section className="architecture-source-inspector"><div><FileCode2 size={14}/><strong>Declared source</strong></div><span className="architecture-source-state">Source inspection is unavailable: this service exposes structural descriptors only.</span></section></div> : <div className="architecture-empty"><MousePointer2 size={22}/><h3>Inspect a node</h3><p>Select an input, component or output to examine its declared contract.</p></div>}<div className="binding-summary"><div><ShieldCheck size={15}/><strong>Checkpoint binding</strong></div><span>{model.model_id}</span><code title={model.checkpoint.sha256 || model.checkpoint.revision}>{model.checkpoint.sha256 || model.checkpoint.revision}</code><details><summary>Descriptor identity</summary><code>{model.descriptor_sha256}</code></details></div><div className="validation-list success"><CheckCircle2 size={15}/><span>No blocking graph errors reported.</span></div></Paper></div><ModelBrief model={model}/>
  </div>;
}
