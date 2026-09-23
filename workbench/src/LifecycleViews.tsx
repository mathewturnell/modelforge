// Annotation presentation adapted from the original AnnotationEditor.tsx.
// All annotation persistence remains behind the public source-bound sidecar port.
import {useEffect, useRef, useState} from "react";
import {BoxSelect, ChevronLeft, ChevronRight, CircleDot, Download, Eye, EyeOff, Hand, Maximize2, MousePointer2, Pentagon, PenLine, Plus, Redo2, RotateCcw, Save, Search, Sparkles, Trash2, Undo2, X, ZoomIn, ZoomOut} from "lucide-react";
import {Button} from "@mui/material";
import {request} from "./lib/api";
import type {Project, Sample} from "./types";
import "./AnnotationEditor.css";

type Box = {id: string; frame: number; label: string; track_id: string; x: number; y: number; width: number; height: number};
type Annotations = {revision: number; editable: boolean; sample_sha256: string; annotations: Box[]};
type Point = {x: number; y: number};
type Gesture = {kind: "draw" | "move" | "resize" | "pan"; start: Point; original?: Box; pan?: Point; before?: Box[]};
const enc = encodeURIComponent;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
export function annotationTrackColor(value: string) {
  const numeric = Number(value);let hue: number;
  if (Number.isFinite(numeric)) hue = ((numeric * 137.508) % 360 + 360) % 360;
  else {let hash = 2166136261;for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);hash ^= hash >>> 16;hue = Math.abs(hash) % 360;}
  return `hsl(${hue} 82% 62%)`;
}
export function recordedAnnotationFrames(boxes: {frame: number}[]) {return [...new Set(boxes.map(box => box.frame))].sort((a, b) => a - b);}
/** Bound labels by their screen separation, without changing recorded coordinates. */
export function annotationTimelineTicks(frames: number[], current: number, width: number) {
  if (!frames.length) return [];
  const first = frames[0], last = frames[frames.length - 1];
  if (first === last) return [first];
  const position = (current - first) / (last - first) * Math.max(0, width);
  return frames.includes(current) && current !== first && current !== last && position >= 72 && width - position >= 72
    ? [first, current, last] : [first, last];
}
export function AnnotationTimelineTicks({frames, current, width, onFrame}: {frames: number[]; current: number; width: number; onFrame: (frame: number) => void}) {
  return <>{annotationTimelineTicks(frames, current, width).map(value => <Button key={value} className={value === current ? "active" : ""} aria-label={`Go to recorded frame ${value}`} style={{left: `${frames.length === 1 ? 0 : (value - frames[0]) / (frames[frames.length - 1] - frames[0]) * 96}%`}} onClick={() => onFrame(value)}>{value}</Button>)}</>;
}


export function AnnotationView({project, sample, preview, onClose}: {project: Project; sample: Sample | null; preview: string; onClose?: () => void}) {
  const [annotation, setAnnotation] = useState<Annotations | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [frame, setFrame] = useState(1), [fps, setFps] = useState(5);
  const [selected, setSelected] = useState(""), [status, setStatus] = useState("");
  const [tool, setTool] = useState<"select" | "pan" | "box">("select");
  const [saving, setSaving] = useState(false), [showLabels, setShowLabels] = useState(true);
  const [filter, setFilter] = useState(""), [newLabel, setNewLabel] = useState("object");
  const [zoom, setZoom] = useState(1), [pan, setPan] = useState<Point>({x: 0, y: 0});
  const [dimensions, setDimensions] = useState({width: 1280, height: 720});
  const [viewportSize, setViewportSize] = useState({width: 960, height: 540});
  const [draft, setDraft] = useState<Partial<Box> | null>(null);
  const [history, setHistory] = useState<Box[][]>([]), [future, setFuture] = useState<Box[][]>([]);
  const gesture = useRef<Gesture | null>(null), video = useRef<HTMLVideoElement>(null), viewport = useRef<HTMLDivElement>(null), editor = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null);
  const isVideo = sample?.content_type?.startsWith("video/");
  const endpoint = project.dataset && sample ? `/api/v1/projects/${enc(project.id)}/datasets/${enc(project.dataset.id)}/samples/${enc(sample.id)}/annotations` : "";
  const editable = !!annotation?.editable && !saving;
  const dirty = !!annotation && JSON.stringify(boxes) !== JSON.stringify(annotation.annotations);
  const active = boxes.find(box => box.id === selected);
  const frameBoxes = boxes.filter(box => box.frame === frame);
  const frames = recordedAnnotationFrames(boxes);
  const previousFrame = frames.filter(value => value < frame).at(-1), nextFrame = frames.find(value => value > frame);
  const tracks = [...new Set(boxes.map(box => box.track_id))];
  const fitScale = Math.min(viewportSize.width / dimensions.width, viewportSize.height / dimensions.height);
  const scale = fitScale * zoom;
  useEffect(() => {
    setAnnotation(null);setBoxes([]);setSelected("");setStatus("");setHistory([]);setFuture([]);setPan({x:0,y:0});setZoom(1);setFrame(isVideo ? 1 : 0);
    if (!endpoint) return;
    const abort = new AbortController();
    request<Annotations>(endpoint, {signal: abort.signal}).then(value => {setAnnotation(value);setBoxes(value.annotations);if(value.annotations.length){setFrame(value.annotations[0].frame);setNewLabel(value.annotations[0].label);}}).catch(error => {if (!abort.signal.aborted) setStatus(message(error));});
    return () => abort.abort();
  }, [endpoint]);
  useEffect(() => {
    if (!viewport.current) return;
    const observer = new ResizeObserver(entries => {const rect=entries[0].contentRect;setViewportSize({width:Math.max(1,rect.width),height:Math.max(1,rect.height)});});
    observer.observe(viewport.current);return () => observer.disconnect();
  }, [preview]);
  useEffect(() => {const previous = window.document.activeElement as HTMLElement | null;editor.current?.focus();return () => previous?.focus();}, []);
  function remember(before: Box[]) {setHistory(values => [...values.slice(-49), before]);setFuture([]);}
  function mutate(next: Box[]) {if(!editable)return;remember(boxes);setBoxes(next);}
  function update(patch: Partial<Box>) {mutate(boxes.map(box => box.id === selected ? {...box, ...patch} : box));}
  function undo() {if(!editable||!history.length)return;setFuture(values=>[boxes,...values]);setBoxes(history[history.length-1]);setHistory(values=>values.slice(0,-1));}
  function redo() {if(!editable||!future.length)return;setHistory(values=>[...values,boxes]);setBoxes(future[0]);setFuture(values=>values.slice(1));}
  function addBox(geometry: Pick<Box,"x"|"y"|"width"|"height">) {const id=crypto.randomUUID();mutate([...boxes,{id,track_id:`track-${boxes.length+1}`,frame,label:newLabel||"object",...geometry}]);setSelected(id);setTool("select");}
  function goFrame(next: number) {if(!Number.isFinite(next))return;const bounded=Math.max(0,Math.round(next));setFrame(bounded);setSelected("");if(video.current)video.current.currentTime=Math.max(0,bounded-1)/fps;}
  function point(event: {clientX: number; clientY: number}): Point {const bounds=svg.current!.getBoundingClientRect();return {x:clamp((event.clientX-bounds.left)/bounds.width),y:clamp((event.clientY-bounds.top)/bounds.height)};}
  function startGesture(event: React.PointerEvent<SVGSVGElement>) {
    if(tool==="pan") gesture.current={kind:"pan",start:{x:event.clientX,y:event.clientY},pan};
    else if(tool==="box"&&editable)gesture.current={kind:"draw",start:point(event)};
    if(gesture.current) event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveGesture(event: React.PointerEvent<SVGSVGElement>) {
    const action=gesture.current;if(!action)return;
    if(action.kind==="pan"){setPan({x:action.pan!.x+event.clientX-action.start.x,y:action.pan!.y+event.clientY-action.start.y});return;}
    const p=point(event),dx=p.x-action.start.x,dy=p.y-action.start.y;
    if(action.kind==="draw"){setDraft({x:Math.min(p.x,action.start.x),y:Math.min(p.y,action.start.y),width:Math.abs(dx),height:Math.abs(dy)});return;}
    const original=action.original!;
    const geometry=action.kind==="move"?{x:clamp(original.x+dx,0,1-original.width),y:clamp(original.y+dy,0,1-original.height)}:{width:clamp(original.width+dx,.003,1-original.x),height:clamp(original.height+dy,.003,1-original.y)};
    setBoxes(values=>values.map(box=>box.id===original.id?{...box,...geometry}:box));
  }
  function endGesture(event: React.PointerEvent<SVGSVGElement>) {
    const action=gesture.current;if(!action)return;gesture.current=null;
    if(action.kind==="draw") {const p=point(event),width=Math.abs(p.x-action.start.x),height=Math.abs(p.y-action.start.y);if(width>=.003&&height>=.003)addBox({x:Math.min(p.x,action.start.x),y:Math.min(p.y,action.start.y),width,height});}
    else if(action.before&&JSON.stringify(action.before)!==JSON.stringify(boxes))remember(action.before);
    setDraft(null);
  }
  async function save() {
    if(!annotation?.editable||saving||!dirty)return;setSaving(true);setStatus("Saving…");
    try {const value=await request<Annotations>(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({expected_revision:annotation.revision,annotations:boxes})});setAnnotation(value);setBoxes(value.annotations);setStatus(`Saved revision ${value.revision}`);}
    catch(error){setStatus(message(error));}finally{setSaving(false);}
  }
  function exportLabels() {if(!annotation)return;const payload={...annotation,annotations:boxes,unsaved_changes:dirty};const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:"application/json"}));const link=window.document.createElement("a");link.href=url;link.download=`${(sample?.name||sample?.id||"annotations").replace(/[^a-zA-Z0-9._-]/g,"_")}.annotations.json`;link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function keyboard(event: React.KeyboardEvent<HTMLDivElement>) {
    if(event.key==="Tab"){const items=editor.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]');if(items?.length){const first=items[0],last=items[items.length-1];if(event.shiftKey&&window.document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&window.document.activeElement===last){event.preventDefault();first.focus();}}return;}
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="s"){event.preventDefault();void save();return;}
    if((event.target as HTMLElement).matches("input,select,textarea"))return;
    if(event.key.toLowerCase()==="v")setTool("select");if(event.key.toLowerCase()==="h")setTool("pan");if(event.key.toLowerCase()==="r"&&editable)setTool("box");if(event.key==="Escape"){gesture.current=null;setDraft(null);setTool("select");}
  }
  if(!sample||!preview)return <section><h1>Annotation</h1><p>Select an image or video in Dataset first.</p></section>;
  return <div className="native-annotation-editor" role="dialog" aria-modal="true" aria-label={`Annotation editor · ${sample.name||sample.id}`} tabIndex={-1} ref={editor} onKeyDown={keyboard}>
    <header className="nae-header"><Button aria-label="Close annotation editor" title={dirty?"Close editor (unsaved changes will be discarded)":"Close editor"} onClick={onClose}><X size={15}/></Button><div className="nae-file"><strong>{sample.name||sample.id}</strong><small>{sample.split||"unassigned"} · {dimensions.width} × {dimensions.height}</small></div><div className="nae-header-actions"><Button aria-label="Undo annotation change" disabled={!editable||!history.length} onClick={undo}><Undo2 size={14}/></Button><Button aria-label="Redo annotation change" disabled={!editable||!future.length} onClick={redo}><Redo2 size={14}/></Button><span className={`nae-state${dirty?" is-dirty":""}`}>{saving?"SAVING":dirty?"UNSAVED":annotation?"SAVED":"LOADING"}</span><span className="nae-state">{annotation?.editable?"EDITABLE":"READ ONLY"}</span><Button aria-label="Save annotations" disabled={!editable||!dirty} onClick={()=>void save()}><Save size={13}/>Save</Button><select aria-label="Annotation export format"><option>ModelForge JSON</option></select><Button disabled={!annotation} onClick={exportLabels}><Download size={13}/>Export</Button></div></header>
    <div className="nae-toolbar"><label className="nae-new-label">New object label <span style={{background:annotationTrackColor(`track-${boxes.length+1}`)}}/><input aria-label="New object label" value={newLabel} disabled={!editable} onChange={event=>setNewLabel(event.target.value)}/></label><Button disabled title="Assisted annotation requires a project service that is not available in this build."><Sparkles size={13}/>Easy annotate</Button><Button aria-label="Add rectangle" disabled={!editable} onClick={()=>addBox({x:.1,y:.1,width:.2,height:.2})}><Plus size={13}/>Add box</Button><span className="nae-guidance">{active?"Track selected · drag to move or resize":`${frameBoxes.length} objects on this frame · select one to refine`}</span><div className="nae-zoom"><Button aria-label="Zoom out" onClick={()=>setZoom(value=>clamp(value/1.25,.25,8))}><ZoomOut size={15}/></Button><span>{Math.round(zoom*100)}%</span><Button aria-label="Zoom in" onClick={()=>setZoom(value=>clamp(value*1.25,.25,8))}><ZoomIn size={15}/></Button><Button aria-label="Fit image" onClick={()=>{setZoom(1);setPan({x:0,y:0});}}><Maximize2 size={14}/></Button><Button aria-label="Reset canvas" onClick={()=>{setZoom(1);setPan({x:0,y:0});setTool("select");}}><RotateCcw size={14}/></Button><Button aria-label={showLabels?"Hide annotations":"Show annotations"} aria-pressed={showLabels} onClick={()=>setShowLabels(!showLabels)}>{showLabels?<Eye size={15}/>:<EyeOff size={15}/>}</Button></div></div>
    <div className="nae-body"><nav className="nae-tools" aria-label="Annotation tools"><Button className={tool==="select"?"active":""} aria-label="Select annotation" aria-pressed={tool==="select"} onClick={()=>setTool("select")}><MousePointer2 size={18}/><small>Select</small><kbd>V</kbd></Button><Button className={tool==="pan"?"active":""} aria-label="Pan canvas" aria-pressed={tool==="pan"} onClick={()=>setTool("pan")}><Hand size={18}/><small>Pan</small><kbd>H</kbd></Button><hr/><Button className={tool==="box"?"active":""} aria-label="Draw rectangle" disabled={!editable} aria-pressed={tool==="box"} onClick={()=>setTool("box")}><BoxSelect size={18}/><small>Box</small><kbd>R</kbd></Button>{[{name:"Polygon",Icon:Pentagon},{name:"Line",Icon:PenLine},{name:"Point",Icon:CircleDot}].map(({name,Icon})=><Button key={name} disabled title={`${name} annotations are not supported by the current annotation service.`}><Icon size={18}/><small>{name}</small></Button>)}</nav>
      <div className="nae-center"><div className={`nae-viewport tool-${tool}`} ref={viewport} onWheel={event=>{if(event.ctrlKey||event.metaKey)setZoom(value=>clamp(value*(event.deltaY>0?.9:1.1),.25,8));}}><div className="annotation-stage nae-stage" style={{width:dimensions.width*scale,height:dimensions.height*scale,transform:`translate(${pan.x}px, ${pan.y}px)`}}>{isVideo?<video ref={video} src={preview} muted preload="auto" onLoadedMetadata={event=>{setDimensions({width:event.currentTarget.videoWidth||1280,height:event.currentTarget.videoHeight||720});event.currentTarget.currentTime=Math.max(0,frame-1)/fps;}}/>:<img src={preview} alt={`Annotation source ${sample.name}`} onLoad={event=>setDimensions({width:event.currentTarget.naturalWidth,height:event.currentTarget.naturalHeight})}/>}<svg ref={svg} aria-label="Annotation rectangles" viewBox={`0 0 ${dimensions.width} ${dimensions.height}`} onPointerDown={startGesture} onPointerMove={moveGesture} onPointerUp={endGesture} onPointerCancel={()=>{if(gesture.current?.before)setBoxes(gesture.current.before);gesture.current=null;setDraft(null);}}>{showLabels&&frameBoxes.map(box=>{const color=annotationTrackColor(box.track_id),x=box.x*dimensions.width,y=box.y*dimensions.height,w=box.width*dimensions.width,h=box.height*dimensions.height;return <g key={box.id} className={selected===box.id?"nae-selected":""} style={{"--track-color":color} as React.CSSProperties} onPointerDown={event=>{if(tool!=="select")return;event.stopPropagation();setSelected(box.id);if(editable){gesture.current={kind:"move",start:point(event),original:box,before:boxes};svg.current?.setPointerCapture(event.pointerId);}}}><rect className="nae-box" x={x} y={y} width={w} height={h}/><rect className="nae-box-label" x={x} y={Math.max(0,y-22/scale)} width={Math.min(w,Math.max(55,box.label.length*7+12)/scale)} height={22/scale}/><text x={x+5/scale} y={Math.max(15/scale,y-6/scale)} style={{fontSize:12/scale}}>{box.label}</text>{selected===box.id&&editable&&<rect className="nae-resize" aria-label="Resize selected rectangle" x={x+w-5/scale} y={y+h-5/scale} width={10/scale} height={10/scale} onPointerDown={event=>{event.stopPropagation();gesture.current={kind:"resize",start:point(event),original:box,before:boxes};svg.current?.setPointerCapture(event.pointerId);}}/>}</g>;})}{draft&&<rect className="nae-draft" x={draft.x!*dimensions.width} y={draft.y!*dimensions.height} width={draft.width!*dimensions.width} height={draft.height!*dimensions.height}/>}</svg></div></div>
      <div className="nae-timeline"><div className="nae-frame-controls"><Button aria-label="Previous annotated frame" disabled={previousFrame===undefined} onClick={()=>previousFrame!==undefined&&goFrame(previousFrame)}><ChevronLeft size={14}/></Button><input aria-label="Annotation frame" type="number" min={0} value={frame} onChange={event=>goFrame(Number(event.target.value))}/><span>{frames.length} recorded frame{frames.length===1?"":"s"}</span><Button aria-label="Next annotated frame" disabled={nextFrame===undefined} onClick={()=>nextFrame!==undefined&&goFrame(nextFrame)}><ChevronRight size={14}/></Button>{isVideo&&<label>Source FPS<input aria-label="Source FPS" type="number" min={1} max={240} value={fps} onChange={event=>setFps(clamp(Number(event.target.value),1,240))}/></label>}<span className="nae-timeline-note">Source-bound annotations · recorded frames only</span></div><div className="nae-track-timeline"><div className="nae-track-heading"><span>TRACKS</span><div><AnnotationTimelineTicks frames={frames} current={frame} width={Math.max(0,viewportSize.width-140)} onFrame={goFrame}/></div></div>{tracks.map(track=><div className="nae-track-row" key={track}><span title={track}>{track}</span><div>{boxes.filter(box=>box.track_id===track).map(box=><Button key={box.id} aria-label={`Track ${track} frame ${box.frame}`} title={`Frame ${box.frame}`} style={{left:`${frames.length===1?0:(box.frame-frames[0])/(frames.at(-1)!-frames[0])*96}%`,background:annotationTrackColor(track)}} onClick={()=>{goFrame(box.frame);setSelected(box.id);}}/>)}</div></div>)}{!tracks.length&&<p>No recorded tracks on this source.</p>}</div></div></div>
      <aside className="nae-inspector"><header><strong>OBJECTS</strong><span>{frameBoxes.length} ON FRAME</span></header><label className="nae-search"><Search size={13}/><input aria-label="Search objects" placeholder="Search objects…" value={filter} onChange={event=>setFilter(event.target.value)}/></label><div className="nae-objects">{frameBoxes.filter(box=>`${box.label} ${box.track_id}`.toLowerCase().includes(filter.toLowerCase())).map(box=><Button key={box.id} aria-label={`${box.label} · ${box.track_id}`} aria-pressed={box.id===selected} onClick={()=>setSelected(box.id)}><i style={{background:annotationTrackColor(box.track_id)}}/><span><strong>{box.label}</strong><small>Box · Track {box.track_id}</small></span></Button>)}</div><div className="nae-properties">{active?<fieldset disabled={!editable}><legend>Selected object</legend><label>Label<input aria-label="Object label" value={active.label} onChange={event=>update({label:event.target.value})}/></label><label>Track identity<input aria-label="Track identity" value={active.track_id} onChange={event=>update({track_id:event.target.value})}/></label><div className="nae-coordinate-grid">{(["x","y","width","height"] as const).map(coordinate=><label key={coordinate}>{coordinate}<input aria-label={`Rectangle ${coordinate}`} type="number" min={0} max={1} step={.001} value={active[coordinate]} onChange={event=>update({[coordinate]:Number(event.target.value)})}/></label>)}</div><Button onClick={()=>{mutate(boxes.filter(box=>box.id!==selected));setSelected("");}}><Trash2 size={13}/>Delete rectangle</Button></fieldset>:<div className="nae-selection-hint"><MousePointer2 size={18}/><div><strong>Select an object to edit it</strong><p>Click an outline on the image or choose a row above.</p></div></div>}{annotation&&!annotation.editable&&<p className="nae-readonly">This split is read-only. Protected evaluation material cannot be relabelled here.</p>}<details><summary>Source binding</summary><small>Labels are versioned against sample SHA-256</small><code>{annotation?.sample_sha256}</code></details></div></aside>
    </div><footer className="nae-footer"><span>{sample.split||"unassigned"} · Frame {frame}</span><span role="status">{status||`Revision ${annotation?.revision??"…"}${dirty?" · unsaved changes":" · source media unchanged"}`}</span></footer>
  </div>;
}
