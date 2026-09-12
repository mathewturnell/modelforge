import {useEffect, useMemo, useState} from "react";
import {Box, Cloud, Container, Cpu, ExternalLink, PackageCheck, RefreshCw, Rocket, ServerCog, ShieldCheck} from "lucide-react";
import {api} from "../lib/api";
import {formatBytes, formatDate, humanize, statusTone} from "../lib/utils";
import type {JsonMap, Project} from "../types";
import {useRequest} from "../hooks/use-request";
import {Badge, Button, Card, EmptyState, ErrorNotice, LoadingState, SectionHeader} from "../components/ui";
import {MonitorView} from "./MonitorView";

const objectAt = (value: unknown): JsonMap => value && typeof value === "object" && !Array.isArray(value) ? value as JsonMap : {};
const checkpointPath = (value: JsonMap): string => String(value.path || value.checkpoint || value.storage_ref || "");
const shortPath = (value: string): string => value.split(/[\\/]/).filter(Boolean).slice(-3).join(" / ") || value;

export function mergeDeploymentResponses(published: JsonMap, refreshed: JsonMap | null): JsonMap {
  const publishedDeployment = objectAt(published.deployment);
  const refreshedDeployment = objectAt(refreshed?.deployment);
  return {
    ...published,
    ...(refreshed || {}),
    configured: refreshed?.configured === false ? false : true,
    deployment: {...publishedDeployment, ...refreshedDeployment},
  };
}

export function deploymentPresentation(current: JsonMap | null) {
  const reconciliationPending = String(current?.billing_state || "") === "failed";
  return {
    badgeTone: reconciliationPending ? "warning" : "success",
    badgeLabel: reconciliationPending ? "Active · Billing pending" : "Active",
    billingNotice: reconciliationPending
      ? String(current?.billing_notice || "Deployment succeeded; activation fee reporting is pending operator reconciliation.")
      : "",
  };
}

function TargetIcon({id}: {id: string}) {
  if (id.includes("docker") || id.includes("oci")) return <Container />;
  if (id === "local") return <Cpu />;
  if (id === "modal" || id === "runpod") return <Cloud />;
  return <ServerCog />;
}

export function DeployView({project}: {project: Project}) {
  const releases = useRequest(() => api.releases(), [project.id]);
  const deployment = useRequest(() => project.project_type === "application" ? api.applicationDeployment() : Promise.resolve({configured: false} as JsonMap), [project.id, project.project_type]);
  const [deploying, setDeploying] = useState(false);
  const [building, setBuilding] = useState(false);
  const [checkpoint, setCheckpoint] = useState("");
  const [releaseName, setReleaseName] = useState("");
  const [error, setError] = useState("");
  const rows = (Array.isArray(releases.data?.releases) ? releases.data.releases : []) as JsonMap[];
  const checkpoints = (Array.isArray(releases.data?.checkpoints) ? releases.data.checkpoints : []) as JsonMap[];
  const readiness = objectAt(releases.data?.deployment);
  const targets = (Array.isArray(readiness.targets) ? readiness.targets : []) as JsonMap[];
  const current = (deployment.data?.deployment && typeof deployment.data.deployment === "object" ? deployment.data.deployment : null) as JsonMap | null;
  const backendReadiness = objectAt(deployment.data?.readiness || current?.readiness);
  const deploymentState = deploymentPresentation(current);
  const checkpointPaths = checkpoints.map(checkpointPath);
  const checkpointPathKey = checkpointPaths.join("|");
  const selectedCheckpoint = checkpointPaths.includes(checkpoint) ? checkpoint : "";
  useEffect(() => {
    if (!checkpointPaths.includes(checkpoint)) setCheckpoint(checkpointPaths[0] || "");
  }, [checkpoint, checkpointPathKey]);
  const releaseBytes = (release: JsonMap) => Number(release.bytes || release.size_bytes || (Array.isArray(release.artifacts) ? release.artifacts.reduce((sum, item) => sum + Number(objectAt(item).bytes || 0), 0) : 0));
  const readyTargets = useMemo(() => targets.filter((target) => ["ready", "build_ready"].includes(String(target.status))), [targets]);

  const build = async () => {
    if (!selectedCheckpoint) return;
    setBuilding(true); setError("");
    try { await api.buildRelease(project.id, selectedCheckpoint, releaseName); setReleaseName(""); await releases.reload(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBuilding(false); }
  };
  const deploy = async () => {
    if (!window.confirm("Publish the declared immutable application? Managed inference can incur usage charges after requests arrive.")) return;
    setDeploying(true); setError("");
    try {
      const published = await api.deployApplication(project.id);
      const immediate = mergeDeploymentResponses(published, null);
      deployment.setData(immediate);
      deployment.setError("");
      const [refreshed] = await Promise.all([deployment.reload(), releases.reload()]);
      deployment.setData(mergeDeploymentResponses(immediate, refreshed));
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setDeploying(false); }
  };
  if ((releases.loading || deployment.loading) && !releases.data && !deployment.data) return <LoadingState label="Loading release and deployment state…" />;
  return <div className="document-scroll deploy-workspace"><div className="deploy-layout">
    <SectionHeader eyebrow="Delivery" title="Releases and deployment targets" description="Package a registered checkpoint as an immutable release, then inspect the real readiness of every declared delivery target." actions={<Button onClick={() => void Promise.all([deployment.reload(), releases.reload()])}><RefreshCw size={14} /> Refresh</Button>} />
    {error && <ErrorNotice message={error} />}
    {deployment.error && <ErrorNotice message={deployment.error} action={<Button onClick={() => void deployment.reload()}><RefreshCw size={14} /> Retry deployment status</Button>} />}

    <div className="release-builder-grid">
      <Card className="release-builder">
        <div className="release-builder-heading">
          <div className="deployment-icon"><PackageCheck /></div>
          <div><span className="eyebrow">Immutable model release</span><h3>Package a checkpoint</h3><p>Bundle checkpoint provenance, runtime dependencies, SBOM, and target manifests into a versioned release.</p></div>
        </div>
        <div className="release-builder-fields">
          <label><span>Eligible checkpoint</span><select aria-label="Release checkpoint" value={selectedCheckpoint} onChange={(event) => setCheckpoint(event.target.value)}><option value="">Select a registered checkpoint…</option>{checkpoints.map((item) => { const path = checkpointPath(item); return <option key={path} value={path}>{String(item.name || shortPath(path))}</option>; })}</select><small title={selectedCheckpoint}>{selectedCheckpoint ? shortPath(selectedCheckpoint) : "Completed training runs remain ineligible until registered evaluation or promotion evidence marks a checkpoint release-ready."}</small></label>
          <label><span>Release name <em>optional</em></span><input aria-label="Release name" value={releaseName} onChange={(event) => setReleaseName(event.target.value)} placeholder="Generated when empty" /><small>A stable identifier is generated when left empty.</small></label>
        </div>
        <div className="release-builder-footer"><span><ShieldCheck size={14} /> The source checkpoint remains unchanged.</span><Button variant="primary" busy={building} disabled={!selectedCheckpoint} onClick={() => void build()}><PackageCheck size={14} /> Build immutable release</Button></div>
      </Card>
      <Card className="release-readiness-summary">
        <div className="release-readiness-heading"><span className="eyebrow">Target readiness</span><strong>{readyTargets.length}<small> / {targets.length || 0}</small></strong></div>
        <p>Targets ready to run or build from the current project contract.</p>
        <div className="deployment-guardrails"><span><ShieldCheck size={16} /> Immutable inputs</span><span><PackageCheck size={16} /> Hash-bound artifacts</span><span><Cloud size={16} /> Explicit cloud action</span></div>
      </Card>
    </div>

    <section className="deployment-target-section"><SectionHeader eyebrow="Runtime matrix" title="Deployment targets" description="Readiness comes directly from the release subsystem; configuration blockers remain visible." />
      <div className="deployment-target-grid">{targets.map((target) => { const issues = (Array.isArray(target.issues) ? target.issues : []) as unknown[]; const requirements = (Array.isArray(target.requirements) ? target.requirements : []) as unknown[]; return <Card key={String(target.id)} className="deployment-target-card"><div className="target-heading"><span><TargetIcon id={String(target.id)} /></span><div><strong>{String(target.name || humanize(target.id))}</strong><small>{String(target.image || target.recommended_gpu || target.id)}</small></div><Badge tone={["ready", "build_ready"].includes(String(target.status)) ? "success" : String(target.status).includes("required") ? "warning" : statusTone(target.status)}>{humanize(target.status || "Unknown")}</Badge></div>{[...issues, ...requirements].length ? <ul>{[...issues, ...requirements].slice(0, 4).map((issue, index) => <li key={index}>{String(issue)}</li>)}</ul> : <p>No readiness blockers reported.</p>}</Card>; })}</div>
      {!targets.length && <EmptyState icon={<ServerCog />} title="No deployment targets declared" description="Build an eligible release or add a project runtime declaration to expose delivery readiness." />}
    </section>

    {project.project_type === "application" && <section className="application-deployment-section"><SectionHeader eyebrow="Application delivery" title="Hosted application" description="Application publication is separate from model release packaging and always requires explicit confirmation." />{String(backendReadiness.classification || "") === "static_limited" && <ErrorNotice message={String(backendReadiness.message || "This deployment is limited to its declared static fallback; unavailable backend capabilities remain disabled.")} />}<Card className="deployment-current"><div className="deployment-icon"><Rocket /></div><div><span className="eyebrow">Current application</span><h3>{current ? String(current.release_id || current.id || "Active release") : "Not deployed"}</h3><p>{current ? `${Number(current.file_count || 0).toLocaleString()} files · ${formatBytes(Number(current.size_bytes || 0))}` : deployment.data?.configured === true ? "The application is configured and ready for an explicit deployment." : deployment.error ? "Deployment status is unavailable. Retry the status check or deploy the reviewed declaration." : "Checking the application deployment declaration."}</p>{deploymentState.billingNotice && <small>{deploymentState.billingNotice}</small>}</div><div className="deployment-actions">{current && <Badge tone={deploymentState.badgeTone}>{deploymentState.badgeLabel}</Badge>}{Boolean(current?.launch_url) && <a className="mf-button mf-button-secondary mf-button-md" href={String(current?.launch_url)} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open</a>}<Button variant="primary" busy={deploying} disabled={deployment.data?.configured === false || String(backendReadiness.classification || "") === "blocked"} onClick={() => void deploy()}><Cloud size={14} /> {current ? "Deploy new release" : "Deploy application"}</Button></div></Card></section>}

    <MonitorView project={project} embedded />

    <section className="release-section"><SectionHeader eyebrow="Registry" title="Release history" description={`${rows.length} retained immutable release${rows.length === 1 ? "" : "s"}`} />
      <div className="release-list">{rows.map((release) => <Card key={String(release.id)} className="release-row"><span className="release-icon"><Box size={16} /></span><div><strong>{String(release.id || release.name || "Release")}</strong><small>{formatDate(release.created_at || release.modified)} · {formatBytes(releaseBytes(release))}</small></div><Badge tone={statusTone(release.status)}>{humanize(release.status || "Ready")}</Badge><a href={`/api/project/releases/file?release=${encodeURIComponent(String(release.id || ""))}&path=manifest.json`} target="_blank" rel="noreferrer">Manifest <ExternalLink size={12} /></a></Card>)}</div>
      {!rows.length && <EmptyState icon={<Box />} title="No immutable releases" description="Select an eligible checkpoint above to package the first project release." />}
    </section>
  </div></div>;
}
