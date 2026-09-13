import {Activity, AlertTriangle, Cpu, Gauge, HardDrive, RefreshCw, Server, Waves} from "lucide-react";
import {api} from "../lib/api";
import {humanize, statusTone} from "../lib/utils";
import type {JsonMap, Project} from "../types";
import {useRequest} from "../hooks/use-request";
import {Badge, Button, Card, EmptyState, LoadingState, SectionHeader} from "../components/ui";

function valueAt(data: JsonMap | null, ...keys: string[]): unknown {
  let value: unknown = data;
  for (const key of keys) value = value && typeof value === "object" ? (value as JsonMap)[key] : undefined;
  return value;
}

export function MonitorView({project, embedded = false}: {project: Project; embedded?: boolean}) {
  const system = useRequest(() => api.systemMetrics(), [project.id]);
  const inference = useRequest(() => api.inferenceStatus(), [project.id]);
  if ((system.loading || inference.loading) && !system.data) return <LoadingState label="Reading local runtime telemetry…" />;
  const progress = (inference.data?.progress && typeof inference.data.progress === "object" ? inference.data.progress : {}) as JsonMap;
  const running = Boolean(inference.data?.running || inference.data?.starting);
  const cards = [
    {label: "Runtime", value: running ? "Running" : "Idle", detail: String(progress.stage || "No active inference"), icon: <Server />, tone: running ? "active" : "neutral"},
    {label: "CPU", value: `${Number(valueAt(system.data, "cpu", "percent") || system.data?.cpu_percent || 0).toFixed(0)}%`, detail: "Local utilization", icon: <Cpu />, tone: "neutral"},
    {label: "Memory", value: `${Number(valueAt(system.data, "memory", "percent") || system.data?.memory_percent || 0).toFixed(0)}%`, detail: "Local utilization", icon: <Gauge />, tone: "neutral"},
    {label: "Progress", value: `${Number(progress.percent || 0).toFixed(0)}%`, detail: `${Number(progress.completed || 0).toLocaleString()} / ${Number(progress.total || 0).toLocaleString()}`, icon: <Activity />, tone: running ? "active" : "neutral"},
  ];
  const log = (inference.data?.log && typeof inference.data.log === "object" ? inference.data.log : {}) as JsonMap;
  const entries = (Array.isArray(log.entries) ? log.entries : []).slice(-30) as JsonMap[];
  return <section className={`${embedded ? "monitor-workspace-embedded " : "document-scroll "}monitor-workspace`}>
    <SectionHeader eyebrow="Observability" title="Runtime monitoring" description="Honest local job, inference and system telemetry from existing ModelForge services." actions={<Button onClick={() => void Promise.all([system.reload(), inference.reload()])}><RefreshCw size={14} /> Refresh</Button>} />
    <div className="monitor-grid">{cards.map((card) => <Card key={card.label}><span className={`monitor-icon tone-${card.tone}`}>{card.icon}</span><div><small>{card.label}</small><strong>{card.value}</strong><p>{card.detail}</p></div></Card>)}</div>
    <div className="monitor-columns">
      <Card className="runtime-timeline"><div className="card-title"><Waves size={16} /><strong>Runtime activity</strong><Badge tone={statusTone(running ? "running" : "idle")}>{running ? "Live" : "Idle"}</Badge></div>{entries.map((entry, index) => <div key={index} className="timeline-entry"><i /><span>{entry.timestamp ? new Date(String(entry.timestamp)).toLocaleTimeString() : "—"}</span><p>{String(entry.text || "")}</p></div>)}{!entries.length && <EmptyState icon={<Activity />} title="No recent runtime activity" description="Inference and application events will appear here when work starts." />}</Card>
      <Card className="monitor-capabilities"><div className="card-title"><AlertTriangle size={16} /><strong>Monitoring coverage</strong></div><div className="capability-row"><div><strong>Job and runtime health</strong><span>Existing local telemetry</span></div><Badge tone="success">Available</Badge></div><div className="capability-row"><div><strong>Artifact evidence</strong><span>Durable result and checkpoint records</span></div><Badge tone="success">Available</Badge></div><div className="capability-row"><div><strong>Production drift</strong><span>Requires a project-declared drift contract</span></div><Badge tone="warning">Unavailable</Badge></div><div className="capability-row"><div><strong>Alerts and cohorts</strong><span>No registered monitoring backend</span></div><Badge tone="warning">Unavailable</Badge></div></Card>
    </div>
  </section>;
}
