import {Cloud, Cpu, Gauge, MonitorCog} from "lucide-react";
import {api} from "../lib/api";
import type {JsonMap} from "../types";
import {useRequest} from "../hooks/use-request";
import {Badge} from "./ui";

export interface ComputeSelection {
  target: "local" | "cpu" | "gpu" | "cloud";
  device: string;
  modalGpu: string;
}

interface ComputeTargetPickerProps {
  value: ComputeSelection;
  onChange: (selection: ComputeSelection) => void;
  disabled?: boolean;
  allowCloud?: boolean;
}

const objectAt = (value: unknown): JsonMap => value && typeof value === "object" ? value as JsonMap : {};

export function ComputeTargetPicker({value, onChange, disabled = false, allowCloud = true}: ComputeTargetPickerProps) {
  const {data} = useRequest(() => api.systemMetrics(), []);
  const gpu = objectAt(data?.gpu);
  const cloud = objectAt(data?.cloud);
  const gpuAvailable = gpu.available === true;
  const cloudReady = allowCloud && cloud.available === true && cloud.dispatch_ready === true;
  const cloudTargets = Array.isArray(cloud.gpu_targets) ? cloud.gpu_targets.map(String) : [];
  const encoded = value.target === "gpu" ? "gpu" : value.target === "cpu" ? "cpu" : value.target === "cloud" ? "cloud" : "auto";
  const choose = (next: string) => {
    if (next === "gpu") onChange({...value, target: "gpu", device: "0"});
    else if (next === "cpu") onChange({...value, target: "cpu", device: "cpu"});
    else if (next === "cloud") onChange({...value, target: "cloud", device: "cuda:0", modalGpu: value.modalGpu || String(cloudTargets[0] || "L4")});
    else onChange({...value, target: "local", device: "auto"});
  };
  const memory = objectAt(gpu.memory);

  return <div className="compute-picker" aria-label="Execution target">
    <div className="compute-picker-heading"><span>{value.target === "cloud" ? <Cloud size={15} /> : value.target === "gpu" ? <MonitorCog size={15} /> : <Cpu size={15} />}</span><div><strong>Execution target</strong><small>{value.target === "cloud" ? "Managed cloud compute" : "This workstation"}</small></div><Badge tone={value.target === "cloud" ? (cloudReady ? "success" : "warning") : "success"}>{value.target === "cloud" ? "Cloud" : "Local"}</Badge></div>
    <label><span>Device</span><select aria-label="Compute device" value={encoded} disabled={disabled} onChange={(event) => choose(event.target.value)}>
      <option value="auto">Automatic local device</option>
      <option value="gpu" disabled={!gpuAvailable}>{gpuAvailable ? `NVIDIA GPU · ${String(gpu.name || "CUDA device 0")}` : "NVIDIA GPU unavailable"}</option>
      <option value="cpu">CPU · {String(objectAt(data?.cpu).name || "Local processor")}</option>
      {allowCloud && <option value="cloud" disabled={!cloudReady}>{cloudReady ? "Cloud GPU" : "Cloud GPU · dispatch not configured"}</option>}
    </select></label>
    {value.target === "cloud" && <label><span>Cloud accelerator</span><select aria-label="Cloud accelerator" value={value.modalGpu} disabled={disabled || !cloudReady} onChange={(event) => onChange({...value, modalGpu: event.target.value})}>{(cloudTargets.length ? cloudTargets : ["L4"]).map((target) => <option key={target} value={target}>{target}</option>)}</select></label>}
    <div className="compute-picker-telemetry"><Gauge size={13} />{value.target === "gpu" && gpuAvailable ? <span>{Number(gpu.load_percent || 0).toFixed(0)}% GPU · {Number(memory.percent || 0).toFixed(0)}% VRAM</span> : value.target === "cloud" ? <span>{cloudReady ? `${String(cloud.provider || "Cloud")} connected` : "Cloud dispatch requires trusted-host configuration"}</span> : <span>{Number(objectAt(data?.cpu).load_percent || 0).toFixed(0)}% CPU load</span>}</div>
  </div>;
}
