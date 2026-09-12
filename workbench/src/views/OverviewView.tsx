import {ArrowRight, BookOpen, Box, Braces, Database, ExternalLink, GitBranch, Sparkles} from "lucide-react";
import {api} from "../lib/api";
import {humanize} from "../lib/utils";
import type {ActivityId, JsonMap, Project} from "../types";
import {useRequest} from "../hooks/use-request";
import {Button, Card, EmptyState, ErrorNotice, LoadingState, SectionHeader} from "../components/ui";
import {SignalField} from "../components/SignalField";

interface OverviewProps {
  project: Project;
  onNavigate: (activity: ActivityId) => void;
}

export const overviewTextList = (value: unknown): string[] => Array.isArray(value)
  ? value.flatMap((item) => {
    if (typeof item === "string" || typeof item === "number") return [String(item)];
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as JsonMap;
    const text = record.text ?? record.description ?? record.label;
    return typeof text === "string" && text.trim() ? [text.trim()] : [];
  })
  : [];

function DomainCard({icon, label, domain}: {icon: React.ReactNode; label: string; domain: JsonMap}) {
  const items = [
    ...(Array.isArray(domain.inputs) ? domain.inputs : []),
    ...(Array.isArray(domain.outputs) ? domain.outputs : []),
    ...(Array.isArray(domain.targets) ? domain.targets : []),
    ...(Array.isArray(domain.nodes) ? domain.nodes : []),
  ].slice(0, 8) as JsonMap[];
  return (
    <Card className="overview-domain-card">
      <div className="domain-card-heading"><span>{icon}</span><div><small>{label}</small><h3>{String(domain.name || `No ${label.toLowerCase()} selected`)}</h3></div></div>
      <p>{String(domain.description || `${label} evidence has not been described yet.`)}</p>
      {items.length > 0 && <div className="chip-row">{items.map((item, index) => <span key={`${String(item.id || item.name)}-${index}`}>{String(item.name || item.id || item.type || "Item")}</span>)}</div>}
    </Card>
  );
}

export function OverviewView({project, onNavigate}: OverviewProps) {
  const {data, error, loading, reload} = useRequest(() => api.overview(), [project.id]);
  if (loading && !data) return <LoadingState label="Composing the living project page…" />;
  if (error && !data) return <ErrorNotice message={error} action={<Button onClick={() => void reload()}>Try again</Button>} />;
  if (!data) return <EmptyState icon={<BookOpen />} title="Project overview unavailable" description="ModelForge could not compose bounded project evidence." />;

  const highlights = (Array.isArray(data.highlights) ? data.highlights : []).slice(0, 3) as JsonMap[];
  const instructions = (Array.isArray(data.instructions) ? data.instructions : []) as JsonMap[];
  const rationale = overviewTextList(data.rationale_points || data.rationale);
  const references = (Array.isArray(data.references) ? data.references : []) as JsonMap[];
  const dataset = (data.dataset && typeof data.dataset === "object" ? data.dataset : {}) as JsonMap;
  const architecture = (data.architecture && typeof data.architecture === "object" ? data.architecture : {}) as JsonMap;
  const routeFor = (value: unknown): ActivityId => {
    const route = String(value || "").toLowerCase();
    if (route.includes("data")) return "data";
    if (route.includes("model") || route.includes("architecture")) return "model";
    if (route.includes("train") || route.includes("run")) return "runs";
    if (route.includes("source")) return "source";
    if (route.includes("inference")) return "inference";
    if (route.includes("deploy")) return "deploy";
    return "overview";
  };

  return (
    <div className="document-scroll overview-document">
      <section className="overview-hero">
        <SignalField />
        <div className="overview-hero-copy">
          <span className="eyebrow"><Sparkles size={12} /> Living project overview</span>
          <h1>{String(data.title || project.name || project.id)}</h1>
          <p>{String(data.summary || data.tagline || "Project intent has not been documented yet.")}</p>
          <div className="overview-actions">
            <Button variant="primary" onClick={() => onNavigate("data")}><Database size={15} /> Explore data</Button>
            <Button onClick={() => onNavigate("runs")}><GitBranch size={15} /> View runs</Button>
          </div>
        </div>
        <div className="overview-identity">
          <span>Project</span><strong>{project.id}</strong>
          <span>Dataset</span><strong>{String(project.default_dataset_profile || "Not selected")}</strong>
          <span>Type</span><strong>{humanize(project.project_type || "ML project")}</strong>
          <div className="modality-platform-signature" aria-label="A Modality Systems platform">
            <small>A platform by</small>
            <span className="modality-platform-logo"><img src="/modalitysystems.png" alt="Modality Systems" /></span>
          </div>
        </div>
      </section>

      {highlights.length > 0 && <section className="overview-highlights">
        {highlights.map((item, index) => <article key={index}><span>0{index + 1}</span><strong>{String(item.keyword || "Focus")}</strong><p>{String(item.text || "")}</p></article>)}
      </section>}

      <section className="overview-section">
        <SectionHeader eyebrow="Project knowledge" title="Data and model, in context" description="Current descriptor evidence rendered through trusted ModelForge components." />
        <div className="overview-domain-grid">
          <DomainCard icon={<Database size={18} />} label="Dataset" domain={dataset} />
          <DomainCard icon={<Box size={18} />} label="Architecture" domain={architecture} />
        </div>
      </section>

      {rationale.length > 0 && <section className="overview-section rationale-section">
        <SectionHeader eyebrow="Why this approach" title="Design rationale" />
        <div className="rationale-list">{rationale.slice(0, 6).map((item, index) => <article key={index}><span>{String(index + 1).padStart(2, "0")}</span><p>{item}</p></article>)}</div>
      </section>}

      {instructions.length > 0 && <section className="overview-section">
        <SectionHeader eyebrow="Workflow" title="Annotate, train, and verify" description="Open the corresponding workbench surface and verify its recorded outcome." />
        <div className="instruction-grid">{instructions.slice(0, 6).map((item, index) => (
          <button key={index} className="instruction-card" onClick={() => onNavigate(routeFor(item.workspace || item.tab || item.action))}>
            <span className="instruction-number">{String(index + 1).padStart(2, "0")}</span>
            <div><strong>{String(item.title || item.action_label || item.workspace || `Step ${index + 1}`)}</strong><p>{String(item.description || item.instruction || item.outcome || "Open this workspace to continue.")}</p>{Boolean(item.outcome) && <small>Verify · {String(item.outcome)}</small>}</div>
            <ArrowRight size={16} />
          </button>
        ))}</div>
      </section>}

      <section className="overview-section overview-evidence">
        <SectionHeader eyebrow="Evidence" title="Sources and technical detail" />
        <div className="evidence-grid">
          <Card><Braces size={18} /><strong>Typed project contracts</strong><p>Architecture, task, dataset, runtime and checkpoint identities stay linked to recorded evidence.</p></Card>
          <Card><BookOpen size={18} /><strong>Project-owned knowledge</strong><p>Intent and documentation remain in the project repository and refresh with verified changes.</p></Card>
          <Card><GitBranch size={18} /><strong>Source provenance</strong><p>{String((data.provenance as JsonMap | undefined)?.repository || project.repository || "Repository identity unavailable")}</p></Card>
        </div>
        {references.length > 0 && <div className="reference-list">{references.map((reference, index) => {
          const href = String(reference.url || reference.href || "");
          return href ? <a key={index} href={href} target="_blank" rel="noreferrer"><ExternalLink size={13} />{String(reference.title || reference.label || href)}</a> : null;
        })}</div>}
      </section>
    </div>
  );
}
