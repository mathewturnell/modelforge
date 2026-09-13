import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {CalibrationEstimate} from "../lib/device-calibration";

export type CalibrationChartMetric = "fps" | "latency" | "memory";

const COLORS = ["#76b900", "#a5d63f", "#38bdf8", "#e4a84d", "#ef6b73"];

function metricValue(estimate: CalibrationEstimate, metric: CalibrationChartMetric): number {
  if (!estimate.fitsMemory) return 0;
  if (metric === "latency") return estimate.latencyMs;
  if (metric === "memory") return estimate.memoryRequiredGb;
  return estimate.fps;
}

function metricLabel(metric: CalibrationChartMetric): string {
  if (metric === "latency") return "Frame latency · ms (lower is better)";
  if (metric === "memory") return "Estimated accelerator memory · GB";
  return "Estimated throughput · frames per second";
}

function valueLabel(value: number, metric: CalibrationChartMetric): string {
  if (metric === "latency") return `${value.toFixed(value < 10 ? 2 : 1)} ms`;
  if (metric === "memory") return `${value.toFixed(2)} GB`;
  return `${value.toFixed(value < 10 ? 1 : 0)} FPS`;
}

export default function CalibrationComparisonChart({estimates, metric}: {
  estimates: CalibrationEstimate[];
  metric: CalibrationChartMetric;
}) {
  const data = estimates.map((estimate) => ({
    name: estimate.device.shortName,
    value: metricValue(estimate, metric),
    estimate,
  }));

  return <figure className="calibration-chart" aria-label={`${metricLabel(metric)} comparison`}>
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{top: 5, right: 32, bottom: 18, left: 14}}>
        <CartesianGrid stroke="#252a31" strokeDasharray="3 5" horizontal={false} />
        <XAxis type="number" stroke="#69727e" tick={{fontSize: 9}} label={{value: metricLabel(metric), position: "insideBottom", offset: -12, fill: "#858d99", fontSize: 9}} />
        <YAxis type="category" dataKey="name" width={105} stroke="#69727e" tick={{fontSize: 9, fill: "#c2c7cf"}} />
        <ChartTooltip
          cursor={{fill: "#ffffff08"}}
          content={({active, payload}) => {
            const row = payload?.[0]?.payload as {estimate?: CalibrationEstimate} | undefined;
            if (!active || !row?.estimate) return null;
            const estimate = row.estimate;
            return <div className="calibration-chart-tooltip"><strong>{estimate.device.name}</strong>{estimate.fitsMemory
              ? <><span>{valueLabel(metricValue(estimate, metric), metric)}</span><small>{estimate.limitingFactor} limited · planning estimate</small></>
              : <><span>Does not fit</span><small>{estimate.memoryRequiredGb.toFixed(1)} GB required / {estimate.memoryCapacityGb} GB available</small></>}</div>;
          }}
        />
        <Bar dataKey="value" radius={[0, 5, 5, 0]} maxBarSize={28}>{data.map((entry, index) => <Cell key={entry.estimate.device.id} fill={entry.estimate.fitsMemory ? COLORS[index % COLORS.length] : "#ef6b73"} />)}</Bar>
      </BarChart>
    </ResponsiveContainer>
    <figcaption className="sr-only">{data.map((entry) => `${entry.name}: ${entry.estimate.fitsMemory ? valueLabel(entry.value, metric) : "does not fit in device memory"}`).join("; ")}</figcaption>
  </figure>;
}
