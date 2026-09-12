import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "./lib/api";
import type {
  ActivityId,
  AnnotationRecord,
  Artifact,
  ExecutionTarget,
  ModalStatus,
  Project,
  ProjectAction,
  Run,
  Sample,
} from "./types";

type Activity = {
  id: ActivityId;
  label: string;
  shortLabel: string;
  icon: IconName;
  state: "ready" | "partial" | "unavailable";
  reason?: string;
};
type IconName =
  | "home"
  | "file"
  | "branch"
  | "database"
  | "box"
  | "training"
  | "scan"
  | "jobs"
  | "assistant"
  | "settings"
  | "book"
  | "command"
  | "search"
  | "terminal"
  | "chevron"
  | "close"
  | "plus"
  | "refresh"
  | "download"
  | "play"
  | "stop"
  | "check"
  | "cloud"
  | "cpu"
  | "layers"
  | "chart"
  | "warning"
  | "send"
  | "paperclip";

const destinations: Array<
  Pick<Activity, "id" | "label" | "shortLabel" | "icon">
> = [
  { id: "overview", label: "Overview", shortLabel: "Overview", icon: "home" },
  { id: "source", label: "Source", shortLabel: "Source", icon: "file" },
  { id: "dataset", label: "Dataset", shortLabel: "Datasets", icon: "database" },
  {
    id: "annotation",
    label: "Annotation",
    shortLabel: "Annotate",
    icon: "scan",
  },
  {
    id: "architecture",
    label: "Models / Architecture",
    shortLabel: "Models",
    icon: "box",
  },
  {
    id: "training",
    label: "Training",
    shortLabel: "Training",
    icon: "training",
  },
  {
    id: "inference",
    label: "Inference",
    shortLabel: "Inference",
    icon: "scan",
  },
  { id: "runs", label: "Jobs / Runs", shortLabel: "Jobs", icon: "jobs" },
  {
    id: "assistant",
    label: "ModelForge Coding Assistant",
    shortLabel: "Assistant",
    icon: "assistant",
  },
  {
    id: "settings",
    label: "Settings",
    shortLabel: "Settings",
    icon: "settings",
  },
];
const unavailable: Record<ActivityId, string> = {
  overview: "",
  dataset: "",
  inference: "",
  runs: "",
  settings: "",
  source:
    "The public source inspection and editing service is not delivered in this alpha slice.",
  annotation:
    "This project does not expose a dataset-backed annotation service.",
  architecture:
    "Only authored capabilities are available; safe model inspection is not delivered yet.",
  training: "This project does not declare a managed training action.",
  assistant:
    "The local Coding Assistant host and write-authority controls are not delivered yet.",
};

export function activitiesFor(project: Project | null): Activity[] {
  const actions = project
    ? project.actions?.length
      ? project.actions
      : [project.action]
    : [];
  return destinations.map((item) => {
    if (item.id === "dataset")
      return {
        ...item,
        state: project?.dataset ? "ready" : "unavailable",
        reason: project?.dataset
          ? undefined
          : "This project declares no browser dataset.",
      };
    if (item.id === "annotation")
      return {
        ...item,
        state: project?.dataset ? "ready" : "unavailable",
        reason: project?.dataset ? undefined : unavailable.annotation,
      };
    if (item.id === "training")
      return {
        ...item,
        state: actions.some((action) => action.kind === "training")
          ? "ready"
          : "unavailable",
        reason: unavailable.training,
      };
    if (item.id === "inference")
      return {
        ...item,
        state: actions.some(
          (action) => action.kind === "inference" || action.kind === "prompt",
        )
          ? "ready"
          : "unavailable",
        reason: "This project declares no managed inference or prompt action.",
      };
    if (item.id === "architecture")
      return { ...item, state: "partial", reason: unavailable.architecture };
    if (["overview", "runs", "settings"].includes(item.id))
      return { ...item, state: "ready" };
    return { ...item, state: "unavailable", reason: unavailable[item.id] };
  });
}
function projectActions(project: Project | null): ProjectAction[] {
  return project
    ? project.actions?.length
      ? project.actions
      : [project.action]
    : [];
}
export function runStatus(run: Run | null): string {
  if (!run) return "No run selected";
  if (run.runtime_observation?.state === "unavailable")
    return `${run.status} · unavailable`;
  const requested = Boolean(run.configuration?.cancellation_requested_at);
  const confirmed = Boolean(run.configuration?.cancellation_confirmed_at);
  return requested && !confirmed
    ? `${run.status} · cancellation requested`
    : run.status;
}
export function createLatestRequestGuard() {
  let current = 0;
  return {
    begin: () => ++current,
    isCurrent: (value: number) => value === current,
    invalidate: () => ++current,
  };
}
export function tableProjection(value: unknown): {
  columns: string[];
  rows: Record<string, unknown>[];
} {
  const candidates = Array.isArray(value)
    ? value
    : value && typeof value === "object"
      ? Object.values(value).filter(Array.isArray)
      : [];
  const rawRows: unknown[] = (
    Array.isArray(value) ? candidates : candidates[0] || []
  ).slice(0, 100);
  const rows: Record<string, unknown>[] = rawRows.map((row: unknown) =>
    row && typeof row === "object" && !Array.isArray(row)
      ? (row as Record<string, unknown>)
      : { value: row },
  );
  const columns: string[] = [
    ...new Set(
      rows.flatMap((row: Record<string, unknown>) => Object.keys(row)),
    ),
  ].slice(0, 20);
  return { columns, rows };
}
function trainingSeries(
  value: unknown,
): Array<{ epoch: number; loss: number; score: number }> {
  if (!value || typeof value !== "object") return [];
  const raw = (value as { series?: unknown }).series;
  if (!Array.isArray(raw)) return [];
  return raw
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const point = item as Record<string, unknown>;
      const epoch = Number(point.epoch);
      const loss = Number(point.loss);
      const score = Number(point.score);
      return Number.isFinite(epoch) &&
        Number.isFinite(loss) &&
        Number.isFinite(score)
        ? [{ epoch, loss, score }]
        : [];
    })
    .slice(0, 100);
}
const fmtBytes = (value?: number) =>
  value === undefined
    ? "size unavailable"
    : value < 1024
      ? `${value} B`
      : `${(value / 1024).toFixed(1)} KiB`;
const errorText = (reason: unknown) =>
  reason instanceof Error ? reason.message : String(reason);
const isActive = (run: Run | null) =>
  Boolean(run && ["queued", "running"].includes(run.status));
const isModal = (run: Run | null) =>
  Boolean(run?.provider === "modal" || run?.configuration?.modal);

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const shapes: Record<IconName, React.ReactNode> = {
    home: (
      <>
        <path d="M3 11.5 12 4l9 7.5" />
        <path d="M5.5 10.5V20h13v-9.5M9.5 20v-6h5v6" />
      </>
    ),
    file: (
      <>
        <path d="M6 2.8h8l4 4V21H6z" />
        <path d="M14 2.8V7h4M9 12h6M9 16h5" />
      </>
    ),
    branch: (
      <>
        <circle cx="7" cy="5" r="2" />
        <circle cx="17" cy="7" r="2" />
        <circle cx="7" cy="19" r="2" />
        <path d="M7 7v10M9 11h3a5 5 0 0 0 5-2" />
      </>
    ),
    database: (
      <>
        <ellipse cx="12" cy="5" rx="7.5" ry="3" />
        <path d="M4.5 5v7c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V5M4.5 12v7c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-7" />
      </>
    ),
    box: (
      <>
        <path d="m12 2.8 8 4.4v9.6l-8 4.4-8-4.4V7.2zM4 7.2l8 4.5 8-4.5M12 21.2v-9.5" />
      </>
    ),
    training: (
      <>
        <circle cx="6" cy="6" r="2" />
        <circle cx="18" cy="6" r="2" />
        <circle cx="12" cy="18" r="2" />
        <path d="m7.7 7.2 3.2 8.8M16.3 7.2 13.1 16M8 6h8" />
      </>
    ),
    scan: (
      <>
        <path d="M8 4H4v4M16 4h4v4M20 16v4h-4M8 20H4v-4" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    jobs: (
      <>
        <path d="M8 6h12M8 12h12M8 18h12" />
        <path d="m3.5 6 1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2" />
      </>
    ),
    assistant: (
      <path d="M12 3 9.8 8.7 4 11l5.8 2.3L12 19l2.2-5.7L20 11l-5.8-2.3z" />
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.2 13.4a7.7 7.7 0 0 0 0-2.8l2-1.6-2-3.4-2.5 1A7.7 7.7 0 0 0 14.3 5L14 2.4h-4L9.7 5a7.7 7.7 0 0 0-2.4 1.4l-2.5-1-2 3.4 2 1.7a7.7 7.7 0 0 0 0 2.8l-2 1.7 2 3.4 2.5-1A7.7 7.7 0 0 0 9.7 19l.3 2.6h4l.3-2.6a7.7 7.7 0 0 0 2.4-1.4l2.5 1 2-3.4z" />
      </>
    ),
    book: (
      <>
        <path d="M4 4.5A3.5 3.5 0 0 1 7.5 4H11v16H7.5A3.5 3.5 0 0 0 4 20.5zM20 4.5A3.5 3.5 0 0 0 16.5 4H13v16h3.5a3.5 3.5 0 0 1 3.5.5z" />
      </>
    ),
    command: (
      <path d="M9 6V5a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v14a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z" />
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m15.5 15.5 5 5" />
      </>
    ),
    terminal: (
      <>
        <path d="m5 7 4 4-4 4M11 17h8" />
      </>
    ),
    chevron: <path d="m9 6 6 6-6 6" />,
    close: (
      <>
        <path d="m6 6 12 12M18 6 6 18" />
      </>
    ),
    plus: (
      <>
        <path d="M12 5v14M5 12h14" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5" />
        <path d="M18.3 9A7 7 0 0 0 6.2 6.2L4 9M5.7 15A7 7 0 0 0 17.8 17.8L20 15" />
      </>
    ),
    download: (
      <>
        <path d="M12 3v12M7 10l5 5 5-5M5 20h14" />
      </>
    ),
    play: <path d="m8 5 11 7-11 7z" />,
    stop: <rect x="6" y="6" width="12" height="12" rx="1" />,
    check: <path d="m5 12 4 4L19 6" />,
    cloud: (
      <path d="M7 18h11a4 4 0 0 0 .5-8A6.5 6.5 0 0 0 6 8.5 4.8 4.8 0 0 0 7 18Z" />
    ),
    cpu: (
      <>
        <rect x="7" y="7" width="10" height="10" rx="1" />
        <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
      </>
    ),
    layers: (
      <>
        <path d="m12 3 9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5" />
      </>
    ),
    chart: (
      <>
        <path d="M4 20V9M10 20V4M16 20v-7M22 20H2" />
      </>
    ),
    warning: (
      <>
        <path d="M12 3 2.5 20h19z" />
        <path d="M12 9v5M12 17h.01" />
      </>
    ),
    send: (
      <>
        <path d="m3 11 18-8-8 18-2-8zM11 13 21 3" />
      </>
    ),
    paperclip: <path d="m8 12 6-6a3 3 0 1 1 4 4l-8 8a5 5 0 0 1-7-7l8-8" />,
  };
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      {...common}
    >
      {shapes[name]}
    </svg>
  );
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function UnavailableView({
  activity,
  project,
}: {
  activity: Activity;
  project: Project;
}) {
  const nodes = [
    project.dataset?.name || "Project input",
    activity.shortLabel,
    project.action?.display_name || project.action?.id || "Managed action",
  ];
  return (
    <section className="unavailable-view">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Product workspace</span>
          <h1>{activity.label}</h1>
        </div>
        <Badge tone={activity.state}>{activity.state}</Badge>
      </div>
      <div
        className="unavailable-canvas"
        aria-label={`${activity.label} service boundary`}
      >
        <div className="boundary-graph" aria-hidden="true">
          {nodes.map((node, index) => (
            <div
              key={node}
              className={index === 1 ? "graph-node active" : "graph-node"}
            >
              <Icon
                name={
                  index === 0
                    ? "database"
                    : index === 1
                      ? activity.icon
                      : "terminal"
                }
              />
              <span>{node}</span>
            </div>
          ))}
        </div>
        <div className="empty-state">
          <span className="empty-icon">
            <Icon name={activity.icon} size={26} />
          </span>
          <h2>{activity.shortLabel} service is not available</h2>
          <p>{activity.reason}</p>
          <div className="boundary-note">
            <Icon name="warning" />
            No placeholder data or action is exposed. This destination remains
            visible to preserve the complete local-product map.
          </div>
        </div>
      </div>
    </section>
  );
}

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedId, setSelectedId] = useState(
    () => sessionStorage.getItem("modelforge.public-alpha.project") || "",
  );
  const [project, setProject] = useState<Project | null>(null);
  const [activity, setActivity] = useState<ActivityId>(
    () =>
      (sessionStorage.getItem(
        "modelforge.public-alpha.activity",
      ) as ActivityId) || "overview",
  );
  const [samples, setSamples] = useState<Sample[]>([]);
  const [sampleError, setSampleError] = useState("");
  const [selectedSample, setSelectedSample] = useState<Sample | null>(null);
  const [samplePreview, setSamplePreview] = useState("");
  const [sampleText, setSampleText] = useState("");
  const [annotation, setAnnotation] = useState<AnnotationRecord | null>(null);
  const [annotationLabels, setAnnotationLabels] = useState("");
  const [annotationNote, setAnnotationNote] = useState("");
  const [runs, setRuns] = useState<Run[]>([]);
  const [currentRun, setCurrentRun] = useState<Run | null>(null);
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [artifactPreview, setArtifactPreview] = useState("");
  const [artifactText, setArtifactText] = useState("");
  const [artifactJson, setArtifactJson] = useState<unknown>(null);
  const [runLog, setRunLog] = useState("");
  const [trainingMetrics, setTrainingMetrics] = useState<unknown>(null);
  const [modal, setModal] = useState<ModalStatus | null>(null);
  const [connection, setConnection] = useState("Connecting");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [target, setTarget] = useState<ExecutionTarget | null>(null);
  const [billable, setBillable] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(
    () => window.matchMedia("(min-width: 1400px)").matches,
  );
  const [bottomOpen, setBottomOpen] = useState(true);
  const [commandOpen, setCommandOpen] = useState(false);
  const [bottomTab, setBottomTab] = useState<
    "output" | "logs" | "problems" | "jobs"
  >("output");
  const selectionEpoch = useRef(0);
  const sampleUrl = useRef("");
  const artifactUrl = useRef("");
  const projectHeading = useRef<HTMLHeadingElement>(null);
  const sampleGuard = useRef(createLatestRequestGuard());
  const artifactGuard = useRef(createLatestRequestGuard());
  const sampleRequest = useRef<AbortController | null>(null);
  const artifactRequest = useRef<AbortController | null>(null);
  const logRequest = useRef<AbortController | null>(null);
  const activities = useMemo(() => activitiesFor(project), [project]);
  const activeActivity =
    activities.find((item) => item.id === activity) || activities[0];
  const inferenceAction =
    projectActions(project).find(
      (item) => item.kind === "inference" || item.kind === "prompt",
    ) || null;
  const trainingAction =
    projectActions(project).find((item) => item.kind === "training") || null;
  const activityAction =
    activity === "training" ? trainingAction : inferenceAction;

  const clearSampleBlob = () => {
    if (sampleUrl.current) URL.revokeObjectURL(sampleUrl.current);
    sampleUrl.current = "";
    setSamplePreview("");
    setSampleText("");
  };
  const clearArtifactBlob = () => {
    if (artifactUrl.current) URL.revokeObjectURL(artifactUrl.current);
    artifactUrl.current = "";
    setArtifactPreview("");
    setArtifactText("");
    setArtifactJson(null);
  };

  useEffect(
    () => () => {
      sampleRequest.current?.abort();
      artifactRequest.current?.abort();
      logRequest.current?.abort();
      if (sampleUrl.current) URL.revokeObjectURL(sampleUrl.current);
      if (artifactUrl.current) URL.revokeObjectURL(artifactUrl.current);
    },
    [],
  );
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
      if (event.key === "Escape") setCommandOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
  useEffect(() => {
    const wide = window.matchMedia("(min-width: 1400px)");
    const onViewportChange = (event: MediaQueryListEvent) => {
      if (!event.matches) setAssistantOpen(false);
    };
    wide.addEventListener("change", onViewportChange);
    return () => wide.removeEventListener("change", onViewportChange);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    api
      .projects(controller.signal)
      .then(({ projects: values }) => {
        setProjects(values);
        const wanted = values.some((item) => item.id === selectedId)
          ? selectedId
          : values[0]?.id || "";
        setSelectedId(wanted);
        setConnection("Connected");
      })
      .catch((reason) => {
        if (reason.name !== "AbortError") {
          setError(errorText(reason));
          setConnection("Disconnected");
        }
      });
    api
      .modal(controller.signal)
      .then(setModal)
      .catch(() => setModal(null));
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!selectedId) {
      setProject(null);
      return;
    }
    const epoch = ++selectionEpoch.current;
    const controller = new AbortController();
    sessionStorage.setItem("modelforge.public-alpha.project", selectedId);
    sampleRequest.current?.abort();
    artifactRequest.current?.abort();
    logRequest.current?.abort();
    sampleGuard.current.invalidate();
    artifactGuard.current.invalidate();
    clearSampleBlob();
    clearArtifactBlob();
    setRunLog("");
    setTrainingMetrics(null);
    setProject(null);
    setSamples([]);
    setSelectedSample(null);
    setAnnotation(null);
    setAnnotationLabels("");
    setAnnotationNote("");
    setRuns([]);
    setCurrentRun(null);
    setArtifact(null);
    setPrompt("");
    setError("");
    setSampleError("");
    setBillable(false);
    Promise.all([
      api.project(selectedId, controller.signal),
      api.runs(selectedId, controller.signal),
    ])
      .then(([detail, history]) => {
        if (selectionEpoch.current !== epoch) return;
        setProject(detail);
        setRuns(history.runs);
        setCurrentRun(history.runs[0] || null);
        const targets = detail.execution_targets || [];
        setTarget(
          targets.find(
            (item) => item.readiness === "ready" && !item.billable,
          ) ||
            targets[0] ||
            null,
        );
        setConnection("Connected");
        if (detail.dataset)
          api
            .samples(detail.id, detail.dataset.id, controller.signal)
            .then((value) => {
              if (selectionEpoch.current !== epoch) return;
              setSamples(value.samples || value.items || []);
            })
            .catch((reason) => {
              if (
                reason.name !== "AbortError" &&
                selectionEpoch.current === epoch
              )
                setSampleError(errorText(reason));
            });
      })
      .catch((reason) => {
        if (reason.name !== "AbortError" && selectionEpoch.current === epoch) {
          setError(errorText(reason));
          setConnection("Disconnected");
        }
      });
    return () => controller.abort();
  }, [selectedId]);
  useEffect(() => {
    sessionStorage.setItem("modelforge.public-alpha.activity", activity);
  }, [activity]);
  useEffect(() => {
    if (project) projectHeading.current?.focus();
  }, [project?.id]);
  useEffect(() => {
    artifactRequest.current?.abort();
    artifactGuard.current.invalidate();
    clearArtifactBlob();
    setArtifact(null);
  }, [currentRun?.id]);
  useEffect(() => {
    logRequest.current?.abort();
    setRunLog("");
    const log = currentRun?.artifacts?.find(
      (item) => item.kind === "process-log",
    );
    if (!currentRun || !log || currentRun.live?.log_tail) return;
    const runId = currentRun.id;
    const epoch = selectionEpoch.current;
    const controller = new AbortController();
    logRequest.current = controller;
    api
      .artifact(runId, log.id, controller.signal)
      .then((blob) => blob.text())
      .then((text) => {
        if (
          selectionEpoch.current === epoch &&
          currentRun.id === runId &&
          !controller.signal.aborted
        )
          setRunLog(text);
      })
      .catch((reason) => {
        if (!(reason instanceof DOMException && reason.name === "AbortError"))
          setError(`Checked process log unavailable. ${errorText(reason)}`);
      });
    return () => controller.abort();
  }, [currentRun?.id, currentRun?.status, currentRun?.artifacts?.length]);
  useEffect(() => {
    if (
      !isActive(currentRun) ||
      currentRun?.runtime_observation?.state === "unavailable"
    )
      return;
    const expectedProject = project?.id;
    const controller = new AbortController();
    const timer = window.setInterval(
      () =>
        api
          .run(currentRun!.id, controller.signal)
          .then((next) => {
            if (next.project_id !== expectedProject) return;
            setCurrentRun(next);
            setRuns((values) => [
              next,
              ...values.filter((item) => item.id !== next.id),
            ]);
            setConnection("Connected");
          })
          .catch((reason) => {
            if (reason.name !== "AbortError") setConnection("Reconnecting");
          }),
      700,
    );
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [
    currentRun?.id,
    currentRun?.status,
    currentRun?.runtime_observation?.state,
    project?.id,
  ]);
  useEffect(() => {
    const action = projectActions(project).find(
      (item) => item.kind === "training",
    );
    const run = runs.find(
      (item) =>
        item.status === "completed" &&
        (item.request?.workflow === "training" ||
          item.configuration?.action_id === action?.id),
    );
    const metrics = run?.artifacts?.find(
      (item) =>
        item.kind === "training-metrics" || item.name === "metrics.json",
    );
    if (!run || !metrics) {
      setTrainingMetrics(null);
      return;
    }
    const controller = new AbortController();
    api
      .artifact(run.id, metrics.id, controller.signal)
      .then((blob) => blob.text())
      .then((text) => JSON.parse(text) as unknown)
      .then(setTrainingMetrics)
      .catch((reason) => {
        if (reason.name !== "AbortError") setTrainingMetrics(null);
      });
    return () => controller.abort();
  }, [project?.id, runs]);

  async function chooseSample(value: Sample) {
    if (!project?.dataset) return;
    const epoch = selectionEpoch.current;
    sampleRequest.current?.abort();
    const controller = new AbortController();
    sampleRequest.current = controller;
    const request = sampleGuard.current.begin();
    setSelectedSample(value);
    setAnnotation(null);
    setAnnotationLabels("");
    setAnnotationNote("");
    clearSampleBlob();
    setError("");
    try {
      const [blob, record] = await Promise.all([
        api.sampleContent(
          project.id,
          project.dataset.id,
          value.id,
          controller.signal,
        ),
        api.annotation(
          project.id,
          project.dataset.id,
          value.id,
          controller.signal,
        ),
      ]);
      if (
        epoch !== selectionEpoch.current ||
        !sampleGuard.current.isCurrent(request)
      )
        return;
      if (blob.type.startsWith("text/") || blob.type.includes("json"))
        setSampleText(await blob.text());
      else {
        const url = URL.createObjectURL(blob);
        if (!sampleGuard.current.isCurrent(request)) {
          URL.revokeObjectURL(url);
          return;
        }
        sampleUrl.current = url;
        setSamplePreview(url);
      }
      setAnnotation(record);
      setAnnotationLabels(record.labels.join(", "));
      setAnnotationNote(record.note);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError")
        return;
      if (
        epoch === selectionEpoch.current &&
        sampleGuard.current.isCurrent(request)
      )
        setError(`Checked sample preview unavailable. ${errorText(reason)}`);
    }
  }
  async function saveAnnotation() {
    if (!project?.dataset || !selectedSample || !annotation) return;
    setBusy(true);
    setError("");
    try {
      const next = await api.saveAnnotation(
        project.id,
        project.dataset.id,
        selectedSample.id,
        {
          sample_sha256: selectedSample.sha256 || "",
          expected_revision: annotation.revision,
          labels: annotationLabels
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
          note: annotationNote,
          boxes: annotation.boxes || [],
        },
      );
      setAnnotation(next);
    } catch (reason) {
      setError(`Annotation was not saved. ${errorText(reason)}`);
    } finally {
      setBusy(false);
    }
  }
  async function launch(action: ProjectAction | null) {
    if (!project || !target || !action) return;
    setBusy(true);
    setError("");
    const input =
      action.kind === "prompt"
        ? {
            messages: [{ role: "user", content: prompt }],
            generation: { max_new_tokens: 256, temperature: 0, top_p: 1 },
          }
        : action.kind === "training" && project.dataset
          ? {
              dataset_id: project.dataset.id,
              dataset_split: "train",
              epochs: 3,
              annotation_revision: annotation?.revision || 0,
            }
          : selectedSample && project.dataset
            ? { dataset_id: project.dataset.id, sample_id: selectedSample.id }
            : {};
    const fingerprint = JSON.stringify({
      project: project.id,
      action: action.id,
      target: target.target,
      binding: target.binding_sha256 || null,
      input,
    });
    const key = `modelforge.public-alpha.launch.${project.id}`;
    let idempotency = crypto.randomUUID();
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) || "null");
      if (saved?.fingerprint === fingerprint) idempotency = saved.idempotency;
    } catch {
      /* replace malformed tab state */
    }
    sessionStorage.setItem(key, JSON.stringify({ fingerprint, idempotency }));
    try {
      const run = await api.launch(project.id, action.id, {
        protocol: "modelforge.managed-action-request/v1",
        execution: {
          target: target.target,
          idempotency_key: idempotency,
          binding_sha256: target.binding_sha256 || null,
          billable_confirmed: Boolean(target.billable) && billable,
        },
        input,
      });
      sessionStorage.removeItem(key);
      setCurrentRun(run);
      setRuns((values) => [
        run,
        ...values.filter((item) => item.id !== run.id),
      ]);
      setActivity("runs");
      setBottomOpen(true);
      setBottomTab("output");
      if (target.billable) setBillable(false);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status < 500)
        sessionStorage.removeItem(key);
      setError(
        `${errorText(reason)}${reason instanceof ApiError && reason.status < 500 ? "" : " The launch outcome may be unknown; retrying unchanged reuses the same identity."}`,
      );
    } finally {
      setBusy(false);
    }
  }
  async function mutateRun(kind: "cancel" | "recover") {
    if (!currentRun) return;
    setBusy(true);
    setError("");
    try {
      const next = await api[kind](currentRun.id);
      setCurrentRun(next);
      setRuns((values) => [
        next,
        ...values.filter((item) => item.id !== next.id),
      ]);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }
  async function openArtifact(value: Artifact) {
    if (!currentRun) return;
    const epoch = selectionEpoch.current;
    const runId = currentRun.id;
    artifactRequest.current?.abort();
    const controller = new AbortController();
    artifactRequest.current = controller;
    const request = artifactGuard.current.begin();
    setArtifact(value);
    clearArtifactBlob();
    setError("");
    setBottomOpen(true);
    setBottomTab("output");
    try {
      const blob = await api.artifact(runId, value.id, controller.signal);
      if (
        epoch !== selectionEpoch.current ||
        !artifactGuard.current.isCurrent(request)
      )
        return;
      if (blob.type.startsWith("text/") || blob.type.includes("json")) {
        const text = await blob.text();
        if (!artifactGuard.current.isCurrent(request)) return;
        if (value.kind === "table" && blob.type.includes("json"))
          setArtifactJson(JSON.parse(text));
        else setArtifactText(text);
      } else {
        const url = URL.createObjectURL(blob);
        if (!artifactGuard.current.isCurrent(request)) {
          URL.revokeObjectURL(url);
          return;
        }
        artifactUrl.current = url;
        setArtifactPreview(url);
      }
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError")
        return;
      if (
        epoch === selectionEpoch.current &&
        artifactGuard.current.isCurrent(request)
      )
        setError(`Checked artifact unavailable. ${errorText(reason)}`);
    }
  }
  async function downloadArtifact(value: Artifact) {
    if (!currentRun) return;
    try {
      const blob = await api.artifact(currentRun.id, value.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = value.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (reason) {
      setError(`Download unavailable. ${errorText(reason)}`);
    }
  }
  function navigate(next: ActivityId) {
    setActivity(next);
    setCommandOpen(false);
  }

  const targetReady = Boolean(
    target && (target.readiness === "ready" || target.ready),
  );
  const needsInput =
    inferenceAction?.kind === "prompt"
      ? !prompt.trim()
      : Boolean(samples.length && !selectedSample);
  const launchBlocked = !targetReady
    ? "Execution target unavailable"
    : needsInput
      ? `Select ${inferenceAction?.kind === "prompt" ? "a prompt" : "a sample"}`
      : target?.billable && !billable
        ? "Confirm this billable target"
        : "";
  const appClass = `app-shell${assistantOpen ? " assistant-open" : " assistant-closed"}${bottomOpen ? " bottom-open" : " bottom-closed"}`;

  return (
    <div className={appClass}>
      <a className="skip-link" href="#workspace">
        Skip to workspace
      </a>
      <header className="title-bar">
        <button
          className="brand"
          onClick={() => navigate("overview")}
          aria-label="ModelForge home"
        >
          <span className="brand-mark">
            <span>M</span>
          </span>
          <span className="brand-word">
            Model<strong>Forge</strong>
          </span>
        </button>
        <label className="project-select">
          <span className="sr-only">Project</span>
          <Icon name="file" />
          <select
            aria-label="Project"
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {projects.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          <Icon name="chevron" size={14} />
        </label>
        <div className="compute-chip" title="Local execution boundary">
          <span>LOCAL</span>
          <strong>{target?.provider === "modal" ? "MODAL" : "SYSTEM"}</strong>
        </div>
        <div className="runtime-chip">
          <Icon name="cpu" />
          <span>{project?.runtime_readiness || "checking"}</span>
          <i className={connection.toLowerCase()} />
        </div>
        <button
          className="command-search"
          aria-label="Search or run a command"
          onClick={() => setCommandOpen(true)}
        >
          <Icon name="search" />
          <span>Search or run a command</span>
          <kbd>Ctrl K</kbd>
        </button>
        <button
          className={`icon-button assistant-toggle ${assistantOpen ? "active" : ""}`}
          onClick={() => setAssistantOpen((value) => !value)}
          aria-pressed={assistantOpen}
          aria-label="Toggle ModelForge Coding Assistant"
        >
          <Icon name="assistant" />
        </button>
        <div className="profile" aria-label="Local profile">
          <span>MF</span>
          <i />
        </div>
      </header>

      <nav className="activity-rail" aria-label="Workbench destinations">
        <div className="rail-main">
          {activities
            .filter((item) => item.id !== "settings")
            .map((item) => (
              <button
                key={item.id}
                aria-label={item.label}
                aria-current={activity === item.id ? "page" : undefined}
                onClick={() => navigate(item.id)}
                title={item.reason || item.label}
              >
                <span className="rail-icon">
                  <Icon name={item.icon} />
                  {item.state !== "ready" && <i aria-hidden="true" />}
                </span>
                <span>{item.shortLabel}</span>
              </button>
            ))}
        </div>
        <div className="rail-secondary">
          <a
            href="/modal-setup.html"
            target="_blank"
            rel="noreferrer"
            aria-label="Learn"
          >
            <span className="rail-icon">
              <Icon name="book" />
            </span>
            <span>Learn</span>
          </a>
          <button aria-label="Commands" onClick={() => setCommandOpen(true)}>
            <span className="rail-icon">
              <Icon name="command" />
            </span>
            <span>Commands</span>
          </button>
          {activities
            .filter((item) => item.id === "settings")
            .map((item) => (
              <button
                key={item.id}
                aria-label={item.label}
                aria-current={activity === item.id ? "page" : undefined}
                onClick={() => navigate(item.id)}
              >
                <span className="rail-icon">
                  <Icon name={item.icon} />
                </span>
                <span>{item.shortLabel}</span>
              </button>
            ))}
        </div>
      </nav>

      <div
        className="document-tabs"
        role="tablist"
        aria-label="Open workbench documents"
      >
        <button role="tab" aria-selected="true">
          <Icon name={activeActivity.icon} />
          <span>
            {activeActivity.shortLabel}
            {project ? ` · ${project.name}` : ""}
          </span>
          <Icon name="close" size={13} />
        </button>
        <button
          className="new-tab"
          role="tab"
          aria-selected="false"
          aria-label="New document"
          onClick={() => navigate("overview")}
        >
          <Icon name="plus" size={15} />
        </button>
      </div>

      <main id="workspace" className="workspace" tabIndex={-1}>
        <h1 className="project-heading" ref={projectHeading} tabIndex={-1}>
          {project?.name || "ModelForge public workbench"}
        </h1>
        {error && (
          <div className="error" role="alert">
            <Icon name="warning" />
            <span>{error}</span>
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <Icon name="close" />
            </button>
          </div>
        )}
        {!project ? (
          <div className="loading">
            <span className="loading-mark">
              <Icon name="layers" />
            </span>
            <strong>Opening local project…</strong>
          </div>
        ) : activeActivity.state !== "ready" ? (
          <UnavailableView activity={activeActivity} project={project} />
        ) : activity === "overview" ? (
          <Overview
            project={project}
            modal={modal}
            runs={runs}
            onNavigate={navigate}
          />
        ) : activity === "dataset" ? (
          <Dataset
            project={project}
            samples={samples}
            selected={selectedSample}
            preview={samplePreview}
            text={sampleText}
            error={sampleError}
            onSelect={chooseSample}
            onRun={() => navigate("annotation")}
          />
        ) : activity === "annotation" ? (
          <AnnotationStudio
            project={project}
            samples={samples}
            selected={selectedSample}
            preview={samplePreview}
            text={sampleText}
            annotation={annotation}
            labels={annotationLabels}
            note={annotationNote}
            busy={busy}
            onSelect={chooseSample}
            onLabels={setAnnotationLabels}
            onNote={setAnnotationNote}
            onAddBox={() =>
              annotation &&
              setAnnotation({
                ...annotation,
                boxes: [
                  ...(annotation.boxes || []),
                  {
                    id: crypto.randomUUID(),
                    label: annotationLabels.split(",")[0]?.trim() || "object",
                    x: 0.2,
                    y: 0.2,
                    width: 0.42,
                    height: 0.46,
                  },
                ],
              })
            }
            onSave={saveAnnotation}
            onContinue={() => navigate("training")}
          />
        ) : activity === "training" ? (
          <Training
            project={project}
            action={trainingAction}
            runs={runs}
            metrics={trainingMetrics}
            target={target}
            busy={busy}
            onLaunch={() => launch(trainingAction)}
          />
        ) : activity === "inference" ? (
          <Action
            project={project}
            action={inferenceAction!}
            target={target}
            setTarget={setTarget}
            prompt={prompt}
            setPrompt={setPrompt}
            selectedSample={selectedSample}
            billable={billable}
            setBillable={setBillable}
            blocked={launchBlocked}
            busy={busy}
            onLaunch={() => launch(inferenceAction)}
          />
        ) : activity === "runs" ? (
          <RunHistory
            runs={runs}
            current={currentRun}
            onSelect={(run) => {
              setCurrentRun(run);
              setBottomOpen(true);
            }}
          />
        ) : (
          <Settings modal={modal} />
        )}
      </main>

      <aside
        className="assistant-panel"
        aria-label="ModelForge Coding Assistant"
      >
        <header>
          <div className="assistant-identity">
            <span className="assistant-mark">
              <Icon name="assistant" />
            </span>
            <div>
              <strong>ModelForge Coding Assistant</strong>
              <small>local project agent</small>
            </div>
          </div>
          <button
            className="icon-button"
            onClick={() => setAssistantOpen(false)}
            aria-label="Close ModelForge Coding Assistant"
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="assistant-context">
          <span>CONTEXT</span>
          <Badge>{activeActivity.shortLabel}</Badge>
        </div>
        <div className="assistant-conversation">
          <div className="assistant-welcome">
            <span className="assistant-mark large">
              <Icon name="assistant" size={24} />
            </span>
            <h2>Your ModelForge project agent</h2>
            <p>
              The assistant panel stays in context while you inspect data,
              execute supported actions, and review evidence.
            </p>
          </div>
          <div className="assistant-unavailable">
            <Badge tone="unavailable">Unavailable in this alpha</Badge>
            <p>{unavailable.assistant}</p>
          </div>
          <div
            className="suggestion-list"
            aria-label="Example assistant requests"
          >
            <span>When enabled, you can ask:</span>
            <div>
              Explain the selected {activeActivity.shortLabel.toLowerCase()} in
              this project
            </div>
            <div>Summarize the latest run evidence</div>
            <div>Help diagnose a failed local action</div>
          </div>
        </div>
        <div className="assistant-composer">
          <label>
            <span className="sr-only">Ask the ModelForge Coding Assistant</span>
            <textarea
              rows={2}
              disabled
              placeholder={`Ask about ${activeActivity.shortLabel.toLowerCase()}…`}
            />
          </label>
          <div>
            <button disabled aria-label="Attach context">
              <Icon name="paperclip" />
            </button>
            <button disabled className="send" aria-label="Send message">
              <Icon name="send" />
            </button>
          </div>
        </div>
        <footer>Project-scoped · no write authority exposed</footer>
      </aside>

      <section className="bottom-panel" aria-label="Run evidence">
        <div className="bottom-tabs">
          <div role="tablist" aria-label="Run evidence panels">
            {(
              [
                ["output", "Output"],
                ["logs", "Logs"],
                ["problems", `Problems${error ? " 1" : ""}`],
                ["jobs", `Jobs ${runs.length}`],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                role="tab"
                aria-selected={bottomTab === id}
                onClick={() => {
                  setBottomTab(id);
                  setBottomOpen(true);
                }}
              >
                <Icon
                  name={
                    id === "jobs"
                      ? "jobs"
                      : id === "problems"
                        ? "warning"
                        : id === "logs"
                          ? "file"
                          : "terminal"
                  }
                />
                {label}
              </button>
            ))}
          </div>
          <button
            className="panel-collapse"
            aria-label={
              bottomOpen ? "Collapse run evidence" : "Expand run evidence"
            }
            onClick={() => setBottomOpen((value) => !value)}
          >
            <span>{bottomOpen ? "⌄" : "⌃"}</span>
          </button>
        </div>
        <div className="bottom-content">
          {bottomTab === "output" ? (
            <aside className="run-inspector" aria-label="Current run">
              <RunDetail
                run={currentRun}
                runLog={runLog}
                busy={busy}
                onCancel={() => mutateRun("cancel")}
                onRecover={() => mutateRun("recover")}
                onOpen={openArtifact}
                onDownload={downloadArtifact}
                artifact={artifact}
                artifactPreview={artifactPreview}
                artifactText={artifactText}
                artifactJson={artifactJson}
              />
            </aside>
          ) : bottomTab === "logs" ? (
            <pre className="full-log" aria-label="Run log">
              {currentRun?.live?.log_tail || runLog || "No live log attached."}
            </pre>
          ) : bottomTab === "problems" ? (
            <div className="panel-empty">
              <Icon name={error ? "warning" : "check"} />
              <span>{error || "No current problems"}</span>
            </div>
          ) : (
            <div className="panel-job-list">
              {runs.slice(0, 6).map((run) => (
                <button
                  key={run.id}
                  onClick={() => {
                    setCurrentRun(run);
                    setBottomTab("output");
                  }}
                >
                  <Badge tone={run.status}>{runStatus(run)}</Badge>
                  <code>{run.id}</code>
                </button>
              ))}
              {!runs.length && <span>No jobs recorded for this project.</span>}
            </div>
          )}
        </div>
      </section>

      <footer className="status-bar">
        <span>
          <Icon name="branch" />
          local
        </span>
        <span>
          <Icon name="database" />
          {project?.dataset?.id || "no dataset"}
        </span>
        <span>
          <Icon name="box" />
          {activityAction?.id || "no action"}
        </span>
        <span className="status-right">
          <i className={connection.toLowerCase()} />
          <span>{connection}</span>
          <span>{activeActivity.shortLabel}</span>
          <span>ALPHA</span>
          <code>v0.1.0a1</code>
        </span>
      </footer>

      {commandOpen && (
        <div
          className="command-overlay"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCommandOpen(false);
          }}
        >
          <section
            className="command-palette"
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
          >
            <header>
              <Icon name="search" />
              <span>Go to a ModelForge workspace…</span>
              <kbd>Esc</kbd>
            </header>
            <div>
              {activities.map((item) => (
                <button key={item.id} onClick={() => navigate(item.id)}>
                  <span className="command-icon">
                    <Icon name={item.icon} />
                  </span>
                  <span>
                    <strong>Open {item.label}</strong>
                    <small>{item.reason || "Available for this project"}</small>
                  </span>
                  <Badge tone={item.state}>{item.state}</Badge>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function Overview({
  project,
  modal,
  runs,
  onNavigate,
}: {
  project: Project;
  modal: ModalStatus | null;
  runs: Run[];
  onNavigate: (activity: ActivityId) => void;
}) {
  const complete = runs.filter((run) => run.status === "completed").length;
  return (
    <section className="overview-view">
      <div className="overview-hero">
        <span className="eyebrow">Project workspace</span>
        <h1 tabIndex={-1}>{project.name}</h1>
        <p className="lead">{project.description}</p>
        <div className="hero-actions">
          <button
            className="primary"
            onClick={() =>
              onNavigate(project.dataset ? "dataset" : "inference")
            }
          >
            <Icon name={project.dataset ? "database" : "play"} />
            Open {project.dataset ? "dataset" : "action"}
          </button>
          <button onClick={() => onNavigate("runs")}>
            <Icon name="jobs" />
            Review jobs
          </button>
        </div>
      </div>
      <div className="project-flow" aria-label="Project pipeline">
        <div>
          <span className="flow-icon">
            <Icon name="database" />
          </span>
          <small>INPUT</small>
          <strong>{project.dataset?.name || "Action-owned input"}</strong>
        </div>
        <i />
        <div>
          <span className="flow-icon">
            <Icon name="cpu" />
          </span>
          <small>ACTION</small>
          <strong>{project.action.display_name || project.action.id}</strong>
        </div>
        <i />
        <div>
          <span className="flow-icon">
            <Icon name="layers" />
          </span>
          <small>EVIDENCE</small>
          <strong>
            {runs.length} durable {runs.length === 1 ? "run" : "runs"}
          </strong>
        </div>
      </div>
      <div className="metric-grid">
        <article>
          <span className="metric-icon">
            <Icon name="check" />
          </span>
          <div>
            <small>RUNTIME READINESS</small>
            <strong>{project.runtime_readiness || "not evaluated"}</strong>
            <p>
              {project.readiness_reasons?.join(" · ") ||
                "No readiness blocker reported."}
            </p>
          </div>
        </article>
        <article>
          <span className="metric-icon">
            <Icon name="jobs" />
          </span>
          <div>
            <small>RECORDED JOBS</small>
            <strong>{runs.length}</strong>
            <p>{complete} completed with server-owned evidence.</p>
          </div>
        </article>
        <article>
          <span className="metric-icon">
            <Icon name="cloud" />
          </span>
          <div>
            <small>OPTIONAL MODAL</small>
            <strong>{modal?.state || "unavailable"}</strong>
            <p>{modal?.message || "Provider readiness could not be read."}</p>
          </div>
        </article>
      </div>
      <div className="overview-grid">
        <article className="card capability-card">
          <header>
            <div>
              <span className="eyebrow">Declared by project</span>
              <h2>Capabilities</h2>
            </div>
            <Badge>{project.capabilities?.length || 0}</Badge>
          </header>
          <div className="capability-list">
            {project.capabilities?.map((item) => (
              <span key={item}>
                <Icon name="check" />
                <code>{item}</code>
              </span>
            )) || <p className="empty">No capabilities declared.</p>}
          </div>
        </article>
        <article className="card safety-card">
          <header>
            <div>
              <span className="eyebrow">Execution boundary</span>
              <h2>Trusted local runtime</h2>
            </div>
            <Icon name="cpu" />
          </header>
          <p>
            Trusted local code runs with your operating-system permissions.
            ModelForge isolates owned outputs; it is not a sandbox.
          </p>
          <dl>
            <div>
              <dt>Browser</dt>
              <dd>Bearer authenticated</dd>
            </div>
            <div>
              <dt>Artifacts</dt>
              <dd>Digest checked</dd>
            </div>
            <div>
              <dt>Lifecycle</dt>
              <dd>Server authoritative</dd>
            </div>
          </dl>
        </article>
      </div>
    </section>
  );
}

function Dataset({
  project,
  samples,
  selected,
  preview,
  text,
  error,
  onSelect,
  onRun,
}: {
  project: Project;
  samples: Sample[];
  selected: Sample | null;
  preview: string;
  text: string;
  error: string;
  onSelect: (sample: Sample) => void;
  onRun: () => void;
}) {
  return (
    <section className="dataset-view">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Checked project input</span>
          <h1>{project.dataset?.name || "Dataset"}</h1>
          <p>
            {samples.length} browser-selectable{" "}
            {samples.length === 1 ? "sample" : "samples"} · authenticated
            content
          </p>
        </div>
        <button className="primary" disabled={!selected} onClick={onRun}>
          <Icon name="scan" />
          Open annotation
        </button>
      </div>
      {error && (
        <div className="boundary-note">
          <Icon name="warning" />
          Catalog unavailable: {error}. The action may own a bundled input that
          needs no browser selection.
        </div>
      )}
      <div className="dataset-layout">
        <aside className="sample-sidebar">
          <header>
            <div className="input-search">
              <Icon name="search" />
              <span>Filter samples</span>
            </div>
            <button aria-label="Refresh samples" disabled>
              <Icon name="refresh" />
            </button>
          </header>
          <div
            className="sample-list"
            role="listbox"
            aria-label="Dataset samples"
          >
            {samples.length ? (
              samples.map((item) => (
                <button
                  key={item.id}
                  role="option"
                  aria-selected={selected?.id === item.id}
                  onClick={() => onSelect(item)}
                >
                  <span className="sample-type">
                    <Icon
                      name={
                        item.content_type?.startsWith("video/")
                          ? "play"
                          : "file"
                      }
                    />
                  </span>
                  <span>
                    <strong>{item.name || item.id}</strong>
                    <small>
                      {item.content_type || "unknown type"} ·{" "}
                      {fmtBytes(item.size_bytes)}
                    </small>
                    <code>{item.sha256 || "digest unavailable"}</code>
                  </span>
                  <Icon name="chevron" size={14} />
                </button>
              ))
            ) : (
              <p className="empty">
                No browser-selectable samples were returned.
              </p>
            )}
          </div>
        </aside>
        <div className="media-workspace">
          <header>
            <div>
              <small>SELECTED SAMPLE</small>
              <strong>{selected?.name || "Nothing selected"}</strong>
            </div>
            {selected && <Badge>checked</Badge>}
          </header>
          <div className="preview">
            {preview && selected?.content_type?.startsWith("video/") ? (
              <video controls src={preview} />
            ) : preview && selected?.content_type?.startsWith("image/") ? (
              <img
                src={preview}
                alt={`Checked preview of ${selected.name || selected.id}`}
              />
            ) : text ? (
              <pre className="sample-text-preview">{text}</pre>
            ) : (
              <div className="preview-empty">
                <span>
                  <Icon name="scan" size={28} />
                </span>
                <strong>Choose a sample to inspect</strong>
                <p>
                  ModelForge fetches authenticated, digest-bound content from
                  the local server.
                </p>
              </div>
            )}
          </div>
          {selected && (
            <footer>
              <span>
                <strong>ID</strong>
                <code>{selected.id}</code>
              </span>
              <span>
                <strong>SPLIT</strong>
                {selected.split || "not declared"}
              </span>
              <span>
                <strong>SIZE</strong>
                {fmtBytes(selected.size_bytes)}
              </span>
            </footer>
          )}
        </div>
      </div>
    </section>
  );
}

function AnnotationStudio({
  project,
  samples,
  selected,
  preview,
  text,
  annotation,
  labels,
  note,
  busy,
  onSelect,
  onLabels,
  onNote,
  onAddBox,
  onSave,
  onContinue,
}: {
  project: Project;
  samples: Sample[];
  selected: Sample | null;
  preview: string;
  text: string;
  annotation: AnnotationRecord | null;
  labels: string;
  note: string;
  busy: boolean;
  onSelect: (sample: Sample) => void;
  onLabels: (value: string) => void;
  onNote: (value: string) => void;
  onAddBox: () => void;
  onSave: () => void;
  onContinue: () => void;
}) {
  const visual = Boolean(
    selected?.content_type?.startsWith("image/") ||
      selected?.content_type?.startsWith("video/"),
  );
  return (
    <section className="annotation-view">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Revisioned project sidecar</span>
          <h1>Annotation studio</h1>
          <p>
            Curate the selected sample without modifying the source dataset.
          </p>
        </div>
        <div className="heading-actions">
          <Badge tone={annotation ? "success" : "neutral"}>
            revision {annotation?.revision ?? "—"}
          </Badge>
          <button
            className="primary"
            disabled={!annotation || busy}
            onClick={onSave}
          >
            <Icon name="check" />
            {busy ? "Saving…" : "Save annotation"}
          </button>
        </div>
      </div>
      <div className="annotation-layout">
        <aside className="annotation-samples">
          <header>
            <span>DATASET ITEMS</span>
            <Badge>{samples.length}</Badge>
          </header>
          {samples.map((item) => (
            <button
              key={item.id}
              aria-pressed={selected?.id === item.id}
              onClick={() => onSelect(item)}
            >
              <span className="sample-type">
                <Icon
                  name={
                    item.content_type?.startsWith("video/") ? "play" : "file"
                  }
                />
              </span>
              <span>
                <strong>{item.name || item.id}</strong>
                <small>{item.split || "unspecified"}</small>
              </span>
            </button>
          ))}
        </aside>
        <div className="annotation-canvas">
          <header>
            <div>
              <small>ANNOTATION TARGET</small>
              <strong>{selected?.name || "Select a dataset item"}</strong>
            </div>
            {selected && <code>{selected.sha256?.slice(0, 12)}…</code>}
          </header>
          <div className="annotation-media">
            {preview && selected?.content_type?.startsWith("video/") ? (
              <video controls src={preview} />
            ) : preview && selected?.content_type?.startsWith("image/") ? (
              <img
                src={preview}
                alt={`Annotation target ${selected.name || selected.id}`}
              />
            ) : (
              <div className="conversation-sheet">
                <Icon name="file" size={28} />
                <strong>
                  {selected
                    ? "Conversation / structured sample"
                    : "No sample selected"}
                </strong>
                {text ? (
                  <pre>{text}</pre>
                ) : (
                  <p>
                    {selected
                      ? "Use labels and review notes to curate this digest-bound item."
                      : "Choose an item from the dataset catalog."}
                  </p>
                )}
              </div>
            )}
            {visual &&
              annotation?.boxes?.map((box) => (
                <div
                  key={box.id}
                  className="annotation-box"
                  style={{
                    left: `${box.x * 100}%`,
                    top: `${box.y * 100}%`,
                    width: `${box.width * 100}%`,
                    height: `${box.height * 100}%`,
                  }}
                >
                  <span>{box.label}</span>
                </div>
              ))}
          </div>
          <footer>
            <span>Source bytes remain immutable</span>
            {visual && (
              <button disabled={!selected} onClick={onAddBox}>
                <Icon name="plus" />
                Add bounding box
              </button>
            )}
          </footer>
        </div>
        <aside className="annotation-properties">
          <span className="eyebrow">Properties</span>
          <h2>Labels & review</h2>
          <label>
            <span>Labels</span>
            <input
              value={labels}
              onChange={(event) => onLabels(event.target.value)}
              disabled={!annotation}
              placeholder="person, vehicle"
            />
          </label>
          <label>
            <span>Review note</span>
            <textarea
              rows={8}
              value={note}
              onChange={(event) => onNote(event.target.value)}
              disabled={!annotation}
              placeholder="Record the human review decision…"
            />
          </label>
          <dl>
            <div>
              <dt>Sample digest</dt>
              <dd>
                <code>{annotation?.sample_sha256?.slice(0, 12) || "—"}</code>
              </dd>
            </div>
            <div>
              <dt>Geometry</dt>
              <dd>{annotation?.boxes?.length || 0} boxes</dd>
            </div>
            <div>
              <dt>Storage</dt>
              <dd>Owner state</dd>
            </div>
          </dl>
          <button disabled={!annotation} onClick={onContinue}>
            Continue to training
            <Icon name="chevron" />
          </button>
        </aside>
      </div>
    </section>
  );
}

function Training({
  project,
  action,
  runs,
  metrics,
  target,
  busy,
  onLaunch,
}: {
  project: Project;
  action: ProjectAction | null;
  runs: Run[];
  metrics: unknown;
  target: ExecutionTarget | null;
  busy: boolean;
  onLaunch: () => void;
}) {
  const trainingRuns = runs.filter(
    (run) =>
      run.request?.workflow === "training" ||
      run.configuration?.action_id === action?.id,
  );
  const latest = trainingRuns[0];
  const progress =
    latest?.live?.progress?.percent ??
    (latest?.status === "completed" ? 100 : 0);
  const series = trainingSeries(metrics);
  const maxLoss = Math.max(...series.map((item) => item.loss), 1);
  return (
    <section className="training-view">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Managed training</span>
          <h1>Training dashboard</h1>
          <p>
            Launch the project-owned trainer through the same durable run, log,
            cancellation, and artifact pipeline.
          </p>
        </div>
        <button
          className="primary"
          disabled={!action || !target || busy}
          onClick={onLaunch}
        >
          <Icon name="play" />
          {busy ? "Starting…" : action?.display_name || "Training unavailable"}
        </button>
      </div>
      <div className="training-summary">
        <article>
          <small>ACTION</small>
          <strong>{action?.id || "not declared"}</strong>
          <span>{project.dataset?.name || "No dataset"}</span>
        </article>
        <article>
          <small>EXECUTION</small>
          <strong>{target?.target || "none"}</strong>
          <span>
            {target?.billable ? "Billable target" : "Local nonbillable"}
          </span>
        </article>
        <article>
          <small>LATEST STATE</small>
          <strong>{latest?.status || "not started"}</strong>
          <span>
            {trainingRuns.length} durable training{" "}
            {trainingRuns.length === 1 ? "run" : "runs"}
          </span>
        </article>
      </div>
      <div className="training-grid">
        <article className="chart-card">
          <header>
            <div>
              <span className="eyebrow">Live telemetry</span>
              <h2>Training progress</h2>
            </div>
            <Badge tone={latest?.status || "neutral"}>
              {latest?.status || "idle"}
            </Badge>
          </header>
          <div
            className="line-chart"
            role="img"
            aria-label={`Training progress ${progress} percent`}
          >
            <div className="chart-grid" />
            {series.map((point) => (
              <i
                key={point.epoch}
                style={{
                  height: `${Math.max(2, (point.loss / maxLoss) * 100)}%`,
                }}
                title={`Epoch ${point.epoch}: loss ${point.loss}, score ${point.score}`}
              >
                <span>{point.epoch}</span>
              </i>
            ))}
            {!series.length && (
              <p className="chart-empty">
                Metrics appear after a checked training run.
              </p>
            )}
          </div>
          <footer>
            <span>Epoch</span>
            <strong>{progress}% complete</strong>
          </footer>
          {series.length > 0 && (
            <table className="metric-series">
              <caption>Recorded metric series</caption>
              <thead>
                <tr>
                  <th>Epoch</th>
                  <th>Loss</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {series.map((point) => (
                  <tr key={point.epoch}>
                    <td>{point.epoch}</td>
                    <td>{point.loss.toFixed(3)}</td>
                    <td>{point.score.toFixed(3)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </article>
        <article className="chart-card">
          <header>
            <div>
              <span className="eyebrow">Verified outputs</span>
              <h2>Run evidence</h2>
            </div>
            <Icon name="layers" />
          </header>
          <div className="evidence-stack">
            <div>
              <Icon name="terminal" />
              <span>
                <strong>Process log</strong>
                <small>Bounded stdout and stderr</small>
              </span>
            </div>
            <div>
              <Icon name="chart" />
              <span>
                <strong>Metrics</strong>
                <small>Finite scalar series artifact</small>
              </span>
            </div>
            <div>
              <Icon name="box" />
              <span>
                <strong>Checkpoint</strong>
                <small>Digest-checked, never auto-promoted</small>
              </span>
            </div>
          </div>
          <p>
            Select the completed job below to inspect its real files and native
            metrics.
          </p>
        </article>
      </div>
    </section>
  );
}

function Action({
  project,
  action,
  target,
  setTarget,
  prompt,
  setPrompt,
  selectedSample,
  billable,
  setBillable,
  blocked,
  busy,
  onLaunch,
}: {
  project: Project;
  action: ProjectAction;
  target: ExecutionTarget | null;
  setTarget: (value: ExecutionTarget | null) => void;
  prompt: string;
  setPrompt: (value: string) => void;
  selectedSample: Sample | null;
  billable: boolean;
  setBillable: (value: boolean) => void;
  blocked: string;
  busy: boolean;
  onLaunch: () => void;
}) {
  const targets = project.execution_targets || [];
  return (
    <section className="action-view">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Managed action</span>
          <h1>
            {action.kind === "prompt" ? "Prompt studio" : "Inference workspace"}
          </h1>
          <p>
            Launch through the durable project action contract and inspect
            native results below.
          </p>
        </div>
        <Badge tone={target?.readiness || "neutral"}>
          {target?.readiness || "no target"}
        </Badge>
      </div>
      <div className="action-grid">
        <div className="action-form">
          <header>
            <span className="action-icon">
              <Icon name={action.kind === "prompt" ? "assistant" : "scan"} />
            </span>
            <div>
              <small>REGISTERED ACTION</small>
              <strong>{action.display_name || action.id}</strong>
            </div>
          </header>
          <label>
            <span>Execution target</span>
            <div className="select-shell">
              <Icon name={target?.provider === "modal" ? "cloud" : "cpu"} />
              <select
                value={target?.target || ""}
                onChange={(event) => {
                  setTarget(
                    targets.find(
                      (item) => item.target === event.target.value,
                    ) || null,
                  );
                  setBillable(false);
                }}
              >
                {targets.map((item) => (
                  <option key={item.target} value={item.target}>
                    {item.target} · {item.readiness || "unknown"}
                    {item.billable ? " · billable" : ""}
                  </option>
                ))}
              </select>
            </div>
          </label>
          {action.kind === "prompt" ? (
            <label className="prompt-field">
              <span>Prompt</span>
              <textarea
                rows={10}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Describe what you want the model to produce…"
              />
            </label>
          ) : (
            <div className="selected-input">
              <span>SELECTED INPUT</span>
              <div>
                <Icon name="play" />
                <p>
                  <strong>
                    {selectedSample
                      ? selectedSample.name || selectedSample.id
                      : "No browser sample selected"}
                  </strong>
                  <small>
                    {selectedSample
                      ? selectedSample.content_type || "checked sample"
                      : "The server accepts only an action-owned implicit input."}
                  </small>
                </p>
              </div>
            </div>
          )}
          {target?.billable && (
            <label className="check">
              <input
                type="checkbox"
                checked={billable}
                onChange={(event) => setBillable(event.target.checked)}
              />
              <span>
                I confirm this exact user-owned Modal binding may incur charges.
              </span>
            </label>
          )}
          <button
            className="primary launch-button"
            disabled={Boolean(blocked) || busy}
            onClick={onLaunch}
          >
            <Icon name="play" />
            {busy ? "Starting…" : action.display_name || "Start managed action"}
          </button>
          {blocked && <p className="blocker">{blocked}</p>}
        </div>
        <aside className="execution-summary">
          <span className="eyebrow">Execution contract</span>
          <h2>Bound before dispatch</h2>
          <p>
            ModelForge creates a durable queued run before any local process or
            provider operation starts.
          </p>
          <dl>
            <div>
              <dt>Target</dt>
              <dd>{target?.target || "none"}</dd>
            </div>
            <div>
              <dt>Provider</dt>
              <dd>{target?.provider || "local"}</dd>
            </div>
            <div>
              <dt>Environment</dt>
              <dd>{target?.environment || "local"}</dd>
            </div>
            <div>
              <dt>Binding</dt>
              <dd>
                <code>{target?.binding_sha256 || "local target"}</code>
              </dd>
            </div>
          </dl>
          <div className="contract-flow">
            <span>
              <Icon name="check" />
              Queue
            </span>
            <i />
            <span>
              <Icon name="play" />
              Execute
            </span>
            <i />
            <span>
              <Icon name="layers" />
              Verify
            </span>
          </div>
        </aside>
      </div>
    </section>
  );
}

function RunHistory({
  runs,
  current,
  onSelect,
}: {
  runs: Run[];
  current: Run | null;
  onSelect: (run: Run) => void;
}) {
  const active = runs.filter((run) => isActive(run)).length;
  const completed = runs.filter((run) => run.status === "completed").length;
  const failed = runs.filter((run) =>
    ["failed", "cancelled"].includes(run.status),
  ).length;
  return (
    <section className="runs-view">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Execution registry</span>
          <h1>Jobs</h1>
          <p>Past and ongoing work for the selected local project.</p>
        </div>
        <button disabled>
          <Icon name="refresh" />
          Refresh
        </button>
      </div>
      <div className="run-metrics">
        <article>
          <span>
            <Icon name="jobs" />
          </span>
          <small>ONGOING</small>
          <strong>{active}</strong>
        </article>
        <article>
          <span>
            <Icon name="check" />
          </span>
          <small>COMPLETED</small>
          <strong>{completed}</strong>
        </article>
        <article>
          <span>
            <Icon name="warning" />
          </span>
          <small>FAILED / CANCELLED</small>
          <strong>{failed}</strong>
        </article>
      </div>
      <div className="jobs-table" aria-label="Durable jobs">
        <div className="jobs-head">
          <span>Job</span>
          <span>Compute</span>
          <span>State</span>
          <span>Created</span>
          <span>Outputs</span>
        </div>
        {runs.map((run) => (
          <button
            key={run.id}
            aria-current={run.id === current?.id ? "true" : undefined}
            onClick={() => onSelect(run)}
          >
            <span>
              <span className="job-icon">
                <Icon name={run.provider === "modal" ? "cloud" : "terminal"} />
              </span>
              <span>
                <strong>
                  {String(
                    run.configuration?.action_id ||
                      run.request?.action_id ||
                      "managed workbench run",
                  )}
                </strong>
                <code>{run.id}</code>
              </span>
            </span>
            <span>
              <Icon name={run.provider === "modal" ? "cloud" : "cpu"} />
              {run.provider || "Local"}
            </span>
            <span>
              <Badge tone={run.status}>{runStatus(run)}</Badge>
            </span>
            <span>{run.created_at || "time unavailable"}</span>
            <span>
              <strong>{run.artifacts?.length || 0}</strong>
              <Icon name="chevron" />
            </span>
          </button>
        ))}
        {!runs.length && (
          <div className="table-empty">
            <Icon name="jobs" />
            <strong>No jobs recorded</strong>
            <p>
              Supported actions will appear here after the server creates their
              durable run.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function Settings({ modal }: { modal: ModalStatus | null }) {
  return (
    <section className="settings-view">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Local configuration</span>
          <h1>Settings</h1>
          <p>Read-only runtime and provider status from the local server.</p>
        </div>
      </div>
      <div className="settings-grid">
        <article className="card">
          <header>
            <span className="metric-icon">
              <Icon name="settings" />
            </span>
            <div>
              <small>BROWSER SECURITY</small>
              <h2>Protected local session</h2>
            </div>
            <Badge tone="success">enforced</Badge>
          </header>
          <p>
            Bearer authentication is held in this tab’s session storage. Host,
            mutation Origin, CSP, and no-CORS controls are enforced by the
            loopback server.
          </p>
          <dl>
            <div>
              <dt>Token storage</dt>
              <dd>Session only</dd>
            </div>
            <div>
              <dt>Network boundary</dt>
              <dd>Loopback</dd>
            </div>
            <div>
              <dt>Project UI</dt>
              <dd>Data only</dd>
            </div>
          </dl>
        </article>
        <article className="card">
          <header>
            <span className="metric-icon">
              <Icon name="cloud" />
            </span>
            <div>
              <small>OPTIONAL PROVIDER</small>
              <h2>Modal readiness</h2>
            </div>
            <Badge tone={modal?.state || "unavailable"}>
              {modal?.state || "unavailable"}
            </Badge>
          </header>
          <p>{modal?.message || "Status unavailable."}</p>
          <a
            className="settings-link"
            href="/modal-setup.html"
            target="_blank"
            rel="noreferrer"
          >
            Open owner setup guide
            <Icon name="chevron" />
          </a>
        </article>
      </div>
      <div className="boundary-note">
        <Icon name="warning" />
        Credential editing and filesystem settings are not exposed in the
        browser.
      </div>
    </section>
  );
}

function TablePreview({ value, name }: { value: unknown; name: string }) {
  const { columns, rows } = tableProjection(value);
  if (!rows.length || !columns.length)
    return (
      <pre aria-label={`Checked table result ${name}`}>
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  return (
    <div className="result-table-scroll">
      <table>
        <caption>{name}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => {
                const value = row[column];
                return (
                  <td key={column}>
                    {value == null
                      ? ""
                      : typeof value === "object"
                        ? JSON.stringify(value)
                        : String(value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RunDetail({
  run,
  runLog,
  busy,
  onCancel,
  onRecover,
  onOpen,
  onDownload,
  artifact,
  artifactPreview,
  artifactText,
  artifactJson,
}: {
  run: Run | null;
  runLog: string;
  busy: boolean;
  onCancel: () => void;
  onRecover: () => void;
  onOpen: (artifact: Artifact) => void;
  onDownload: (artifact: Artifact) => void;
  artifact: Artifact | null;
  artifactPreview: string;
  artifactText: string;
  artifactJson: unknown;
}) {
  const stale = run?.runtime_observation?.state === "unavailable";
  const recoverable = Boolean(run && isModal(run) && stale && isActive(run));
  const progress = run?.live?.progress?.percent;
  return (
    <div className="run-detail">
      <section className="run-summary">
        <header>
          <div>
            <span className="eyebrow">Current run</span>
            <code>{run?.id || "No run selected"}</code>
          </div>
          <Badge
            tone={
              run?.status === "failed"
                ? "error"
                : isActive(run) && !stale
                  ? "running"
                  : run?.status || "neutral"
            }
          >
            {runStatus(run)}
          </Badge>
        </header>
        <div className="run-live" aria-live="polite">
          {run ? (
            <>
              {run.error && <p className="failure">{run.error}</p>}
              <p>
                {stale
                  ? run.runtime_observation?.reason
                  : run.live?.progress
                    ? `${run.live.progress.stage || "running"} · ${progress ?? "?"}%`
                    : "No live progress reported."}
              </p>
              {typeof progress === "number" && (
                <div className="progress">
                  <i
                    style={{
                      width: `${Math.max(0, Math.min(100, progress))}%`,
                    }}
                  />
                </div>
              )}
              <div className="run-actions">
                {isActive(run) && !stale && (
                  <button disabled={busy} onClick={onCancel}>
                    <Icon name="stop" />
                    Request cancellation
                  </button>
                )}
                {recoverable && (
                  <button disabled={busy} onClick={onRecover}>
                    <Icon name="refresh" />
                    Recover exact Modal call
                  </button>
                )}
              </div>
            </>
          ) : (
            <p className="empty">Start or select a project run.</p>
          )}
        </div>
      </section>
      <section className="logs" aria-label="Run log">
        <h2>
          <Icon name="terminal" />
          Output
        </h2>
        <pre>{run?.live?.log_tail || runLog || "No live log attached."}</pre>
      </section>
      <section className="artifacts">
        <h2>
          <Icon name="layers" />
          Checked artifacts
        </h2>
        <div className="artifact-list">
          {run?.artifacts?.map((item) => (
            <div key={item.id}>
              <button onClick={() => onOpen(item)}>
                <span className="artifact-icon">
                  <Icon
                    name={
                      item.content_type?.startsWith("video/")
                        ? "play"
                        : item.kind === "table"
                          ? "chart"
                          : "file"
                    }
                  />
                </span>
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.kind || item.content_type || "artifact"}</small>
                </span>
              </button>
              <button
                className="download"
                aria-label={`Download ${item.name}`}
                onClick={() => onDownload(item)}
              >
                <Icon name="download" />
              </button>
            </div>
          ))}
          {!run?.artifacts?.length && (
            <p className="empty">No checked artifacts attached.</p>
          )}
        </div>
      </section>
      {artifact && (
        <section className="artifact-preview">
          <header>
            <div>
              <span className="eyebrow">Selected result</span>
              <h3>{artifact.name}</h3>
            </div>
            <Badge>digest checked</Badge>
          </header>
          {artifactJson !== null ? (
            <TablePreview value={artifactJson} name={artifact.name} />
          ) : artifactText ? (
            <pre
              aria-label={
                artifact.kind === "assistant-text"
                  ? "Checked assistant response"
                  : `Checked text artifact ${artifact.name}`
              }
            >
              {artifactText}
            </pre>
          ) : artifactPreview && artifact.content_type?.startsWith("video/") ? (
            <video
              controls
              aria-label={`${artifact.name} result preview`}
              src={artifactPreview}
            />
          ) : artifactPreview && artifact.content_type?.startsWith("image/") ? (
            <img
              src={artifactPreview}
              alt={`Checked artifact ${artifact.name}`}
            />
          ) : (
            <p className="empty">
              No inline preview for this checked artifact type.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
