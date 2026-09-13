import {useMemo} from "react";
import {Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis} from "recharts";
import {runMetricSeries} from "../lib/utils";
import type {RunRecord} from "../types";

const colors = ["#76b900", "#38bdf8", "#e4a84d", "#fb7185", "#22d3ee", "#a5d63f"];

export default function RunComparisonChart({runs, metric}: {runs: RunRecord[]; metric: string}) {
  const {rows, terminalOnly, terminalRows} = useMemo(() => {
    const series = runs.map((run) => ({run, points: runMetricSeries(run)[metric] || []}));
    const steps = [...new Set(series.flatMap((item) => item.points.map((point) => point.step)))].sort((a, b) => a - b);
    const rows = steps.map((step) => Object.fromEntries([
      ["step", step],
      ...series.map(({run, points}) => [run.id, points.find((point) => point.step === step)?.value ?? null]),
    ]));
    return {
      rows,
      terminalOnly: series.every((item) => item.points.length <= 1),
      terminalRows: series.flatMap(({run, points}) => points.length ? [{name: run.name || run.id, value: points[points.length - 1].value}] : []),
    };
  }, [runs, metric]);
  if (!rows.length) return <div className="chart-empty">No recorded values are available for {metric}.</div>;
  if (terminalOnly) return <div className="comparison-chart-wrap"><span className="terminal-evidence-label">Terminal values only · no intermediate curve was recorded</span><ResponsiveContainer width="100%" height="100%"><BarChart data={terminalRows} margin={{top: 28, right: 22, left: 4, bottom: 34}}><CartesianGrid stroke="#252a31" strokeDasharray="2 5" vertical={false} /><XAxis dataKey="name" stroke="#737b87" tick={{fill: "#858d99", fontSize: 10}} tickLine={false} axisLine={{stroke: "#30353d"}} angle={-10} textAnchor="end" interval={0} /><YAxis stroke="#737b87" tick={{fill: "#858d99", fontSize: 11}} tickLine={false} axisLine={false} width={50} /><Tooltip cursor={{fill: "#ffffff08"}} contentStyle={{background: "#11151a", border: "1px solid #30353d", borderRadius: 7, boxShadow: "0 12px 38px #0009"}} /><Bar dataKey="value" name={metric} fill="#76b900" radius={[5, 5, 0, 0]} maxBarSize={72} isAnimationActive={false} /></BarChart></ResponsiveContainer></div>;
  return <div className="comparison-chart-wrap">
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={rows} margin={{top: 24, right: 22, left: 4, bottom: 4}}>
        <CartesianGrid stroke="#252a31" strokeDasharray="2 5" vertical={false} />
        <XAxis dataKey="step" stroke="#737b87" tick={{fill: "#858d99", fontSize: 11}} tickLine={false} axisLine={{stroke: "#30353d"}} label={{value: terminalOnly ? "recorded result" : "step / epoch", position: "insideBottomRight", offset: -2, fill: "#707986", fontSize: 10}} />
        <YAxis stroke="#737b87" tick={{fill: "#858d99", fontSize: 11}} tickLine={false} axisLine={false} width={50} />
        <Tooltip contentStyle={{background: "#11151a", border: "1px solid #30353d", borderRadius: 7, boxShadow: "0 12px 38px #0009"}} labelStyle={{color: "#9199a5"}} />
        <Legend wrapperStyle={{fontSize: 11, color: "#a6adb8"}} />
        {runs.map((run, index) => <Line key={run.id} type="linear" dataKey={run.id} name={run.name || run.id} stroke={colors[index % colors.length]} strokeWidth={2} dot={{r: terminalOnly ? 5 : 2, strokeWidth: 0}} activeDot={{r: 5}} connectNulls={false} isAnimationActive={!window.matchMedia("(prefers-reduced-motion: reduce)").matches} />)}
      </LineChart>
    </ResponsiveContainer>
  </div>;
}
