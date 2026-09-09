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
let latestRun = null;
let pollTimer = null;
let samplePreviewUrl = null;
let resultPreviewUrls = [];
let renderEpoch = 0;
let selectionEpoch = 0;
const node = id => document.getElementById(id);
const escapeHtml = value => String(value ?? "").replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"})[c]);

async function api(path, options = {}) {
  const response = await fetch(path, {...options, headers: {...headers, ...(options.headers || {})}});
  let value = {};
  try { value = await response.json(); } catch (_error) {}
  if (!response.ok) throw new Error(value.error || `Request failed with HTTP ${response.status}`);
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

function renderRun(run) {
  const epoch = ++renderEpoch;
  latestRun = run;
  clearResultPreviews();
  const status = run?.status || "No run";
  const unavailable = run?.runtime_observation?.state === "unavailable";
  const cancelling = Boolean(run?.cancellation_requested_at) && ["queued", "running"].includes(status);
  node("run-status").textContent = unavailable ? `${status} · unavailable` : cancelling ? `${status} · cancellation requested` : status;
  node("run-status").className = `badge ${status === "failed" ? "failed" : ["queued", "running"].includes(status) && !unavailable ? "running" : "neutral"}`;
  node("cancel").hidden = !run || unavailable || cancelling || !["queued", "running"].includes(status);
  node("artifacts").replaceChildren();
  if (!run) {
    node("run-detail").className = "empty";
    node("run-detail").textContent = selectedProject ? `No ${selectedProject.name} run is selected.` : "Select and start an available project action.";
    node("progress").className = "empty";
    node("progress").textContent = "Unavailable";
    node("log-tail").className = "empty";
    node("log-tail").textContent = "Unavailable";
    return;
  }
  node("run-detail").className = "";
  node("run-detail").innerHTML = `<dl>
    <div><dt>Run identity</dt><dd><code>${escapeHtml(run.id)}</code></dd></div>
    <div><dt>Project</dt><dd>${escapeHtml(run.project_id)}</dd></div>
    <div><dt>Created</dt><dd>${escapeHtml(run.created_at)}</dd></div>
    ${run.request?.checkpoint_sha256 ? `<div><dt>Checkpoint</dt><dd><code>${escapeHtml(run.request.checkpoint_sha256)}</code></dd></div>` : ""}
    ${run.request?.model_revision ? `<div><dt>Model revision</dt><dd><code>${escapeHtml(run.request.model_revision)}</code></dd></div>` : ""}
    ${run.error ? `<div><dt>Failure</dt><dd>${escapeHtml(run.error)}</dd></div>` : ""}
  </dl>`;
  node("progress").className = run.live?.progress ? "" : "empty";
  node("progress").textContent = run.live?.progress
    ? `${run.live.progress.stage || "running"} · ${run.live.progress.percent ?? "?"}%`
    : unavailable
      ? "Unavailable · retained run state is stale. Restarted local processes are not reported as successful."
      : status === "completed"
        ? "Completed; live progress is operational status, not scientific telemetry."
        : status === "cancelled"
          ? "Cancellation was confirmed by the local executor."
          : "Unavailable";
  node("log-tail").className = run.live?.log_tail ? "" : "empty";
  node("log-tail").textContent = run.live?.log_tail || (unavailable
    ? "Unavailable · no live process log is attached."
    : status === "completed"
      ? "Live process log ended. A checked process.log appears below only when this action recorded one."
      : status === "cancelled"
        ? "The local process stopped; inspect the checked process.log artifact when available."
        : "Unavailable");
  const artifacts = node("artifacts");
  for (const artifact of run.artifacts || []) {
    const link = document.createElement("a");
    link.className = "artifact";
    link.href = artifactUrl(run, artifact);
    link.textContent = `${artifact.name} · ${artifact.size_bytes} bytes`;
    link.dataset.artifactId = artifact.id;
    link.addEventListener("click", event => openArtifact(event, link, artifact));
    artifacts.append(link);
    if (artifact.content_type === "video/mp4" || artifact.kind === "assistant-text") loadArtifactPreview(run, artifact, epoch);
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
  node("run").textContent = project.id === "synthetic-threshold" ? "Run offline smoke test" : project.action.display_name;
  const ready = project.runtime_readiness === "ready";
  node("run").disabled = !ready || (Boolean(project.dataset) && project.id !== "synthetic-threshold");
  if (!ready) showActionError(`This action is not ready. ${project.readiness_reasons.join("; ") || "Complete its local runtime configuration, then refresh."}`);
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
          node("run").disabled = !ready;
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

node("run").addEventListener("click", async () => {
  if (!selectedProject) return;
  node("run").disabled = true;
  showActionError("");
  try {
    let path;
    const options = {method: "POST"};
    if (selectedProject.id === "synthetic-threshold") path = "/api/v1/example-runs";
    else {
      path = `/api/v1/projects/${encodeURIComponent(selectedProject.id)}/actions/${encodeURIComponent(selectedProject.action.id)}/runs`;
      const payload = selectedProject.action.kind === "prompt"
        ? {messages: [{role: "user", content: node("prompt").value}], generation: {max_new_tokens: Number(node("max-tokens").value), temperature: 0, top_p: 1}}
        : {dataset_id: selectedProject.dataset.id, sample_id: selectedSample?.id};
      options.headers = {"Content-Type": "application/json"};
      options.body = JSON.stringify(payload);
    }
    renderRun(await api(path, options));
    await refresh();
  } catch (error) {
    showActionError(`The action could not be started. ${error.message}`);
    connection("Action failed", true);
  } finally {
    node("run").disabled = selectedProject.runtime_readiness !== "ready" || (Boolean(selectedProject.dataset) && !selectedSample && selectedProject.id !== "synthetic-threshold");
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
