import AxeBuilder from "@axe-core/playwright";

import {expect, test} from "../support/workbench.js";


async function open(page, workbench) {
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(await workbench.start("full"), {waitUntil: "domcontentloaded"});
  await expect(page.getByText("Connected", {exact: true})).toBeVisible();
  return pageErrors;
}

async function chooseProject(page, name) {
  await page.getByLabel("Project").selectOption({label: name});
  await expect(page.locator(".project-heading")).toHaveText(name);
  await expect(page.locator(".project-heading")).toBeFocused();
}

async function openDestination(page, name) {
  await page.getByRole("button", {name: new RegExp(`^${name}`)}).click();
}

async function chooseSample(page, name) {
  await openDestination(page, "Dataset");
  const sample = page.getByRole("option", {name: new RegExp(name, "i")});
  await sample.click();
  await expect(sample).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".preview video")).toBeVisible();
}

async function expectTerminal(page, status) {
  await expect(page.locator(".run-inspector .badge")).toHaveText(status, {timeout: 30_000});
}

test("vision execution exposes live evidence, checked media, reload, and restart recovery", async ({page, workbench}) => {
  test.setTimeout(120_000);
  const pageErrors = await open(page, workbench);
  await chooseProject(page, "Synthetic Vision Lab");
  await chooseSample(page, "Success synthetic clip");
  await openDestination(page, "Inference");
  await page.getByRole("button", {name: "Run synthetic vision fixture", exact: true}).click();
  await expectTerminal(page, "completed");
  await expect(page.getByRole("region", {name: "Run log"})).toContainText("Synthetic vision fixture started");
  const artifact = page.getByRole("button", {name: /result\.mp4/}).first();
  await expect(artifact).toBeVisible();
  await artifact.click();
  await expect(page.getByLabel("result.mp4 result preview")).toBeVisible();
  const runIdentity = await page.locator(".run-live > code").textContent();
  expect(runIdentity).toMatch(/^[a-f0-9]{32}$/);

  await page.reload({waitUntil: "domcontentloaded"});
  await expect(page.locator(".run-live > code")).toHaveText(runIdentity);
  await expectTerminal(page, "completed");

  const restartedUrl = await workbench.restart();
  await page.goto(restartedUrl, {waitUntil: "domcontentloaded"});
  await chooseProject(page, "Synthetic Vision Lab");
  await expect(page.locator(".run-live > code")).toHaveText(runIdentity);
  await expectTerminal(page, "completed");

  await chooseProject(page, "Synthetic Prompt Lab");
  await expect(page.locator(".run-inspector .badge")).toHaveText("No run selected");
  await expect(page.getByRole("complementary", {name: "Current run"})).toContainText("Start or select a project run.");
  expect(pageErrors).toEqual([]);
});

test("prompt action renders checked text without inventing training support", async ({page, workbench}) => {
  const pageErrors = await open(page, workbench);
  await chooseProject(page, "Synthetic Prompt Lab");
  await openDestination(page, "Training");
  await expect(page.getByText(/local training and held-out evaluation services are not delivered/i)).toBeVisible();
  await expect(page.getByRole("button", {name: /start training/i})).toHaveCount(0);

  await openDestination(page, "Inference");
  await page.getByRole("textbox", {name: "Prompt"}).fill("Why are durable local runs useful?");
  await page.getByRole("button", {name: "Run synthetic prompt fixture", exact: true}).click();
  await expectTerminal(page, "completed");
  const artifact = page.getByRole("complementary", {name: "Current run"}).getByRole("button", {name: /^assistant\.txt/});
  await artifact.click();
  await expect(page.getByLabel("Checked assistant response")).toContainText("Why are durable local runs useful?");
  const accessibility = await new AxeBuilder({page}).analyze();
  expect(accessibility.violations.filter(item => item.impact === "critical")).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("failed and invalid outputs terminate truthfully with only safe evidence", async ({page, workbench}) => {
  await open(page, workbench);
  await chooseProject(page, "Synthetic Vision Lab");

  await chooseSample(page, "Failure synthetic clip");
  await openDestination(page, "Inference");
  await page.getByRole("button", {name: "Run synthetic vision fixture", exact: true}).click();
  await expectTerminal(page, "failed");
  await expect(page.getByRole("complementary", {name: "Current run"})).toContainText("exited with code 7");
  await expect(page.getByRole("button", {name: /process\.log/}).first()).toBeVisible();
  await expect(page.getByRole("button", {name: /result\.mp4/})).toHaveCount(0);

  await chooseSample(page, "Invalid synthetic clip");
  await openDestination(page, "Inference");
  await page.getByRole("button", {name: "Run synthetic vision fixture", exact: true}).click();
  await expectTerminal(page, "failed");
  await expect(page.getByRole("complementary", {name: "Current run"})).toContainText(/digest|SHA-256|differs/i);
  await expect(page.getByRole("button", {name: /result\.mp4/})).toHaveCount(0);
});

test("cancellation is requested through the shared lifecycle and reaches cancelled", async ({page, workbench}) => {
  test.setTimeout(120_000);
  await open(page, workbench);
  await chooseProject(page, "Synthetic Vision Lab");
  await chooseSample(page, "Cancel synthetic clip");
  await openDestination(page, "Inference");
  await page.getByRole("button", {name: "Run synthetic vision fixture", exact: true}).click();
  await expect(page.locator(".run-inspector .badge")).toContainText(/running|queued/);
  await expect(page.getByRole("region", {name: "Run log"})).toContainText("fixture_heartbeat");
  await page.getByRole("button", {name: "Request cancellation"}).click();
  await expectTerminal(page, "cancelled");
  await expect(page.getByRole("button", {name: /process\.log/}).first()).toBeVisible();
  await expect(page.getByRole("button", {name: /result\.mp4/})).toHaveCount(0);
});
