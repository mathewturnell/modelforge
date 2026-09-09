import AxeBuilder from "@axe-core/playwright";

import {expect, test} from "../support/workbench.js";


async function open(page, workbench) {
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(await workbench.start("full"), {waitUntil: "domcontentloaded"});
  await expect(page.locator("#connection")).toHaveText("Connected");
  return pageErrors;
}

async function chooseProject(page, name) {
  await page.getByRole("button", {name: new RegExp(name)}).click();
  await expect(page.getByRole("heading", {name})).toBeFocused();
}

async function chooseSample(page, name) {
  const sample = page.getByRole("button", {name: new RegExp(name, "i")});
  await sample.click();
  await expect(sample).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Selected dataset sample preview")).toBeVisible();
}

test("vision execution exposes live evidence, checked media, reload, and app-restart recovery", async ({page, workbench}) => {
  test.setTimeout(120_000);
  const pageErrors = await open(page, workbench);
  await chooseProject(page, "Synthetic Vision Lab");
  await expect(page.getByText("action.inference", {exact: false})).toBeVisible();
  await chooseSample(page, "Success synthetic clip");
  await page.getByRole("button", {name: "Run synthetic vision fixture", exact: true}).click();
  await expect(page.locator("#run-status")).toHaveText("completed");
  await expect(page.getByLabel("Live process log")).toContainText("Synthetic vision fixture started");
  await expect(page.getByRole("link", {name: /result\.mp4/})).toBeVisible();
  await expect(page.getByLabel("result.mp4 result preview")).toBeVisible();
  await expect(page.locator("#telemetry")).toHaveText("Unavailable for this action.");
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("link", {name: /result\.mp4/}).click();
  const popup = await popupPromise;
  await expect.poll(() => popup.url()).toMatch(/^blob:/);
  await popup.close();
  const runIdentity = await page.locator("#run-detail code").first().textContent();
  expect(runIdentity).toMatch(/^[a-f0-9]{32}$/);

  await page.reload({waitUntil: "domcontentloaded"});
  await expect(page.locator("#run-detail code").first()).toHaveText(runIdentity);
  await expect(page.locator("#run-status")).toHaveText("completed");

  const restartedUrl = await workbench.restart();
  await page.goto(restartedUrl, {waitUntil: "domcontentloaded"});
  await chooseProject(page, "Synthetic Vision Lab");
  await expect(page.locator("#run-detail code").first()).toHaveText(runIdentity);
  await expect(page.getByLabel("result.mp4 result preview")).toBeVisible();

  await chooseProject(page, "Synthetic Prompt Lab");
  await expect(page.locator("#run-status")).toHaveText("No run");
  await expect(page.locator("#run-detail")).toContainText("No Synthetic Prompt Lab run is selected");
  expect(pageErrors).toEqual([]);
});

test("prompt action renders a checked text result without inventing training", async ({page, workbench}) => {
  const pageErrors = await open(page, workbench);
  await chooseProject(page, "Synthetic Prompt Lab");
  await expect(page.getByText("action.prompt", {exact: false})).toBeVisible();
  await expect(page.getByText("action.training", {exact: false})).toHaveCount(0);
  await page.getByLabel("Prompt").fill("Why are durable local runs useful?");
  await page.getByRole("button", {name: "Run synthetic prompt fixture", exact: true}).click();
  await expect(page.locator("#run-status")).toHaveText("completed");
  await expect(page.getByLabel("Checked assistant response")).toContainText("Why are durable local runs useful?");
  await expect(page.getByText("fixture-revision", {exact: true})).toBeVisible();
  const accessibility = await new AxeBuilder({page}).analyze();
  expect(accessibility.violations.filter(item => item.impact === "critical")).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test("failed and invalid outputs terminate truthfully with only safe failure evidence", async ({page, workbench}) => {
  await open(page, workbench);
  await chooseProject(page, "Synthetic Vision Lab");

  await chooseSample(page, "Failure synthetic clip");
  await page.getByRole("button", {name: "Run synthetic vision fixture", exact: true}).click();
  await expect(page.locator("#run-status")).toHaveText("failed");
  await expect(page.locator("#run-detail")).toContainText("exited with code 7");
  await expect(page.getByRole("link", {name: /process\.log/})).toBeVisible();
  await expect(page.getByRole("link", {name: /result\.mp4/})).toHaveCount(0);

  await chooseSample(page, "Invalid synthetic clip");
  await page.getByRole("button", {name: "Run synthetic vision fixture", exact: true}).click();
  await expect(page.locator("#run-status")).toHaveText("failed");
  await expect(page.locator("#run-detail")).toContainText(/digest|SHA-256|differs/i);
  await expect(page.getByRole("link", {name: /process\.log/})).toBeVisible();
  await expect(page.getByRole("link", {name: /result\.mp4/})).toHaveCount(0);
});

test("cancellation is requested through the shared lifecycle and reaches cancelled", async ({page, workbench}) => {
  test.setTimeout(120_000);
  await open(page, workbench);
  await chooseProject(page, "Synthetic Vision Lab");
  await chooseSample(page, "Cancel synthetic clip");
  await page.getByRole("button", {name: "Run synthetic vision fixture", exact: true}).click();
  await expect(page.locator("#run-status")).toContainText("running");
  await expect(page.getByLabel("Live process log")).toContainText("fixture_heartbeat");
  await page.getByRole("button", {name: "Request cancellation"}).click();
  await expect(page.locator("#run-status")).toHaveText("cancelled");
  await expect(page.locator("#progress")).toContainText("Cancellation was confirmed");
  await expect(page.getByRole("link", {name: /process\.log/})).toBeVisible();
  await expect(page.getByRole("link", {name: /result\.mp4/})).toHaveCount(0);
});
