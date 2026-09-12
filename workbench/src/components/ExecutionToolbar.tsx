import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {Activity, Check, ChevronDown, Cpu, Gauge} from "lucide-react";
import {useEffect, useState} from "react";
import type {JsonMap} from "../types";
import {api} from "../lib/api";
import {inferenceProgressPresentation} from "../lib/inference-progress";
import type {ComputeSelection} from "./ComputeTargetPicker";

function objectAt(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
}

function percent(value: unknown): string {
  const number = Number(value);
  return Number.isFinite(number) ? `${Math.round(number)}%` : "—";
}

export function ExecutionToolbar({value, onChange, projectId}: {
  value: ComputeSelection;
  onChange: (selection: ComputeSelection) => void;
  projectId: string;
}) {
  const [metrics, setMetrics] = useState<JsonMap>({});
  const [training, setTraining] = useState<JsonMap>({});
  const [inference, setInference] = useState<JsonMap>({});
  const [cloudInference, setCloudInference] = useState<JsonMap>({});

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      let cloudJobId = "";
      try { cloudJobId = window.localStorage.getItem(`modelforge.inference.cloud.job.${projectId}`) || ""; }
      catch { /* Restored browser state is optional and never grants job authority. */ }
      const [nextMetrics, nextTraining, nextInference, nextCloudInference] = await Promise.all([
        api.systemMetrics().catch(() => ({} as JsonMap)),
        api.trainingStatus().catch(() => ({} as JsonMap)),
        api.inferenceStatus().catch(() => ({} as JsonMap)),
        cloudJobId ? api.cloudInferenceStatus(cloudJobId).then((response) => objectAt(response.job)).catch(() => ({} as JsonMap)) : Promise.resolve({} as JsonMap),
      ]);
      if (!mounted) return;
      setMetrics(nextMetrics); setTraining(nextTraining); setInference(nextInference); setCloudInference(nextCloudInference);
    };
    void load();
    const timer = window.setInterval(() => void load(), 2500);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [projectId]);

  const cpu = objectAt(metrics.cpu);
  const memory = objectAt(cpu.memory || metrics.memory);
  const gpu = objectAt(metrics.gpu);
  const cloud = objectAt(metrics.cloud);
  const cpuName = String(cpu.name || "Local processor");
  const cpuVendor = /\b(?:amd|ryzen|epyc|athlon)\b/i.test(cpuName)
    ? "amd"
    : /\b(?:intel|xeon|celeron|pentium)\b/i.test(cpuName) ? "intel" : "";
  const gpuAvailable = gpu.available === true;
  const cloudReady = cloud.available === true && cloud.dispatch_ready === true;
  const cloudTargets = Array.isArray(cloud.gpu_targets) ? cloud.gpu_targets.map(String) : [];
  const acceleratorTargets = cloudTargets.length ? cloudTargets : ["L4"];
  const selectedAccelerator = value.modalGpu || acceleratorTargets[0];
  const encoded = value.target === "gpu" ? "gpu" : value.target === "cpu" ? "cpu" : value.target === "cloud" ? "cloud" : "auto";
  const deviceOptions = [
    {value: "auto", label: "Auto", detail: "Local device selection", disabled: false},
    {value: "gpu", label: "GPU", detail: gpuAvailable ? String(gpu.name || "CUDA 0") : "Unavailable", disabled: !gpuAvailable},
    {value: "cpu", label: "CPU", detail: cpuName, disabled: false},
    {value: "cloud", label: "Cloud GPU", detail: cloudReady ? "Managed accelerator" : "Dispatch not configured", disabled: !cloudReady},
  ];
  const selectedDevice = deviceOptions.find((option) => option.value === encoded) || deviceOptions[0];
  const choose = (next: string) => {
    if (next === "gpu") onChange({...value, target: "gpu", device: "0"});
    else if (next === "cpu") onChange({...value, target: "cpu", device: "cpu"});
    else if (next === "cloud") onChange({...value, target: "cloud", device: "cuda:0", modalGpu: value.modalGpu || cloudTargets[0] || "L4"});
    else onChange({...value, target: "local", device: "auto"});
  };
  const trainingActive = training.running === true || training.starting === true;
  const inferenceActive = inference.running === true || inference.starting === true || inference.postprocessing === true;
  const cloudInferenceActive = ["queued", "running"].includes(String(cloudInference.status || ""));
  const active = trainingActive ? training : inferenceActive ? inference : cloudInferenceActive ? cloudInference : null;
  const progress = objectAt(active?.progress);
  const activeKind = trainingActive ? "Training" : inferenceActive || cloudInferenceActive ? "Inference" : "Idle";
  const progressPresentation = inferenceProgressPresentation(progress, Boolean(active));
  const activePercent = progressPresentation.percent;

  return <section className="execution-toolbar" aria-label="Compute and active jobs">
    <span className={`execution-location ${value.target === "cloud" ? "cloud" : "local"}`}>{value.target === "cloud" ? "CLOUD" : "LOCAL"}</span>
    <label className="execution-device">
      {value.target === "gpu" || value.target === "cloud"
        ? <span className="execution-provider" aria-label="NVIDIA"><img src="/nvidia-mark.svg" alt="" aria-hidden="true" /></span>
        : cpuVendor
          ? <span className={`execution-provider ${cpuVendor}`} role="img" aria-label={cpuVendor === "amd" ? "AMD" : "Intel"}><img src={`/${cpuVendor}-mark.svg`} alt="" aria-hidden="true" /></span>
          : <span className="execution-provider-cpu" aria-hidden="true"><Cpu /></span>}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild><button className="execution-device-trigger" type="button" disabled={Boolean(active)} aria-label={`Workspace compute device: ${selectedDevice.label}, ${selectedDevice.detail}`} title={`${selectedDevice.label} · ${selectedDevice.detail}`}><span><strong>{selectedDevice.label}</strong><i aria-hidden="true">·</i><small>{selectedDevice.detail}</small></span><ChevronDown aria-hidden="true" /></button></DropdownMenu.Trigger>
        <DropdownMenu.Portal><DropdownMenu.Content className="execution-device-menu" align="start" sideOffset={7} collisionPadding={8}><DropdownMenu.Label className="execution-device-menu-label">Execution device</DropdownMenu.Label>{deviceOptions.map((option) => <DropdownMenu.Item key={option.value} className="execution-device-option" disabled={option.disabled} onSelect={() => choose(option.value)}><span className={`execution-device-option-icon ${option.value}`}>{option.value === "gpu" || option.value === "cloud" ? <img src="/nvidia-mark.svg" alt="" /> : option.value === "cpu" && cpuVendor ? <img src={`/${cpuVendor}-mark.svg`} alt="" /> : <Cpu />}</span><span><strong>{option.label}</strong><small>{option.detail}</small></span>{option.value === encoded && <Check className="execution-device-check" aria-label="Selected" />}</DropdownMenu.Item>)}</DropdownMenu.Content></DropdownMenu.Portal>
      </DropdownMenu.Root>
    </label>
    {value.target === "cloud" && <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild><button className="execution-accelerator-trigger" type="button" disabled={!cloudReady || Boolean(active)} aria-label={`Workspace cloud accelerator: ${selectedAccelerator}`} title={`Cloud accelerator · ${selectedAccelerator}`}><span><small>GPU</small><strong>{selectedAccelerator}</strong></span><ChevronDown aria-hidden="true" /></button></DropdownMenu.Trigger>
      <DropdownMenu.Portal><DropdownMenu.Content className="execution-accelerator-menu" align="start" sideOffset={7} collisionPadding={8}><DropdownMenu.Label className="execution-accelerator-menu-label">Cloud accelerator</DropdownMenu.Label><DropdownMenu.RadioGroup value={selectedAccelerator} onValueChange={(modalGpu) => onChange({...value, modalGpu})}>{acceleratorTargets.map((target) => <DropdownMenu.RadioItem key={target} className="execution-accelerator-option" value={target}><span>{target}</span><DropdownMenu.ItemIndicator><Check aria-label="Selected" /></DropdownMenu.ItemIndicator></DropdownMenu.RadioItem>)}</DropdownMenu.RadioGroup></DropdownMenu.Content></DropdownMenu.Portal>
    </DropdownMenu.Root>}
    <div className="execution-health" aria-label="Local compute utilization">
      <span><b>CPU</b>{percent(cpu.load_percent ?? cpu.percent)}</span>
      <span><b>RAM</b>{percent(memory.percent ?? metrics.memory_percent)}</span>
      <span><b>GPU</b>{gpuAvailable ? percent(gpu.load_percent) : "Off"}</span>
    </div>
    <div className={`execution-job ${active ? "active" : ""}`}>
      <div className="execution-job-status"><Activity /><strong>{activeKind}</strong>{active && <><small>{String(progress.stage || progress.phase || "Running")}</small><b>{progressPresentation.indeterminate ? "…" : `${activePercent.toFixed(0)}%`}</b></>}</div>
      <div className={`execution-progress ${active ? "active" : "idle"} ${progressPresentation.indeterminate ? "indeterminate" : ""}`} role="progressbar" aria-label="Current job progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressPresentation.indeterminate ? undefined : activePercent} aria-valuetext={active ? progressPresentation.indeterminate ? `${activeKind} in progress` : `${activeKind} ${activePercent.toFixed(0)} percent` : "Idle, no active job"}><i style={progressPresentation.indeterminate ? undefined : {width: `${activePercent}%`}} /></div>
    </div>
    <Gauge className="execution-gauge" aria-hidden="true" />
  </section>;
}
