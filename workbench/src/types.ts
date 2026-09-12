export type ActivityId =
  | "overview"
  | "source"
  | "dataset"
  | "annotation"
  | "architecture"
  | "training"
  | "inference"
  | "runs"
  | "assistant"
  | "settings";

export type JsonObject = Record<string, unknown>;

export interface ExecutionTarget extends JsonObject {
  target: string;
  provider?: string;
  billable?: boolean;
  readiness?: string;
  ready?: boolean;
  binding_sha256?: string;
  environment?: string;
  reasons?: string[];
}
export interface ProjectAction extends JsonObject {
  id: string;
  kind: "inference" | "prompt" | "training";
  display_name?: string;
  interface?: string;
}
export interface Project extends JsonObject {
  id: string;
  name: string;
  description?: string;
  support_level?: string;
  capabilities?: string[];
  runtime_readiness?: string;
  readiness_reasons?: string[];
  action: ProjectAction;
  actions?: ProjectAction[];
  dataset?: { id: string; name?: string; sample_count?: number };
  execution_targets?: ExecutionTarget[];
}
export interface Sample extends JsonObject {
  id: string;
  name?: string;
  split?: string;
  content_type?: string;
  size_bytes?: number;
  sha256?: string;
}
export interface Artifact extends JsonObject {
  id: string;
  name: string;
  kind?: string;
  content_type?: string;
  size_bytes?: number;
  sha256?: string;
}
export interface Run extends JsonObject {
  id: string;
  project_id: string;
  status: string;
  provider?: string;
  created_at?: string;
  error?: string;
  artifacts?: Artifact[];
  request?: JsonObject;
  configuration?: JsonObject;
  live?: { progress?: { stage?: string; percent?: number }; log_tail?: string };
  runtime_observation?: {
    state?: string;
    stale?: boolean;
    reason?: string;
    recoverable?: boolean;
  };
  recovery_available?: boolean;
}
export interface ModalStatus extends JsonObject {
  state: string;
  installed: boolean;
  environment: string;
  message: string;
  live_verified: boolean;
}
export interface AnnotationRecord extends JsonObject {
  protocol: "modelforge.annotation/v1";
  project_id: string;
  dataset_id: string;
  sample_id: string;
  sample_sha256: string;
  revision: number;
  labels: string[];
  note: string;
  boxes?: Array<{
    id: string;
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}
