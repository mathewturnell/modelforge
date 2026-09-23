import {useEffect, useRef, useState} from "react";
import {request} from "./lib/api";
import type {Project, Run, Sample} from "./types";

type Box = {id: string; frame: number; label: string; track_id: string; x: number; y: number; width: number; height: number};
type Annotations = {revision: number; editable: boolean; sample_sha256: string; annotations: Box[]};
const enc = encodeURIComponent;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function AnnotationView({project, sample, preview}: {project: Project; sample: Sample | null; preview: string}) {
  const [document, setDocument] = useState<Annotations | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [frame, setFrame] = useState(1);
  const [fps, setFps] = useState(5);
  const [selected, setSelected] = useState("");
  const [status, setStatus] = useState("");
  const [dirty, setDirty] = useState(false);
  const [drawing, setDrawing] = useState(false);
  const start = useRef<{x: number; y: number} | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const endpoint = project.dataset && sample ? `/api/v1/projects/${enc(project.id)}/datasets/${enc(project.dataset.id)}/samples/${enc(sample.id)}/annotations` : "";
  useEffect(() => {
    setDocument(null); setBoxes([]); setSelected(""); setDirty(false); setStatus(""); setFrame(sample?.content_type?.startsWith("image/") ? 0 : 1);
    if (!endpoint) return;
    const abort = new AbortController();
    request<Annotations>(endpoint, {signal: abort.signal}).then(value => {setDocument(value); setBoxes(value.annotations);}).catch(error => {if (!abort.signal.aborted) setStatus(message(error));});
    return () => abort.abort();
  }, [endpoint]);
  const active = boxes.find(box => box.id === selected);
  function update(patch: Partial<Box>) {setBoxes(values => values.map(box => box.id === selected ? {...box, ...patch} : box)); setDirty(true);}
  function point(event: React.PointerEvent<SVGSVGElement>) {const bounds = event.currentTarget.getBoundingClientRect(); return {x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)), y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height))};}
  async function save() {
    if (!document) return;
    setStatus("Saving…");
    try {const value = await request<Annotations>(endpoint, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({expected_revision: document.revision, annotations: boxes})}); setDocument(value);setBoxes(value.annotations);setDirty(false);setStatus(`Saved revision ${value.revision}`);}
    catch (error) {setStatus(message(error));}
  }
  if (!sample || !preview) return <section><h1>Annotation</h1><p>Select an image or video in Dataset first.</p></section>;
  return <section className="annotation-view"><span className="eyebrow">Source-linked labels</span><h1>{sample.name}</h1><div className="annotation-toolbar"><label>Frame<input aria-label="Annotation frame" type="number" min={0} value={frame} onChange={event => {const next = Math.max(0, Number(event.target.value));setFrame(next);if(video.current)video.current.currentTime=Math.max(0,next-1)/fps;}} /></label>{sample.content_type?.startsWith("video/") && <label>Source FPS<input aria-label="Source FPS" type="number" min={1} max={240} value={fps} onChange={event => setFps(Math.max(1,Number(event.target.value)))} /></label>}<button disabled={!document?.editable} aria-pressed={drawing} onClick={() => setDrawing(!drawing)}>Draw rectangle</button><button disabled={!document?.editable} onClick={() => {const id=crypto.randomUUID();setBoxes(values=>[...values,{id,track_id:`track-${values.length+1}`,frame,label:"object",x:.1,y:.1,width:.2,height:.2}]);setSelected(id);setDirty(true);}}>Add rectangle</button><button className="primary" disabled={!document?.editable || !dirty} onClick={save}>Save annotations</button><span role="status">{status || `Revision ${document?.revision ?? "…"}${dirty ? " · unsaved" : ""}`}</span></div><div className="annotation-stage">{sample.content_type?.startsWith("video/") ? <video ref={video} src={preview} muted preload="auto" /> : <img src={preview} alt={`Annotation source ${sample.name}`} />}<svg aria-label="Annotation rectangles" viewBox="0 0 1000 1000" preserveAspectRatio="none" onPointerDown={event => {if (!drawing || !document?.editable)return;start.current=point(event);event.currentTarget.setPointerCapture(event.pointerId);}} onPointerUp={event => {if(!start.current)return;const end=point(event), origin=start.current;start.current=null;const width=Math.abs(end.x-origin.x),height=Math.abs(end.y-origin.y);if(width<.003||height<.003)return;const id=crypto.randomUUID();setBoxes(values=>[...values,{id,track_id:`track-${values.length+1}`,frame,label:"object",x:Math.min(end.x,origin.x),y:Math.min(end.y,origin.y),width,height}]);setSelected(id);setDirty(true);setDrawing(false);}}>{boxes.filter(box=>box.frame===frame).map(box=><g key={box.id} onClick={()=>setSelected(box.id)}><rect className={box.id===selected?"selected-box":""} x={box.x*1000} y={box.y*1000} width={box.width*1000} height={box.height*1000}/><text x={box.x*1000+3} y={Math.max(18,box.y*1000-7)}>{box.label} · {box.track_id}</text></g>)}</svg></div><div className="annotation-inspector"><div><h2>Objects in frame · {boxes.filter(box=>box.frame===frame).length}</h2><div className="object-list">{boxes.filter(box=>box.frame===frame).map(box=><button key={box.id} aria-pressed={box.id===selected} onClick={()=>setSelected(box.id)}>{box.label} · {box.track_id}</button>)}</div></div>{active && <fieldset disabled={!document?.editable}><legend>Selected object</legend><label>Label<input aria-label="Object label" value={active.label} onChange={event=>update({label:event.target.value})}/></label><label>Track identity<input aria-label="Track identity" value={active.track_id} onChange={event=>update({track_id:event.target.value})}/></label>{(["x","y","width","height"] as const).map(coordinate=><label key={coordinate}>{coordinate}<input aria-label={`Rectangle ${coordinate}`} type="number" min={0} max={1} step={.001} value={active[coordinate]} onChange={event=>update({[coordinate]:Number(event.target.value)})}/></label>)}<button onClick={()=>{setBoxes(values=>values.filter(box=>box.id!==selected));setSelected("");setDirty(true);}}>Delete rectangle</button></fieldset>}</div>{document && !document.editable && <p className="boundary-note">This split is read-only. Protected evaluation material cannot be relabelled here.</p>}<p className="muted">Original media stays unchanged. Labels are versioned against sample SHA-256 <code>{document?.sample_sha256}</code>.</p></section>;
}

type Model = {name: string; model_id: string; descriptor_sha256: string; checkpoint: {sha256?: string; revision?: string}; nodes: {id: string; label: string; kind: string; parameter_count?: number}[]; edges: {source: string; target: string}[]};
export function ModelView({project}: {project: Project}) {
 const [model,setModel]=useState<Model|null>(null);const [error,setError]=useState("");const [selected,setSelected]=useState("");
 useEffect(()=>{const abort=new AbortController();setModel(null);setError("");request<Model>(`/api/v1/projects/${enc(project.id)}/model`,{signal:abort.signal}).then(setModel).catch(reason=>{if(!abort.signal.aborted)setError(message(reason));});return()=>abort.abort();},[project.id]);
 if(!model)return <section><h1>Models / Architecture</h1><p>{error||"Checking model descriptor…"}</p></section>;
 const node=model.nodes.find(item=>item.id===selected);const cols=3;const height=Math.ceil(model.nodes.length/cols)*130;
 const position=(id:string)=>{const index=model.nodes.findIndex(item=>item.id===id);return{x:25+(index%cols)*250,y:25+Math.floor(index/cols)*130};};
 return <section><span className="eyebrow">Checked structural descriptor</span><h1>{model.name}</h1><p>Owner-authored structure · exact checkpoint binding</p><svg className="model-graph" viewBox={`0 0 770 ${height+30}`} role="group" aria-label={`${model.name} architecture graph`}>{model.edges.map((edge,index)=>{const a=position(edge.source),b=position(edge.target);return <path key={index} d={`M ${a.x+105} ${a.y+76} L ${b.x+105} ${b.y}`} />;})}{model.nodes.map(item=>{const p=position(item.id);return <g key={item.id} tabIndex={0} role="button" aria-label={item.label} onClick={()=>setSelected(item.id)} onKeyDown={event=>{if(event.key==="Enter"||event.key===" ")setSelected(item.id);}}><rect className={selected===item.id?"selected-node":""} x={p.x} y={p.y} width={215} height={76} rx={6}/><text x={p.x+12} y={p.y+30}>{item.label.slice(0,28)}</text><text className="node-kind" x={p.x+12} y={p.y+54}>{item.kind}</text></g>;})}</svg>{node&&<div className="card"><h2>{node.label}</h2><p>{node.kind}{node.parameter_count!==undefined?` · ${node.parameter_count.toLocaleString()} parameters`:""}</p></div>}<dl><dt>Checkpoint identity</dt><dd><code>{model.checkpoint.sha256||model.checkpoint.revision}</code></dd><dt>Descriptor SHA-256</dt><dd><code>{model.descriptor_sha256}</code></dd></dl><p className="muted">Structure is validated without executing model code or loading checkpoint objects.</p></section>;
}

export function TelemetryView({runs}: {runs: Run[]}) {
 const [metric, setMetric] = useState("");
 const [chosen, setChosen] = useState<string[] | null>(null);
 const available = runs.filter(run => run.telemetry?.events?.length);
 const names = [...new Set(available.flatMap(run => run.telemetry!.events.map(event => `${event.split}/${event.name}`)))];
 const key = names.includes(metric) ? metric : names[0];
 const selected = chosen ?? available.map(run => run.id);
 const visible = available.filter(run => selected.includes(run.id));
 const events = (run: Run) => run.telemetry!.events.filter(event => `${event.split}/${event.name}` === key);
 const points = visible.flatMap(events);
 const maxStep = Math.max(1, ...points.map(point => point.step));
 const lo = points.length ? Math.min(...points.map(point => point.value)) : 0;
 const hi = points.length ? Math.max(...points.map(point => point.value)) : 1;
 return <section className="telemetry-view">
  <h2>Recorded training metrics</h2>
  {!available.length ? <p className="empty">No scientific telemetry is available for these runs.</p> : <>
   <label>Comparison metric<select aria-label="Comparison metric" value={key} onChange={event => setMetric(event.target.value)}>{names.map(name => <option key={name}>{name}</option>)}</select></label>
   <div className="comparison-choices">{available.map(run => <label key={run.id}><input type="checkbox" checked={selected.includes(run.id)} onChange={event => setChosen(event.target.checked ? [...selected, run.id] : selected.filter(id => id !== run.id))}/>{run.id.slice(0, 8)} · {run.status}</label>)}</div>
   {!points.length ? <p>Select a run containing this metric to compare recorded values.</p> : <svg viewBox="0 0 800 280" role="img" aria-label={`${key} recorded values by optimizer step; range ${lo} to ${hi}`}>
    <path className="chart-axis" d="M 125 20 V 225 H 790"/>
    <text x={5} y={30}>{hi.toPrecision(5)}</text><text x={5} y={215}>{lo.toPrecision(5)}</text>
    <text x={125} y={245}>0</text><text x={765} y={245}>{maxStep}</text>
    {visible.map((run, index) => <polyline key={`${run.id}-points`} className={`series series-${index % 3}`} points={events(run).map(event => `${125 + event.step / maxStep * 650},${215 - (event.value - lo) / (hi - lo || 1) * 190}`).join(" ")}><title>{run.id}</title></polyline>)}
    <text x={340} y={275}>Optimizer step</text>
   </svg>}
   <div className="result-table-scroll"><table><caption>Exact recorded values · {key}</caption><thead><tr><th>Run</th><th>Step</th><th>Split</th><th>Value</th></tr></thead><tbody>{visible.flatMap(run => events(run).map((event, index) => <tr key={`${run.id}-${index}`}><td>{run.id.slice(0, 8)}</td><td>{event.step}</td><td>{event.split}</td><td>{String(event.value)}</td></tr>))}</tbody></table></div>
   <p className="muted">Axis labels are rounded; the table preserves recorded numeric precision. Comparisons display recorded points. Matching metric names do not establish scientific comparability or model promotion.</p>
  </>}
 </section>;
}
