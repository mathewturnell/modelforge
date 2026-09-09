const tokenStorageKey = "modelforge.alpha.session-token";
const projectStorageKey = "modelforge.alpha.selected-project";
const fragmentToken = new URLSearchParams(location.hash.slice(1)).get("token");
let token = fragmentToken;
try {
  if (fragmentToken) sessionStorage.setItem(tokenStorageKey, fragmentToken);
  else token = sessionStorage.getItem(tokenStorageKey);
} catch (_error) {}
history.replaceState(null, "", `${location.pathname}${location.search}`);

const headers = token ? {Authorization: `Bearer ${token}`} : {};
let projects = [];
let selectedProject = null;
let selectedSample = null;
let selectedExecutionTarget = null;
let latestRun = null;
let pollTimer = null;
let samplePreviewUrl = null;
let resultPreviewUrls = [];
let renderEpoch = 0;
let selectionEpoch = 0;
const node = id => document.getElementById(id);
const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]);

function executionTargets(project) {
  if (Array.isArray(project?.execution_targets) && project.execution_targets.length) return project.execution_targets;
  return [{
    target: "local",
    provider: "local",
    billable: false,
    readiness: project?.runtime_readiness,
    ready: project?.runtime_readiness === "ready",
    reasons: project?.readiness_reasons || [],
  }];
}

function targetName(target) {
  if (target?.provider === "modal" || target?.target === "modal") return "Modal";
  return target?.display_name || "Local computer";
}

function targetIsReady(target) {
  if (!target) return false;
  if (typeof target.ready === "boolean") return target.ready;
  return ["ready", "configured"].includes(target.readiness || target.state);
}

function targetReasons(target) {
  const reasons = target?.reasons || target?.readiness_reasons || [];
  return Array.isArray(reasons) ? reasons : reasons ? [String(reasons)] : [];
}

function runProvider(run) {
  return run?.provider || run?.execution?.provider || run?.configuration?.provider || run?.configuration?.execution_target;
}

function isModalTarget(target) {
  return target?.provider === "modal" || target?.target === "modal";
}

function runIsModal(run) {
  return runProvider(run) === "modal";
}

function idempotencyStorageKey(project) {
  return `modelforge.alpha.pending-launch.${project.id}.${project.action.id}`;
}

function requestFingerprint(value) {
  const textValue = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < textValue.length; index += 1) {
    hash ^= textValue.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function newIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

function pendingLaunch(project, request) {
  const fingerprint = requestFingerprint(request);
  let retained = null;
  try { retained = JSON.parse(sessionStorage.getItem(idempotencyStorageKey(project))); } catch (_error) {}
  if (retained && retained.fingerprint !== fingerprint) {
    throw new Error("A previous launch has an unknown outcome. Restore its exact target and input, then retry with the same launch identity, or refresh run history before leaving this tab.");
  }
  const value = retained || {idempotency_key: newIdempotencyKey(), fingerprint};
  try { sessionStorage.setItem(idempotencyStorageKey(project), JSON.stringify(value)); } catch (_error) {}
  return value;
}

function clearPendingLaunch(project) {
  try { sessionStorage.removeItem(idempotencyStorageKey(project)); } catch (_error) {}
}

async function api(path, options = {}) {
  const response = await fetch(path, {...options, headers: {...headers, ...(options.headers || {})}});
  let value = {};
  try { value = await response.json(); } catch (_error) {}
  if (!response.ok) {
    const error = new Error(value.error || `Request failed with HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return value;
}

function connection(value, failed = false) {
  node("connection").textContent = value;
  node("connection").className = `badge ${failed ? "failed" : value === "Connected" ? "" : "neutral"}`;
}

function clearPoll() {
  if (pollTimer !== null) clearTimeout(pollTimer);
  pollTimer = null;
}

function showActionError(message) {
  const error = node("action-error");
  error.textContent = message;
  error.hidden = !message;
}

function resetSamplePreview() {
  const preview = node("sample-preview");
  preview.hidden = true;
  preview.removeAttribute("src");
  preview.load();
  if (samplePreviewUrl) URL.revokeObjectURL(samplePreviewUrl);
  samplePreviewUrl = null;
}

function clearResultPreviews() {
  for (const url of resultPreviewUrls) URL.revokeObjectURL(url);
  resultPreviewUrls = [];
  node("result-preview").replaceChildren();
}

const artifactUrl = (run, artifact) => `/api/v1/runs/${encodeURIComponent(run.id)}/artifacts/${encodeURIComponent(artifact.id)}`;
const sampleUrl = (project, sample) => `/api/v1/projects/${encodeURIComponent(project.id)}/datasets/${encodeURIComponent(project.dataset.id)}/samples/${encodeURIComponent(sample.id)}/content`;

async function checkedFetch(path) {
  const response = await fetch(path, {headers});
  if (!response.ok) throw new Error(`Request failed with HTTP ${response.status}`);
  return response;
}

async function previewSample(project, sample, epoch) {
  resetSamplePreview();
  if (!sample.content_type?.startsWith("video/")) return;
  node("dataset-state").hidden = false;
  node("dataset-state").textContent = "Loading the selected checked sample…";
  try {
    const response = await checkedFetch(sampleUrl(project, sample));
    const url = URL.createObjectURL(await response.blob());
    if (epoch !== selectionEpoch || selectedSample?.id !== sample.id) {
      URL.revokeObjectURL(url);
      return;
    }
    samplePreviewUrl = url;
    const preview = node("sample-preview");
    preview.src = url;
    preview.hidden = false;
    node("dataset-state").hidden = true;
  } catch (error) {
    node("dataset-state").hidden = false;
    node("dataset-state").textContent = `Sample unavailable. ${error.message}`;
    connection("Sample unavailable", true);
  }
}

async function openArtifact(event, link, artifact) {
  event.preventDefault();
  const preview = window.open("about:blank", "_blank");
  if (preview) preview.opener = null;
  try {
    const response = await checkedFetch(link.href);
    const url = URL.createObjectURL(await response.blob());
    if (preview) preview.location.replace(url);
    else {
      const download = document.createElement("a");
      download.href = url;
      download.download = artifact.name;
      download.hidden = true;
      document.body.append(download);
      download.click();
      download.remove();
    }
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (error) {
    if (preview) preview.close();
    showActionError(`Artifact unavailable. ${error.message}`);
  }
}

function previewError(message) {
  const alert = document.createElement("div");
  alert.className = "alert";
  alert.role = "alert";
  alert.textContent = message;
  node("result-preview").append(alert);
}

function renderTableResult(value, artifact) {
  const candidates = Array.isArray(value)
    ? value
    : Object.values(value || {}).filter(item => Array.isArray(item));
  const rows = (Array.isArray(value) ? candidates : candidates[0] || []).slice(0, 100);
  const columns = [...new Set(rows.flatMap(row => (
    row && typeof row === "object" && !Array.isArray(row) ? Object.keys(row) : ["value"]
  )))].slice(0, 20);
  if (!rows.length || !columns.length) {
    const fallback = document.createElement("pre");
    fallback.setAttribute("aria-label", `Checked table result ${artifact.name}`);
    fallback.textContent = JSON.stringify(value, null, 2);
    return fallback;
  }
  const scroll = document.createElement("div");
  scroll.className = "result-table-scroll";
  const table = document.createElement("table");
  const caption = document.createElement("caption");
  caption.textContent = artifact.name;
  table.append(caption);
  const head = document.createElement("thead");
  const header = document.createElement("tr");
  for (const column of columns) {
    const cell = document.createElement("th");
    cell.scope = "col";
    cell.textContent = column;
    header.append(cell);
  }
  head.append(header);
  table.append(head);
  const body = document.createElement("tbody");
  for (const row of rows) {
    const line = document.createElement("tr");
    const record = row && typeof row === "object" && !Array.isArray(row) ? row : {value: row};
    for (const column of columns) {
      const cell = document.createElement("td");
      const cellValue = record[column];
      cell.textContent = cellValue === null || cellValue === undefined
        ? ""
        : typeof cellValue === "object" ? JSON.stringify(cellValue) : String(cellValue);
      line.append(cell);
    }
    body.append(line);
  }
  table.append(body);
  scroll.append(table);
  return scroll;
}

async function loadArtifactPreview(run, artifact, epoch) {
  const path = artifactUrl(run, artifact);
  try {
    const response = await checkedFetch(path);
    const blob = await response.blob();
    if (epoch !== renderEpoch) return;
    if (artifact.content_type === "video/mp4") {
      const url = URL.createObjectURL(blob);
      resultPreviewUrls.push(url);
      const video = document.createElement("video");
      video.controls = true;
      video.preload = "metadata";
      video.setAttribute("aria-label", `${artifact.name} result preview`);
      video.src = url;
      node("result-preview").append(video);
    } else if (artifact.kind === "assistant-text") {
      const result = document.createElement("pre");
      result.setAttribute("aria-label", "Checked assistant response");
      result.textContent = await blob.text();
      if (epoch === renderEpoch) node("result-preview").append(result);
    } else if (artifact.kind === "table" && artifact.content_type === "application/json") {
      const result = renderTableResult(JSON.parse(await blob.text()), artifact);
      if (epoch === renderEpoch) node("result-preview").append(result);
    }
  } catch (error) {
    if (epoch === renderEpoch) previewError(`Checked preview unavailable. ${error.message}`);
  }
}

async function loadProcessLog(run, artifact, epoch) {
  try {
    const response = await checkedFetch(artifactUrl(run, artifact));
    const text = await response.text();
    if (epoch !== renderEpoch) return;
    node("log-tail").className = "";
    node("log-tail").textContent = text || "The checked process log is empty.";
  } catch (error) {
    if (epoch === renderEpoch) node("log-tail").textContent = `Checked process log unavailable. ${error.message}`;
  }
}

function renderExecutionTarget() {
  const panel = node("execution-panel");
  if (!selectedProject || selectedProject.id === "synthetic-threshold") {
    panel.hidden = true;
    selectedExecutionTarget = null;
    updateRunAvailability();
    return;
  }
  panel.hidden = false;
  const target = selectedExecutionTarget;
  const detail = node("execution-detail");
  const billable = Boolean(target?.billable || isModalTarget(target));
  node("billable-panel").hidden = !billable;
  if (!billable) node("billable-confirm").checked = false;
  if (!target) {
    detail.className = "target-detail empty";
    detail.textContent = "No execution target is configured for this action.";
    updateRunAvailability();
    return;
  }
  const ready = targetIsReady(target);
  node("billable-confirm").disabled = billable && !ready;
  const compute = target.compute || {};
  const hasCompute = Object.keys(compute).length > 0;
  const gpu = !hasCompute ? null : compute.gpu
    ? `${escapeHtml(compute.gpu)} × ${escapeHtml(compute.gpu_count ?? 1)}`
    : "CPU only";
  const cpu = Number.isInteger(compute.cpu_millis) ? `${compute.cpu_millis / 1000} planned CPU core${compute.cpu_millis === 1000 ? "" : "s"}` : null;
  const memory = Number.isInteger(compute.memory_mib) ? `${compute.memory_mib} MiB planned memory` : null;
  const resources = [gpu, cpu, memory].filter(Boolean).join(" · ");
  const limits = Number.isInteger(compute.timeout_seconds)
    ? `${compute.timeout_seconds}s timeout · ${compute.max_containers ?? "?"} maximum container · ${compute.retries ?? "?"} retries · ${compute.warm_containers ?? "?"} warm containers`
    : null;
  const configuredStatus = isModalTarget(target) && ready ? "Configured for launch" : ready ? "Ready" : "Unavailable";
  detail.className = "target-detail";
  detail.innerHTML = `<dl>
    <div><dt>Status</dt><dd>${escapeHtml(configuredStatus)}</dd></div>
    ${target.provider_readiness ? `<div><dt>Provider verification</dt><dd>${escapeHtml(String(target.provider_readiness).replaceAll("_", " "))}</dd></div>` : ""}
    ${target.environment ? `<div><dt>Environment</dt><dd>${escapeHtml(target.environment)}</dd></div>` : ""}
    ${compute.target ? `<div><dt>Compute target</dt><dd>${escapeHtml(compute.target)}</dd></div>` : ""}
    ${resources ? `<div><dt>Declared resources</dt><dd>${resources}</dd></div>` : ""}
    ${limits ? `<div><dt>Declared limits</dt><dd>${escapeHtml(limits)}</dd></div>` : ""}
    ${target.binding_sha256 ? `<div><dt>Binding</dt><dd><code>${escapeHtml(target.binding_sha256)}</code></dd></div>` : ""}
    ${targetReasons(target).length ? `<div><dt>Reason</dt><dd>${escapeHtml(targetReasons(target).join("; "))}</dd></div>` : ""}
  </dl>`;
  node("support").textContent = `${selectedProject.support_level} · ${isModalTarget(target) && ready ? "configured" : ready ? "ready" : "unavailable"}`;
  updateRunAvailability();
}

function updateRunAvailability() {
  if (!selectedProject) return;
  const runButton = node("run");
  if (selectedProject.id === "synthetic-threshold") {
    runButton.textContent = "Run offline smoke test";
    runButton.disabled = selectedProject.runtime_readiness !== "ready";
    return;
  }
  const target = selectedExecutionTarget;
  const hasRequiredInput = !selectedProject.dataset || Boolean(selectedSample);
  const billableConfirmed = !(target?.billable || isModalTarget(target)) || node("billable-confirm").checked;
  runButton.textContent = isModalTarget(target)
    ? (billableConfirmed ? "Start confirmed Modal run" : "Confirm billable run to continue")
    : selectedProject.action.display_name;
  runButton.disabled = !targetIsReady(target) || !hasRequiredInput || !billableConfirmed;
}

function chooseExecutionTarget(project) {
  const targets = executionTargets(project);
  const control = node("execution-target");
  control.replaceChildren();
  const preferred = targets.find(target => targetIsReady(target) && !target.billable && !isModalTarget(target))
    || targets.find(target => targetIsReady(target))
    || targets[0]
    || null;
  for (const target of targets) {
    const option = document.createElement("option");
    option.value = target.target;
    option.textContent = `${targetName(target)}${target.billable || isModalTarget(target) ? " · billable" : ""}${targetIsReady(target) ? "" : " · unavailable"}`;
    control.append(option);
  }
  selectedExecutionTarget = preferred;
  if (preferred) control.value = preferred.target;
  node("billable-confirm").checked = false;
  renderExecutionTarget();
}

function renderRun(run) {
  const epoch = ++renderEpoch;
  latestRun = run;
  clearResultPreviews();
  const status = run?.status || "No run";
  const unavailable = run?.runtime_observation?.state === "unavailable";
  const modal = runIsModal(run);
  const cancellationRequested = run?.configuration?.cancellation_requested_at || run?.cancellation_requested_at;
  const cancellationConfirmed = run?.configuration?.cancellation_confirmed_at || run?.cancellation_confirmed_at;
  const cancelling = Boolean(cancellationRequested) && !cancellationConfirmed && ["queued", "running"].includes(status);
  node("run-status").textContent = unavailable ? `${status} · unavailable` : cancelling ? `${status} · cancellation requested` : status;
  node("run-status").className = `badge ${status === "failed" ? "failed" : ["queued", "running"].includes(status) && !unavailable ? "running" : "neutral"}`;
  node("cancel").hidden = !run || unavailable || cancelling || !["queued", "running"].includes(status);
  node("cancel").textContent = modal ? "Request Modal cancellation" : "Request cancellation";
  const recoverable = Boolean(run?.runtime_observation?.recoverable || run?.recovery_available || (modal && unavailable && ["queued", "running"].includes(status)));
  node("recover").hidden = !recoverable;
  node("run-controls").hidden = node("cancel").hidden && node("recover").hidden;
  node("artifacts").replaceChildren();
  if (!run) {
    node("run-detail").className = "empty";
    node("run-detail").textContent = selectedProject ? `No ${selectedProject.name} run is selected.` : "Select and start an available project action.";
    node("progress").className = "empty";
    node("progress").textContent = "Unavailable";
    node("log-tail").className = "empty";
    node("log-tail").textContent = "Unavailable";
    node("telemetry").className = "empty";
    node("telemetry").textContent = "Unavailable for this action.";
    return;
  }
  node("run-detail").className = "";
  node("run-detail").innerHTML = `<dl>
    <div><dt>Run identity</dt><dd><code>${escapeHtml(run.id)}</code></dd></div>
    <div><dt>Project</dt><dd>${escapeHtml(run.project_id)}</dd></div>
    ${runProvider(run) ? `<div><dt>Execution</dt><dd>${escapeHtml(runProvider(run) === "modal" ? "Modal provider" : "Local computer")}</dd></div>` : ""}
    ${run.provider_action_id ? `<div><dt>Provider call</dt><dd><code>${escapeHtml(run.provider_action_id)}</code></dd></div>` : ""}
    ${run.configuration?.modal?.binding_sha256 ? `<div><dt>Binding</dt><dd><code>${escapeHtml(run.configuration.modal.binding_sha256)}</code></dd></div>` : ""}
    ${cancellationRequested ? `<div><dt>Cancellation</dt><dd>${escapeHtml(cancellationConfirmed ? "Confirmed by executor" : ["completed", "failed"].includes(status) ? "Requested; terminal result won the race" : "Requested; awaiting executor acknowledgement")}</dd></div>` : ""}
    <div><dt>Created</dt><dd>${escapeHtml(run.created_at)}</dd></div>
    ${run.request?.checkpoint_sha256 ? `<div><dt>Checkpoint</dt><dd><code>${escapeHtml(run.request.checkpoint_sha256)}</code></dd></div>` : ""}
    ${run.request?.model_revision ? `<div><dt>Model revision</dt><dd><code>${escapeHtml(run.request.model_revision)}</code></dd></div>` : ""}
    ${run.error ? `<div><dt>Failure</dt><dd>${escapeHtml(run.error)}</dd></div>` : ""}
  </dl>`;
  node("progress").className = run.live?.progress ? "" : "empty";
  node("progress").textContent = run.live?.progress
    ? `${run.live.progress.stage || "running"} · ${run.live.progress.percent ?? "?"}%`
    : unavailable
      ? modal
        ? "Provider status unavailable · retained run state is stale. No completion or failure has been inferred. Recover to reattach to the same provider call."
        : "Unavailable · retained run state is stale. Restarted local processes are not reported as successful."
      : status === "completed"
        ? "Completed; live progress is operational status, not scientific telemetry."
        : status === "cancelled"
          ? modal ? "Cancellation was confirmed by Modal." : "Cancellation was confirmed by the local executor."
          : modal ? "Unavailable · this Modal action does not provide live progress." : "Unavailable";
  node("log-tail").className = run.live?.log_tail ? "" : "empty";
  node("log-tail").textContent = run.live?.log_tail || (unavailable
    ? modal ? "Unavailable · no live provider log is attached. Recovery does not start a second call." : "Unavailable · no live process log is attached."
    : status === "completed"
      ? "Live process log ended. A checked process.log appears below only when this action recorded one."
      : status === "cancelled"
        ? modal ? "The provider acknowledged cancellation. Checked terminal output appears below only when returned by the action." : "The local process stopped; inspect the checked process.log artifact when available."
        : modal ? "Unavailable · live Modal logs are not streamed into this workbench." : "Unavailable");
  node("telemetry").className = "empty";
  node("telemetry").textContent = modal
    ? "Unavailable · no live scientific telemetry or provider usage is reported for this action."
    : "Unavailable for this action.";
  const artifacts = node("artifacts");
  for (const artifact of run.artifacts || []) {
    const link = document.createElement("a");
    link.className = "artifact";
    link.href = artifactUrl(run, artifact);
    link.textContent = `${artifact.name} · ${artifact.size_bytes} bytes`;
    link.dataset.artifactId = artifact.id;
    link.addEventListener("click", event => openArtifact(event, link, artifact));
    artifacts.append(link);
    if (
      artifact.content_type === "video/mp4"
      || artifact.kind === "assistant-text"
      || (artifact.kind === "table" && artifact.content_type === "application/json")
    ) loadArtifactPreview(run, artifact, epoch);
    if (artifact.kind === "process-log") loadProcessLog(run, artifact, epoch);
  }
}

function renderHistory(runs) {
  const historyNode = node("history");
  historyNode.replaceChildren();
  historyNode.className = runs.length ? "" : "empty";
  if (!runs.length) {
    historyNode.textContent = selectedProject ? `No recorded ${selectedProject.name} runs in this state root.` : "No recorded runs in this state root.";
    return;
  }
  for (const run of runs) {
    const row = document.createElement("button");
    row.className = "run-row secondary";
    row.type = "button";
    const status = run.runtime_observation?.state === "unavailable" ? `${run.status} · unavailable` : run.status;
    row.setAttribute("aria-label", `${run.name}, ${status}`);
    row.innerHTML = `<span>${escapeHtml(run.name)}</span><span>${escapeHtml(status)}</span>`;
    row.addEventListener("click", () => renderRun(run));
    historyNode.append(row);
  }
}

function updateSelectedProjectControl() {
  for (const button of node("projects").children) {
    const chosen = button.dataset.projectId === selectedProject?.id;
    button.classList.toggle("selected", chosen);
    button.setAttribute("aria-pressed", String(chosen));
  }
}

async function selectProject(project, {moveFocus = false} = {}) {
  const epoch = ++selectionEpoch;
  clearPoll();
  resetSamplePreview();
  showActionError("");
  selectedProject = project;
  try { sessionStorage.setItem(projectStorageKey, project.id); } catch (_error) {}
  selectedSample = null;
  renderRun(null);
  updateSelectedProjectControl();
  node("project-name").textContent = project.name;
  node("project-description").textContent = project.description;
  node("support").textContent = `${project.support_level} · ${project.runtime_readiness}`;
  node("capabilities").innerHTML = `<div><dt>Capabilities</dt><dd>${escapeHtml(project.capabilities.join(", "))}</dd></div><div><dt>Runtime</dt><dd>${escapeHtml(project.readiness_reasons.join("; ") || project.runtime_readiness)}</dd></div>`;
  node("prompt-panel").hidden = project.action.kind !== "prompt";
  node("dataset-panel").hidden = !project.dataset;
  chooseExecutionTarget(project);
  const ready = project.id === "synthetic-threshold" ? project.runtime_readiness === "ready" : targetIsReady(selectedExecutionTarget);
  if (!ready) showActionError(`This action is not ready on the selected target. ${targetReasons(selectedExecutionTarget).join("; ") || project.readiness_reasons.join("; ") || "Complete its owner configuration, then refresh."}`);
  if (moveFocus) {
    node("project-name").tabIndex = -1;
    node("project-name").focus();
  }
  if (project.dataset && project.id !== "synthetic-threshold") {
    const datasetState = node("dataset-state");
    datasetState.hidden = false;
    datasetState.textContent = "Loading bounded sample metadata…";
    const sampleList = node("samples");
    sampleList.replaceChildren();
    try {
      const page = await api(`/api/v1/projects/${encodeURIComponent(project.id)}/datasets/${encodeURIComponent(project.dataset.id)}/samples`);
      if (epoch !== selectionEpoch) return;
      for (const sample of page.samples) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "sample secondary";
        button.textContent = `${sample.name} · ${sample.split}`;
        button.setAttribute("aria-pressed", "false");
        button.addEventListener("click", () => {
          selectedSample = sample;
          for (const item of sampleList.children) {
            item.classList.remove("selected");
            item.setAttribute("aria-pressed", "false");
          }
          button.classList.add("selected");
          button.setAttribute("aria-pressed", "true");
          updateRunAvailability();
          previewSample(project, sample, epoch);
        });
        sampleList.append(button);
      }
      if (page.samples.length) sampleList.firstElementChild.click();
      else datasetState.textContent = "No bounded samples are configured. Update the private local configuration and refresh.";
    } catch (error) {
      if (epoch !== selectionEpoch) return;
      datasetState.textContent = `Dataset unavailable. ${error.message}`;
      showActionError(`The configured dataset cannot be inspected. ${error.message}`);
    }
  }
  await refresh();
}

function renderProjects() {
  const list = node("projects");
  list.replaceChildren();
  node("project-count").textContent = projects.length;
  for (const project of projects) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "project-row secondary";
    button.dataset.projectId = project.id;
    button.setAttribute("aria-pressed", "false");
    button.innerHTML = `<strong>${escapeHtml(project.name)}</strong><span>${escapeHtml(project.action.kind)}</span>`;
    button.addEventListener("click", () => selectProject(project, {moveFocus: true}));
    list.append(button);
  }
}

async function refresh() {
  clearPoll();
  const project = selectedProject;
  const epoch = selectionEpoch;
  if (!project) return;
  try {
    const {runs} = await api(`/api/v1/runs?project_id=${encodeURIComponent(project.id)}`);
    if (epoch !== selectionEpoch || selectedProject?.id !== project.id) return;
    connection("Connected");
    renderHistory(runs);
    if (!latestRun && runs.length) renderRun(runs[0]);
    if (latestRun) {
      const current = await api(`/api/v1/runs/${encodeURIComponent(latestRun.id)}`);
      if (epoch !== selectionEpoch || current.project_id !== project.id) return;
      renderRun(current);
      if (["queued", "running"].includes(current.status) && current.runtime_observation?.state !== "unavailable") pollTimer = setTimeout(refresh, 500);
    }
  } catch (error) {
    if (epoch === selectionEpoch) connection(`Disconnected · retained data is stale · ${error.message}`, true);
  }
}

async function loadModalStatus() {
  try {
    const status = await api("/api/v1/providers/modal");
    node("modal-status").textContent = status.state;
    node("modal-status").className = `badge ${status.state === "error" ? "failed" : "neutral"}`;
    node("modal-message").textContent = status.message;
  } catch (error) {
    node("modal-status").textContent = "unavailable";
    node("modal-status").className = "badge failed";
    node("modal-message").textContent = `Provider status unavailable. Open the setup guide for local checks. ${error.message}`;
  }
}

node("execution-target").addEventListener("change", event => {
  selectedExecutionTarget = executionTargets(selectedProject).find(target => target.target === event.target.value) || null;
  node("billable-confirm").checked = false;
  showActionError("");
  if (!targetIsReady(selectedExecutionTarget)) {
    showActionError(`This target is unavailable. ${targetReasons(selectedExecutionTarget).join("; ") || "Complete its owner configuration, then refresh."}`);
  }
  renderExecutionTarget();
});

node("billable-confirm").addEventListener("change", updateRunAvailability);

node("run").addEventListener("click", async () => {
  if (!selectedProject) return;
  const launchingProject = selectedProject;
  const launchingTarget = selectedExecutionTarget;
  node("run").disabled = true;
  showActionError("");
  try {
    let path;
    const options = {method: "POST"};
    if (launchingProject.id === "synthetic-threshold") path = "/api/v1/example-runs";
    else {
      path = `/api/v1/projects/${encodeURIComponent(launchingProject.id)}/actions/${encodeURIComponent(launchingProject.action.id)}/runs`;
      const input = launchingProject.action.kind === "prompt"
        ? {messages: [{role: "user", content: node("prompt").value}], generation: {max_new_tokens: Number(node("max-tokens").value), temperature: 0, top_p: 1}}
        : {dataset_id: launchingProject.dataset.id, sample_id: selectedSample?.id};
      const requestIdentity = {
        target: launchingTarget.target,
        binding_sha256: launchingTarget.binding_sha256 || null,
        input,
      };
      const pending = pendingLaunch(launchingProject, requestIdentity);
      const payload = {
        protocol: "modelforge.managed-action-request/v1",
        execution: {
          target: launchingTarget.target,
          idempotency_key: pending.idempotency_key,
          binding_sha256: launchingTarget.binding_sha256 || null,
          billable_confirmed: Boolean(launchingTarget.billable || isModalTarget(launchingTarget)) && node("billable-confirm").checked,
        },
        input,
      };
      options.headers = {"Content-Type": "application/json"};
      options.body = JSON.stringify(payload);
    }
    const run = await api(path, options);
    if (launchingProject.id !== "synthetic-threshold") clearPendingLaunch(launchingProject);
    if (launchingProject.id === selectedProject?.id) {
      renderRun(run);
      if (isModalTarget(launchingTarget)) node("billable-confirm").checked = false;
    }
    await refresh();
  } catch (error) {
    if (launchingProject.id !== "synthetic-threshold" && error.status && error.status < 500) clearPendingLaunch(launchingProject);
    const retry = !error.status || error.status >= 500 ? " The launch outcome may be unknown; retrying unchanged will reuse the same launch identity." : "";
    showActionError(`The action could not be started. ${error.message}${retry}`);
    connection("Action failed", true);
  } finally {
    updateRunAvailability();
  }
});

node("cancel").addEventListener("click", async () => {
  if (!latestRun) return;
  const cancelling = latestRun;
  node("cancel").disabled = true;
  try {
    renderRun(await api(`/api/v1/runs/${encodeURIComponent(cancelling.id)}/cancel`, {method: "POST"}));
    await refresh();
  } catch (error) {
    showActionError(`Cancellation could not be requested. ${error.message}`);
  } finally {
    node("cancel").disabled = false;
  }
});

node("recover").addEventListener("click", async () => {
  if (!latestRun) return;
  const recovering = latestRun;
  node("recover").disabled = true;
  showActionError("");
  try {
    renderRun(await api(`/api/v1/runs/${encodeURIComponent(recovering.id)}/recover`, {method: "POST"}));
    connection("Connected");
    await refresh();
  } catch (error) {
    showActionError(`Provider recovery could not reattach to this run. No new call was started. ${error.message}`);
  } finally {
    node("recover").disabled = false;
  }
});

node("refresh").addEventListener("click", refresh);
window.addEventListener("beforeunload", () => {
  clearPoll();
  resetSamplePreview();
  clearResultPreviews();
});

(async () => {
  if (!token) {
    connection("Open the tokenized URL shown by the CLI", true);
    showActionError("This tab has no local session token. Return to the terminal and open the tokenized loopback URL.");
    return;
  }
  loadModalStatus();
  try {
    projects = (await api("/api/v1/projects")).projects;
    renderProjects();
    if (!projects.length) {
      node("project-name").textContent = "No projects available";
      node("project-description").textContent = "Follow the first-use setup above, then refresh.";
      connection("Connected");
      return;
    }
    let initialProject = projects[0];
    try {
      const retainedProject = sessionStorage.getItem(projectStorageKey);
      initialProject = projects.find(project => project.id === retainedProject) || initialProject;
    } catch (_error) {}
    await selectProject(initialProject);
  } catch (error) {
    connection(`Disconnected · retry · ${error.message}`, true);
    showActionError(`The project catalog could not be loaded. ${error.message}`);
  }
})();
