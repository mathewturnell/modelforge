export type ActivityId = "overview" | "source" | "data" | "model" | "llm" | "github" | "huggingface" | "runs" | "inference" | "jobs" | "calibration" | "deploy" | "monitor" | "knowledge" | "settings";

export type JsonMap = Record<string, unknown>;

export type CliffDelegateRoleId = "ml_systems_engineer";

export type CliffDelegation = {
  id: string;
  parent_run_id: string;
  depth: number;
  role: {
    id: CliffDelegateRoleId;
    display_name: string;
    authority: "read_only_diagnostic";
  };
  status: string;
  task_label?: string;
  result?: {
    name?: string;
    feedback?: string;
    provider?: string;
    mode?: string;
  } | null;
  error?: string | null;
};

export interface Project extends JsonMap {
  id: string;
  name?: string;
  accent?: string;
  repository?: string;
  selected_dataset?: string;
  dataset_repository?: string;
  dataset_profiles?: DatasetProfile[];
  active_dataset_profile?: string;
  default_dataset?: string;
  default_dataset_profile?: string;
  project_type?: string;
  adapters?: JsonMap;
  runtime?: JsonMap;
  deployment?: JsonMap;
  model_artifacts?: ModelArtifact[];
  model_checkpoints?: ModelArtifact[];
  active_checkpoint?: ModelArtifact;
  research_candidates?: ModelArtifact[];
  training_checkpoints?: ModelArtifact[];
  training_target?: TrainingTarget;
  visual_workflow?: JsonMap;
  inference_target_contract?: {kinds?: string[]; transport?: string; identity?: string[]; requires_checkpoint?: boolean};
}

export interface ResearchCandidate extends JsonMap {
  id: string;
  model_version_id: string;
  dataset_profile: string;
  checkpoint_sha256: string;
  research_inference_eligible: boolean;
  active: false;
  eligible: false;
  local_only: true;
}

export interface DatasetProfile extends JsonMap {
  id: string;
  name?: string;
  root: string;
  default?: boolean;
  splits?: Record<string, {count?: number; normal?: number; anomalous?: number}>;
}

export interface BrowseDirectory extends JsonMap {
  name: string;
  path: string;
  dataset?: boolean;
  dataset_count?: number;
}

export interface BrowseResponse extends JsonMap {
  path: string;
  parent?: string;
  dataset?: boolean;
  directories?: BrowseDirectory[];
  files?: Array<Record<string, unknown>>;
}

export interface ModelArtifact extends JsonMap {
  id?: string;
  filename?: string;
  path?: string;
  status?: string;
  eligible?: boolean;
  sha256?: string;
  validation?: {metrics?: Record<string, number>; passed?: boolean};
  evaluation?: {metrics?: Record<string, number>; passed?: boolean};
}

export interface SourceEntry {
  name: string;
  path: string;
  type: "directory" | "file";
  extension?: string;
  size?: number;
  modified?: string;
  viewable?: boolean;
}

export interface SourceTreeResponse {
  root?: string;
  path?: string;
  entries: SourceEntry[];
  truncated?: boolean;
  tooling?: JsonMap;
}

export interface SourceFile {
  name: string;
  path: string;
  extension?: string;
  content: string;
  size?: number;
  modified?: string;
}

export interface Artifact {
  name: string;
  path: string;
  kind: string;
  extension?: string;
  mime_type?: string;
  size?: number;
  directory?: string;
  annotation_count?: number;
  annotation_formats?: string[];
  details?: Record<string, unknown>;
}

export interface ArtifactFolder {
  path: string;
  name: string;
  files: number;
  bytes?: number;
  kinds?: Record<string, number>;
  folders?: number;
  artifacts?: Artifact[];
}

export interface ArtifactNavigation {
  splits?: Array<{id: string; label: string; path: string; files: number; sequences: number}>;
  sequences?: Array<{id: string; name: string; split: string; path: string; files: number; bytes?: number; artifacts?: Artifact[]}>;
  truncated?: boolean;
}

export interface InferenceTarget {
  projectId: string;
  datasetRoot: string;
  path: string;
  name: string;
  kind: string;
  targetType?: "artifact" | "sequence" | "descriptor_sample";
  mimeType?: string;
  size?: number;
  previewPath?: string;
  frames?: number;
  fps?: number;
  split?: string;
  sampleIndex?: number;
  sampleId?: string;
}

export interface DescriptorSample extends JsonMap {
  id: string;
  kind: "descriptor_sample";
  split: string;
  index: number;
  inputs: Record<string, string>;
  targets?: Record<string, string>;
  labels?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  preview_path?: string;
  complete?: boolean;
  required_inputs?: string[];
}

export interface DescriptorSampleResponse extends JsonMap {
  available?: boolean;
  kind?: "descriptor_sample";
  split?: string;
  offset?: number;
  limit?: number;
  total?: number;
  truncated?: boolean;
  samples?: DescriptorSample[];
}

export interface TrainingTarget {
  kind: "dataset" | "folder" | "artifact";
  dataset_root: string;
  path: string;
  name: string;
}

export interface ArtifactResponse extends JsonMap {
  available?: boolean;
  name?: string;
  root?: string;
  total?: number;
  limit?: number;
  offset?: number;
  folder?: string;
  parent?: string | null;
  matched_total?: number;
  folder_total?: number;
  folders_truncated?: boolean;
  folders?: ArtifactFolder[];
  navigation?: ArtifactNavigation;
  artifacts?: Artifact[];
  summary?: {
    files?: number;
    directories?: number;
    bytes?: number;
    kinds?: Record<string, number>;
    truncated?: boolean;
  };
  inventory?: DatasetInventory;
  annotations?: JsonMap;
}

export interface DatasetInventory {
  name?: string;
  profile?: string;
  scope?: string;
  completeness?: string;
  corpus_complete?: boolean | null;
  catalog_truncated?: boolean;
  split_plan?: {
    protocol?: string;
    editable?: boolean;
    assignment_count?: number;
    updated_at?: string;
    roles?: string[];
    held_out_protected?: boolean;
  };
  totals?: Record<string, number>;
  splits?: Array<Record<string, string | number>>;
  sequences?: Array<{
    id: string;
    path?: string;
    split?: string;
    imported_split?: string;
    split_assignment?: "imported" | "workspace";
    split_editable?: boolean;
    frames?: number;
    objects?: number;
    tracks?: number;
    editable?: boolean;
    annotated?: boolean;
    kind?: string;
    media_kind?: string;
    preview_path?: string;
    fps?: number;
    duration_seconds?: number;
  }>;
}

export interface AnnotationProject {
  project: string;
  project_kind?: string;
  output_root?: string;
  source_video?: string;
  duration_seconds?: number;
  classes?: Record<string, string>;
  markers?: AnnotationMarker[];
  sample_count?: number;
  splits?: Record<string, number>;
  protected?: boolean;
  protection_reason?: string;
  export_supported?: boolean;
  export_formats?: string[];
  interchange?: string;
}

export interface AnnotationMarker {
  id: number;
  class_id?: number;
  sample_index?: number;
  bbox?: number[];
  start_seconds?: number;
  end_seconds?: number;
  keyframe_count?: number;
  source_track_id?: string;
}

export interface AnnotationObservation {
  geometry_type?: "bbox" | "rotated_box" | "polygon" | "polyline" | "point" | "points" | "keypoints" | "skeleton" | "mask" | "ellipse" | "cuboid" | "classification";
  bbox?: [number, number, number, number];
  polygon?: number[];
  polyline?: number[];
  points?: number[];
  keypoints?: number[];
  skeleton?: JsonMap;
  mask?: JsonMap;
  rotated_box?: number[];
  cuboid?: number[];
  ellipse?: number[];
  attributes?: JsonMap;
  marker_id?: number;
  class_id?: number;
  class_name?: string;
  confidence?: number;
  is_keyframe?: boolean;
  source_track_id?: string;
}

export interface AnnotationSample extends JsonMap {
  project: string;
  sample_index: number;
  filename?: string;
  image_path?: string;
  width?: number;
  height?: number;
  media_seconds?: number;
  split?: string;
  observations?: Record<string, AnnotationObservation>;
}

export interface RunRecord extends JsonMap {
  id: string;
  name?: string;
  status?: string;
  modified?: string;
  provider?: string;
  workflow?: string;
  model?: string;
  device?: string;
  compute_target?: string;
  metrics?: Record<string, unknown>;
  history?: Record<string, unknown>;
  metric_series?: Record<string, unknown>;
  curves?: Record<string, unknown>;
  configuration?: Record<string, unknown>;
  artifacts?: Array<Record<string, unknown>>;
  weights?: Array<Record<string, unknown>>;
  visual_artifacts?: Array<Record<string, unknown>>;
  tree?: Array<Record<string, unknown>>;
  error?: string;
  epochs_completed?: number;
  epochs_expected?: number;
  evidence_kind?: string;
  tensorboard_events?: number;
  tensorboard_replay_available?: boolean;
}

export interface JobArtifact extends JsonMap {
  id: string;
  name: string;
  kind?: string;
  content_type?: string;
  size_bytes?: number;
  downloadable?: boolean;
  download_url?: string;
  view_url?: string;
}

export interface JobRecord extends JsonMap {
  id: string;
  project_id: string;
  name?: string;
  provider?: string;
  compute_target?: string;
  dataset_ref?: string;
  status?: "queued" | "running" | "completed" | "failed" | "cancelled";
  request?: JsonMap;
  configuration?: JsonMap;
  metrics?: JsonMap;
  artifacts?: JobArtifact[];
  error?: string;
  created_at?: string;
  started_at?: string;
  completed_at?: string;
  updated_at?: string;
}

export interface LlmAttachment {
  name: string;
  media_type: string;
  data?: string;
  path?: string;
  sha256?: string;
  size?: number;
}

export interface LlmMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  attachments?: LlmAttachment[];
}

export type LlmAnnotationSource = "manual" | "automatic" | "manual_reviewed" | "imported";

export interface LlmAnnotationValue {
  value: string | number | boolean;
  source: LlmAnnotationSource;
}

export interface LlmMetadataOption {
  value: string;
  label: string;
}

export interface LlmMetadataField {
  id: string;
  label: string;
  type: "text" | "textarea" | "number" | "integer" | "boolean" | "date" | "enum";
  group: string;
  description?: string;
  placeholder?: string;
  unit?: string;
  required_for_approval?: boolean;
  minimum?: number;
  maximum?: number;
  step?: number;
  options?: LlmMetadataOption[];
}

export interface LlmMetadataSchema {
  protocol: "modelforge.example-metadata-schema/v1";
  id: string;
  version: number;
  title: string;
  description?: string;
  path?: string;
  fields: LlmMetadataField[];
}

export interface LlmExample {
  id: string;
  split: "train" | "validation";
  messages: LlmMessage[];
  review_status?: "draft" | "reviewed" | "approved" | "rejected";
  annotations?: Record<string, LlmAnnotationValue>;
  annotation_schema?: {id: string; version: number};
  tags?: string[];
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

export interface LlmDatasetVersion {
  revision: number;
  sha256: string;
  snapshot_path: string;
}

export interface LlmEvaluationMetrics {
  examples: number;
  completed: number;
  failed: number;
  completion_rate: number;
  exact_reference_matches: number;
  exact_match_rate: number;
  mean_latency_ms: number;
  total_tokens: number;
}

export interface LlmEvaluationCase {
  example_id: string;
  input: LlmMessage[];
  reference_output: string;
  actual_output: string;
  status: "completed" | "failed";
  exact_reference_match: boolean;
  duration_ms: number;
  prompt_run_id: string;
  model: string;
  usage: {input_tokens: number; output_tokens: number; total_tokens: number};
  error?: string;
}

export interface LlmEvaluationSummary extends JsonMap {
  id: string;
  name: string;
  status: "running" | "completed" | "completed_with_errors" | string;
  created_at: string;
  completed_at?: string;
  model?: string;
  dataset: LlmDatasetVersion & {split?: string; example_ids?: string[]};
  generation: {temperature?: number; max_tokens?: number; timeout_seconds?: number};
  metrics: Partial<LlmEvaluationMetrics>;
  baseline: boolean;
  comparison?: {
    baseline_id: string;
    compatible: boolean;
    exact_match_rate_delta?: number;
    mean_latency_ms_delta?: number;
  };
}

export interface LlmEvaluation extends LlmEvaluationSummary {
  protocol: "modelforge.prompt-evaluation/v1";
  project_id: string;
  cases: LlmEvaluationCase[];
}

export interface LlmWorkspace extends JsonMap {
  protocol: string;
  project_id: string;
  revision: number;
  examples: LlmExample[];
  counts: {examples: number; messages: number; attachments: number; train: number; validation: number};
  dataset_path: string;
  dataset_version: LlmDatasetVersion;
  example_metadata_schema: LlmMetadataSchema;
  prompt_action: {
    available: boolean;
    display_name: string;
    interface: string;
    modalities: string[];
    default_model?: string;
  };
}

export interface MetricPoint {
  step: number;
  value: number;
}

export interface OpenDocument {
  key: string;
  activity: ActivityId;
  kind: "overview" | "source-collection" | "source" | "dataset" | "artifact" | "annotation" | "architecture" | "llm" | "repository" | "run-collection" | "run" | "inference" | "jobs" | "calibration" | "deployment" | "monitor" | "knowledge" | "settings";
  title: string;
  subtitle?: string;
  payload?: unknown;
  closeable?: boolean;
}
