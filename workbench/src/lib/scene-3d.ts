export type SceneLayer = Record<string, any>;

const PLACEHOLDER_ORIGIN = "http://modelforge.local";

export function safeSceneAssetPath(value: unknown): string {
  const path = String(value || "").trim().replaceAll("\\", "/");
  if (!path || path.startsWith("/") || path.split("/").some((part) => !part || part === "." || part === "..")) return "";
  return path;
}

export function sceneAssetUrl(sceneSource: string, assetPath: unknown): string {
  const path = safeSceneAssetPath(assetPath);
  if (!path) return "";
  const source = new URL(sceneSource, PLACEHOLDER_ORIGIN);
  const live = source.pathname === "/api/inference/result/scene";
  const retained = source.pathname.match(/^\/api\/jobs\/([A-Za-z0-9._-]+)\/artifacts\/[A-Za-z0-9._-]+\/view$/);
  let target: URL | null = null;
  if (live) {
    target = new URL("/api/inference/result/scene-asset", source.origin);
    target.searchParams.set("run_id", source.searchParams.get("run_id") || "");
  } else if (retained) {
    target = new URL(`/api/jobs/${encodeURIComponent(retained[1])}/scene-asset`, source.origin);
  }
  if (!target) return "";
  target.searchParams.set("path", path);
  return target.origin === PLACEHOLDER_ORIGIN ? `${target.pathname}${target.search}` : target.toString();
}

export function sceneLayerLabel(layer: SceneLayer): string {
  return String(layer.label || layer.name || layer.id || layer.channel || layer.kind || "Layer").replaceAll("_", " ");
}

export function visibleSceneLayerIds(layers: SceneLayer[]): string[] {
  return layers.flatMap((layer, index) => {
    if (!layer || layer.kind === "polygon_map" || layer.visible === false) return [];
    return [String(layer.id || `${layer.kind || "layer"}-${index}`)];
  });
}

export function sparseScalarUsesMarkers(populatedCells: number, totalCells: number, scalarIndex: number): boolean {
  if (scalarIndex <= 0 || populatedCells <= 0 || totalCells <= 0) return false;
  return populatedCells <= Math.max(8, Math.ceil(totalCells * .01));
}

export function seriesMarkerColor(layer: SceneLayer, role: unknown): string {
  const normalizedRole = String(role || "").toLowerCase();
  return String(
    layer.style?.[`${normalizedRole}_color`]
    || layer.style?.color
    || (normalizedRole === "reference" ? "#59f0a6" : normalizedRole === "prediction" ? "#ffd166" : "#72e6ff"),
  );
}
