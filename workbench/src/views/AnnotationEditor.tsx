import {useEffect, useMemo, useRef, useState} from "react";
import {BoxSelect, ChevronLeft, ChevronRight, CircleDot, Download, KeyRound, Merge, MousePointer2, PenLine, Pentagon, Save, Trash2} from "lucide-react";
import {annotationFrameUrl, api} from "../lib/api";
import type {AnnotationObservation, AnnotationProject, AnnotationSample, JsonMap} from "../types";
import {Badge, Button, ErrorNotice, IconButton, LoadingState} from "../components/ui";

type Tool = "select" | "box" | "polygon" | "polyline" | "point";
type Point = {x: number; y: number};

function colorFor(value: number | string, alpha?: number) {
  const numeric = Number(value);
  let hue: number;
  if (Number.isFinite(numeric)) hue = ((numeric * 137.508) % 360 + 360) % 360;
  else {
    let hash = 2166136261;
    for (const character of String(value)) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    hash ^= hash >>> 16;
    hue = Math.abs(hash) % 360;
  }
  return alpha === undefined ? `hsl(${hue} 82% 62%)` : `hsla(${hue}, 82%, 62%, ${alpha})`;
}

export function AnnotationEditor({initial, onClose}: {initial: AnnotationProject; onClose: () => void}) {
  const [project, setProject] = useState(initial);
  const [sampleIndex, setSampleIndex] = useState(Math.max(1, initial.markers?.[0]?.sample_index || 1));
  const [sample, setSample] = useState<AnnotationSample | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [tool, setTool] = useState<Tool>("select");
  const [draft, setDraft] = useState<[number, number, number, number] | null>(null);
  const [shapeDraft, setShapeDraft] = useState<number[]>([]);
  const [exportFormat, setExportFormat] = useState(initial.export_formats?.[0] || "modelforge_jsonl");
  const [gesture, setGesture] = useState<{kind: "draw" | "move" | "resize"; markerId?: number; start: Point; original?: [number, number, number, number]; corner?: number} | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState(project.protected ? project.protection_reason || "Read-only annotation evidence" : "Edits are backed up and autosaved.");
  const svgRef = useRef<SVGSVGElement>(null);
  const sampleRequestRef = useRef(0);
  const requestedSampleRef = useRef(sampleIndex);

  const loadSample = async (index: number) => {
    const bounded = Math.max(1, Math.min(project.sample_count || 1, index));
    const request = ++sampleRequestRef.current;
    requestedSampleRef.current = bounded;
    setSampleIndex(bounded); setSample(null);
    setLoading(true); setError("");
    try {
      const next = await api.annotationSample(project.project, bounded);
      if (request === sampleRequestRef.current) setSample(next);
    } catch (reason) {
      if (request === sampleRequestRef.current) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (request === sampleRequestRef.current) setLoading(false);
    }
  };
  useEffect(() => { void loadSample(sampleIndex); }, [project.project]);

  const dimensions = useMemo(() => {
    let width = Number(sample?.width || 0);
    let height = Number(sample?.height || 0);
    for (const observation of Object.values(sample?.observations || {})) {
      width = Math.max(width, observation.bbox?.[2] || 0);
      height = Math.max(height, observation.bbox?.[3] || 0);
    }
    return {width: width || 1280, height: height || 720};
  }, [sample]);
  const observations = Object.entries(sample?.observations || {}).map(([trackId, observation]) => ({trackId, observation, markerId: Number(observation.marker_id ?? trackId), colorKey: String(observation.source_track_id || observation.marker_id || trackId)}));
  const selectedObservation = observations.find((item) => selected.size === 1 && selected.has(item.markerId));
  const selectedClassId = Number(Object.keys(project.classes || {})[0] || 0);

  const position = (event: React.PointerEvent<SVGSVGElement>): Point => {
    const svg = svgRef.current;
    if (!svg) return {x: 0, y: 0};
    const rectangle = svg.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(dimensions.width, (event.clientX - rectangle.left) / rectangle.width * dimensions.width)),
      y: Math.max(0, Math.min(dimensions.height, (event.clientY - rectangle.top) / rectangle.height * dimensions.height)),
    };
  };
  const normalizeBox = (a: Point, b: Point): [number, number, number, number] => [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)];

  const finishShape = async () => {
    const minimum = tool === "polygon" ? 6 : tool === "polyline" ? 4 : 2;
    if (shapeDraft.length >= minimum) {
      await mutate({action: "add_shape", sample_index: sampleIndex, class_id: selectedClassId,
        geometry_type: tool, geometry: shapeDraft});
    }
    setShapeDraft([]);
  };

  const mutate = async (change: JsonMap) => {
    if (project.protected) return setError(project.protection_reason || "This annotation project is read-only.");
    setSaving(true); setError(""); setMessage("Saving annotation edit…");
    try {
      const updated = await api.mutateAnnotation(project.project, change);
      setProject(updated); setMessage("Saved with a recovery backup.");
      await loadSample(sampleIndex);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); setMessage("Annotation edit was not saved."); }
    finally { setSaving(false); }
  };

  const onPointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
    if (project.protected || event.button !== 0) return;
    const point = position(event);
    if (tool === "box") { setGesture({kind: "draw", start: point}); setDraft([point.x, point.y, point.x, point.y]); }
    if (tool === "point") void mutate({action: "add_shape", sample_index: sampleIndex, class_id: selectedClassId,
      geometry_type: "point", geometry: [point.x, point.y]});
    if (tool === "polygon" || tool === "polyline") setShapeDraft((current) => [...current, point.x, point.y]);
  };
  const onPointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!gesture) return;
    const point = position(event);
    if (gesture.kind === "draw") setDraft(normalizeBox(gesture.start, point));
    if (gesture.kind === "move" && gesture.original) {
      const dx = point.x - gesture.start.x; const dy = point.y - gesture.start.y;
      const [x1, y1, x2, y2] = gesture.original;
      setDraft([x1 + dx, y1 + dy, x2 + dx, y2 + dy]);
    }
    if (gesture.kind === "resize" && gesture.original) {
      const box = [...gesture.original] as [number, number, number, number];
      const corner = gesture.corner || 0;
      box[corner % 2 === 0 ? 0 : 2] = point.x;
      box[corner < 2 ? 1 : 3] = point.y;
      setDraft(normalizeBox({x: box[0], y: box[1]}, {x: box[2], y: box[3]}));
    }
  };
  const onPointerUp = async () => {
    if (!gesture || !draft) return setGesture(null);
    const width = draft[2] - draft[0]; const height = draft[3] - draft[1];
    if (width > 3 && height > 3) {
      if (gesture.kind === "draw") await mutate({action: "add_track", sample_index: sampleIndex, class_id: Number(Object.keys(project.classes || {})[0] || 0), bbox: draft});
      else if (gesture.markerId !== undefined) await mutate({action: "set_keyframe", marker_id: gesture.markerId, sample_index: sampleIndex, bbox: draft});
    }
    setDraft(null); setGesture(null);
  };

  const selectMarker = (event: React.PointerEvent, markerId: number, observation: AnnotationObservation) => {
    event.stopPropagation();
    setSelected((current) => {
      if (event.shiftKey) { const next = new Set(current); next.has(markerId) ? next.delete(markerId) : next.add(markerId); return next; }
      return new Set([markerId]);
    });
    if (tool === "select" && !project.protected && observation.bbox && (observation.geometry_type || "bbox") === "bbox") {
      const start = position(event as unknown as React.PointerEvent<SVGSVGElement>);
      setDraft(observation.bbox);
      setGesture({kind: "move", markerId, start, original: observation.bbox});
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, select, textarea, button")) return;
      if (event.key === "ArrowLeft") { event.preventDefault(); void loadSample(requestedSampleRef.current - 1); }
      if (event.key === "ArrowRight") { event.preventDefault(); void loadSample(requestedSampleRef.current + 1); }
      if (event.key === "Enter" && shapeDraft.length) { event.preventDefault(); void finishShape(); }
      if (event.key === "Escape" && shapeDraft.length) setShapeDraft([]);
      const shortcut = {v: "select", r: "box", p: "polygon", l: "polyline", k: "point"}[event.key.toLowerCase()] as Tool | undefined;
      if (shortcut && !project.protected) setTool(shortcut);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [project.protected, sampleIndex, shapeDraft, tool]);

  const exportAnnotations = async () => {
    if (!window.confirm(`Export a new ${exportFormat} sidecar? Imported source annotations remain unchanged.`)) return;
    setSaving(true); setError("");
    try {
      const result = await api.exportAnnotations(project.project, exportFormat);
      const exported = result.export as JsonMap | undefined;
      const fidelity = exported?.fidelity as JsonMap | undefined;
      setMessage(`${fidelity?.lossless ? "Lossless" : "Compatible"} ${exportFormat} export saved to ${exported?.path || "the edit layer"}.`);
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  };

  return <div className="annotation-editor">
    <header className="annotation-toolbar">
      <div className="annotation-tool-group" aria-label="Annotation tools"><Button title="Select · V" variant={tool === "select" ? "primary" : "ghost"} onClick={() => {setTool("select"); setShapeDraft([]);}} disabled={project.protected}><MousePointer2 size={14} /> Select</Button><Button title="Box · R" variant={tool === "box" ? "primary" : "ghost"} onClick={() => {setTool("box"); setShapeDraft([]);}} disabled={project.protected}><BoxSelect size={14} /> Box</Button><Button title="Polygon geometry is not part of the current public annotation contract" variant="ghost" disabled><Pentagon size={14} /> Polygon</Button><Button title="Polyline geometry is not part of the current public annotation contract" variant="ghost" disabled><PenLine size={14} /> Line</Button><Button title="Point geometry is not part of the current public annotation contract" variant="ghost" disabled><CircleDot size={14} /> Point</Button></div>
      <div className="frame-controls"><IconButton label="Previous frame" onClick={() => void loadSample(requestedSampleRef.current - 1)} disabled={sampleIndex <= 1}><ChevronLeft size={16} /></IconButton><span><strong>{sampleIndex}</strong> / {project.sample_count || 0}</span><input type="range" min={1} max={project.sample_count || 1} value={sampleIndex} onChange={(event) => void loadSample(Number(event.target.value))} aria-label="Annotation frame" /><IconButton label="Next frame" onClick={() => void loadSample(requestedSampleRef.current + 1)} disabled={sampleIndex >= (project.sample_count || 1)}><ChevronRight size={16} /></IconButton></div>
      <div className="annotation-tool-group"><Badge tone={project.protected ? "warning" : "success"}>{project.protected ? "Read only" : saving ? "Saving" : "Autosaved"}</Badge>{project.export_supported && <div className="annotation-export"><select aria-label="Annotation export format" value={exportFormat} onChange={(event) => setExportFormat(event.target.value)}>{(project.export_formats || ["modelforge_jsonl"]).map((format) => <option key={format} value={format}>{humanizeFormat(format)}</option>)}</select><Button onClick={() => void exportAnnotations()} disabled={project.protected || saving}><Download size={14} /> Export</Button></div>}<Button variant="ghost" onClick={onClose}>Done</Button></div>
    </header>
    {error && <ErrorNotice message={error} />}
    <div className="annotation-main">
      <div className="annotation-stage-wrap">
        {loading && <LoadingState label="Decoding annotation frame…" />}
        {sample && <div className="annotation-stage" style={{aspectRatio: `${dimensions.width}/${dimensions.height}`}}>
          <img key={`${project.project}:${sampleIndex}`} src={annotationFrameUrl(project.project, sampleIndex)} alt={sample.filename || `Annotation frame ${sampleIndex}`} draggable={false} />
          <svg ref={svgRef} viewBox={`0 0 ${dimensions.width} ${dimensions.height}`} preserveAspectRatio="xMidYMid meet" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={() => void onPointerUp()} onPointerLeave={() => gesture && void onPointerUp()} onDoubleClick={() => shapeDraft.length && void finishShape()}>
            {observations.map(({trackId, observation, markerId, colorKey}) => {
              const box = gesture?.markerId === markerId && draft ? draft : observation.bbox;
              const [x1, y1, x2, y2] = box || [0, 0, 0, 0]; const color = colorFor(colorKey); const active = selected.has(markerId);
              const geometryType = observation.geometry_type || "bbox";
              const points = observation.polygon || observation.polyline || observation.points || [];
              const keypoints = observation.keypoints || [];
              const rotated = rotatedBoxPoints(observation.rotated_box);
              return <g key={`${trackId}-${markerId}`} className={active ? "selected" : ""} onPointerDown={(event) => selectMarker(event, markerId, observation)}>
                {geometryType === "bbox" && box && <rect className="annotation-box" x={x1} y={y1} width={x2 - x1} height={y2 - y1} style={{stroke: color, fill: colorFor(colorKey, active ? .16 : .035)}} />}
                {geometryType === "mask" && box && <rect className="annotation-mask" x={x1} y={y1} width={x2 - x1} height={y2 - y1} style={{stroke: color, fill: colorFor(colorKey, active ? .2 : .08)}} />}
                {observation.polygon && <polygon className="annotation-vector" points={svgPoints(observation.polygon)} style={{stroke: color, fill: colorFor(colorKey, active ? .18 : .06)}} />}
                {observation.polyline && <polyline className="annotation-vector line" points={svgPoints(observation.polyline)} style={{stroke: color}} />}
                {rotated.length > 0 && <polygon className="annotation-vector" points={svgPoints(rotated)} style={{stroke: color, fill: colorFor(colorKey, active ? .16 : .035)}} />}
                {observation.ellipse && observation.ellipse.length >= 4 && <ellipse className="annotation-vector" cx={observation.ellipse[0]} cy={observation.ellipse[1]} rx={observation.ellipse[2]} ry={observation.ellipse[3]} style={{stroke: color, fill: colorFor(colorKey, active ? .16 : .035)}} />}
                {points.reduce<React.ReactNode[]>((nodes, _value, index) => {if (index % 2 === 0) nodes.push(<circle key={index} className="annotation-point" cx={points[index]} cy={points[index + 1]} r={active ? 6 : 4} style={{fill: color}} />); return nodes;}, [])}
                {keypoints.reduce<React.ReactNode[]>((nodes, _value, index) => {if (index % 3 === 0 && keypoints[index + 2] !== 0) nodes.push(<circle key={index} className="annotation-point" cx={keypoints[index]} cy={keypoints[index + 1]} r={active ? 6 : 4} style={{fill: color}} />); return nodes;}, [])}
                {box && <><rect className="annotation-label-bg" x={x1} y={Math.max(0, y1 - 22)} width={Math.max(58, String(observation.class_name || markerId).length * 8 + 18)} height={22} style={{fill: color}} /><text x={x1 + 7} y={Math.max(15, y1 - 7)}>{observation.class_name || `#${markerId}`}</text></>}
                {active && geometryType === "bbox" && box && [0, 1, 2, 3].map((corner) => {
                  const cx = corner % 2 === 0 ? x1 : x2; const cy = corner < 2 ? y1 : y2;
                  return <circle key={corner} className="annotation-handle" cx={cx} cy={cy} r={6} onPointerDown={(event) => { event.stopPropagation(); setDraft(box); setGesture({kind: "resize", markerId, start: position(event as unknown as React.PointerEvent<SVGSVGElement>), original: box, corner}); }} />;
                })}
              </g>;
            })}
            {draft && gesture?.kind === "draw" && <rect className="annotation-box draft" x={draft[0]} y={draft[1]} width={draft[2] - draft[0]} height={draft[3] - draft[1]} />}
            {shapeDraft.length >= 2 && (tool === "polygon" ? <polygon className="annotation-vector draft" points={svgPoints(shapeDraft)} /> : <polyline className="annotation-vector draft line" points={svgPoints(shapeDraft)} />)}
          </svg>
        </div>}
        <div className="annotation-timeline" aria-label="Annotation timeline"><div className="annotation-timeline-ruler"><span>0</span><i style={{left: `${Math.max(0, Math.min(100, (sampleIndex - 1) / Math.max(1, (project.sample_count || 1) - 1) * 100))}%`}} /><span>{project.sample_count || 0}</span></div>{(project.markers || []).slice(0, 12).map((marker) => { const total = Math.max(project.duration_seconds || (project.sample_count || 1) - 1, 1); const start = Number(marker.start_seconds || 0) / total * 100; const width = Math.max(.35, (Number(marker.end_seconds || 0) - Number(marker.start_seconds || 0)) / total * 100); return <button key={marker.id} className={selected.has(marker.id) ? "active" : ""} onClick={() => setSelected(new Set([marker.id]))}><span>#{marker.id}</span><b><i style={{left: `${start}%`, width: `${width}%`, background: colorFor(marker.source_track_id || marker.id)}} /></b></button>; })}</div>
        <footer className="annotation-stage-status"><span>{sample?.split || "Unspecified split"} · {Number(sample?.media_seconds || 0).toFixed(2)}s</span><span><Save size={13} />{message}</span></footer>
      </div>
      <aside className="object-inspector">
        <div className="pane-heading"><span>Objects in frame</span><Badge>{observations.length}</Badge></div>
        <div className="object-list">{observations.map(({trackId, observation, markerId, colorKey}) => <button key={trackId} className={selected.has(markerId) ? "active" : ""} onClick={(event) => setSelected((current) => { if (event.shiftKey) { const next = new Set(current); next.has(markerId) ? next.delete(markerId) : next.add(markerId); return next; } return new Set([markerId]); })}><i style={{background: colorFor(colorKey)}} /><div><strong>{observation.class_name || `Track ${markerId}`}</strong><small>{humanizeFormat(observation.geometry_type || "bbox")} · Track {observation.source_track_id || markerId} · {Math.round((observation.confidence || 0) * 100)}%</small></div>{observation.is_keyframe && <KeyRound size={13} />}</button>)}</div>
        <div className="object-actions">
          {selectedObservation && <label>Class<select value={String(selectedObservation.observation.class_id ?? "")} disabled={project.protected} onChange={(event) => void mutate({action: "set_class", marker_id: selectedObservation.markerId, class_id: Number(event.target.value)})}>{Object.entries(project.classes || {}).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>}
          <Button disabled={selected.size < 2 || project.protected} onClick={() => void mutate({action: "merge", marker_ids: [...selected]})}><Merge size={14} /> Merge tracks</Button>
          <Button variant="danger" disabled={selected.size !== 1 || project.protected} onClick={() => { const markerId = [...selected][0]; if (window.confirm(`Delete track ${markerId}?`)) void mutate({action: "delete_track", marker_id: markerId}); }}><Trash2 size={14} /> Delete track</Button>
        </div>
      </aside>
    </div>
  </div>;
}

function svgPoints(values: number[]) { return values.reduce<string[]>((points, value, index) => { if (index % 2 === 0) points.push(`${value},${values[index + 1]}`); return points; }, []).join(" "); }
function rotatedBoxPoints(values?: number[]) {
  if (!values) return [];
  if (values.length === 8) return values;
  if (values.length < 5) return [];
  const [cx, cy, width, height, angle] = values; const radians = angle * Math.PI / 180; const cosine = Math.cos(radians); const sine = Math.sin(radians);
  return [-width / 2, -height / 2, width / 2, -height / 2, width / 2, height / 2, -width / 2, height / 2].reduce<number[]>((points, value, index, corners) => { if (index % 2 === 0) { const x = value; const y = corners[index + 1]; points.push(cx + x * cosine - y * sine, cy + x * sine + y * cosine); } return points; }, []);
}
function humanizeFormat(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
