import crypto from "node:crypto";
import {readFile, writeFile} from "node:fs/promises";

import {expect, test} from "../support/workbench.js";

// Record actual browser interaction, including successful runs. These authored
// fixtures prove delivery contracts, never the historical models' quality.
test.use({video: "on", viewport: {width: 1440, height: 960}});

const fixtureCases = [
  {id: "vision", projectId: "bdd100k-docs-fixture", sample: "Success synthetic clip", artifact: "result.mp4", preview: "video"},
  {id: "prompt", projectId: "qwen-docs-fixture", prompt: "Explain how saved runs preserve experiment provenance.", artifact: "assistant.txt", preview: "text"},
  {id: "table", projectId: "tastematch-docs-fixture", sample: "Authored food plate", artifact: "base-siglip-scores.json", preview: "table"},
];

async function authenticatedGet(page, pathname) {
  const token = await page.evaluate(() => sessionStorage.getItem("modelforge.public-alpha.token"));
  const response = await page.request.get(new URL(pathname, page.url()).href, {
    headers: {Authorization: `Bearer ${token}`},
  });
  expect(response.ok(), `${pathname}: HTTP ${response.status()}`).toBe(true);
  return response;
}

async function destination(page, name) {
  await page.getByRole("navigation", {name: "Workbench destinations"})
    .getByRole("button", {name: new RegExp(`^${name}`)}).click();
}

async function exercise(page, scenario, testInfo, evidenceMode) {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await expect(page.getByText("Connected", {exact: true})).toBeVisible();
  await page.getByRole("combobox", {name: "Project", exact: true}).selectOption(scenario.projectId);
  const project = await (await authenticatedGet(page, `/api/v1/projects/${encodeURIComponent(scenario.projectId)}`)).json();
  await expect(page.locator(".project-heading")).toHaveText(project.name);

  // This harness cannot accidentally admit paid execution on a prepared host.
  const local = project.execution_targets.find(target => target.provider === "local" && !target.billable);
  expect(local, "A nonbillable local execution target is required").toBeTruthy();
  let inputSha256 = null;
  if (scenario.sample) {
    await destination(page, "Dataset");
    const sample = page.getByRole("option").filter({hasText: scenario.sample});
    await expect(sample).toHaveCount(1);
    await sample.click();
    await expect(sample).toHaveAttribute("aria-selected", "true");
    inputSha256 = await sample.locator("code").textContent();
    expect(inputSha256).toMatch(/^[a-f0-9]{64}$/);
    if (scenario.inputPreview !== false) await expect(page.locator(".preview video, .preview img")).toBeVisible();
    await page.screenshot({path: testInfo.outputPath(`${scenario.id}-dataset.png`), fullPage: true});
  }

  await destination(page, "Inference");
  await page.getByLabel("Execution target").selectOption(local.target);
  if (scenario.prompt) await page.getByRole("textbox", {name: "Prompt", exact: true}).fill(scenario.prompt);
  const before = await (await authenticatedGet(page, `/api/v1/runs?project_id=${encodeURIComponent(project.id)}`)).json();
  await page.getByRole("button", {name: project.action.display_name || "Start managed action", exact: true}).click();
  await expect(page.locator(".run-inspector .badge")).toHaveText("completed", {timeout: scenario.timeoutMs || 30_000});
  const runId = await page.locator(".run-live > code").textContent();
  expect(runId).toMatch(/^[a-f0-9]{32}$/);
  expect(before.runs.some(run => run.id === runId), "Capture must follow a new execution").toBe(false);
  const run = await (await authenticatedGet(page, `/api/v1/runs/${runId}`)).json();
  expect(run).toMatchObject({id: runId, project_id: project.id, provider: "local", status: "completed"});
  const artifact = run.artifacts.find(item => item.name === scenario.artifact);
  expect(artifact, `Expected checked artifact ${scenario.artifact}`).toBeTruthy();
  const artifactResponse = await authenticatedGet(page, `/api/v1/runs/${runId}/artifacts/${artifact.id}`);
  const bytes = await artifactResponse.body();
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  expect(sha256).toBe(artifact.sha256);
  expect(bytes.length).toBeGreaterThan(0);
  const savedArtifact = testInfo.outputPath(`${scenario.id}-${artifact.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`);
  await writeFile(savedArtifact, bytes);
  await testInfo.attach(scenario.artifact, {path: savedArtifact, contentType: artifact.content_type || "application/octet-stream"});
  await page.getByRole("complementary", {name: "Current run"}).getByRole("button", {name: new RegExp(`^${scenario.artifact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`)}).first().click();
  let durationSeconds = null;
  if (scenario.preview === "video") {
    const video = page.getByLabel(`${scenario.artifact} result preview`);
    await expect(video).toBeVisible();
    await expect.poll(() => video.evaluate(element => element.readyState)).toBeGreaterThanOrEqual(2);
    durationSeconds = await video.evaluate(element => element.duration);
    expect(durationSeconds).toBeGreaterThanOrEqual(scenario.minimumVideoSeconds || 0.1);
    await video.evaluate(async element => { element.muted = true; await element.play(); });
    await expect.poll(() => video.evaluate(element => element.currentTime)).toBeGreaterThan(0);
  } else if (scenario.preview === "text") {
    await expect(page.getByLabel("Checked assistant response")).not.toBeEmpty();
  } else if (scenario.preview === "table") {
    await expect(page.locator(".result-table-scroll table")).toBeVisible();
    expect(await page.locator(".result-table-scroll tbody tr").count()).toBeGreaterThan(0);
  }
  await expect(page.getByRole("region", {name: "Run log"})).not.toContainText("No live log attached.");
  await page.screenshot({path: testInfo.outputPath(`${scenario.id}-result.png`), fullPage: true});
  await page.reload({waitUntil: "domcontentloaded"});
  await expect(page.locator(".run-live > code")).toHaveText(runId);
  await expect(page.locator(".run-inspector .badge")).toHaveText("completed");
  expect(errors).toEqual([]);
  const evidencePath = testInfo.outputPath(`${scenario.id}-evidence.json`);
  await writeFile(evidencePath, JSON.stringify({
      protocol: "modelforge.showcase-regression-evidence/v1", evidenceMode,
      projectId: project.id, runId, inputSha256,
      artifact: {id: artifact.id, name: artifact.name, sha256, bytes: bytes.length, durationSeconds},
      limitations: evidenceMode === "synthetic-contract-fixture"
        ? ["No historical dataset or model was loaded; this is not model-quality or full showcase-parity evidence."] : [],
    }, null, 2));
  await testInfo.attach(`${scenario.id}-evidence.json`, {path: evidencePath, contentType: "application/json"});
}

for (const scenario of fixtureCases) {
  test(`showcase ${scenario.id}: current UI preserves checked local result evidence`, async ({page, workbench}, testInfo) => {
    await page.goto(await workbench.start("documentation"), {waitUntil: "domcontentloaded"});
    await exercise(page, scenario, testInfo, "synthetic-contract-fixture");
  });
}

test("absent run telemetry remains unavailable rather than invented", async ({page, workbench}) => {
  await page.goto(await workbench.start("full"), {waitUntil: "domcontentloaded"});
  await expect(page.getByText("Connected", {exact: true})).toBeVisible();
  await page.getByRole("combobox", {name: "Project", exact: true}).selectOption("prompt-fixture");
  await expect(page.locator(".run-inspector .badge")).toHaveText("No run selected");
  await expect(page.getByRole("region", {name: "Run log"})).toContainText("No live log attached.");
  await expect(page.locator(".run-live")).not.toContainText(/100%|completed|succeeded/i);
});

// Optional prepared local examples use the same assertions. The JSON file holds
// {cases:[{id,projectId,sample?,inputPreview?,prompt?,artifact,preview,minimumVideoSeconds?}]}.
// Pass the fragment-token URL only through MODELFORGE_SHOWCASE_URL, not the file.
test("prepared examples: current UI produces fresh checked inference artifacts", async ({page}, testInfo) => {
  test.skip(!process.env.MODELFORGE_SHOWCASE_CASES, "Requires prepared real local projects and an explicit cases file");
  test.setTimeout(30 * 60_000);
  const url = new URL(process.env.MODELFORGE_SHOWCASE_URL || "");
  expect(["127.0.0.1", "localhost", "[::1]"]).toContain(url.hostname);
  const {cases} = JSON.parse(await readFile(process.env.MODELFORGE_SHOWCASE_CASES, "utf8"));
  expect(Array.isArray(cases) && cases.length > 0).toBe(true);
  await page.goto(url.href, {waitUntil: "domcontentloaded"});
  for (const scenario of cases) await exercise(page, scenario, testInfo, "prepared-local-project");
});
