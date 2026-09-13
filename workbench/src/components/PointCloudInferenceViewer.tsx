import {useEffect, useMemo, useRef, useState} from "react";
import {Crosshair, RotateCcw} from "lucide-react";
import type {JsonMap} from "../types";
import {Button} from "./ui";

type PointCloud = JsonMap & {
  positions?: number[];
  colors?: number[];
  anomaly?: number[];
  axes?: string[];
  point_count?: number;
  source_point_count?: number;
  anomaly_range?: JsonMap;
  spatial_score_coordinates?: JsonMap;
};

function triplet(values: number[], index: number): [number, number, number] {
  return [Number(values[index * 3] || 0), Number(values[index * 3 + 1] || 0), Number(values[index * 3 + 2] || 0)];
}

function heatColor(value: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, value / 255));
  const red = Math.max(0, Math.min(255, 420 * t - 40));
  const green = Math.max(0, Math.min(255, 420 - Math.abs(t - .5) * 700));
  const blue = Math.max(0, Math.min(255, 320 - 430 * t));
  return [red, green, blue];
}

function coordinateLabel(label: string, value: unknown, axes: string[]): string {
  const position = Array.isArray(value) ? value : [];
  const location = position.slice(0, 3).map((entry, index) => `${axes[index] || "xyz"[index]} ${Number(entry).toPrecision(5)}`).join(" · ");
  return `${label}: ${location}`;
}

export function PointCloudInferenceViewer({cloud, title = "3D anomaly heatmap"}: {cloud: PointCloud; title?: string}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const drag = useRef<{x: number; y: number} | null>(null);
  const [mode, setMode] = useState<"anomaly" | "rgb">(Array.isArray(cloud.anomaly) ? "anomaly" : "rgb");
  const [camera, setCamera] = useState({yaw: 0, pitch: 0, zoom: 1});
  const [size, setSize] = useState({width: 800, height: 520});
  const positions = Array.isArray(cloud.positions) ? cloud.positions.map(Number) : [];
  const colors = Array.isArray(cloud.colors) ? cloud.colors.map(Number) : [];
  const anomaly = Array.isArray(cloud.anomaly) ? cloud.anomaly.map(Number) : [];
  const count = Math.min(Math.floor(positions.length / 3), Number(cloud.point_count || Number.MAX_SAFE_INTEGER));
  const axes = Array.isArray(cloud.axes) && cloud.axes.length === 3 ? cloud.axes.map(String) : ["x", "y", "z"];
  const coordinates = cloud.spatial_score_coordinates && typeof cloud.spatial_score_coordinates === "object" ? cloud.spatial_score_coordinates : {};
  const coordinateAxes = Array.isArray(coordinates.axes) && coordinates.axes.length === 3 ? coordinates.axes.map(String) : axes;
  const coordinateUnit = coordinates.unit_declared === true && String(coordinates.unit || "").trim() ? String(coordinates.unit) : "";
  const peak = coordinates.peak && typeof coordinates.peak === "object" ? coordinates.peak as JsonMap : {};
  const highScoreRegion = coordinates.high_score_region && typeof coordinates.high_score_region === "object" ? coordinates.high_score_region as JsonMap : {};
  const range = cloud.anomaly_range && typeof cloud.anomaly_range === "object" ? cloud.anomaly_range : {};

  const points = useMemo(() => Array.from({length: count}, (_, index) => triplet(positions, index)), [positions.join("|"), count]);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setSize({
      width: Math.max(1, Math.round(entry.contentRect.width)),
      height: Math.max(1, Math.round(entry.contentRect.height)),
    }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = canvas.current;
    if (!element || !points.length) return;
    const ratio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = Math.max(1, Math.floor(size.width));
    const height = Math.max(1, Math.floor(size.height));
    element.width = Math.floor(width * ratio); element.height = Math.floor(height * ratio);
    const context = element.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const background = context.createRadialGradient(width * .5, height * .45, 20, width * .5, height * .5, width * .7);
    background.addColorStop(0, "#12232d"); background.addColorStop(1, "#020608");
    context.fillStyle = background; context.fillRect(0, 0, width, height);
    const cy = Math.cos(camera.yaw), sy = Math.sin(camera.yaw);
    const cp = Math.cos(camera.pitch), sp = Math.sin(camera.pitch);
    const projected = points.map(([px, py, pz], index) => {
      const x1 = px * cy + pz * sy;
      const z1 = -px * sy + pz * cy;
      const y1 = py * cp - z1 * sp;
      const z2 = py * sp + z1 * cp;
      const perspective = 1 / Math.max(.55, 1.8 - z2);
      const extent = Math.min(width, height) * 1.35 * camera.zoom;
      return {index, x: width / 2 + x1 * perspective * extent, y: height / 2 - y1 * perspective * extent, z: z2};
    }).sort((a, b) => a.z - b.z);
    for (const point of projected) {
      if (point.x < 0 || point.x >= width || point.y < 0 || point.y >= height) continue;
      const color = mode === "anomaly" && anomaly.length === count
        ? heatColor(anomaly[point.index])
        : triplet(colors, point.index);
      context.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
      context.globalAlpha = mode === "anomaly" ? .92 : .82;
      context.beginPath(); context.arc(point.x, point.y, mode === "anomaly" ? 1.75 : 1.45, 0, Math.PI * 2); context.fill();
    }
    context.globalAlpha = 1;
  }, [points, colors.join("|"), anomaly.join("|"), camera, mode, count, size]);

  return <section className="point-cloud-inference-viewer" aria-label={title}>
    <header><div><strong>{title}</strong><small>{count.toLocaleString()} of {Number(cloud.source_point_count || count).toLocaleString()} valid XYZ points</small></div><div className="point-cloud-mode" role="group" aria-label="Point-cloud coloring"><Button size="sm" variant={mode === "anomaly" ? "primary" : undefined} disabled={!anomaly.length} onClick={() => setMode("anomaly")}>Failure heatmap</Button><Button size="sm" variant={mode === "rgb" ? "primary" : undefined} onClick={() => setMode("rgb")}>RGB</Button><Button size="sm" aria-label="Reset 3D view" onClick={() => setCamera({yaw: 0, pitch: 0, zoom: 1})}><RotateCcw size={13} /></Button></div></header>
    <canvas
      ref={canvas}
      tabIndex={0}
      aria-label="Interactive XYZ point cloud with anomaly-score coloring"
      onPointerDown={(event) => {
        drag.current = {x: event.clientX, y: event.clientY};
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current) return;
        const dx = event.clientX - drag.current.x, dy = event.clientY - drag.current.y;
        drag.current = {x: event.clientX, y: event.clientY};
        setCamera((value) => ({
          ...value,
          yaw: value.yaw + dx * .008,
          pitch: Math.max(-1.45, Math.min(1.45, value.pitch + dy * .008)),
        }));
      }}
      onPointerUp={() => { drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}
      onWheel={(event) => {
        event.preventDefault();
        setCamera((value) => ({
          ...value,
          zoom: Math.max(.3, Math.min(6, value.zoom * (event.deltaY < 0 ? 1.1 : .9))),
        }));
      }}
      onKeyDown={(event) => {
        const rotation = .12, zoom = 1.12;
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "=", "-", "0"].includes(event.key)) return;
        event.preventDefault();
        if (event.key === "0") { setCamera({yaw: 0, pitch: 0, zoom: 1}); return; }
        setCamera((value) => ({
          yaw: value.yaw + (event.key === "ArrowLeft" ? -rotation : event.key === "ArrowRight" ? rotation : 0),
          pitch: Math.max(-1.45, Math.min(1.45, value.pitch + (event.key === "ArrowUp" ? -rotation : event.key === "ArrowDown" ? rotation : 0))),
          zoom: Math.max(.3, Math.min(6, value.zoom * (["+", "="].includes(event.key) ? zoom : event.key === "-" ? 1 / zoom : 1))),
        }));
      }}
    />
    <footer><span>Drag or arrow keys to orbit · wheel or +/− to zoom · 0 to reset · axes {axes.join(" / ")}</span>{anomaly.length > 0 && <span>Display range {Number(range.minimum || 0).toPrecision(4)}–{Number(range.maximum || 0).toPrecision(4)} · {String(range.normalization || "model score")}</span>}</footer>
    {coordinates.status === "available" && <details className="point-cloud-coordinates" open><summary><Crosshair size={13} /> Highest-scoring physical coordinates</summary><span>Source coordinate unit: {coordinateUnit || "undeclared"}</span>{Array.isArray(peak.position) && <code>{coordinateLabel("Peak", peak.position, coordinateAxes)}{coordinateUnit ? ` ${coordinateUnit}` : ""}{Number.isFinite(Number(peak.source_score)) ? ` · model score ${Number(peak.source_score).toPrecision(4)}` : ""} · display score {Number(peak.display_score || 0).toPrecision(4)}</code>}{Array.isArray(coordinates.weighted_centroid) && <code>{coordinateLabel("Score-weighted center", coordinates.weighted_centroid, coordinateAxes)}{coordinateUnit ? ` ${coordinateUnit}` : ""}</code>}{Array.isArray(highScoreRegion.centroid) && <code>{coordinateLabel(`High-score region center (${Number(highScoreRegion.coordinate_count || 0).toLocaleString()} points)`, highScoreRegion.centroid, coordinateAxes)}{coordinateUnit ? ` ${coordinateUnit}` : ""}</code>}<small>Coordinates use the source XYZ frame. Heat colors are display-normalized spatial scores, not the calibrated sample operating point.</small></details>}
  </section>;
}
