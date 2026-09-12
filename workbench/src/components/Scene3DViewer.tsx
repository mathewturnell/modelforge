import {useEffect, useMemo, useRef, useState} from "react";
import {Box, Rotate3D} from "lucide-react";
import {artifactUrl} from "../lib/api";
import {sceneAssetUrl, sceneLayerLabel, seriesMarkerColor, sparseScalarUsesMarkers, visibleSceneLayerIds} from "../lib/scene-3d";
import {Badge, Button, EmptyState, ErrorNotice, LoadingState} from "./ui";

type SceneMap = Record<string, any>;
export type SceneCamera = {azimuth: number; elevation: number; zoom: number};

export function sceneCameraAfterKey(key: string, camera: SceneCamera, initial: SceneCamera): SceneCamera | null {
  const orbit = 6;
  const zoom = 1.12;
  if (key === "ArrowLeft") return {...camera, azimuth: camera.azimuth - orbit};
  if (key === "ArrowRight") return {...camera, azimuth: camera.azimuth + orbit};
  if (key === "ArrowUp") return {...camera, elevation: Math.max(8, camera.elevation - orbit)};
  if (key === "ArrowDown") return {...camera, elevation: Math.min(78, camera.elevation + orbit)};
  if (key === "+" || key === "=") return {...camera, zoom: Math.min(2.6, camera.zoom * zoom)};
  if (key === "-") return {...camera, zoom: Math.max(.55, camera.zoom / zoom)};
  if (key === "0") return initial;
  return null;
}

function numbers(value: unknown): number[] {
  return Array.isArray(value) ? value.flat(Infinity).map(Number) : [];
}

function boundaryCandidates(path: string): string[] {
  const candidates = [path];
  const marker = path.lastIndexOf("/boundaries/");
  if (marker >= 0) candidates.push(path.slice(marker + 1));
  return [...new Set(candidates.filter(Boolean))];
}

function temperatureColor(value: number, minimum: number, maximum: number, alpha = .82): string {
  const ratio = Math.max(0, Math.min(1, (value - minimum) / Math.max(1e-9, maximum - minimum)));
  const stops = [[16, 59, 134], [19, 146, 196], [72, 190, 155], [236, 201, 72], [211, 72, 55]];
  const scaled = ratio * (stops.length - 1);
  const left = Math.min(stops.length - 2, Math.floor(scaled));
  const mix = scaled - left;
  const color = stops[left].map((channel, index) => Math.round(channel + (stops[left + 1][index] - channel) * mix));
  return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
}

export function Scene3DViewer({src, title}: {src: string; title: string}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{x: number; y: number} | null>(null);
  const [scene, setScene] = useState<SceneMap | null>(null);
  const [map, setMap] = useState<SceneMap | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [azimuth, setAzimuth] = useState(-24);
  const [elevation, setElevation] = useState(36);
  const [zoom, setZoom] = useState(1);
  const [time, setTime] = useState(0);
  const [seriesId, setSeriesId] = useState("");
  const [visibleLevels, setVisibleLevels] = useState<number[]>([]);
  const [visibleLayers, setVisibleLayers] = useState<string[]>([]);
  const [size, setSize] = useState({width: 900, height: 560});

  useEffect(() => {
    let active = true;
    setLoading(true); setError(""); setScene(null); setMap(null);
    void fetch(src, {cache: "no-store"}).then(async (response) => {
      if (!response.ok) throw new Error(`Could not load the registered 3D scene (${response.status})`);
      const next = await response.json();
      if (next?.format !== "modelforge.scene-3d/v1" || next?.profile !== "temporal_geospatial_layered_grid") {
        throw new Error("This artifact is not a supported ModelForge temporal geospatial 3D scene.");
      }
      if (!active) return;
      setScene(next);
      setAzimuth(Number(next.camera?.initial_azimuth_degrees ?? -24));
      setElevation(Number(next.camera?.initial_elevation_degrees ?? 36));
      setSeriesId(String(next.series?.[0]?.id || ""));
      setVisibleLevels(numbers(next.grid?.level_hpa));
      setVisibleLayers(visibleSceneLayerIds(Array.isArray(next.layers) ? next.layers : []));
      const mapPath = String(next.layers?.find((layer: SceneMap) => layer.kind === "polygon_map")?.source?.path || "");
      const retainedAsset = sceneAssetUrl(src, mapPath);
      const candidates = [retainedAsset, ...boundaryCandidates(mapPath).map((candidate) => artifactUrl("raw", candidate))].filter(Boolean);
      for (const candidate of candidates) {
        try {
          const boundaryResponse = await fetch(candidate, {cache: "no-store"});
          if (!boundaryResponse.ok) continue;
          const boundaries = await boundaryResponse.json();
          if (active) setMap(boundaries);
          break;
        } catch { /* Try the next safe catalog-relative candidate. */ }
      }
    }).catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [src]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(([entry]) => setSize({
      width: Math.max(520, Math.round(entry.contentRect.width)),
      height: Math.max(420, Math.round(entry.contentRect.height)),
    }));
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [scene]);

  const series = useMemo(() => scene?.series?.find((item: SceneMap) => String(item.id) === seriesId) || scene?.series?.[0], [scene, seriesId]);
  const levels = numbers(scene?.grid?.level_hpa);
  const timestamps = Array.isArray(series?.timestamps) ? series.timestamps.map(String) : [];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !scene || !series) return;
    const width = size.width; const height = size.height;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
    const context = canvas.getContext("2d"); if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const background = context.createRadialGradient(width * .5, height * .45, 10, width * .5, height * .5, Math.max(width, height) * .7);
    background.addColorStop(0, "#102331"); background.addColorStop(1, "#03070b");
    context.fillStyle = background; context.fillRect(0, 0, width, height);

    const longitudes = numbers(scene.grid?.longitude); const latitudes = numbers(scene.grid?.latitude);
    if (!longitudes.length || !latitudes.length || !levels.length) return;
    const domain = scene.coordinate_system?.domain || {};
    const west = Number(domain.west ?? Math.min(...longitudes)); const east = Number(domain.east ?? Math.max(...longitudes));
    const south = Number(domain.south ?? Math.min(...latitudes)); const north = Number(domain.north ?? Math.max(...latitudes));
    const centerLat = Number(scene.coordinate_system?.display_projection?.standard_parallel ?? (south + north) / 2);
    const xScale = Math.cos(centerLat * Math.PI / 180);
    const yaw = azimuth * Math.PI / 180; const pitch = elevation * Math.PI / 180;
    const project = (longitude: number, latitude: number, vertical: number) => {
      const x = (((longitude - west) / Math.max(1e-9, east - west)) - .5) * 2 * xScale;
      const z = (((latitude - south) / Math.max(1e-9, north - south)) - .5) * 1.35;
      const y = vertical;
      const rx = x * Math.cos(yaw) - z * Math.sin(yaw);
      const rz0 = x * Math.sin(yaw) + z * Math.cos(yaw);
      const ry = y * Math.cos(pitch) - rz0 * Math.sin(pitch);
      const rz = y * Math.sin(pitch) + rz0 * Math.cos(pitch);
      const perspective = (Math.min(width, height) * .62 * zoom) / Math.max(1.8, 4.3 - rz);
      return {x: width * .5 + rx * perspective, y: height * .58 - ry * perspective, depth: rz};
    };
    const levelHeight = (level: number) => .28 + (levels.length - 1 - levels.indexOf(level)) * .43;

    const features = Array.isArray(map?.features) ? map.features : [];
    const mapShapes: Array<{points: ReturnType<typeof project>[]; depth: number; name: string}> = [];
    features.forEach((feature: SceneMap) => {
      const geometry = feature.geometry || {};
      const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
      polygons.forEach((polygon: any[]) => {
        const ring = Array.isArray(polygon?.[0]) ? polygon[0] : [];
        const points = ring.map((point: number[]) => project(Number(point[0]), Number(point[1]), 0));
        if (points.length >= 3) mapShapes.push({points, depth: points.reduce((sum, point) => sum + point.depth, 0) / points.length, name: String(feature.properties?.ADMIN || feature.properties?.NAME || feature.properties?.name || "")});
      });
    });
    mapShapes.sort((a, b) => a.depth - b.depth).forEach((shape) => {
      context.beginPath(); shape.points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)); context.closePath();
      context.fillStyle = "rgba(22, 49, 62, .96)"; context.strokeStyle = "rgba(150, 181, 194, .72)"; context.lineWidth = 1;
      context.fill(); context.stroke();
    });

    const frame = numbers(series.values?.[Math.min(time, Math.max(0, series.values?.length - 1))]);
    const channels = Array.isArray(scene.grid?.channels) ? scene.grid.channels.map(String) : [];
    const layers = Array.isArray(scene.layers) ? scene.layers : [];
    const layerId = (layer: SceneMap, index: number) => String(layer.id || `${layer.kind || "layer"}-${index}`);
    const activeLayers = layers.filter((layer: SceneMap, index: number) => layer.kind === "polygon_map" || visibleLayers.includes(layerId(layer, index)));
    const valueAt = (levelIndex: number, latIndex: number, lonIndex: number, channel: number) => frame[(((levelIndex * latitudes.length + latIndex) * longitudes.length + lonIndex) * channels.length) + channel];
    const scalarLayers = activeLayers.filter((layer: SceneMap) => layer.kind === "scalar_surfaces");
    const legendLayers: SceneMap[] = [];
    scalarLayers.forEach((scalar: SceneMap, scalarIndex: number) => {
      const channel = channels.indexOf(String(scalar.channel || ""));
      if (channel < 0) return;
      const minimum = Number(scalar.legend?.minimum ?? 0); const maximum = Number(scalar.legend?.maximum ?? 1);
      const opacity = Math.max(0.05, Math.min(1, Number(scalar.style?.opacity ?? (scalarIndex ? .58 : .82))));
      const populated: Array<{levelIndex: number; row: number; column: number; value: number; normalized: number}> = [];
      levels.forEach((_level, levelIndex) => latitudes.forEach((_latitude, row) => longitudes.forEach((_longitude, column) => {
        const value = valueAt(levelIndex, row, column, channel);
        const normalized = Math.max(0, Math.min(1, (value - minimum) / Math.max(1e-9, maximum - minimum)));
        if (Number.isFinite(value) && normalized > .001) populated.push({levelIndex, row, column, value, normalized});
      })));
      const sparse = sparseScalarUsesMarkers(populated.length, levels.length * latitudes.length * longitudes.length, scalarIndex);
      if (sparse) {
        const markerColor = seriesMarkerColor(scalar, series.role);
        const threshold = Math.max(0, Math.min(1, Number(scalar.style?.threshold ?? .5)));
        populated.filter((item) => item.normalized >= threshold && visibleLevels.includes(levels[item.levelIndex])).forEach((item) => {
          const point = project(longitudes[item.column], latitudes[item.row], levelHeight(levels[item.levelIndex]) + .04 + scalarIndex * .012);
          const radius = 4 + item.normalized * 5;
          context.beginPath(); context.arc(point.x, point.y, radius + 3, 0, Math.PI * 2); context.fillStyle = "rgba(3,8,12,.78)"; context.fill();
          context.beginPath(); context.arc(point.x, point.y, radius, 0, Math.PI * 2); context.fillStyle = markerColor; context.fill(); context.strokeStyle = "rgba(255,255,255,.96)"; context.lineWidth = 1.5; context.stroke();
        });
      } else {
        const faces: Array<{points: ReturnType<typeof project>[]; value: number; depth: number; normalized: number}> = [];
        levels.forEach((level, levelIndex) => {
          if (!visibleLevels.includes(level)) return;
          for (let row = 0; row < latitudes.length - 1; row += 1) for (let column = 0; column < longitudes.length - 1; column += 1) {
            const value = valueAt(levelIndex, row, column, channel);
            const normalized = Math.max(0, Math.min(1, (value - minimum) / Math.max(1e-9, maximum - minimum)));
            if (scalarIndex > 0 && normalized <= .001) continue;
            const points = [[column, row], [column + 1, row], [column + 1, row + 1], [column, row + 1]].map(([x, y]) => project(longitudes[x], latitudes[y], levelHeight(level) + scalarIndex * .012));
            faces.push({points, value, normalized, depth: points.reduce((sum, point) => sum + point.depth, 0) / 4});
          }
        });
        faces.sort((a, b) => a.depth - b.depth).forEach((face) => {
          context.beginPath(); face.points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)); context.closePath();
          context.fillStyle = temperatureColor(face.value, minimum, maximum, scalarIndex ? opacity * Math.max(.12, face.normalized) : opacity); context.strokeStyle = scalarIndex ? "rgba(225,244,250,.08)" : "rgba(225,244,250,.18)"; context.lineWidth = .55; context.fill(); context.stroke();
        });
        legendLayers.push(scalar);
      }
    });

    activeLayers.filter((layer: SceneMap) => layer.kind === "point_markers").forEach((layer: SceneMap, markerIndex: number) => {
      const channel = channels.indexOf(String(layer.channel || "")); if (channel < 0) return;
      const threshold = Math.max(0, Math.min(1, Number(layer.threshold ?? layer.style?.threshold ?? .5)));
      const markerColor = seriesMarkerColor(layer, series.role);
      levels.forEach((level, levelIndex) => {
        if (!visibleLevels.includes(level)) return;
        latitudes.forEach((_latitude, row) => longitudes.forEach((_longitude, column) => {
          const score = valueAt(levelIndex, row, column, channel); if (!Number.isFinite(score) || score < threshold) return;
          const point = project(longitudes[column], latitudes[row], levelHeight(level) + .07 + markerIndex * .012);
          const radius = 5 + Math.min(1, score) * 5;
          context.beginPath(); context.arc(point.x, point.y, radius + 3, 0, Math.PI * 2); context.fillStyle = "rgba(3,8,12,.78)"; context.fill();
          context.beginPath(); context.arc(point.x, point.y, radius, 0, Math.PI * 2); context.fillStyle = markerColor; context.fill(); context.strokeStyle = "white"; context.lineWidth = 1.5; context.stroke();
        }));
      });
    });

    activeLayers.filter((layer: SceneMap) => layer.kind === "vector_field").forEach((layer: SceneMap) => {
      const components = Array.isArray(layer.components) ? layer.components.map(String) : [];
      const uChannel = channels.indexOf(components[0]); const vChannel = channels.indexOf(components[1]);
      if (uChannel < 0 || vChannel < 0) return;
      const rowStride = Math.max(1, Number(layer.sampling?.latitude_stride || 2)); const columnStride = Math.max(1, Number(layer.sampling?.longitude_stride || 4));
      levels.forEach((level, levelIndex) => {
        if (!visibleLevels.includes(level)) return;
        for (let row = 1; row < latitudes.length; row += rowStride) for (let column = 1; column < longitudes.length; column += columnStride) {
          const start = project(longitudes[column], latitudes[row], levelHeight(level) + .025);
          const u = valueAt(levelIndex, row, column, uChannel); const v = valueAt(levelIndex, row, column, vChannel);
          if (!Number.isFinite(u) || !Number.isFinite(v)) continue;
          const magnitude = Math.max(1, Math.hypot(u, v)); const length = Math.min(18, 5 + magnitude * .13);
          const endX = start.x + u / magnitude * length; const endY = start.y - v / magnitude * length;
          context.strokeStyle = String(layer.style?.color || "rgba(248,252,255,.9)"); context.lineWidth = 1; context.beginPath(); context.moveTo(start.x, start.y); context.lineTo(endX, endY); context.stroke();
        }
      });
    });

    mapShapes.forEach((shape) => {
      context.beginPath(); shape.points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y)); context.closePath();
      context.strokeStyle = "rgba(214,232,238,.88)"; context.lineWidth = 1.15; context.stroke();
    });

    const labels = mapShapes.filter((shape) => shape.name).sort((a, b) => b.points.length - a.points.length).slice(0, 22);
    context.font = "600 10px ui-monospace, monospace"; context.textAlign = "center"; context.textBaseline = "middle";
    labels.forEach((shape) => {
      const point = shape.points.reduce((total, item) => ({x: total.x + item.x / shape.points.length, y: total.y + item.y / shape.points.length}), {x: 0, y: 0});
      context.fillStyle = "rgba(3,8,12,.8)"; context.fillText(shape.name, point.x + 1, point.y + 1); context.fillStyle = "rgba(221,238,244,.92)"; context.fillText(shape.name, point.x, point.y);
    });

    context.textAlign = "left"; context.textBaseline = "alphabetic"; context.fillStyle = "#eaf7fb"; context.font = "700 14px ui-monospace, monospace"; context.fillText(String(scene.name || title), 18, 25);
    context.fillStyle = "#78e5d4"; context.font = "600 11px ui-monospace, monospace"; context.fillText(`${String(series.label || series.id)} · ${timestamps[time] || `step ${time + 1}`}`, 18, 43);
    levels.forEach((level) => { if (!visibleLevels.includes(level)) return; const point = project(east, north, levelHeight(level)); context.fillStyle = "#f3f7f8"; context.fillText(`layer ${level} hPa`, point.x - 80, point.y - 5); });
    legendLayers.slice(0, 3).forEach((layer, index) => {
      const minimum = Number(layer.legend?.minimum ?? 0); const maximum = Number(layer.legend?.maximum ?? 1);
      const legendX = 18; const legendY = height - 34 - index * 28; const gradient = context.createLinearGradient(legendX, 0, legendX + 210, 0);
      [0, .25, .5, .75, 1].forEach((stop) => gradient.addColorStop(stop, temperatureColor(minimum + stop * (maximum - minimum), minimum, maximum, 1)));
      context.fillStyle = gradient; context.fillRect(legendX, legendY, 210, 10); context.fillStyle = "#dce9ed"; context.font = "10px ui-monospace, monospace";
      context.fillText(`${sceneLayerLabel(layer)} · ${minimum} ${String(layer.units || "")}`, legendX, legendY - 5);
      context.fillText(`${maximum} ${String(layer.units || "")}`, legendX + 150, legendY - 5);
    });
    context.fillStyle = "#8ba1aa"; context.fillText("drag: orbit · wheel: zoom · categorical pressure height", width - 390, height - 14);
  }, [scene, map, series, time, visibleLevels.join(","), visibleLayers.join(","), azimuth, elevation, zoom, size, title]);

  if (loading) return <LoadingState label="Loading registered 3D scene…" />;
  if (error) return <ErrorNotice message={error} />;
  if (!scene || !series) return <EmptyState icon={<Box />} title="No compatible 3D scene" description="The standard viewer could not resolve a scene series." />;
  const toggleLevel = (level: number) => setVisibleLevels((current) => current.includes(level) ? current.filter((item) => item !== level) : [...current, level]);
  const sceneLayers = Array.isArray(scene.layers) ? scene.layers : [];
  const toggleLayer = (id: string) => setVisibleLayers((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  return <section className="scene-3d-viewer" aria-label={title}>
    <header><div><Badge tone="success">3D scene</Badge><strong>{title}</strong><small>{scene.coordinate_system?.horizontal_crs || "Coordinate system unavailable"} · {scene.profile}</small></div><Button size="sm" onClick={() => {setAzimuth(Number(scene.camera?.initial_azimuth_degrees ?? -24)); setElevation(Number(scene.camera?.initial_elevation_degrees ?? 36)); setZoom(1);}}><Rotate3D size={13} /> Reset view</Button></header>
    <div className="scene-3d-controls">
      <label>Series<select value={seriesId} onChange={(event) => setSeriesId(event.target.value)}>{scene.series.map((item: SceneMap) => <option key={String(item.id)} value={String(item.id)}>{String(item.label || item.id)}</option>)}</select></label>
      <label>Time<input type="range" min="0" max={Math.max(0, timestamps.length - 1)} value={Math.min(time, Math.max(0, timestamps.length - 1))} onChange={(event) => setTime(Number(event.target.value))} /><span>{Math.min(time + 1, timestamps.length)}/{timestamps.length}</span></label>
      <fieldset><legend>Pressure levels</legend>{levels.map((level) => <label key={level}><input type="checkbox" checked={visibleLevels.includes(level)} onChange={() => toggleLevel(level)} /> {level} hPa</label>)}</fieldset>
      <fieldset><legend>Layers</legend>{sceneLayers.flatMap((layer: SceneMap, index: number) => {
        if (layer.kind === "polygon_map") return [];
        const id = String(layer.id || `${layer.kind || "layer"}-${index}`);
        return [<label key={id}><input type="checkbox" checked={visibleLayers.includes(id)} onChange={() => toggleLayer(id)} /> {sceneLayerLabel(layer)}</label>];
      })}</fieldset>
    </div>
    <canvas
      ref={canvasRef}
      tabIndex={0}
      aria-label={`${title} interactive 3D scene. Use arrow keys to orbit, plus and minus to zoom, and 0 to reset.`}
      onPointerDown={(event) => {dragRef.current = {x: event.clientX, y: event.clientY}; event.currentTarget.setPointerCapture(event.pointerId);}}
      onPointerMove={(event) => {if (!dragRef.current) return; const dx = event.clientX - dragRef.current.x; const dy = event.clientY - dragRef.current.y; dragRef.current = {x: event.clientX, y: event.clientY}; setAzimuth((value) => value + dx * .35); setElevation((value) => Math.max(8, Math.min(78, value + dy * .28)));}}
      onPointerUp={() => {dragRef.current = null;}}
      onWheel={(event) => {event.preventDefault(); setZoom((value) => Math.max(.55, Math.min(2.6, value * (event.deltaY > 0 ? .9 : 1.1))));}}
      onKeyDown={(event) => {
        const next = sceneCameraAfterKey(
          event.key,
          {azimuth, elevation, zoom},
          {azimuth: Number(scene.camera?.initial_azimuth_degrees ?? -24), elevation: Number(scene.camera?.initial_elevation_degrees ?? 36), zoom: 1},
        );
        if (!next) return;
        event.preventDefault();
        setAzimuth(next.azimuth); setElevation(next.elevation); setZoom(next.zoom);
      }}
    />
    <p className="scene-3d-help">Drag or arrow keys to orbit · wheel or +/− to zoom · 0 to reset · pressure height is categorical, not metric</p>
    {!map && <div className="scene-3d-map-warning">Country geometry is unavailable; atmospheric surfaces remain interactive.</div>}
  </section>;
}
