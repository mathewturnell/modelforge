import {useEffect, useMemo, useState} from "react";
import type {DragEvent, MouseEvent as ReactMouseEvent} from "react";
import * as Tabs from "@radix-ui/react-tabs";
import {ChevronRight, Crosshair, Database, File, FileImage, FileText, Film, Folder, FolderOpen, GitBranch, GripVertical, Grid3X3, List, Lock, MessagesSquare, MoreHorizontal, Play, RefreshCw, Search, Tags, Undo2} from "lucide-react";
import {api, artifactUrl} from "../lib/api";
import {descriptorSampleInferenceTarget, inferenceTargetKinds} from "../lib/inference-targets";
import {compactNumber, formatBytes, humanize} from "../lib/utils";
import {isLlmCorpusProject} from "../lib/llm-corpus";
import type {AnnotationProject, Artifact, BrowseResponse, DatasetInventory, DatasetProfile, DescriptorSample, InferenceTarget, Project, TrainingTarget} from "../types";
import {useRequest} from "../hooks/use-request";
import {AnnotationEditor} from "./AnnotationEditor";
import {LlmCorpusView} from "./LlmCorpusView";
import {Badge, Button, Card, EmptyState, ErrorNotice, IconButton, LoadingState, Modal} from "../components/ui";
import {Scene3DViewer} from "../components/Scene3DViewer";

function ArtifactIcon({kind}: {kind: string}) {
  if (kind === "image") return <FileImage />;
  if (kind === "video") return <Film />;
  if (kind === "text" || kind === "table") return <FileText />;
  return <File />;
}

function isHeldOutPath(path: string, kind: TrainingTarget["kind"]): boolean {
  const parts = path.split("/");
  return (kind === "artifact" ? parts.slice(0, -1) : parts).some((part) => ["test", "held-out", "heldout", "held_out"].includes(part.toLowerCase()));
}

function ArtifactPreview({artifact}: {artifact: Artifact}) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (!["text", "table"].includes(artifact.kind)) return;
    let active = true;
    void fetch(artifactUrl("text", artifact.path), {cache: "no-store"}).then((response) => response.json()).then((data) => { if (active) setText(String(data.text || data.error || "")); });
    return () => { active = false; };
  }, [artifact.path]);
  if (artifact.name.endsWith(".scene.json")) return <Scene3DViewer src={artifactUrl("raw", artifact.path)} title="3D Dataset Inspector" />;
  if (artifact.kind === "image") return <div className="artifact-full-preview"><img src={artifactUrl("raw", artifact.path)} alt={artifact.name} /></div>;
  if (artifact.kind === "video") return <div className="artifact-full-preview"><video src={artifactUrl("raw", artifact.path)} controls preload="metadata" /></div>;
  if (artifact.kind === "audio") return <div className="artifact-full-preview compact"><audio src={artifactUrl("raw", artifact.path)} controls preload="metadata" /></div>;
  if (artifact.kind === "pdf") return <iframe className="artifact-pdf" src={artifactUrl("raw", artifact.path)} title={artifact.name} />;
  if (["text", "table"].includes(artifact.kind)) return <pre className="artifact-text-preview">{text || "Loading preview…"}</pre>;
  return <EmptyState icon={<ArtifactIcon kind={artifact.kind} />} title="No native preview" description="This artifact remains available through its authenticated original-file route." action={<a className="mf-button mf-button-secondary mf-button-md" href={artifactUrl("raw", artifact.path)} target="_blank" rel="noreferrer">Open original</a>} />;
}

function DatasetPicker({project, open, onOpenChange, onSelected}: {project: Project; open: boolean; onOpenChange: (open: boolean) => void; onSelected: (project: Project) => void}) {
  const initial = String(project.dataset_repository || project.repository || project.selected_dataset || project.default_dataset || "");
  const [path, setPath] = useState(initial);
  const [listing, setListing] = useState<BrowseResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [showInternal, setShowInternal] = useState(false);
  const [error, setError] = useState("");
  const load = async (next: string) => {
    if (!next) return;
    setLoading(true); setError("");
    try { const response = await api.browse(next); setListing(response); setPath(response.path); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setLoading(false); }
  };
  useEffect(() => { if (open) void load(initial); }, [open, project.id, project.dataset_repository]);
  const select = async () => {
    setSelecting(true); setError("");
    try { const selected = await api.selectDataset(project.id, path); onSelected(selected); onOpenChange(false); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSelecting(false); }
  };
  const directories = (listing?.directories || []).filter((directory) => showInternal || !directory.name.startsWith("."));
  return <Modal open={open} onOpenChange={onOpenChange} title="Choose a dataset or collection root" description="Choose one dataset or point ModelForge at a collection root to index every nested dataset and sequence." wide>
    <div className="dataset-picker">
      <div className="dataset-picker-location"><Button disabled={!listing?.parent || loading} onClick={() => listing?.parent && void load(listing.parent)}><FolderOpen size={14} /> Up</Button><div><span>Current folder</span><code title={path}>{path || "No repository selected"}</code></div><label><input type="checkbox" checked={showInternal} onChange={(event) => setShowInternal(event.target.checked)} /> Show internal folders</label></div>
      {error && <ErrorNotice message={error} />}
      <div className="dataset-picker-list" role="listbox" aria-label="Dataset folders">{loading ? <LoadingState label="Reading dataset repository…" /> : directories.map((directory) => <button key={directory.path} type="button" onClick={() => void load(directory.path)}><span><Folder size={17} /></span><div><strong>{directory.name}</strong><small>{directory.dataset ? "Recognized dataset" : directory.dataset_count ? `${directory.dataset_count} nested datasets` : "Collection folder"}</small></div><ChevronRight size={15} /></button>)}</div>
      {!loading && !directories.length && <EmptyState icon={<Folder />} title="No child folders" description="Select the current folder or navigate back to its parent." />}
      <footer><div><Badge tone={listing?.dataset ? "success" : "neutral"}>{listing?.dataset ? "Dataset" : "Collection root"}</Badge><span>{path.split(/[\\/]/).filter(Boolean).at(-1) || "Dataset collection"}</span></div><div><Button onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" busy={selecting} disabled={!path || loading} onClick={() => void select()}>Index this folder</Button></div></footer>
    </div>
  </Modal>;
}

type DatasetSequence = NonNullable<DatasetInventory["sequences"]>[number];

function SplitManager({project, sequences, open, onOpenChange, onSaved}: {project: Project; sequences: DatasetSequence[]; open: boolean; onOpenChange: (open: boolean) => void; onSaved: () => Promise<unknown>}) {
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(sequences.map((sequence) => [sequence.path || "", sequence.split || "unassigned"]).filter(([path]) => path)));
  const [visibleByRole, setVisibleByRole] = useState<Record<string, number>>({unassigned: 24, train: 24, validation: 24, held_out: 24});
  const [draggingPath, setDraggingPath] = useState("");
  const [dropTarget, setDropTarget] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    setDraft(Object.fromEntries(sequences.map((sequence) => [sequence.path || "", sequence.split || "unassigned"]).filter(([path]) => path)));
    setVisibleByRole({unassigned: 24, train: 24, validation: 24, held_out: 24});
    setError("");
  }, [open, sequences]);
  const changed = sequences.filter((sequence) => {
    const path = sequence.path || "";
    return Boolean(path && sequence.split_editable !== false && (draft[path] || "unassigned") !== (sequence.split || "unassigned"));
  });
  const save = async () => {
    if (!changed.length) { onOpenChange(false); return; }
    setSaving(true); setError("");
    try {
      const assignments = Object.fromEntries(changed.map((sequence) => {
        const path = sequence.path || "";
        const next = draft[path] || "unassigned";
        return [path, next === (sequence.imported_split || "unassigned") ? "imported" : next];
      }));
      await api.updateDatasetSplits(project.id, assignments);
      await onSaved();
      onOpenChange(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSaving(false); }
  };
  const assignAll = (from: string, to: string) => setDraft((current) => ({...current, ...Object.fromEntries(sequences.filter((sequence) => sequence.split_editable !== false && (current[sequence.path || ""] || sequence.split) === from).map((sequence) => [sequence.path || "", to]))}));
  const setRole = (path: string, role: string) => {
    const sequence = sequences.find((candidate) => candidate.path === path);
    if (!sequence || sequence.split_editable === false) return;
    setDraft((current) => ({...current, [path]: role}));
    setVisibleByRole((current) => ({...current, [role]: (current[role] || 24) + 1}));
  };
  const editable = sequences.filter((sequence) => sequence.split_editable !== false);
  const protectedSequences = sequences.filter((sequence) => sequence.split_editable === false);
  const lane = (role: string) => editable.filter((sequence) => (draft[sequence.path || ""] || sequence.split || "unassigned") === role);
  const drop = (event: DragEvent<HTMLElement>, role: string) => {
    event.preventDefault();
    const path = event.dataTransfer.getData("text/plain") || draggingPath;
    setRole(path, role); setDraggingPath(""); setDropTarget("");
  };
  const card = (sequence: DatasetSequence, protectedSequence = false) => {
    const path = sequence.path || "";
    const role = draft[path] || sequence.split || "unassigned";
    return <article className={`split-board-card ${draggingPath === path ? "dragging" : ""} ${protectedSequence ? "protected" : ""}`} draggable={!protectedSequence && !saving} onDragStart={(event) => {event.dataTransfer.setData("text/plain", path); event.dataTransfer.effectAllowed = "move"; setDraggingPath(path);}} onDragEnd={() => {setDraggingPath(""); setDropTarget("");}} key={path || sequence.id}>
      <div className="split-board-thumbnail"><img src={artifactUrl("thumbnail", path)} alt={`${sequence.id} representative frame`} loading="lazy" draggable={false} />{protectedSequence ? <span><Lock size={13} /> Protected</span> : <GripVertical size={16} />}</div>
      <div className="split-board-card-copy"><strong>{sequence.id}</strong><small title={path}>{path}</small><span>{compactNumber(sequence.frames)} frames · {compactNumber(sequence.objects)} objects</span></div>
      {!protectedSequence && <div className="split-board-card-actions" aria-label={`Move ${sequence.id}`}>
        {role !== "train" && <button type="button" disabled={saving} onClick={() => setRole(path, "train")}>Training</button>}
        {role !== "validation" && <button type="button" disabled={saving} onClick={() => setRole(path, "validation")}>Validation</button>}
        {role !== (sequence.imported_split || "unassigned") && <button type="button" className="reset" disabled={saving} onClick={() => setRole(path, sequence.imported_split || "unassigned")}><Undo2 size={11} /> Imported</button>}
      </div>}
    </article>;
  };
  return <Modal open={open} onOpenChange={onOpenChange} title="Manage training and validation splits" description="Assign complete sequences without moving source files. ModelForge saves this project-scoped plan for registered local training; held-out evidence stays protected." wide>
    <div className="split-manager">
      {error && <ErrorNotice message={error} />}
      <div className="split-manager-tools"><span>{changed.length ? `${changed.length} unsaved ${changed.length === 1 ? "change" : "changes"}` : "All assignments saved"}</span><div><Button size="sm" onClick={() => assignAll("unassigned", "train")}>Put unassigned in Training</Button><Button size="sm" onClick={() => assignAll("unassigned", "validation")}>Put unassigned in Validation</Button></div></div>
      <div className="split-board" aria-label="Dataset split assignment board">
        {[{id: "unassigned", label: "Unassigned"}, {id: "train", label: "Training"}, {id: "validation", label: "Validation"}].map(({id, label}) => { const members = lane(id); const visible = members.slice(0, visibleByRole[id] || 24); return <section className={`split-board-lane ${id} ${dropTarget === id ? "drop-target" : ""}`} aria-label={`${label} sequences drop zone`} onDragEnter={(event) => {event.preventDefault(); setDropTarget(id);}} onDragOver={(event) => {event.preventDefault(); event.dataTransfer.dropEffect = "move";}} onDragLeave={(event) => {if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget("");}} onDrop={(event) => drop(event, id)} key={id}>
          <header><span><i />{label}</span><b>{members.length}</b></header>
          <div className="split-board-lane-items">{visible.map((sequence) => card(sequence))}{!members.length && <div className="split-board-empty">Drop sequences here</div>}{visible.length < members.length && <Button size="sm" onClick={() => setVisibleByRole((current) => ({...current, [id]: (current[id] || 24) + 24}))}>Show 24 more · {members.length - visible.length} remaining</Button>}</div>
        </section>;})}
      </div>
      {Boolean(protectedSequences.length) && <section className="split-board-protected" aria-label="Protected held-out sequences"><header><span><Lock size={13} /> Held out · protected</span><b>{protectedSequences.length}</b></header><div>{protectedSequences.slice(0, visibleByRole.held_out || 24).map((sequence) => card(sequence, true))}{(visibleByRole.held_out || 24) < protectedSequences.length && <Button size="sm" onClick={() => setVisibleByRole((current) => ({...current, held_out: (current.held_out || 24) + 24}))}>Show 24 more · {protectedSequences.length - (visibleByRole.held_out || 24)} remaining</Button>}</div></section>}
      <div className="split-manager-note"><Lock size={14} /><span>Held-out sequences cannot be reassigned here. This prevents training or iterative validation from opening reserved evaluation evidence.</span></div>
      <div className="modal-actions split-manager-actions"><Button onClick={() => onOpenChange(false)}>Cancel</Button><Button variant="primary" busy={saving} disabled={!changed.length} onClick={() => void save()}>Save split assignments</Button></div>
    </div>
  </Modal>;
}

export function DatasetView({project, inferenceTarget, onRunInference, onProjectChange, onOpenLlm}: {project: Project; inferenceTarget: InferenceTarget | null; onRunInference: (target: InferenceTarget) => void; onProjectChange: (project: Project) => void; onOpenLlm: () => void}) {
  const llmCorpus = isLlmCorpusProject(project);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const [layout, setLayout] = useState<"folders" | "grid" | "list">(llmCorpus ? "list" : "folders");
  const [folderPath, setFolderPath] = useState(".");
  const [visibleFiles, setVisibleFiles] = useState(24);
  const [visibleFolders, setVisibleFolders] = useState(24);
  const [visibleSequences, setVisibleSequences] = useState(48);
  const [visibleDescriptorSamples, setVisibleDescriptorSamples] = useState(48);
  const [descriptorSplit, setDescriptorSplit] = useState("test");
  const [activeTab, setActiveTab] = useState(llmCorpus ? "corpus" : "files");
  const [selected, setSelected] = useState<Artifact | null>(null);
  const [annotation, setAnnotation] = useState<AnnotationProject | null>(null);
  const [actionError, setActionError] = useState("");
  const [scanning, setScanning] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [splitManagerOpen, setSplitManagerOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [trainingMenu, setTrainingMenu] = useState<{x: number; y: number; target: TrainingTarget; artifact?: Artifact} | null>(null);
  const {data, error, loading, reload} = useRequest(
    () => api.artifacts(search, kind, 0, visibleFiles, layout === "folders" ? folderPath : undefined, visibleFolders),
    [project.id, project.selected_dataset, project.active_dataset_profile, search, kind, layout, folderPath, visibleFiles, visibleFolders],
  );
  const acceptedInferenceTargets = inferenceTargetKinds(project);
  const descriptorSamplesEnabled = acceptedInferenceTargets.includes("descriptor_sample");
  const activeDatasetProfile = (project.dataset_profiles || []).find((profile) => profile.id === project.active_dataset_profile);
  const descriptorSplitOptions = Object.entries(activeDatasetProfile?.splits || {});
  const {data: descriptorSamples, error: descriptorSampleError, loading: descriptorSamplesLoading} = useRequest(
    () => descriptorSamplesEnabled
      ? api.architectureSamples(descriptorSplit, 0, visibleDescriptorSamples)
      : Promise.resolve({available: false, samples: [], total: 0}),
    [project.id, project.selected_dataset, project.active_dataset_profile, descriptorSamplesEnabled, descriptorSplit, visibleDescriptorSamples],
  );
  const kinds = useMemo(() => Object.entries(data?.summary?.kinds || {}), [data]);
  const inventory = data?.inventory;
  const sequences = inventory?.sequences || [];
  const splitById = useMemo(() => Object.fromEntries((inventory?.splits || []).map((split) => [String(split.id), split])), [inventory]);
  const datasetRoot = String(project.selected_dataset || project.default_dataset || data?.root || "");
  const targetPath = inferenceTarget?.projectId === project.id && inferenceTarget.datasetRoot === datasetRoot && acceptedInferenceTargets.includes(inferenceTarget.targetType || "artifact") ? inferenceTarget.path : "";
  const trainingTarget = project.training_target?.dataset_root === datasetRoot ? project.training_target : undefined;
  const folderCrumbs = folderPath === "." ? [] : folderPath.split("/").filter(Boolean);
  const indexedFolders = data?.folders || [];
  const shownFolders = indexedFolders;
  const datasetNavigation = data?.navigation;
  const sequenceByPath = useMemo(() => new Map(
    sequences.filter((sequence) => sequence.path).map((sequence) => [String(sequence.path), sequence]),
  ), [sequences]);
  const currentSequence = sequenceByPath.get(folderPath);
  useEffect(() => { setFolderPath("."); setVisibleFiles(24); setVisibleFolders(24); setVisibleSequences(48); setVisibleDescriptorSamples(48); setDescriptorSplit("test"); setLayout(llmCorpus ? "list" : "folders"); setActiveTab(llmCorpus ? "corpus" : descriptorSamplesEnabled ? "inference-samples" : "files"); }, [project.id, project.selected_dataset, project.active_dataset_profile, llmCorpus, descriptorSamplesEnabled]);
  useEffect(() => {
    if (descriptorSplitOptions.length && !descriptorSplitOptions.some(([name]) => name === descriptorSplit)) setDescriptorSplit(descriptorSplitOptions[0][0]);
  }, [descriptorSplit, descriptorSplitOptions.map(([name]) => name).join("|")]);
  useEffect(() => { setVisibleFiles(24); setVisibleFolders(24); }, [search, kind, folderPath]);
  useEffect(() => {
    if (!trainingMenu) return;
    const close = () => setTrainingMenu(null);
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("click", close); window.addEventListener("blur", close); window.addEventListener("keydown", escape); window.addEventListener("scroll", close, true);
    return () => { window.removeEventListener("click", close); window.removeEventListener("blur", close); window.removeEventListener("keydown", escape); window.removeEventListener("scroll", close, true); };
  }, [trainingMenu]);
  const runInference = (artifact: Artifact) => onRunInference({
    projectId: project.id,
    datasetRoot,
    path: artifact.path,
    name: artifact.name,
    kind: artifact.kind,
    targetType: "artifact",
    mimeType: artifact.mime_type,
    size: artifact.size,
  });
  const runSequenceInference = (sequence: DatasetSequence) => onRunInference({
    projectId: project.id,
    datasetRoot,
    path: String(sequence.path || ""),
    name: String(sequence.id || "Image sequence"),
    kind: "sequence",
    targetType: "sequence",
    previewPath: String(sequence.preview_path || ""),
    frames: Number(sequence.frames || 0),
    fps: Number(sequence.fps || 0),
  });
  const runDescriptorSampleInference = (sample: DescriptorSample) => onRunInference(
    descriptorSampleInferenceTarget(project, datasetRoot, sample),
  );
  const datasetTrainingTarget = (kind: TrainingTarget["kind"], path: string, name: string): TrainingTarget => ({
    kind, dataset_root: datasetRoot, path, name,
  });
  const openTrainingMenu = (event: ReactMouseEvent, target: TrainingTarget, artifact?: Artifact) => {
    event.preventDefault(); event.stopPropagation();
    setTrainingMenu({x: Math.min(event.clientX, window.innerWidth - 230), y: Math.min(event.clientY, window.innerHeight - (artifact ? 145 : 90)), target, artifact});
  };
  const chooseTrainingTarget = async (target: TrainingTarget) => {
    setActionError(""); setTrainingMenu(null);
    try { onProjectChange(await api.selectTrainingTarget(project.id, target)); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : String(reason)); }
  };

  const rescan = async () => {
    setScanning(true); setActionError("");
    try { await api.rescanArtifacts(); await reload(); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setScanning(false); }
  };
  const openAnnotations = async (artifact: Artifact) => {
    setActionError("");
    try { setAnnotation(await api.annotationFromArtifact(artifact.path)); setSelected(null); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : String(reason)); }
  };
  const selectProfile = async (profileId: string) => {
    setSwitching(true); setActionError("");
    try { const selected = await api.selectDatasetProfile(project.id, profileId); onProjectChange(selected); }
    catch (reason) { setActionError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSwitching(false); }
  };
  const artifactCard = (artifact: Artifact) => {
    const inferenceSelected = artifact.path === targetPath;
    const trainingSelected = trainingTarget?.kind === "artifact" && trainingTarget.path === artifact.path;
    const targetable = artifact.kind !== "link" && acceptedInferenceTargets.includes("artifact");
    const target = datasetTrainingTarget("artifact", artifact.path, artifact.name);
    return <article key={artifact.path} className={`artifact-card ${inferenceSelected ? "inference-selected" : ""} ${trainingSelected ? "training-selected" : ""}`} onContextMenu={(event) => openTrainingMenu(event, target, artifact)}>
      <button type="button" className="artifact-open" onClick={() => setSelected(artifact)} aria-label={`Preview ${artifact.name}`}>
        <div className="artifact-thumbnail">{["image", "video"].includes(artifact.kind) ? <><img src={artifactUrl("thumbnail", artifact.path)} alt="" loading="lazy" />{artifact.kind === "video" && <span className="play-mark"><Play size={15} fill="currentColor" /></span>}</> : <ArtifactIcon kind={artifact.kind} />}{Boolean(artifact.annotation_count) && <Badge tone="active">{artifact.annotation_count} labels</Badge>}{inferenceSelected && <span className="inference-target-mark"><Crosshair size={12} /> Inference target</span>}{trainingSelected && <span className="training-target-mark"><Play size={12} /> Training target</span>}</div>
        <div className="artifact-copy"><small>{humanize(artifact.kind)}</small><strong>{artifact.name}</strong><span>{artifact.directory || "/"} · {formatBytes(artifact.size)}</span></div>
      </button>
      <button type="button" className="artifact-more-actions" title="Artifact actions" aria-label={`Actions for ${artifact.name}`} aria-haspopup="menu" onClick={(event) => openTrainingMenu(event, target, artifact)}><MoreHorizontal size={14} /></button>
      {targetable && <button type="button" className="artifact-run-inference" title="Select this object and configure inference" onClick={() => runInference(artifact)} aria-label={`Run inference on ${artifact.name}`}><Crosshair size={13} /> {inferenceSelected ? "Open in Inference" : "Run inference"}</button>}
    </article>;
  };

  if (loading && !data) return <LoadingState label="Cataloging dataset artifacts…" />;
  if (error && !data) return <ErrorNotice message={error} action={<Button onClick={() => void reload()}>Retry</Button>} />;
  if (!data?.available) return <div className="document-scroll dataset-workspace">
    <EmptyState
      icon={<Database />}
      title="No dataset selected"
      description="Choose a compatible dataset folder to connect this project workspace."
      action={<Button variant="primary" onClick={() => setPickerOpen(true)}><FolderOpen size={14} /> Browse datasets</Button>}
    />
    <DatasetPicker
      project={project}
      open={pickerOpen}
      onOpenChange={setPickerOpen}
      onSelected={(selected) => onProjectChange({...selected, dataset_repository: project.dataset_repository || selected.dataset_repository})}
    />
  </div>;

  return <div className="document-scroll dataset-workspace">
    <section className="dataset-hero">
      <div className="dataset-compact-header">
        <div className="dataset-compact-copy"><span>{llmCorpus ? "LLM corpus" : "Dataset"}</span><strong>{inventory?.name || data.name || "Imported dataset"}</strong><small title={String(project.selected_dataset || data.root || "")}>{String(project.selected_dataset || data.root || "")}</small></div>
        {Boolean(project.dataset_profiles?.length) && <label><span>Profile</span><select aria-label="Active dataset profile" disabled={switching} value={project.active_dataset_profile || project.default_dataset_profile || ""} onChange={(event) => void selectProfile(event.target.value)}>{(project.dataset_profiles || []).map((profile: DatasetProfile) => <option key={profile.id} value={profile.id}>{profile.name || profile.id}{profile.default ? " · default" : ""}</option>)}</select></label>}
        <Badge tone="success">{llmCorpus ? "Corpus bound" : "Project bound"}</Badge>
        <div className="dataset-compact-actions">{llmCorpus && <Button size="sm" onClick={onOpenLlm}><MessagesSquare size={13} /> Curate</Button>}<Button size="sm" variant={trainingTarget?.kind === "dataset" ? "primary" : "secondary"} onClick={() => void chooseTrainingTarget(datasetTrainingTarget("dataset", ".", data.name || datasetRoot.split(/[\\/]/).filter(Boolean).at(-1) || "Dataset"))}><Play size={13} /> {trainingTarget?.kind === "dataset" ? "Training target" : llmCorpus ? "Train on corpus" : "Train on dataset"}</Button><IconButton label="Browse datasets" onClick={() => setPickerOpen(true)}><FolderOpen size={14} /></IconButton><IconButton label="Refresh catalog" busy={scanning} onClick={() => void rescan()}><RefreshCw size={14} /></IconButton></div>
      </div>
      <details className="dataset-details">
        <summary><span>Dataset details</span><small>{compactNumber(data.summary?.files)} files · {compactNumber(inventory?.totals?.sequences)} sequences · {formatBytes(data.summary?.bytes)}</small><ChevronRight size={14} /></summary>
        <div className="dataset-details-body">
          <div className={`metric-strip ${llmCorpus ? "corpus" : ""}`}>
            <div><span>Files</span><strong>{compactNumber(data.summary?.files)}</strong></div>
            {llmCorpus ? <><div><span>Text &amp; tables</span><strong>{compactNumber(Number(data.summary?.kinds?.text || 0) + Number(data.summary?.kinds?.table || 0))}</strong></div><div><span>Documents</span><strong>{compactNumber(data.summary?.kinds?.pdf)}</strong></div><div><span>Media</span><strong>{compactNumber(Number(data.summary?.kinds?.image || 0) + Number(data.summary?.kinds?.audio || 0) + Number(data.summary?.kinds?.video || 0))}</strong></div><div><span>Directories</span><strong>{compactNumber(data.summary?.directories)}</strong></div></> : <><div><span>Sequences</span><strong>{compactNumber(inventory?.totals?.sequences)}</strong></div><div><span>Frames</span><strong>{compactNumber(inventory?.totals?.frames)}</strong></div><div><span>Objects</span><strong>{compactNumber(inventory?.totals?.objects)}</strong></div><div><span>Tracks</span><strong>{compactNumber(inventory?.totals?.tracks)}</strong></div></>}
            <div><span>Size</span><strong>{formatBytes(data.summary?.bytes)}</strong></div>
          </div>
          {!llmCorpus && <section className="dataset-split-overview" aria-labelledby="dataset-split-title">
            <div className="dataset-split-heading"><div><span><GitBranch size={16} /></span><div><strong id="dataset-split-title">Training &amp; validation split</strong><small>Assignments are sequence-disjoint and saved without moving source media.</small></div></div><Button variant="primary" disabled={!sequences.length || inventory?.split_plan?.editable === false} onClick={() => setSplitManagerOpen(true)}><GitBranch size={14} /> Manage splits</Button></div>
            <div className="dataset-split-cards">
              {[{id: "train", label: "Training"}, {id: "validation", label: "Validation"}, {id: "held_out", label: "Held out"}].map(({id, label}) => { const split = splitById[id] as Record<string, unknown> | undefined; return <div className={`dataset-split-card ${id}`} key={id}><span>{id === "held_out" && <Lock size={11} />}{label}</span><strong>{compactNumber(Number(split?.sequences || 0))} sequences</strong><small>{compactNumber(Number(split?.frames || 0))} frames · {compactNumber(Number(split?.objects || 0))} objects</small></div>; })}
            </div>
            {Boolean(splitById.unassigned) && <div className="dataset-split-warning"><strong>{compactNumber(Number((splitById.unassigned as Record<string, unknown>).sequences || 0))} unassigned sequences</strong><span>Open Manage splits before starting training.</span></div>}
          </section>}
        </div>
      </details>
      {(inventory?.catalog_truncated || data.summary?.truncated) && <ErrorNotice message="The imported catalog is truncated. Counts describe only the retained bounded inventory." />}
    </section>
    {actionError && <ErrorNotice message={actionError} />}

    <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
      <div className="subnav-bar"><Tabs.List>{llmCorpus && <Tabs.Trigger value="corpus">Corpus records</Tabs.Trigger>}{descriptorSamplesEnabled && <Tabs.Trigger value="inference-samples">Inference samples</Tabs.Trigger>}<Tabs.Trigger value="files">{llmCorpus ? "Files & manifests" : "Inventory & files"}</Tabs.Trigger>{(!llmCorpus || Boolean(sequences.length)) && <Tabs.Trigger value="sequences">{llmCorpus ? "Media sequences" : "Sequences"}</Tabs.Trigger>}{(!llmCorpus || Number(data.annotations?.records || 0) > 0) && <Tabs.Trigger value="annotations">Annotation coverage</Tabs.Trigger>}</Tabs.List></div>
      {llmCorpus && <Tabs.Content value="corpus"><LlmCorpusView project={project} onOpenLlm={onOpenLlm} /></Tabs.Content>}
      {descriptorSamplesEnabled && <Tabs.Content value="inference-samples">
        <section className="descriptor-sample-workspace" aria-labelledby="descriptor-sample-title">
          <header><div><strong id="descriptor-sample-title">Runnable descriptor samples</strong><small>Each object preserves its complete aligned input set. Individual source files remain preview-only.</small></div><label><span>Split</span><select aria-label="Inference sample split" value={descriptorSplit} onChange={(event) => {setDescriptorSplit(event.target.value); setVisibleDescriptorSamples(48);}}>{descriptorSplitOptions.map(([name, summary]) => <option key={name} value={name}>{humanize(name)} · {Number(summary.count || 0).toLocaleString()}</option>)}</select></label></header>
          {descriptorSampleError && <ErrorNotice message={descriptorSampleError} />}
          {descriptorSamplesLoading && !descriptorSamples?.samples?.length ? <LoadingState label="Resolving complete descriptor samples…" /> : <div className="descriptor-sample-grid">{(descriptorSamples?.samples || []).map((sample) => { const selectedSample = inferenceTarget?.targetType === "descriptor_sample" && inferenceTarget.sampleId === sample.id && inferenceTarget.datasetRoot === datasetRoot; const inputs = Object.keys(sample.inputs || {}); const requiredInputs = sample.required_inputs || inputs; return <article key={`${sample.split}:${sample.id}`} className={`descriptor-sample-card ${selectedSample ? "inference-selected" : ""}`}><div className="descriptor-sample-preview">{sample.preview_path ? <img src={artifactUrl("thumbnail", sample.preview_path)} alt="" loading="lazy" /> : <Database size={28} />}{selectedSample && <span className="inference-target-mark"><Crosshair size={12} /> Inference target</span>}</div><div className="descriptor-sample-copy"><small>{humanize(sample.split)} · complete logical sample</small><strong>{sample.id}</strong><span className="descriptor-modality-badges">{requiredInputs.map((name) => <Badge key={name} tone="success">{name.toUpperCase()} ready</Badge>)}<Badge>Expected result protected</Badge></span><span>{inputs.length} aligned inputs · descriptor index {sample.index + 1}</span></div><Button variant="primary" size="sm" onClick={() => runDescriptorSampleInference(sample)}><Crosshair size={13} /> {selectedSample ? "Open in Inference" : "Run inference"}</Button></article>;})}</div>}
          {!descriptorSamplesLoading && !(descriptorSamples?.samples || []).length && !descriptorSampleError && <EmptyState icon={<Crosshair />} title="No runnable samples" description={`The ${humanize(descriptorSplit)} split contains no complete descriptor samples.`} />}
          {Number(descriptorSamples?.total || 0) > (descriptorSamples?.samples || []).length && <div className="artifact-page-actions"><Button onClick={() => setVisibleDescriptorSamples((value) => value + 48)}>Show 48 more samples</Button><span>Showing {(descriptorSamples?.samples || []).length} of {compactNumber(descriptorSamples?.total)}</span></div>}
        </section>
      </Tabs.Content>}
      <Tabs.Content value="files">
        <div className="artifact-toolbar">
          <div className="sidebar-search"><Search size={14} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search imported paths" aria-label="Search dataset artifacts" /></div>
          <select value={kind} onChange={(event) => setKind(event.target.value)} aria-label="Artifact kind"><option value="all">All types ({data.summary?.files || 0})</option>{kinds.map(([name, count]) => <option key={name} value={name}>{humanize(name)} ({count})</option>)}</select>
          <div className="segmented"><IconButton label="Folder view" variant={layout === "folders" ? "primary" : "ghost"} onClick={() => setLayout("folders")}><FolderOpen size={14} /></IconButton><IconButton label="Flat grid view" variant={layout === "grid" ? "primary" : "ghost"} onClick={() => setLayout("grid")}><Grid3X3 size={14} /></IconButton><IconButton label="Flat list view" variant={layout === "list" ? "primary" : "ghost"} onClick={() => setLayout("list")}><List size={14} /></IconButton></div>
        </div>
        {layout === "folders" && Boolean(datasetNavigation?.splits?.length) && <nav className="dataset-jump-nav" aria-label="Dataset split and sequence shortcuts">
          <span>Jump to</span>
          {(datasetNavigation?.splits || []).map((split) => <button type="button" key={split.id} onClick={() => setFolderPath(split.path)}><strong>{split.label}</strong><small>{compactNumber(split.sequences)} sequences</small></button>)}
          <label><span className="sr-only">Jump directly to a sequence</span><select aria-label="Jump directly to a sequence" defaultValue="" onChange={(event) => {if (event.target.value) setFolderPath(event.target.value); event.target.value = "";}}><option value="">Go to sequence…</option>{(datasetNavigation?.sequences || []).map((sequence) => <option key={sequence.id} value={sequence.path}>{humanize(sequence.split)} · {sequence.name}</option>)}</select></label>
        </nav>}
        {targetPath && <div className="dataset-inference-selection" role="status"><Crosshair size={15} /><span><strong>Inference target</strong>{inferenceTarget?.name}</span><Badge tone="success">Selected</Badge><Button variant="primary" size="sm" onClick={() => inferenceTarget && onRunInference(inferenceTarget)}><Play size={13} fill="currentColor" /> Open Inference</Button></div>}
        {trainingTarget && <div className="dataset-training-selection" role="status"><Play size={15} /><span><strong>Training target · {humanize(trainingTarget.kind)}</strong>{trainingTarget.path === "." ? trainingTarget.dataset_root : trainingTarget.path}</span><Badge tone="success">Selected</Badge></div>}
        {layout === "folders" && <>
          <nav className="artifact-breadcrumbs" aria-label="Dataset folder path"><button type="button" onClick={() => setFolderPath(".")}><Database size={13} /> {data.name || "Dataset root"}</button>{folderCrumbs.map((crumb, index) => <span key={`${crumb}-${index}`}><ChevronRight size={12} /><button type="button" onClick={() => setFolderPath(folderCrumbs.slice(0, index + 1).join("/"))}>{crumb}</button></span>)}<small>{compactNumber(Number(data.matched_total ?? data.total ?? 0))} indexed files</small></nav>
          {currentSequence && acceptedInferenceTargets.includes("sequence") && <div className="dataset-sequence-folder-target"><div><Film size={16} /><span><strong>{currentSequence.id}</strong><small>Recognized image sequence · {compactNumber(currentSequence.frames)} frames · {Number(currentSequence.fps || 0).toFixed(1)} FPS</small></span></div><Button variant="primary" size="sm" onClick={() => runSequenceInference(currentSequence)}><Crosshair size={13} /> {targetPath === currentSequence.path ? "Open in Inference" : "Use folder as inference target"}</Button></div>}
          {data.folders_truncated && <ErrorNotice message="This level contains more than 1,000 folders. Use the path search to narrow the indexed collection." />}
          {Boolean(shownFolders.length) && <div className="artifact-folder-collection">{shownFolders.map((folder) => { const selectedForTraining = trainingTarget?.kind === "folder" && trainingTarget.path === folder.path; const target = datasetTrainingTarget("folder", folder.path, folder.name); const sequence = sequenceByPath.get(folder.path); const sequenceTargetable = Boolean(sequence && acceptedInferenceTargets.includes("sequence")); return <article className={`artifact-folder-card ${selectedForTraining ? "training-selected" : ""} ${targetPath === folder.path ? "inference-selected" : ""}`} key={folder.path} onContextMenu={(event) => openTrainingMenu(event, target)}>
            <button type="button" className="artifact-folder-open" onClick={() => setFolderPath(folder.path)} aria-label={`Open ${folder.name}, ${folder.files} files`}><div className={`artifact-folder-mosaic count-${Math.min(4, folder.artifacts?.length || 0)}`}>{(folder.artifacts || []).map((artifact) => <span key={artifact.path}>{["image", "video"].includes(artifact.kind) ? <img src={artifactUrl("thumbnail", artifact.path)} alt="" loading="lazy" /> : <ArtifactIcon kind={artifact.kind} />}</span>)}{!(folder.artifacts || []).length && <Folder size={30} />}{selectedForTraining && <span className="training-target-mark"><Play size={12} /> Training target</span>}</div><div className="artifact-folder-copy"><small><Folder size={12} /> {folder.folders ? `${folder.folders} nested folders` : "Sequence or group"}</small><strong>{folder.name}</strong><span>{compactNumber(folder.files)} files · {formatBytes(folder.bytes)}</span></div><ChevronRight size={17} /></button>
            {sequenceTargetable && sequence && <button type="button" className="folder-inference-action" title={`Use ${sequence.id} as inference target`} aria-label={`Use ${sequence.id} folder as inference target`} onClick={(event) => {event.stopPropagation(); runSequenceInference(sequence);}}><Crosshair size={14} /></button>}
            <button type="button" className={`folder-more-actions ${sequenceTargetable ? "sequence-actions" : ""}`} title="Folder actions" aria-label={`Actions for ${folder.name}`} aria-haspopup="menu" onClick={(event) => openTrainingMenu(event, target)}><MoreHorizontal size={14} /></button>
          </article>;})}</div>}
          {visibleFolders < Math.min(1000, Number(data.folder_total || 0)) && <div className="artifact-page-actions"><Button onClick={() => setVisibleFolders((value) => Math.min(1000, value + 24))}>Show more folders</Button><span>Showing {indexedFolders.length} of {compactNumber(data.folder_total)} folders</span></div>}
          {Boolean((data.artifacts || []).length) && <><div className="artifact-level-heading"><strong>Files in this folder</strong><span>Showing a bounded page, not the entire sequence.</span></div><div className="artifact-collection grid">{(data.artifacts || []).map(artifactCard)}</div></>}
        </>}
        {layout !== "folders" && <div className={`artifact-collection ${layout}`}>{(data.artifacts || []).map(artifactCard)}</div>}
        {Number(data.total || 0) > (data.artifacts || []).length && <div className="artifact-page-actions">{visibleFiles < 100 && <Button onClick={() => setVisibleFiles((value) => Math.min(100, value + 24))}>Show 24 more files</Button>}<span>Showing {(data.artifacts || []).length} of {compactNumber(data.total)} files{visibleFiles >= 100 ? " · narrow the folder or search to continue" : ""}</span></div>}
        {!(data.artifacts || []).length && !shownFolders.length && <EmptyState icon={<Search />} title="No matching artifacts" description="Change the search or media filter, move to a parent folder, or refresh the imported catalog." />}
      </Tabs.Content>
      <Tabs.Content value="sequences" className="sequence-grid">{activeTab === "sequences" && <>{sequences.slice(0, visibleSequences).map((sequence) => <Card key={sequence.path || sequence.id} className={`sequence-card ${targetPath === sequence.path ? "inference-selected" : ""}`}><div className="sequence-heading"><div><Film size={16} /><strong>{sequence.id}</strong></div><Badge>{humanize(sequence.split || "Unassigned")}{sequence.split_editable === false ? " · protected" : ""}</Badge></div><div className="sequence-facts"><span><b>{compactNumber(sequence.frames)}</b> frames</span><span><b>{Number(sequence.fps || 0).toFixed(1)}</b> FPS</span><span><b>{Number(sequence.duration_seconds || 0).toFixed(1)}s</b> duration</span><span><b>{compactNumber(sequence.tracks)}</b> tracks</span></div><small>{sequence.path}</small><div className="sequence-card-actions">{acceptedInferenceTargets.includes("sequence") && <Button variant="primary" size="sm" onClick={() => runSequenceInference(sequence)}><Crosshair size={13} /> {targetPath === sequence.path ? "Open in Inference" : "Run inference"}</Button>}{sequence.split_editable !== false && <Button size="sm" onClick={() => setSplitManagerOpen(true)}>Change split</Button>}</div></Card>)}{visibleSequences < sequences.length && <div className="artifact-page-actions"><Button onClick={() => setVisibleSequences((value) => value + 48)}>Show 48 more sequences</Button><span>Showing {visibleSequences} of {compactNumber(sequences.length)} sequences</span></div>}</>}</Tabs.Content>
      <Tabs.Content value="annotations"><div className="annotation-summary"><Card><Tags size={19} /><strong>{compactNumber(Number(data.annotations?.records || 0))}</strong><span>Annotation records</span></Card><Card><BoxSelectIcon /><strong>{compactNumber(Number(data.annotations?.objects || 0))}</strong><span>Objects</span></Card><Card><Database size={19} /><strong>{compactNumber(Number(data.annotations?.sources || 0))}</strong><span>Sources</span></Card></div><div className="annotation-coverage"><Card><header><strong>Imported formats</strong><small>Normalized through one non-destructive interchange layer</small></header><div>{Object.entries((data.annotations?.formats || {}) as Record<string, number>).map(([format, count]) => <Badge key={format} tone="active">{humanize(format)} · {compactNumber(count)}</Badge>)}</div>{!Object.keys((data.annotations?.formats || {}) as object).length && <span>No annotation sources detected.</span>}</Card><Card><header><strong>Geometry coverage</strong><small>Boxes, vectors, masks, keypoints, tracks, and temporal labels retain their type</small></header><div>{Object.entries((data.annotations?.geometries || {}) as Record<string, number>).map(([geometry, count]) => <Badge key={geometry}>{humanize(geometry)} · {compactNumber(count)}</Badge>)}</div>{!Object.keys((data.annotations?.geometries || {}) as object).length && <span>No normalized geometry detected.</span>}</Card></div></Tabs.Content>
    </Tabs.Root>

    <Modal open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)} title={selected?.name || "Artifact"} description={selected?.path} wide>
      {selected && <div className="artifact-modal-body"><ArtifactPreview artifact={selected} /><aside><Badge>{humanize(selected.kind)}</Badge><dl>{Object.entries({Size: formatBytes(selected.size), MIME: selected.mime_type || "Unknown", Annotations: selected.annotation_count || 0, ...selected.details}).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{typeof value === "object" ? JSON.stringify(value) : String(value ?? "—")}</dd></div>)}</dl><div className="modal-actions">{selected.kind !== "link" && acceptedInferenceTargets.includes("artifact") && <Button variant="primary" onClick={() => runInference(selected)}><Crosshair size={14} /> Run inference on this artifact</Button>}{selected.kind !== "link" && <Button onClick={() => void chooseTrainingTarget(datasetTrainingTarget("artifact", selected.path, selected.name))}><Play size={14} /> Use as training target</Button>}<a className="mf-button mf-button-secondary mf-button-md" href={artifactUrl("raw", selected.path)} target="_blank" rel="noreferrer">Open original</a>{["image", "video"].includes(selected.kind) && <Button onClick={() => void openAnnotations(selected)}>{Number(selected.annotation_count || 0) > 0 ? "Edit annotations" : "Open annotation editor"}</Button>}</div></aside></div>}
    </Modal>
    {trainingMenu && <div className="dataset-context-menu" role="menu" aria-label={trainingMenu.artifact ? "Artifact actions" : "Training target actions"} style={{left: trainingMenu.x, top: trainingMenu.y}} onClick={(event) => event.stopPropagation()}>{trainingMenu.artifact && acceptedInferenceTargets.includes("artifact") && <button type="button" role="menuitem" onClick={() => {const artifact = trainingMenu.artifact; setTrainingMenu(null); if (artifact) runInference(artifact);}}><Crosshair size={14} /><span><strong>Use as inference target</strong><small>{humanize(trainingMenu.artifact.kind)} · {trainingMenu.artifact.path}</small></span></button>}<button type="button" role="menuitem" disabled={trainingMenu.target.kind !== "dataset" && isHeldOutPath(trainingMenu.target.path, trainingMenu.target.kind)} onClick={() => void chooseTrainingTarget(trainingMenu.target)}><Play size={14} /><span><strong>{trainingMenu.target.kind !== "dataset" && isHeldOutPath(trainingMenu.target.path, trainingMenu.target.kind) ? "Held-out evidence cannot train" : "Use as training target"}</strong><small>{humanize(trainingMenu.target.kind)} · {trainingMenu.target.path}</small></span></button></div>}
    {annotation && <div className="annotation-overlay"><AnnotationEditor initial={annotation} onClose={() => { setAnnotation(null); void reload(); }} /></div>}
    {splitManagerOpen && <SplitManager project={project} sequences={sequences} open onOpenChange={setSplitManagerOpen} onSaved={reload} />}
    <DatasetPicker project={project} open={pickerOpen} onOpenChange={setPickerOpen} onSelected={(selected) => {onProjectChange({...selected, dataset_repository: project.dataset_repository || selected.dataset_repository}); setSelected(null); setAnnotation(null);}} />
  </div>;
}

function BoxSelectIcon() { return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><rect x="7" y="8" width="10" height="8" rx="1"/></svg>; }
