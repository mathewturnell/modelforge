// Presentation adapted from the original RunsView.tsx, RunComparisonChart.tsx,
// and styles.css. The current public Run contract remains the only data source.
import {useMemo, useState} from "react";
import {Activity, BarChart3, ChevronRight, GitCompareArrows, X} from "lucide-react";
import {Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis} from "recharts";
import {Button, Checkbox, Radio} from "@mui/material";
import type {Run} from "./types";
import "./TrainingTelemetryView.css";

const colors = ["#76b900", "#38bdf8", "#e4a84d", "#fb7185", "#22d3ee", "#a5d63f"];
type Event = NonNullable<Run["telemetry"]>["events"][number];
type ChartRow = {step: number} & Record<string, number | null>;
export const metricKey = (event: Event) => `${event.split}/${event.name}`;
const runName = (run: Run) => typeof run.name === "string" && run.name ? run.name : run.id.slice(0, 8);
const pointsFor = (run: Run, metric: string) => (run.telemetry?.events || []).filter(event => metricKey(event) === metric);
const metricName = (name: string) => name.replace(/[\/_-]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
const compactValue = (value: number) => Math.abs(value) > 0 && Math.abs(value) < .0001 ? value.toExponential(3) : value.toLocaleString(undefined, {maximumFractionDigits: 6});

/** Preserve numeric coordinates and nulls. Never align points by array position. */
export function buildTrainingChartEvidence(runs: Run[], metric: string) {
  const series = runs.map(run => ({run, points: pointsFor(run, metric)}));
  const steps = [...new Set(series.flatMap(item => item.points.map(point => point.step)))].sort((a, b) => a - b);
  const rows: ChartRow[] = steps.map(step => Object.fromEntries([
    ["step", step], ...series.map(({run, points}) => [run.id, points.find(point => point.step === step)?.value ?? null]),
  ]) as ChartRow);
  const recorded = series.flatMap(item => item.points);
  const latestStep = steps.at(-1) ?? null;
  const latestValue = runs.length === 1 && latestStep !== null ? rows.at(-1)?.[runs[0].id] ?? null : null;
  return {
    rows, latestStep, latestValue, pointCount: recorded.length,
    terminalOnly: series.every(item => item.points.length <= 1),
    terminalRows: series.flatMap(({run, points}) => points.length ? [{name: runName(run), value: points.at(-1)!.value}] : []),
  };
}

export function TrainingMetricChart({runs, metric}: {runs: Run[]; metric: string}) {
  const evidence = useMemo(() => buildTrainingChartEvidence(runs, metric), [runs, metric]);
  const live = runs.some(run => ["queued", "pending", "running"].includes(run.status) && run.runtime_observation?.state !== "unavailable");
  const terminal = evidence.terminalOnly && !live;
  const message = live && evidence.pointCount === 1 ? "First sample received · waiting for the next recorded point" : live ? "Live recorded curve · updates as validated samples arrive" : terminal ? "Terminal values only · no intermediate curve was recorded" : "Recorded curve · no values are interpolated";
  if (!evidence.pointCount) return <div className="chart-empty">Select a run containing this metric to compare recorded values.</div>;
  return <figure className="comparison-chart-wrap" aria-label={`${metric} recorded metric evidence`}>
    <figcaption className={`chart-evidence-summary${terminal ? " is-terminal" : live ? " is-live" : ""}`}>
      <span>{message}</span><dl><div><dt>Axis</dt><dd>Optimizer step</dd></div><div><dt>Points</dt><dd>{evidence.pointCount}</dd></div><div><dt>Latest recorded</dt><dd>{evidence.latestStep}{evidence.latestValue === null ? "" : ` · ${compactValue(evidence.latestValue)}`}</dd></div></dl>
    </figcaption>
    <div className="chart-visual" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        {terminal ? <BarChart data={evidence.terminalRows} margin={{top: 16, right: 22, left: 4, bottom: 34}}>
          <CartesianGrid stroke="#252a31" strokeDasharray="2 5" vertical={false}/>
          <XAxis dataKey="name" stroke="#737b87" tick={{fill: "#858d99", fontSize: 10}} tickLine={false} axisLine={{stroke: "#30353d"}}/>
          <YAxis stroke="#737b87" tick={{fill: "#858d99", fontSize: 11}} tickLine={false} axisLine={false} width={66} tickFormatter={compactValue}/>
          <Tooltip cursor={{fill: "#ffffff08"}} contentStyle={{background: "#11151a", border: "1px solid #30353d", borderRadius: 7, boxShadow: "0 12px 38px #0009"}} formatter={value => String(value)}/>
          <Bar dataKey="value" name={metric} fill="#76b900" radius={[5, 5, 0, 0]} maxBarSize={72} isAnimationActive={false}/>
        </BarChart> : <LineChart data={evidence.rows} margin={{top: 16, right: 22, left: 4, bottom: 4}}>
          <CartesianGrid stroke="#252a31" strokeDasharray="2 5" vertical={false}/>
          <XAxis type="number" dataKey="step" domain={["dataMin", "dataMax"]} allowDecimals={false} stroke="#737b87" tick={{fill: "#858d99", fontSize: 11}} tickLine={false} axisLine={{stroke: "#30353d"}} label={{value: "Optimizer step", position: "insideBottomRight", offset: -2, fill: "#707986", fontSize: 10}}/>
          <YAxis domain={["auto", "auto"]} stroke="#737b87" tick={{fill: "#858d99", fontSize: 11}} tickLine={false} axisLine={false} width={66} tickFormatter={compactValue}/>
          <Tooltip cursor={{stroke: "#737b87", strokeDasharray: "3 3"}} contentStyle={{background: "#11151a", border: "1px solid #30353d", borderRadius: 7, boxShadow: "0 12px 38px #0009"}} labelStyle={{color: "#9199a5"}} labelFormatter={label => `Optimizer step ${label}`} formatter={value => String(value)}/>
          {runs.length > 1 && <Legend wrapperStyle={{fontSize: 11, color: "#a6adb8"}}/>}
          {runs.map((run, index) => <Line key={run.id} type="linear" dataKey={run.id} name={runName(run)} stroke={colors[index % colors.length]} strokeWidth={2} dot={{r: evidence.pointCount === 1 ? 5 : 2, strokeWidth: 0}} activeDot={{r: 5}} connectNulls={false} isAnimationActive={false}/>)}
        </LineChart>}
      </ResponsiveContainer>
    </div>
  </figure>;
}

export function TelemetryView({runs, selectedRunIds, onSelectionChange, mode, inspectedRunId}: {runs: Run[]; selectedRunIds?: string[]; onSelectionChange?: (ids: string[]) => void; mode?: "compare" | "inspect"; inspectedRunId?: string}) {
  const [metric, setMetric] = useState("");
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [localCompare, setCompare] = useState(true);
  const compare = mode ? mode === "compare" : localCompare;
  const [inspected, setInspected] = useState("");
  const available = runs;
  const names = [...new Set(available.flatMap(run => (run.telemetry?.events || []).map(metricKey)))];
  const key = names.includes(metric) ? metric : names[0] || "";
  const selected = selectedRunIds ?? chosen ?? available.map(run => run.id);
  const inspectedRun = available.find(run => run.id === (inspectedRunId ?? inspected)) || available[0];
  const visible = compare ? available.filter(run => selected.includes(run.id)) : inspectedRun ? [inspectedRun] : [];
  function toggleRun(id: string, checked: boolean) {const next = checked ? [...selected, id] : selected.filter(value => value !== id);if (onSelectionChange) onSelectionChange(next);else setChosen(next);}
  return <section className="training-telemetry" aria-label="Recorded training metrics">
    <header className="telemetry-section-heading"><div><span className="telemetry-eyebrow">{compare ? "Run comparison" : "Training run"}</span><h2>{compare ? `Compare ${visible.length} recorded results` : runName(inspectedRun || {id: "No run selected"} as Run)}</h2><p>Curves use recorded values only; missing and terminal-only evidence remains explicit.</p></div><div className="telemetry-heading-actions">{!onSelectionChange && <Button className={compare ? "is-active" : ""} aria-pressed={compare} onClick={() => setCompare(!compare)}><GitCompareArrows size={14}/>Compare {available.length || ""}</Button>}{names.length > 0 && <select aria-label="Comparison metric" value={key} onChange={event => setMetric(event.target.value)}>{names.map(name => <option key={name} value={name}>{name}</option>)}</select>}</div></header>
    {!names.length ? <div className="telemetry-empty"><Activity size={24}/><p>No scientific telemetry is available for these runs.</p></div> : <>
      {!onSelectionChange && <div className="comparison-choices" aria-label="Runs to compare">{available.map(run => <label key={run.id} className={visible.some(item => item.id === run.id) ? "is-selected" : ""}>{compare ? <Checkbox size="small" checked={selected.includes(run.id)} slotProps={{input:{"aria-label":`Compare ${runName(run)}`}}} onChange={event => toggleRun(run.id, event.target.checked)}/> : <Radio size="small" name="telemetry-run" checked={inspectedRun?.id === run.id} slotProps={{input:{"aria-label":`Inspect ${runName(run)}`}}} onChange={()=>setInspected(run.id)}/>}<i className={run.status === "completed" ? "is-completed" : ""}/><span><strong>{runName(run)}</strong><small>{run.status}</small></span></label>)}</div>}
      {compare && <div className="compare-run-chips">{visible.map((run, index) => <span key={run.id}><i style={{background: colors[index % colors.length]}}/>{runName(run)}<Button aria-label={`Remove ${runName(run)}`} onClick={() => toggleRun(run.id, false)}><X size={12}/></Button></span>)}</div>}
      {!compare && inspectedRun && <div className="run-metric-grid">{names.map(name => {const points = pointsFor(inspectedRun, name), latest = points.at(-1);return <Button key={name} className={name === key ? "is-active" : ""} onClick={() => setMetric(name)}><span>{metricName(name)}</span><strong>{latest ? compactValue(latest.value) : "—"}</strong><small>{latest ? `Step ${latest.step} · ${points.length} recorded points` : "Not recorded"}</small></Button>;})}</div>}
      {!compare && inspectedRun && <div className="essential-training-dashboard"><header><Activity size={16}/><div><strong>Essential training curves</strong><small>Recorded training and validation telemetry</small></div></header><div className="essential-training-plots">{[
        {title:"Training loss",pattern: /train\/.*loss|train\/.*objective/i},
        {title:"Validation loss",pattern: /val(?:idation)?\/.*loss|val(?:idation)?\/.*objective/i},
        {title:"Learning rate",pattern: /learning.?rate|(?:^|\/)lr$/i},
        {title:"Gradient norm",pattern: /grad(?:ient)?.*norm/i},
      ].map(({title,pattern})=>{const name=names.find(value=>pattern.test(value)&&pointsFor(inspectedRun,value).length);const last=name?pointsFor(inspectedRun,name).at(-1):undefined;return <article className="essential-training-plot" key={title}><header><div><strong>{title}</strong><small>{name||"Not recorded"}</small></div><b>{last?compactValue(last.value):"—"}</b></header><div className="essential-training-plot-body">{name?<TrainingMetricChart runs={[inspectedRun]} metric={name}/>:<div className="essential-plot-empty"><BarChart3 size={23}/><strong>No recorded curve</strong><span>This run did not retain {title.toLowerCase()} samples.</span></div>}</div></article>;})}</div></div>}
      <details className="telemetry-metric-explorer" open={compare}><summary><span>Advanced metric explorer</span><ChevronRight size={13}/></summary>
      <div className="comparison-chart-card"><div className="chart-heading"><div><BarChart3 size={16}/><strong>{metricName(key || "Metric")}</strong></div><span className="telemetry-badge">{names.length} recorded metrics</span></div><TrainingMetricChart runs={visible} metric={key}/></div></details>
      <div className="comparison-table-card"><h3>Metric summary</h3><div className="comparison-table-scroll"><table><thead><tr><th scope="col">Metric</th>{visible.map(run => <th scope="col" key={run.id}>{runName(run)}</th>)}</tr></thead><tbody>{names.map(name => <tr key={name}><th scope="row">{metricName(name)}</th>{visible.map(run => {const latest=pointsFor(run, name).at(-1);return <td key={run.id} title={latest ? String(latest.value) : undefined}>{latest ? compactValue(latest.value) : <span className="missing-value">Missing</span>}</td>;})}</tr>)}</tbody></table></div></div>
      <details className="advanced-metric-values"><summary><span>Exact recorded values</span><small>{key}</small><ChevronRight size={13}/></summary><div className="comparison-table-scroll"><table><caption>Exact recorded values · {key}</caption><thead><tr><th scope="col">Run</th><th scope="col">Step</th><th scope="col">Split</th><th scope="col">Value</th></tr></thead><tbody>{visible.flatMap(run => pointsFor(run, key).map(event => <tr key={`${run.id}-${event.step}`}><td>{runName(run)}</td><td>{event.step}</td><td>{event.split}</td><td>{String(event.value)}</td></tr>))}</tbody></table></div></details>
      <p className="telemetry-evidence-note">Metric summaries and axes are rounded; exact values and hover details retain recorded precision. Matching metric names do not establish scientific comparability or model promotion.</p>
    </>}
  </section>;
}
