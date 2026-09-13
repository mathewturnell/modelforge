import AxeBuilder from "@axe-core/playwright";

import {expect, test} from "../support/workbench.js";


async function openWorkbench(page, workbench, mode = "full") {
  const errors = [];
  page.on("pageerror", error => errors.push(`pageerror: ${error.message}`));
  page.on("console", message => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  await page.goto(await workbench.start(mode), {waitUntil: "domcontentloaded"});
  await expect(page.getByRole("heading", {name: /^BDD100K Road Scene Lab/}).first()).toBeVisible();
  return errors;
}

async function selectProject(page, name) {
  await page.locator(".project-switcher").click();
  await page.getByRole("menuitem", {name: new RegExp(`^${name}`)}).click();
  await expect(page.getByRole("heading", {name: new RegExp(`^${name}`)}).first()).toBeVisible();
}

async function runTraining(page) {
  await page.getByRole("button", {name: "Training", exact: true}).click();
  await page.getByRole("button", {name: "Start training"}).click();
  await page.getByRole("button", {name: "Validate and start training"}).click();
  await expect(page.locator(".run-detail .mf-badge", {hasText: "Completed"})).toBeVisible({timeout: 15_000});
  await expect(page.getByText("0.31", {exact: true})).toBeVisible();
}

async function annotateDatasetSample(page, sampleName) {
  await page.getByRole("button", {name: "Datasets", exact: true}).click();
  await page.getByRole("button", {name: `Preview ${sampleName}`}).click();
  await page.getByRole("button", {name: "Open annotation editor"}).click();
  await page.getByRole("button", {name: "Box", exact: true}).click();
  const stage = page.locator(".annotation-stage svg");
  const bounds = await stage.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds.x + bounds.width * .18, bounds.y + bounds.height * .22);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .46, bounds.y + bounds.height * .58);
  await page.mouse.up();
  await expect(page.locator(".object-list button")).toHaveCount(1);
  await expect(page.getByText("Autosaved", {exact: true})).toBeVisible();
  await page.getByRole("button", {name: "Done", exact: true}).click();
}

async function expectNoSeriousAccessibilityViolations(page) {
  const result = await new AxeBuilder({page}).analyze();
  const blocking = result.violations.filter(item => ["serious", "critical"].includes(item.impact));
  expect(blocking, blocking.map(item => `${item.id}: ${item.help}`).join("\n")).toEqual([]);
}

test("restored workbench presents the complete established shell and real project source", async ({page, workbench}) => {
  const requests = [];
  page.on("request", request => requests.push(request.url()));
  const errors = await openWorkbench(page, workbench);

  await expect(page.getByRole("navigation", {name: "Workbench activities"})).toBeVisible();
  for (const name of ["Overview", "Source", "Datasets", "Models", "LLM Lab", "Training", "Inference", "Performance", "Deployments", "Jobs", "Knowledge Base", "Command palette", "Settings"]) {
    await expect(page.getByRole("button", {name, exact: true})).toBeVisible();
  }
  await expect(page.getByText("Cliff · local evidence assistant", {exact: true})).toBeVisible();

  await selectProject(page, "BDD100K Road Scene Lab");
  await page.getByRole("button", {name: "Source", exact: true}).click();
  await expect(page.getByText("Project source", {exact: true})).toBeVisible();
  await expect(page.getByText("project.json", {exact: true})).toBeVisible();
  await page.getByText("project.json", {exact: true}).click();
  await expect(page.locator(".monaco-editor")).toBeVisible();

  await expectNoSeriousAccessibilityViolations(page);
  expect(requests.every(url => new URL(url).hostname === "127.0.0.1")).toBeTruthy();
  expect(errors).toEqual([]);
  await expect(page).toHaveScreenshot("first-use-desktop.png", {fullPage: true, animations: "disabled", mask: [page.locator(".execution-provider"), page.locator(".execution-health"), page.locator(".bottom-panel pre")]});
});

test("compiled React journey annotates, trains, and renders checked inference evidence", async ({page, workbench}) => {
  const errors = await openWorkbench(page, workbench);
  await selectProject(page, "BDD100K Road Scene Lab");

  await page.getByRole("button", {name: "Datasets", exact: true}).click();
  await expect(page.getByText("Authored road scenes", {exact: true}).first()).toBeVisible();
  await page.getByRole("button", {name: "Preview Authored road scene"}).click();
  await page.getByRole("button", {name: "Open annotation editor"}).click();
  await page.getByRole("button", {name: "Box", exact: true}).click();
  const stage = page.locator(".annotation-stage svg");
  const bounds = await stage.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds.x + bounds.width * .2, bounds.y + bounds.height * .25);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .5, bounds.y + bounds.height * .6);
  await page.mouse.up();
  await expect(page.locator(".object-list button")).toHaveCount(1);
  await expect(page.getByText("Autosaved", {exact: true})).toBeVisible();
  await page.getByRole("button", {name: "Done", exact: true}).click();

  await runTraining(page);

  await page.getByRole("button", {name: "Datasets", exact: true}).click();
  await page.getByRole("button", {name: "Run inference on Authored road scene"}).click();
  await page.getByRole("button", {name: "Launch inference"}).click();
  await expect(page.getByText("Result ready", {exact: true})).toBeVisible({timeout: 15_000});
  await expect(page.locator('img[alt="Inference result"], video[aria-label="Inference result playback"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("remaining reference projects exercise their supported dataset, training, inference, and prompt paths", async ({page, workbench}) => {
  const errors = await openWorkbench(page, workbench);

  await selectProject(page, "TasteMatch");
  await page.getByRole("button", {name: "Datasets", exact: true}).click();
  await expect(page.getByText("Authored food images", {exact: true}).first()).toBeVisible();
  await annotateDatasetSample(page, "Authored food plate");
  await runTraining(page);
  await page.getByRole("button", {name: "Datasets", exact: true}).click();
  await page.getByRole("button", {name: "Run inference on Authored food plate"}).click();
  await page.getByRole("button", {name: "Launch inference"}).click();
  await expect(page.getByRole("cell", {name: "pizza", exact: true})).toBeVisible({timeout: 15_000});

  await selectProject(page, "SoccerNet Match Intelligence");
  await page.getByRole("button", {name: "Datasets", exact: true}).click();
  await expect(page.getByText("Authored match clips", {exact: true}).first()).toBeVisible();
  await annotateDatasetSample(page, "Authored match clip");
  await runTraining(page);
  await page.getByRole("button", {name: "Datasets", exact: true}).click();
  await page.getByRole("button", {name: "Run inference on Authored match clip"}).click();
  await page.getByRole("button", {name: "Launch inference"}).click();
  await expect(page.getByLabel("Inference result playback")).toHaveCount(1, {timeout: 15_000});

  await selectProject(page, "Qwen2.5-7B Prompt Lab");
  await page.getByRole("button", {name: "Datasets", exact: true}).click();
  await expect(page.getByText("Authored conversations", {exact: true}).first()).toBeVisible();
  await runTraining(page);
  await page.getByRole("button", {name: "LLM Lab", exact: true}).click();
  await expect(page.getByText("Curation persistence is not enabled in the public alpha")).toHaveCount(0);
  await page.locator(".llm-message-editor textarea").nth(1).fill("Why retain evidence with each run?");
  await page.getByPlaceholder("instruction-following, résumé, extraction").fill("grounded, reviewed");
  await page.getByPlaceholder("Why this example belongs in the set").fill("Qwen annotation journey");
  await page.getByRole("button", {name: "Save example"}).click();
  await expect.poll(() => page.evaluate(async () => {
    const token = sessionStorage.getItem("modelforge.public-alpha.token");
    const response = await fetch("/api/v1/projects/qwen-conformance-fixture/datasets/conformance-data/samples/conversation/annotations", {headers: {Authorization: `Bearer ${token}`}});
    return Number((await response.json()).revision || 0);
  })).toBeGreaterThan(0);
  await page.getByRole("button", {name: "Prompt console"}).click();
  await page.getByPlaceholder(/Ask the model about/).fill("Why retain evidence with each run?");
  await page.getByRole("button", {name: "Run prompt"}).click();
  await expect(page.getByText(/Synthetic Qwen conformance response/)).toBeVisible({timeout: 15_000});

  expect(errors).toEqual([]);
});

test("failure and cancellation remain explicit terminal states", async ({page, workbench}) => {
  const errors = await openWorkbench(page, workbench);
  await selectProject(page, "BDD100K Road Scene Lab");
  await page.getByRole("button", {name: "Datasets", exact: true}).click();

  await page.getByRole("button", {name: "Run inference on Failure synthetic clip"}).click();
  await page.getByRole("button", {name: "Launch inference"}).click();
  await expect(page.getByText("Failed", {exact: true})).toBeVisible({timeout: 15_000});
  await expect(page.getByText("Target selected", {exact: true})).toBeVisible();

  await page.getByRole("button", {name: "Datasets", exact: true}).click();
  await page.getByRole("button", {name: "Run inference on Cancel synthetic clip"}).click();
  await page.getByRole("button", {name: "Launch inference"}).click();
  await page.getByRole("button", {name: "Stop inference"}).click();
  await expect(page.getByText("Cancelled", {exact: true})).toBeVisible({timeout: 10_000});
  expect(errors).toEqual([]);
});

test("small viewport keeps exact navigation and evidence assistant operable", async ({page, workbench}) => {
  await page.setViewportSize({width: 390, height: 844});
  const errors = await openWorkbench(page, workbench);
  await page.getByRole("button", {name: "Open workspace navigation"}).click();
  await page.getByRole("menuitem", {name: "Datasets", exact: true}).click();
  await expect(page.getByText("Authored road scenes", {exact: true}).first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expectNoSeriousAccessibilityViolations(page);
  expect(errors).toEqual([]);
  await expect(page).toHaveScreenshot("first-use-mobile-390.png", {fullPage: true, animations: "disabled", mask: [page.locator(".bottom-panel pre")]});
});
