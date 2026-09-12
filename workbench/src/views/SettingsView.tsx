import {Cloud, ExternalLink, PanelBottom, Settings2, SlidersHorizontal, UserRound} from "lucide-react";
import type {ComputeSelection} from "../components/ComputeTargetPicker";
import {ComputeTargetPicker} from "../components/ComputeTargetPicker";
import {Badge, Button, Card, SectionHeader} from "../components/ui";
import {useRequest} from "../hooks/use-request";
import {api} from "../lib/api";
import type {JsonMap, Project} from "../types";

export function SettingsView({project, compute, onComputeChange, cliffOpen, bottomOpen, onToggleCliff, onToggleBottom}: {
  project: Project;
  compute: ComputeSelection;
  onComputeChange: (selection: ComputeSelection) => void;
  cliffOpen: boolean;
  bottomOpen: boolean;
  onToggleCliff: () => void;
  onToggleBottom: () => void;
}) {
  const modal = useRequest(() => api.modalStatus(), [project.id]);
  const executionTargets = Array.isArray(project.execution_targets) ? project.execution_targets as JsonMap[] : [];
  const modalTarget = executionTargets.find((target) => target.target === "modal");
  const providerState = String(modal.data?.state || (modal.loading ? "checking" : "error"));
  const projectReady = Boolean(modalTarget && modalTarget.readiness === "ready" && modalTarget.ready !== false);
  return <div className="document-scroll settings-workspace">
    <SectionHeader eyebrow="Workbench preferences" title="Settings" description="Configure this browser workspace without changing project-owned runtime or repository authority." />
    <div className="settings-grid">
      <Card className="settings-card">
        <div className="card-title"><SlidersHorizontal /><strong>Default execution target</strong></div>
        <p>The selected target is shared by the top toolbar, Training, and Inference. Active jobs retain the target they started with.</p>
        <ComputeTargetPicker value={compute} onChange={onComputeChange} />
      </Card>
      <Card className="settings-card">
        <div className="card-title"><Settings2 /><strong>Workspace layout</strong></div>
        <p>Control persistent supporting panels. These settings affect presentation only.</p>
        <label className="settings-toggle"><span><strong>Cliff inspector</strong><small>Keep the project assistant visible beside documents.</small></span><input type="checkbox" checked={cliffOpen} onChange={onToggleCliff} /></label>
        <label className="settings-toggle"><span><strong>Output and jobs panel</strong><small>Show structured logs and job output below documents.</small></span><input type="checkbox" checked={bottomOpen} onChange={onToggleBottom} /></label>
      </Card>
      <Card className="settings-card">
        <div className="card-title"><Cloud /><strong>Modal execution service</strong><Badge tone={projectReady ? "success" : providerState === "configured" ? "warning" : "neutral"}>{projectReady ? "Project ready" : providerState}</Badge></div>
        <p>{modal.error || String(modal.data?.message || "Checking the local Modal SDK and owner configuration without starting a provider call.")}</p>
        <p>{projectReady ? "This project has a digest-bound Modal action target. Launch still requires explicit billable confirmation." : providerState === "configured" ? "The local Modal account is configured, but this project has no ready digest-bound action target." : "Configure Modal locally, then register an exact project action binding before cloud dispatch is enabled."}</p>
        <div className="settings-links"><a className="mf-button mf-button-secondary mf-button-md" href="/modal-setup.html" target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open owner setup guide</a><Button onClick={() => void modal.reload()}>Refresh status</Button></div>
      </Card>
      <Card className="settings-card">
        <div className="card-title"><UserRound /><strong>Account and installation</strong></div>
        <p>Local account security, membership, and deployment access remain in their authoritative account surface.</p>
        <div className="settings-links"><a className="mf-button mf-button-primary mf-button-md" href="/account"><UserRound size={14} /> Open account</a></div>
      </Card>
      <Card className="settings-card settings-boundary">
        <div className="card-title"><PanelBottom /><strong>Execution boundary</strong></div>
        <p>ModelForge starts only registered project actions. The browser output panel is not a general command terminal, and UI preferences do not grant filesystem or compute authority.</p>
        <Button onClick={() => window.location.reload()}>Reload workbench</Button>
      </Card>
    </div>
  </div>;
}
