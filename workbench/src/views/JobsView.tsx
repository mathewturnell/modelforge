import {useEffect, useMemo, useState} from "react";
import {
  ArrowRight, ChevronDown, Cloud, Cpu, FileArchive, GitCompareArrows, History,
  ListChecks, PlayCircle, RefreshCw, ScanSearch, Search, Square, Timer,
} from "lucide-react";
import {api} from "../lib/api";
import {formatBytes, formatDate, humanize, statusTone} from "../lib/utils";
import type {JobRecord, JsonMap, Project} from "../types";
import {useRequest} from "../hooks/use-request";
import {Badge, Button, Card, EmptyState, ErrorNotice, LoadingState, SectionHeader} from "../components/ui";

export type JobPeriod = "scheduled" | "ongoing" | "past";
export type JobKind = "training" | "inference";
export type JobLocation = "local" | "cloud";

function mapping(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
}

export function jobPeriod(job: JobRecord): JobPeriod {
  if (job.status === "queued") return "scheduled";
  if (job.status === "running") return "ongoing";
  return "past";
}

export function jobKind(job: JobRecord): JobKind {
  const request = mapping(job.request);
  const configuration = mapping(job.configuration);
  return String(configuration.workflow || request.workflow || "").toLowerCase() === "inference"
    ? "inference"
    : "training";
}

export function jobLocation(job: JobRecord): JobLocation {
  return job.provider === "modal" || job.compute_target === "cloud" ? "cloud" : "local";
}

export function jobIsActive(job: JobRecord): boolean {
  return job.status === "queued" || job.status === "running";
}

export function jobCanRecover(job: JobRecord): boolean {
  const observation = mapping(job.runtime_observation);
  return jobIsActive(job)
    && jobLocation(job) === "cloud"
    && observation.state === "unavailable"
    && observation.stale === true;
}

export function jobWorkspace(job: JobRecord): "runs" | "inference" {
  return jobKind(job) === "inference" ? "inference" : "runs";
}

export function jobProjectLabel(job: Pick<JobRecord, "project_id">, projects: Project[]): string {
  const project = projects.find((candidate) => candidate.id === job.project_id);
  return String(project?.name || project?.id || job.project_id || "Unknown project");
}

export function jobTargetLabel(job: JobRecord): string {
  const request = mapping(job.request);
  const configuration = mapping(job.configuration);
  if (jobLocation(job) === "cloud") {
    const gpu = String(configuration.modal_gpu || request.modal_gpu || "GPU").trim();
    return `Cloud · ${gpu || "GPU"}`;
  }
  const device = String(configuration.device || request.device || job.compute_target || "auto").toLowerCase();
  if (device === "cpu" || job.compute_target === "cpu") return "Local CPU";
  if (job.compute_target === "gpu" || device.includes("cuda") || /^\d+$/.test(device)) return "Local GPU";
  return "Local · Auto";
}

export function jobDuration(job: JobRecord, now = Date.now()): string {
  const start = new Date(String(job.started_at || job.created_at || "")).getTime();
  const end = job.completed_at ? new Date(job.completed_at).getTime() : now;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "—";
  const seconds = Math.floor((end - start) / 1_000);
  if (seconds < 1) return "<1s";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function leaf(value: unknown): string {
  const text = String(value || "").trim();
  return text.split(/[\\/]/).filter(Boolean).at(-1) || "Not recorded";
}

function jobStatusLabel(job: JobRecord): string {
  if (job.status === "queued") return "Scheduled";
  if (job.status === "running") return "Ongoing";
  return humanize(job.status || "Unknown");
}

function JobIcon({job}: {job: JobRecord}) {
  return <span className={`job-kind-icon ${jobKind(job)}`} aria-hidden="true">
    {jobKind(job) === "inference" ? <ScanSearch /> : <GitCompareArrows />}
  </span>;
}

function JobRow({job, projectLabel, projectRegistered, cancelling, recovering, canCancel, onOpen, onCancel, onRecover}: {
  job: JobRecord;
  projectLabel: string;
  projectRegistered: boolean;
  cancelling: boolean;
  recovering: boolean;
  canCancel: boolean;
  onOpen: (job: JobRecord) => Promise<void>;
  onCancel: (job: JobRecord) => void;
  onRecover: (job: JobRecord) => void;
}) {
  const artifacts = Array.isArray(job.artifacts) ? job.artifacts : [];
  const metrics = Object.entries(mapping(job.metrics)).filter(([, value]) => (
    typeof value === "number" || typeof value === "string"
  )).slice(0, 6);
  return <details className={`job-row period-${jobPeriod(job)}`}>
    <summary>
      <JobIcon job={job} />
      <span className="job-row-identity"><strong>{job.name || job.id}</strong><small>{projectLabel} · {job.id}</small></span>
      <span className="job-row-kind"><Badge>{humanize(jobKind(job))}</Badge></span>
      <span className="job-row-target">{jobLocation(job) === "cloud" ? <Cloud /> : <Cpu />}<span><strong>{jobTargetLabel(job)}</strong><small>{humanize(job.provider || "local")}</small></span></span>
      <span className="job-row-status"><Badge tone={statusTone(job.status)}>{jobStatusLabel(job)}</Badge><small>{jobDuration(job)}</small></span>
      <span className="job-row-time"><strong>{formatDate(job.created_at)}</strong><small>{jobPeriod(job) === "past" ? `Finished ${formatDate(job.completed_at || job.updated_at)}` : humanize(jobPeriod(job))}</small></span>
      <span className="job-row-artifacts"><strong>{artifacts.length}</strong><small>artifact{artifacts.length === 1 ? "" : "s"}</small><ChevronDown /></span>
    </summary>
    <div className="job-row-detail">
      <dl className="job-detail-facts">
        <div><dt>Job ID</dt><dd>{job.id}</dd></div>
        <div><dt>Project</dt><dd>{projectLabel} · {job.project_id}</dd></div>
        <div><dt>Dataset</dt><dd>{leaf(job.dataset_ref)}</dd></div>
        <div><dt>Started</dt><dd>{formatDate(job.started_at || job.created_at)}</dd></div>
        <div><dt>Duration</dt><dd>{jobDuration(job)}</dd></div>
      </dl>
      {metrics.length > 0 && <div className="job-metrics" aria-label="Recorded job metrics">{metrics.map(([name, value]) => <span key={name}><small>{humanize(name)}</small><strong>{String(value)}</strong></span>)}</div>}
      {artifacts.length > 0 ? <div className="job-artifacts" aria-label="Job artifacts">{artifacts.map((artifact) => {
        const href = String(artifact.view_url || artifact.download_url || "");
        return <a key={artifact.id} href={href || undefined} target={href ? "_blank" : undefined} rel="noreferrer" aria-disabled={!href}>
          <FileArchive /><span><strong>{artifact.name}</strong><small>{humanize(artifact.kind || "artifact")} · {formatBytes(Number(artifact.size_bytes || 0))}</small></span>
        </a>;
      })}</div> : <p className="job-no-artifacts">No terminal artifacts have been registered for this job.</p>}
      {job.error && <ErrorNotice message={job.error} />}
      <div className="job-row-actions">
        <Button size="sm" disabled={!projectRegistered} title={projectRegistered ? undefined : "Register this project to open its workspace"} onClick={() => void onOpen(job)}>Open {jobKind(job) === "inference" ? "Inference" : "Training"} <ArrowRight size={13} /></Button>
        {jobCanRecover(job) && <Button variant="secondary" size="sm" busy={recovering} onClick={() => onRecover(job)}><RefreshCw size={12} /> Recover exact Modal call</Button>}
        {canCancel && <Button variant="danger" size="sm" busy={cancelling} onClick={() => onCancel(job)}><Square size={12} fill="currentColor" /> Cancel job</Button>}
        {jobCanRecover(job) && <small className="job-action-note">The live provider observation is unavailable. Recovery reattaches to this recorded call; it does not submit a new one.</small>}
        {jobIsActive(job) && !canCancel && !jobCanRecover(job) && <small className="job-action-note">{projectRegistered ? "Open the owning project to manage this active job." : "Register the owning project to manage this active job."}</small>}
      </div>
    </div>
  </details>;
}

export function JobsView({projects, activeProjectId, onOpenJob}: {
  projects: Project[];
  activeProjectId: string;
  onOpenJob: (job: JobRecord) => Promise<void>;
}) {
  const jobsRequest = useRequest(() => api.organizationJobs(), []);
  const [period, setPeriod] = useState<"all" | JobPeriod>("all");
  const [kind, setKind] = useState<"all" | JobKind>("all");
  const [location, setLocation] = useState<"all" | JobLocation>("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [cancellingJobId, setCancellingJobId] = useState("");
  const [recoveringJobId, setRecoveringJobId] = useState("");
  const [actionError, setActionError] = useState("");
  const jobs = jobsRequest.data?.jobs || [];
  const activeIdentity = jobs.filter((job) => ["queued", "running"].includes(String(job.status))).map((job) => `${job.id}:${job.status}:${job.updated_at}`).join("|");

  useEffect(() => {
    if (!activeIdentity) return;
    const timer = window.setInterval(() => void jobsRequest.reload(), 3_000);
    return () => window.clearInterval(timer);
  }, [activeIdentity, jobsRequest.reload]);
  useEffect(() => {
    if (cancellingJobId && !jobs.some((job) => job.id === cancellingJobId && jobIsActive(job))) {
      setCancellingJobId("");
    }
  }, [cancellingJobId, jobs]);

  const filtered = useMemo(() => jobs.filter((job) => {
    const projectLabel = jobProjectLabel(job, projects);
    const haystack = `${job.name || ""} ${job.id} ${job.project_id} ${projectLabel} ${job.provider || ""} ${jobTargetLabel(job)} ${leaf(job.dataset_ref)}`.toLowerCase();
    return (period === "all" || jobPeriod(job) === period)
      && (kind === "all" || jobKind(job) === kind)
      && (location === "all" || jobLocation(job) === location)
      && (projectFilter === "all" || job.project_id === projectFilter)
      && (!search.trim() || haystack.includes(search.trim().toLowerCase()));
  }), [jobs, projects, period, kind, location, projectFilter, search]);
  const projectOptions = [...new Set(jobs.map((job) => job.project_id).filter(Boolean))]
    .sort((left, right) => jobProjectLabel({project_id: left}, projects).localeCompare(jobProjectLabel({project_id: right}, projects)));
  const counts = {
    scheduled: jobs.filter((job) => jobPeriod(job) === "scheduled").length,
    ongoing: jobs.filter((job) => jobPeriod(job) === "ongoing").length,
    past: jobs.filter((job) => jobPeriod(job) === "past").length,
  };
  const cancelJob = async (job: JobRecord) => {
    const name = String(job.name || job.id);
    if (!window.confirm(`Cancel ${name}?\n\nModelForge will stop this exact job and keep its durable record.`)) return;
    setCancellingJobId(job.id); setActionError("");
    try {
      await api.cancelJob(job.id);
      await jobsRequest.reload();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
      setCancellingJobId("");
    }
  };
  const recoverJob = async (job: JobRecord) => {
    const name = String(job.name || job.id);
    if (!window.confirm(`Recover ${name}?\n\nModelForge will reattach to this exact recorded Modal call. It will not submit another call.`)) return;
    setRecoveringJobId(job.id); setActionError("");
    try {
      await api.recoverJob(job.id);
      await jobsRequest.reload();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setRecoveringJobId("");
    }
  };
  const openJob = async (job: JobRecord) => {
    setActionError("");
    try { await onOpenJob(job); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : String(reason)); }
  };

  if (jobsRequest.loading && !jobsRequest.data) return <LoadingState label="Loading tool-wide jobs…" />;
  return <div className="document-scroll jobs-workspace">
    <SectionHeader eyebrow="Execution registry" title="Jobs" description="Past, ongoing, and scheduled Training and Inference work across every project and local or cloud compute target." actions={<Button busy={jobsRequest.loading} onClick={() => void jobsRequest.reload()}><RefreshCw size={14} /> Refresh</Button>} />
    {jobsRequest.error && <ErrorNotice message={jobsRequest.error} action={<Button size="sm" onClick={() => void jobsRequest.reload()}>Retry</Button>} />}
    {actionError && <ErrorNotice message={actionError} />}
    <div className="job-period-cards" aria-label="Job lifecycle summary">
      <button className={period === "scheduled" ? "active" : ""} onClick={() => setPeriod(period === "scheduled" ? "all" : "scheduled")}><Timer /><span><small>Scheduled</small><strong>{counts.scheduled}</strong><em>Queued for dispatch</em></span></button>
      <button className={period === "ongoing" ? "active" : ""} onClick={() => setPeriod(period === "ongoing" ? "all" : "ongoing")}><PlayCircle /><span><small>Ongoing</small><strong>{counts.ongoing}</strong><em>Currently running</em></span></button>
      <button className={period === "past" ? "active" : ""} onClick={() => setPeriod(period === "past" ? "all" : "past")}><History /><span><small>Past</small><strong>{counts.past}</strong><em>Terminal records</em></span></button>
    </div>
    <Card className="jobs-registry">
      <div className="jobs-toolbar">
        <div className="sidebar-search"><Search size={14} /><input aria-label="Search jobs" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search jobs, projects, datasets, or targets" /></div>
        <select aria-label="Job project" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="all">All projects</option>{projectOptions.map((projectId) => <option key={projectId} value={projectId}>{jobProjectLabel({project_id: projectId}, projects)}</option>)}</select>
        <select aria-label="Job workload" value={kind} onChange={(event) => setKind(event.target.value as "all" | JobKind)}><option value="all">Training &amp; Inference</option><option value="training">Training</option><option value="inference">Inference</option></select>
        <select aria-label="Job location" value={location} onChange={(event) => setLocation(event.target.value as "all" | JobLocation)}><option value="all">Local &amp; Cloud</option><option value="local">Local</option><option value="cloud">Cloud</option></select>
        <Button variant="ghost" size="sm" disabled={period === "all" && kind === "all" && location === "all" && projectFilter === "all" && !search} onClick={() => {setPeriod("all"); setKind("all"); setLocation("all"); setProjectFilter("all"); setSearch("");}}>Clear filters</Button>
      </div>
      <div className="jobs-list-heading" aria-hidden="true"><span>Job</span><span>Workload</span><span>Compute</span><span>State</span><span>Created</span><span>Outputs</span></div>
      <div className="jobs-list">{filtered.map((job) => {
        const projectRegistered = projects.some((project) => project.id === job.project_id);
        return <JobRow key={job.id} job={job} projectLabel={jobProjectLabel(job, projects)} projectRegistered={projectRegistered} cancelling={cancellingJobId === job.id} recovering={recoveringJobId === job.id} canCancel={jobIsActive(job) && projectRegistered && activeProjectId === job.project_id && !jobCanRecover(job)} onOpen={openJob} onCancel={(item) => void cancelJob(item)} onRecover={(item) => void recoverJob(item)} />;
      })}</div>
      {!filtered.length && <EmptyState icon={<ListChecks />} title={jobs.length ? "No jobs match these filters" : "No registered jobs"} description={jobs.length ? "Clear one or more filters to return to the tool-wide execution history." : "Scheduled, ongoing, and completed Training or Inference jobs from every registered project will appear here after they enter the durable registry."} />}
    </Card>
  </div>;
}
