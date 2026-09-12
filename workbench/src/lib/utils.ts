import {clsx, type ClassValue} from "clsx";
import {twMerge} from "tailwind-merge";
import type {MetricPoint, RunRecord} from "../types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(value = 0): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const order = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** order).toFixed(order ? 1 : 0)} ${units[order]}`;
}

export function compactNumber(value: number | undefined): string {
  return new Intl.NumberFormat(undefined, {notation: "compact", maximumFractionDigits: 1}).format(Number(value || 0));
}

export function formatDate(value: unknown): string {
  if (!value) return "Unknown date";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString([], {dateStyle: "medium", timeStyle: "short"});
}

export function humanize(value: unknown): string {
  return String(value ?? "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function statusTone(value: unknown): "success" | "warning" | "danger" | "neutral" | "active" {
  const status = String(value || "").toLowerCase();
  if (["complete", "completed", "ready", "eligible", "passed", "clean", "running"].includes(status)) return status === "running" ? "active" : "success";
  if (["failed", "error", "blocked", "rejected"].includes(status)) return "danger";
  if (["queued", "pending", "incomplete", "cancelled", "canceled"].includes(status)) return "warning";
  return "neutral";
}

function numericPoints(value: unknown): MetricPoint[] {
  if ((typeof value === "number" || (typeof value === "string" && value.trim())) && Number.isFinite(Number(value))) return [{step: 0, value: Number(value)}];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    if (typeof item === "number" && Number.isFinite(item)) return [{step: index, value: item}];
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const number = Number(row.value ?? row.y ?? row.metric);
    const step = Number(row.step ?? row.epoch ?? row.x ?? index);
    return Number.isFinite(number) && Number.isFinite(step) ? [{step, value: number}] : [];
  });
}

export function runMetricSeries(run: RunRecord): Record<string, MetricPoint[]> {
  const result: Record<string, MetricPoint[]> = {};
  const sources = [run.metrics, run.history, run.metric_series, run.curves];
  for (const source of sources) {
    if (!source || typeof source !== "object" || Array.isArray(source)) continue;
    for (const [name, value] of Object.entries(source as Record<string, unknown>)) {
      const points = numericPoints(value);
      if (points.length) result[name] = points;
      else if (value && typeof value === "object" && !Array.isArray(value)) {
        const nested = numericPoints((value as Record<string, unknown>).values ?? (value as Record<string, unknown>).points);
        if (nested.length) result[name] = nested;
      }
    }
  }
  return result;
}

export function runConfiguration(run: RunRecord): Record<string, unknown> {
  const explicit = run.configuration && typeof run.configuration === "object" ? run.configuration : {};
  const inline = Object.fromEntries(
    ["model", "workflow", "provider", "compute_target", "device", "imgsz", "batch", "epochs_expected"]
      .filter((key) => run[key] !== undefined)
      .map((key) => [key, run[key]]),
  );
  return {...inline, ...explicit};
}

export function languageForPath(path: string): string {
  const extension = path.split(".").pop()?.toLowerCase();
  return ({
    py: "python", ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    json: "json", yaml: "yaml", yml: "yaml", md: "markdown", html: "html", css: "css",
    sh: "shell", toml: "ini", xml: "xml", csv: "plaintext", txt: "plaintext",
  } as Record<string, string>)[extension || ""] || "plaintext";
}
