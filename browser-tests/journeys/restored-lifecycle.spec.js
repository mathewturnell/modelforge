import AxeBuilder from "@axe-core/playwright";
import {expect, test} from "../support/workbench.js";

async function destination(page, name) {
  await page.getByRole("navigation", {name: "Workbench destinations"})
    .getByRole("button", {name: new RegExp(`^${name}`)}).click();
}
async function selectProject(page, id) {
  await expect(page.getByText("Connected", {exact: true})).toBeVisible();
  await page.getByRole("combobox", {name: "Project", exact: true}).selectOption(id);
}
async function selectSample(page, name) {
  await destination(page, "Dataset");
  const sample = page.getByRole("option").filter({hasText: name});
  await sample.click();
  await expect(sample).toHaveAttribute("aria-selected", "true");
}
async function apiJson(page, route) {
  return page.evaluate(async path => {
    const response = await fetch(path, {headers: {Authorization: `Bearer ${sessionStorage.getItem("modelforge.public-alpha.token")}`}});
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }, route);
}

test("annotation drawing and label edits persist across reload and service restart", async ({page, workbench}, testInfo) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(await workbench.start("full"));
  await selectProject(page, "vision-fixture");
  await selectSample(page, "Success synthetic clip");
  await destination(page, "Annotation");
  await expect(page.getByRole("button", {name: "Draw rectangle"})).toBeEnabled();
  await page.getByRole("button", {name: "Draw rectangle"}).click();
  const stage = page.getByLabel("Annotation rectangles");
  const bounds = await stage.boundingBox();
  expect(bounds.width).toBeGreaterThan(0);
  await page.mouse.move(bounds.x + bounds.width * 0.2, bounds.y + bounds.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + bounds.height * 0.7);
  await page.mouse.up();
  await page.getByRole("textbox", {name: "Object label"}).fill("reviewed vehicle");
  await page.getByRole("textbox", {name: "Track identity"}).fill("vehicle-7");
  await page.getByRole("button", {name: "Save annotations"}).click();
  await expect(page.getByRole("status")).toContainText("Saved revision 1");
  const endpoint = "/api/v1/projects/vision-fixture/datasets/clips/samples/success/annotations";
  const saved = await apiJson(page, endpoint);
  expect(saved.annotations).toHaveLength(1);
  expect(saved.annotations[0]).toMatchObject({label: "reviewed vehicle", track_id: "vehicle-7", frame: 1});
  expect(saved.sample_sha256).toMatch(/^[a-f0-9]{64}$/);
  await page.screenshot({path: testInfo.outputPath("annotation-saved.png")});

  await page.reload();
  await selectSample(page, "Success synthetic clip");
  await destination(page, "Annotation");
  await page.getByRole("button", {name: "reviewed vehicle · vehicle-7"}).click();
  await expect(page.getByRole("textbox", {name: "Object label"})).toHaveValue("reviewed vehicle");
  await page.getByRole("textbox", {name: "Object label"}).fill("verified vehicle");
  await page.getByRole("button", {name: "Save annotations"}).click();
  await expect(page.getByRole("status")).toContainText("Saved revision 2");
  await page.goto(await workbench.restart());
  await selectProject(page, "vision-fixture");
  await selectSample(page, "Success synthetic clip");
  await destination(page, "Annotation");
  await expect(page.getByRole("button", {name: "verified vehicle · vehicle-7"})).toBeVisible();
  const recovered = await apiJson(page, endpoint);
  expect(recovered.revision).toBe(2);
  expect(recovered.sample_sha256).toBe(saved.sample_sha256);
  expect(recovered.annotations[0]).toMatchObject({...saved.annotations[0], label: "verified vehicle"});
  expect(errors).toEqual([]);
});

test("annotation rectangles can be created, sized, and saved with the keyboard", async ({page, workbench}) => {
  await page.goto(await workbench.start("full"));
  await selectProject(page, "vision-fixture");
  await selectSample(page, "Success synthetic clip");
  await destination(page, "Annotation");
  await expect(page.getByRole("button", {name: "Add rectangle", exact: true})).toBeEnabled();
  await page.getByRole("button", {name: "Add rectangle", exact: true}).focus();
  await page.keyboard.press("Enter");
  const label = page.getByRole("textbox", {name: "Object label"});
  await label.focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("keyboard vehicle");
  for (const [name, value] of Object.entries({x: "0.25", y: "0.15", width: "0.4", height: "0.3"})) {
    await page.getByRole("spinbutton", {name: `Rectangle ${name}`, exact: true}).focus();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type(value);
    await page.keyboard.press("Tab");
  }
  await page.getByRole("button", {name: "Save annotations", exact: true}).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Saved revision 1");
  await page.reload();
  await selectSample(page, "Success synthetic clip");
  await destination(page, "Annotation");
  await page.getByRole("button", {name: "keyboard vehicle · track-1", exact: true}).focus();
  await page.keyboard.press("Enter");
  for (const [name, value] of Object.entries({x: "0.25", y: "0.15", width: "0.4", height: "0.3"})) {
    await expect(page.getByRole("spinbutton", {name: `Rectangle ${name}`, exact: true})).toHaveValue(value);
  }
  const saved = await apiJson(page, "/api/v1/projects/vision-fixture/datasets/clips/samples/success/annotations");
  expect(saved.annotations).toHaveLength(1);
  expect(saved.annotations[0]).toMatchObject({label: "keyboard vehicle", x: 0.25, y: 0.15, width: 0.4, height: 0.3});
});

test("protected test media stays read-only in the annotation editor", async ({page, workbench}) => {
  await page.goto(await workbench.start("full"));
  await selectProject(page, "vision-fixture");
  await selectSample(page, "Protected test clip");
  await destination(page, "Annotation");
  await expect(page.getByText("This split is read-only.", {exact: false})).toBeVisible();
  await expect(page.getByRole("button", {name: "Draw rectangle"})).toBeDisabled();
  await expect(page.getByRole("button", {name: "Add rectangle"})).toBeDisabled();
  await expect(page.getByRole("button", {name: "Save annotations"})).toBeDisabled();
  await expect(page.locator(".annotation-stage rect")).toHaveCount(0);
});

test("validated model structure is inspectable by keyboard and keeps checkpoint identity", async ({page, workbench}) => {
  await page.goto(await workbench.start("full"));
  await selectProject(page, "vision-fixture");
  await destination(page, "Models / Architecture");
  await expect(page.getByRole("group", {name: "Authored fixture architecture architecture graph"})).toBeVisible();
  const encoder = page.getByRole("button", {name: "Image encoder", exact: true});
  await encoder.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", {name: "Image encoder", exact: true})).toBeVisible();
  await expect(page.getByText("encoder · 42 parameters", {exact: true})).toBeVisible();
  const graph = await apiJson(page, "/api/v1/projects/vision-fixture/model");
  await expect(page.getByText(graph.checkpoint.sha256, {exact: true})).toBeVisible();
  await expect(page.getByText(graph.descriptor_sha256, {exact: true})).toBeVisible();
  const accessibility = await new AxeBuilder({page}).analyze();
  expect(accessibility.violations.filter(item => ["serious", "critical"].includes(item.impact))).toEqual([]);
});

test("training launches from declared splits and displays exact persisted scalar values", async ({page, workbench}, testInfo) => {
  await page.goto(await workbench.start("full"));
  await selectProject(page, "training-fixture");
  await selectSample(page, "Authored train target");
  await destination(page, "Training");
  await expect(page.getByRole("button", {name: "Train authored scalar", exact: true})).toBeDisabled();
  const validation = page.getByRole("combobox", {name: "Validation sample", exact: true});
  await expect(validation.locator("option")).toHaveCount(2);
  await validation.selectOption("validation");
  await expect(page.getByText("No scientific telemetry is available for these runs.")).toBeVisible();
  await page.getByRole("button", {name: "Train authored scalar", exact: true}).click();
  await expect(page.locator(".run-inspector .badge")).toHaveText("completed", {timeout: 30_000});
  const runId = await page.locator(".run-live > code").textContent();
  const metric = page.getByRole("combobox", {name: "Comparison metric", exact: true});
  await metric.selectOption("train/loss");
  const table = page.getByRole("table", {name: "Exact recorded values · train/loss"});
  await expect(table.locator("tbody tr")).toHaveCount(3);
  const values = await table.locator("tbody tr td:last-child").allTextContents();
  expect(values).toEqual(["4", "2.5600000000000005", "1.6383999999999994"]);
  const choice = page.locator(".comparison-choices input").first();
  await expect(choice).toBeChecked();
  await choice.uncheck();
  await expect(table.locator("tbody tr")).toHaveCount(0);
  await expect(page.getByText("Select a run containing this metric to compare recorded values.")).toBeVisible();
  await choice.check();
  await expect(table.locator("tbody tr")).toHaveCount(3);
  await expect(page.getByRole("region", {name: "Run log"})).toContainText("Optimizer step 2");
  await expect(page.getByRole("button", {name: /^candidate.json/}).first()).toBeVisible();
  await metric.selectOption("validation/loss");
  await expect(page.getByRole("table", {name: "Exact recorded values · validation/loss"}).locator("tbody tr")).toHaveCount(3);
  await page.screenshot({path: testInfo.outputPath("recorded-training-scalars.png")});
  await page.goto(await workbench.restart());
  await selectProject(page, "training-fixture");
  await destination(page, "Jobs / Runs");
  await page.getByRole("button").filter({hasText: runId}).click();
  await page.getByRole("combobox", {name: "Comparison metric", exact: true}).selectOption("train/loss");
  await expect(page.getByRole("table", {name: "Exact recorded values · train/loss"}).locator("tbody tr td:last-child")).toHaveText(values);
});
