import {lazy, Suspense, useEffect, useMemo, useState} from "react";
import {
  AlertTriangle,
  BatteryCharging,
  Check,
  CircuitBoard,
  Cpu,
  Gauge,
  HardDrive,
  MemoryStick,
  Server,
  SlidersHorizontal,
  Sparkles,
  Zap,
} from "lucide-react";
import type {Project} from "../types";
import {
  CALIBRATION_DEVICES,
  DEFAULT_CALIBRATION_WORKLOAD,
  estimateSelectedDevices,
  type CalibrationPrecision,
  type CalibrationWorkload,
} from "../lib/device-calibration";
import {Badge, LoadingState} from "../components/ui";
import type {CalibrationChartMetric} from "./CalibrationComparisonChart";

const CalibrationComparisonChart = lazy(() => import("./CalibrationComparisonChart"));

const DEFAULT_SELECTED = ["cpu-16-core", "rtx-4090", "jetson-orin-nano", "nvidia-l4"];

function numberLabel(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  return value.toLocaleString(undefined, {maximumFractionDigits: digits});
}

function kindLabel(kind: string): string {
  return kind === "desktop-gpu" ? "Desktop GPU" : kind === "datacenter" ? "Datacenter" : kind === "edge" ? "Edge AI" : "CPU";
}

function numericInput(value: number, update: (value: number) => void, options: {min: number; max: number; step?: number; label: string}) {
  return <input aria-label={options.label} type="number" value={value} min={options.min} max={options.max} step={options.step || 1} onChange={(event) => {
    const next = Number(event.target.value);
    if (Number.isFinite(next)) update(Math.max(options.min, Math.min(options.max, next)));
  }} />;
}

export function CalibrationView({project}: {project: Project}) {
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem("modelforge.calibration.devices") || "null");
      const valid = Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string" && CALIBRATION_DEVICES.some((device) => device.id === id)) : [];
      return valid.length ? valid : DEFAULT_SELECTED;
    } catch { return DEFAULT_SELECTED; }
  });
  const [focusedId, setFocusedId] = useState("jetson-orin-nano");
  const [workload, setWorkload] = useState<CalibrationWorkload>(DEFAULT_CALIBRATION_WORKLOAD);
  const [chartMetric, setChartMetric] = useState<CalibrationChartMetric>("fps");

  useEffect(() => { localStorage.setItem("modelforge.calibration.devices", JSON.stringify(selectedIds)); }, [selectedIds]);

  const estimates = useMemo(() => estimateSelectedDevices(selectedIds, workload), [selectedIds, workload]);
  const focused = estimates.find((estimate) => estimate.device.id === focusedId) || estimates[0];
  const updateWorkload = <K extends keyof CalibrationWorkload>(key: K, value: CalibrationWorkload[K]) => setWorkload((current) => ({...current, [key]: value}));
  const toggleDevice = (id: string) => {
    setSelectedIds((current) => {
      if (current.includes(id)) {
        if (current.length === 1) return current;
        const next = current.filter((candidate) => candidate !== id);
        if (focusedId === id) setFocusedId(next[0]);
        return next;
      }
      setFocusedId(id);
      return [...current, id];
    });
  };

  return <div className="document-scroll calibration-document">
    <header className="calibration-header">
      <div><span className="eyebrow"><Sparkles size={12} /> Device intelligence</span><h1>Simulation</h1><p>Estimate how <strong>{project.name || project.id}</strong> may perform across local, edge, and datacenter hardware before committing to a deployment target.</p></div>
      <div className="calibration-header-signal" aria-hidden="true"><Gauge /><i /><i /><i /></div>
    </header>

    <div className="calibration-disclaimer" role="note"><AlertTriangle size={15} /><div><strong>Planning estimate, not benchmark evidence.</strong><span>The model combines published peak capacity with conservative utilization, memory-traffic ceilings, and a ±28% uncertainty band. Validate the chosen device with a measured representative run.</span></div></div>

    <section className="calibration-stage">
      <aside className="device-catalog" aria-label="Comparison devices">
        <header><div><CircuitBoard size={15} /><span><strong>Device matrix</strong><small>{selectedIds.length} selected</small></span></div><Badge tone="active">Compare</Badge></header>
        <div>{CALIBRATION_DEVICES.map((device) => {
          const selected = selectedIds.includes(device.id);
          const focusedDevice = focused?.device.id === device.id;
          return <article key={device.id} className={`device-catalog-row ${focusedDevice ? "focused" : ""}`}>
            <button type="button" className="device-focus" onClick={() => {if (!selected) toggleDevice(device.id); else setFocusedId(device.id);}} aria-label={`Show ${device.name} details`}>
              <span className={`device-kind-icon ${device.kind}`}>{device.kind === "cpu" ? <Cpu /> : device.kind === "edge" ? <CircuitBoard /> : device.kind === "datacenter" ? <Server /> : <HardDrive />}</span>
              <span><strong>{device.shortName}</strong><small>{device.location}</small></span>
            </button>
            <button type="button" className={`device-compare-toggle ${selected ? "selected" : ""}`} aria-pressed={selected} aria-label={`${selected ? "Remove" : "Add"} ${device.name} ${selected ? "from" : "to"} comparison`} onClick={() => toggleDevice(device.id)}>{selected ? <Check /> : <span>+</span>}</button>
          </article>;
        })}</div>
      </aside>

      {focused && <article className={`device-hero ${focused.fitsMemory ? "" : "capacity-fail"}`}>
        <img src={focused.device.image} alt={focused.device.imageAlt} />
        <div className="device-hero-shade" />
        <div className="device-hero-copy">
          <div><span className="eyebrow">{kindLabel(focused.device.kind)} · illustrative rendering</span><h2>{focused.device.name}</h2><p>{focused.device.location}</p></div>
          <Badge tone={focused.fitsMemory ? "success" : "danger"}>{focused.fitsMemory ? `${focused.limitingFactor} limited` : "Does not fit"}</Badge>
        </div>
        <dl className="device-hero-metrics">
          <div><dt><Gauge /> Estimated FPS</dt><dd>{focused.fitsMemory ? numberLabel(focused.fps, focused.fps < 10 ? 1 : 0) : "—"}</dd><small>{focused.fitsMemory ? `${numberLabel(focused.lowFps, 0)}–${numberLabel(focused.highFps, 0)} likely range` : `${numberLabel(focused.memoryRequiredGb)} GB required`}</small></div>
          <div><dt><Zap /> Frame time</dt><dd>{focused.fitsMemory ? `${numberLabel(focused.latencyMs, focused.latencyMs < 10 ? 2 : 1)} ms` : "—"}</dd><small>effective single-frame latency</small></div>
          <div><dt><MemoryStick /> Memory</dt><dd>{numberLabel(focused.memoryRequiredGb, 2)} GB</dd><small>{numberLabel(focused.utilizationPercent, 0)}% of {focused.memoryCapacityGb} GB</small></div>
          <div><dt><BatteryCharging /> Energy</dt><dd>{focused.fitsMemory ? `${numberLabel(focused.energyMjPerFrame, 1)} mJ` : "—"}</dd><small>{focused.device.powerWatts} W envelope</small></div>
        </dl>
      </article>}
    </section>

    <section className="calibration-controls" aria-labelledby="workload-heading">
      <header><div><SlidersHorizontal /><span><strong id="workload-heading">Workload assumptions</strong><small>Model-level estimates at the selected precision</small></span></div><button type="button" onClick={() => setWorkload(DEFAULT_CALIBRATION_WORKLOAD)}>Reset defaults</button></header>
      <div className="calibration-control-grid">
        <label><span>Model compute</span><div>{numericInput(workload.gflopsPerFrame, (value) => updateWorkload("gflopsPerFrame", value), {min: .1, max: 10000, step: .1, label: "Model compute in GFLOPs per frame"})}<b>GFLOPs / frame</b></div><small>Operations for one input at FP32-equivalent graph complexity.</small></label>
        <label><span>Weights</span><div>{numericInput(workload.weightsMb, (value) => updateWorkload("weightsMb", value), {min: 1, max: 100000, label: "Model weights in megabytes"})}<b>MB</b></div><small>Unquantized checkpoint size before precision scaling.</small></label>
        <label><span>Peak activations</span><div>{numericInput(workload.activationsMb, (value) => updateWorkload("activationsMb", value), {min: 1, max: 100000, label: "Peak activation memory in megabytes"})}<b>MB</b></div><small>Peak per-frame intermediate tensors at FP32.</small></label>
        <label><span>Batch size</span><div>{numericInput(workload.batchSize, (value) => updateWorkload("batchSize", Math.round(value)), {min: 1, max: 128, label: "Inference batch size"})}<b>frames</b></div><small>Raises memory use and may improve device occupancy.</small></label>
        <fieldset><legend>Precision</legend><div>{(["fp32", "fp16", "int8"] as CalibrationPrecision[]).map((precision) => <button key={precision} type="button" className={workload.precision === precision ? "active" : ""} aria-pressed={workload.precision === precision} onClick={() => updateWorkload("precision", precision)}>{precision.toUpperCase()}</button>)}</div><small>Peak modes are normalized to dense operations; sparse headline rates are excluded.</small></fieldset>
      </div>
    </section>

    <section className="calibration-comparison" aria-labelledby="comparison-heading">
      <header><div><span className="eyebrow">Scenario comparison</span><h2 id="comparison-heading">One workload. Every selected device.</h2></div><div className="calibration-metric-tabs" role="group" aria-label="Comparison metric">{(["fps", "latency", "memory"] as CalibrationChartMetric[]).map((metric) => <button key={metric} type="button" className={chartMetric === metric ? "active" : ""} aria-pressed={chartMetric === metric} onClick={() => setChartMetric(metric)}>{metric === "fps" ? "Throughput" : metric === "latency" ? "Latency" : "Memory"}</button>)}</div></header>
      <Suspense fallback={<LoadingState label="Loading comparison graph…" />}><CalibrationComparisonChart estimates={estimates} metric={chartMetric} /></Suspense>
    </section>

    <section className="calibration-table-section">
      <header><span className="eyebrow">Capacity ledger</span><h2>Hardware and estimate detail</h2></header>
      <div className="calibration-table-wrap"><table className="calibration-table"><thead><tr><th>Device</th><th>Peak capacity</th><th>RAM</th><th>VRAM / unified</th><th>Bandwidth</th><th>FPS estimate</th><th>Latency</th><th>Memory</th><th>Constraint</th></tr></thead><tbody>{estimates.map((estimate) => <tr key={estimate.device.id}>
        <th><button type="button" onClick={() => setFocusedId(estimate.device.id)}>{estimate.device.shortName}</button><small>{kindLabel(estimate.device.kind)}</small></th>
        <td>{estimate.device.peakLabel}<small>{workload.precision.toUpperCase()}: {numberLabel(estimate.device.throughput[workload.precision], 1)} {workload.precision === "int8" ? "TOPS" : "TFLOPS"}</small></td>
        <td>{estimate.device.ramGb} GB</td><td>{estimate.device.memoryLabel}</td><td>{numberLabel(estimate.device.memoryBandwidthGbps, 0)} GB/s</td>
        <td>{estimate.fitsMemory ? numberLabel(estimate.fps, estimate.fps < 10 ? 1 : 0) : "—"}</td><td>{estimate.fitsMemory ? `${numberLabel(estimate.latencyMs, estimate.latencyMs < 10 ? 2 : 1)} ms` : "—"}</td><td>{numberLabel(estimate.memoryRequiredGb, 2)} / {estimate.memoryCapacityGb} GB</td>
        <td><Badge tone={estimate.fitsMemory ? estimate.limitingFactor === "compute" ? "active" : "warning" : "danger"}>{estimate.fitsMemory ? estimate.limitingFactor : "capacity"}</Badge></td>
      </tr>)}</tbody></table></div>
      <p className="calibration-source-note">Preset capacities are fixed, reviewed planning inputs. Device links identify the manufacturer source; the generic CPU is an explicit representative assumption. {CALIBRATION_DEVICES.filter((device) => selectedIds.includes(device.id) && device.sourceUrl).map((device, index) => <span key={device.id}>{index ? " · " : ""}<a href={device.sourceUrl} target="_blank" rel="noreferrer">{device.shortName} source</a></span>)}</p>
    </section>
  </div>;
}
