export type CalibrationPrecision = "fp32" | "fp16" | "int8";
export type DeviceKind = "cpu" | "desktop-gpu" | "edge" | "datacenter";

export interface CalibrationDevice {
  id: string;
  name: string;
  shortName: string;
  kind: DeviceKind;
  location: string;
  image: string;
  imageAlt: string;
  peakLabel: string;
  throughput: Record<CalibrationPrecision, number>;
  ramGb: number;
  vramGb: number | null;
  memoryLabel: string;
  memoryBandwidthGbps: number;
  powerWatts: number;
  utilization: number;
  bandwidthUtilization: number;
  runtimeOverheadMb: number;
  launchOverheadMs: number;
  sourceLabel: string;
  sourceUrl?: string;
}

export interface CalibrationWorkload {
  gflopsPerFrame: number;
  weightsMb: number;
  activationsMb: number;
  batchSize: number;
  precision: CalibrationPrecision;
}

export interface CalibrationEstimate {
  device: CalibrationDevice;
  fps: number;
  latencyMs: number;
  memoryRequiredGb: number;
  memoryCapacityGb: number;
  utilizationPercent: number;
  energyMjPerFrame: number;
  limitingFactor: "compute" | "bandwidth" | "capacity";
  fitsMemory: boolean;
  lowFps: number;
  highFps: number;
}

export const DEFAULT_CALIBRATION_WORKLOAD: CalibrationWorkload = {
  gflopsPerFrame: 35,
  weightsMb: 180,
  activationsMb: 640,
  batchSize: 1,
  precision: "fp16",
};

export const CALIBRATION_DEVICES: CalibrationDevice[] = [
  {
    id: "cpu-16-core",
    name: "16-core workstation CPU",
    shortName: "Workstation CPU",
    kind: "cpu",
    location: "Local · x86 CPU",
    image: "/device-renderings/cpu-v2.webp",
    imageAlt: "Stylized rendering of a workstation CPU package",
    peakLabel: "≈1.2 FP32 TFLOPS",
    throughput: {fp32: 1.2, fp16: 1.8, int8: 5.2},
    ramGb: 64,
    vramGb: null,
    memoryLabel: "64 GB system RAM",
    memoryBandwidthGbps: 85,
    powerWatts: 125,
    utilization: .18,
    bandwidthUtilization: .42,
    runtimeOverheadMb: 720,
    launchOverheadMs: 2.4,
    sourceLabel: "Representative ModelForge planning profile",
  },
  {
    id: "rtx-4090",
    name: "NVIDIA GeForce RTX 4090",
    shortName: "RTX 4090",
    kind: "desktop-gpu",
    location: "Local · discrete GPU",
    image: "/device-renderings/gpu-v2.webp",
    imageAlt: "Stylized rendering of a desktop GPU accelerator",
    peakLabel: "82.6 FP32 TFLOPS",
    throughput: {fp32: 82.6, fp16: 330.3, int8: 660.6},
    ramGb: 64,
    vramGb: 24,
    memoryLabel: "24 GB GDDR6X",
    memoryBandwidthGbps: 1008,
    powerWatts: 450,
    utilization: .31,
    bandwidthUtilization: .54,
    runtimeOverheadMb: 920,
    launchOverheadMs: .75,
    sourceLabel: "NVIDIA FP32/memory specification; lower-precision planning rates derived",
    sourceUrl: "https://images.nvidia.com/aem-dam/Solutions/Data-Center/l4/nvidia-ada-gpu-architecture-whitepaper-v2.1.pdf",
  },
  {
    id: "jetson-orin-nano",
    name: "NVIDIA Jetson Orin Nano 8GB",
    shortName: "Jetson Orin Nano",
    kind: "edge",
    location: "Edge · embedded module",
    image: "/device-renderings/edge-v2.webp",
    imageAlt: "Stylized rendering of an embedded edge AI module",
    peakLabel: "20 dense INT8 TOPS",
    throughput: {fp32: 1.28, fp16: 10, int8: 20},
    ramGb: 8,
    vramGb: null,
    memoryLabel: "8 GB unified LPDDR5",
    memoryBandwidthGbps: 68,
    powerWatts: 15,
    utilization: .27,
    bandwidthUtilization: .48,
    runtimeOverheadMb: 360,
    launchOverheadMs: 1.5,
    sourceLabel: "NVIDIA Jetson Orin Nano specifications",
    sourceUrl: "https://developer.nvidia.com/blog/develop-ai-powered-robots-smart-vision-systems-and-more-with-nvidia-jetson-orin-nano-developer-kit/",
  },
  {
    id: "nvidia-l4",
    name: "NVIDIA L4",
    shortName: "NVIDIA L4",
    kind: "datacenter",
    location: "Cloud · efficient GPU",
    image: "/device-renderings/datacenter-v2.webp",
    imageAlt: "Stylized rendering of a datacenter AI accelerator sled",
    peakLabel: "30.3 FP32 TFLOPS",
    throughput: {fp32: 30.3, fp16: 121, int8: 242},
    ramGb: 64,
    vramGb: 24,
    memoryLabel: "24 GB GDDR6",
    memoryBandwidthGbps: 300,
    powerWatts: 72,
    utilization: .34,
    bandwidthUtilization: .56,
    runtimeOverheadMb: 980,
    launchOverheadMs: .65,
    sourceLabel: "NVIDIA L4 product specifications (dense rates)",
    sourceUrl: "https://www.nvidia.com/en-sg/data-center/l4/",
  },
  {
    id: "nvidia-h100-sxm",
    name: "NVIDIA H100 SXM",
    shortName: "H100 SXM",
    kind: "datacenter",
    location: "Cloud · datacenter GPU",
    image: "/device-renderings/datacenter-v2.webp",
    imageAlt: "Stylized rendering of a datacenter AI accelerator sled",
    peakLabel: "67 FP32 TFLOPS",
    throughput: {fp32: 67, fp16: 989.5, int8: 1979},
    ramGb: 256,
    vramGb: 80,
    memoryLabel: "80 GB HBM3",
    memoryBandwidthGbps: 3350,
    powerWatts: 700,
    utilization: .38,
    bandwidthUtilization: .62,
    runtimeOverheadMb: 1280,
    launchOverheadMs: .42,
    sourceLabel: "NVIDIA H100 product specifications (dense rates)",
    sourceUrl: "https://www.nvidia.com/en-us/data-center/h100/",
  },
];

const PRECISION_BYTES: Record<CalibrationPrecision, number> = {fp32: 4, fp16: 2, int8: 1};

export function estimateDevicePerformance(device: CalibrationDevice, workload: CalibrationWorkload): CalibrationEstimate {
  const precisionScale = PRECISION_BYTES[workload.precision] / 4;
  const batchSize = Math.max(1, Math.round(workload.batchSize));
  const workloadGflops = Math.max(.01, workload.gflopsPerFrame);
  const weightsMb = Math.max(0, workload.weightsMb) * precisionScale;
  const activationsMb = Math.max(0, workload.activationsMb) * precisionScale;
  const memoryRequiredMb = weightsMb + activationsMb * batchSize * 1.15 + device.runtimeOverheadMb;
  const memoryCapacityGb = device.vramGb ?? device.ramGb;
  const memoryRequiredGb = memoryRequiredMb / 1024;
  const fitsMemory = memoryRequiredGb <= memoryCapacityGb;

  const batchComputeGain = 1 + Math.log2(batchSize) * .08;
  const computeFps = device.throughput[workload.precision] * 1000 / workloadGflops
    * device.utilization * batchComputeGain;
  const trafficPerBatchMb = activationsMb * batchSize * 1.35 + weightsMb * .04;
  const bandwidthFps = trafficPerBatchMb > 0
    ? device.memoryBandwidthGbps * 1024 * batchSize / trafficPerBatchMb * device.bandwidthUtilization
    : Number.POSITIVE_INFINITY;
  const rawFps = Math.max(.01, Math.min(computeFps, bandwidthFps));
  const fps = fitsMemory ? rawFps : 0;
  const latencyMs = fitsMemory ? 1000 / rawFps + device.launchOverheadMs : Number.POSITIVE_INFINITY;
  const limitingFactor = !fitsMemory ? "capacity" : computeFps <= bandwidthFps ? "compute" : "bandwidth";
  const utilizationPercent = Math.min(100, memoryRequiredGb / memoryCapacityGb * 100);

  return {
    device,
    fps,
    latencyMs,
    memoryRequiredGb,
    memoryCapacityGb,
    utilizationPercent,
    energyMjPerFrame: fps > 0 ? device.powerWatts / fps * 1000 : Number.POSITIVE_INFINITY,
    limitingFactor,
    fitsMemory,
    lowFps: fps * .72,
    highFps: fps * 1.28,
  };
}

export function estimateSelectedDevices(deviceIds: string[], workload: CalibrationWorkload): CalibrationEstimate[] {
  const selected = new Set(deviceIds);
  return CALIBRATION_DEVICES.filter((device) => selected.has(device.id))
    .map((device) => estimateDevicePerformance(device, workload));
}
