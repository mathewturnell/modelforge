import AxeBuilder from "@axe-core/playwright";

import {expect, test} from "../support/workbench.js";


async function openWorkbench(page, workbench, mode = "empty") {
  const errors = [];
  page.on("pageerror", error => errors.push(`pageerror: ${error.message}`));
  page.on("console", message => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  await page.goto(await workbench.start(mode), {waitUntil: "domcontentloaded"});
  await expect(page.getByText("Connected", {exact: true})).toBeVisible();
  await expect(page.getByRole("heading", {name: "Synthetic Threshold Lab"}).first()).toBeFocused();
  return errors;
}

async function expectNoSeriousAccessibilityViolations(page) {
  const result = await new AxeBuilder({page}).analyze();
  const blocking = result.violations.filter(item => ["serious", "critical"].includes(item.impact));
  expect(blocking, blocking.map(item => `${item.id}: ${item.help}`).join("\n")).toEqual([]);
}

test("first use exposes the full local product contract without fake controls", async ({page, workbench}) => {
  const requests = [];
  page.on("request", request => requests.push(request.url()));
  const errors = await openWorkbench(page, workbench);

  await expect(page.getByLabel("Project")).toHaveValue("synthetic-threshold");
  await expect(page.getByRole("navigation", {name: "Workbench destinations"})).toBeVisible();
  for (const name of [
    "Overview", "Source", "Dataset", "Annotation", "Models / Architecture",
    "Training", "Inference", "Jobs / Runs", "ModelForge Coding Assistant", "Settings",
  ]) await expect(page.getByRole("button", {name: new RegExp(`^${name}`)})).toBeVisible();

  await expect(page.getByText(/trusted local code runs with your operating-system permissions/i)).toBeVisible();
  await page.getByRole("button", {name: /^Source/}).click();
  await expect(page.getByRole("heading", {name: "Source"})).toBeVisible();
  await expect(page.getByText("No placeholder data or action is exposed", {exact: false})).toBeVisible();
  await expect(page.getByRole("button", {name: /^Billing/})).toHaveCount(0);
  await expect(page.getByRole("button", {name: /^Deployments/})).toHaveCount(0);

  await page.getByRole("button", {name: /^Settings/}).click();
  await expect(page.getByRole("heading", {name: "Settings"})).toBeVisible();
  await expect(page.getByRole("link", {name: "Open owner setup guide"})).toHaveAttribute("href", "/modal-setup.html");
  await expectNoSeriousAccessibilityViolations(page);
  expect(requests.every(url => new URL(url).hostname === "127.0.0.1")).toBeTruthy();
  expect(errors).toEqual([]);
  await expect(page).toHaveScreenshot("first-use-desktop.png", {fullPage: true, animations: "disabled"});
});

test("small viewport keeps navigation, workspace, and run inspector operable", async ({page, workbench}) => {
  await page.setViewportSize({width: 390, height: 844});
  const errors = await openWorkbench(page, workbench);
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", {name: "Skip to workspace"});
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#workspace")).toBeFocused();
  await page.getByRole("button", {name: /^Inference/}).click();
  await expect(page.getByRole("button", {name: "Run local inference"})).toBeVisible();
  await expect(page.getByRole("complementary", {name: "Current run"})).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await expectNoSeriousAccessibilityViolations(page);
  expect(errors).toEqual([]);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    scrollTo(0, 0);
  });
  await expect(page).toHaveScreenshot("first-use-mobile-390.png", {fullPage: true, animations: "disabled"});
});

test("accessibility tree exposes the intended workbench and honest unavailable states", async ({page, workbench}) => {
  await openWorkbench(page, workbench);
  await page.getByRole("button", {name: /^ModelForge Coding Assistant/}).click();
  const session = await page.context().newCDPSession(page);
  const tree = await session.send("Accessibility.getFullAXTree");
  const names = tree.nodes.map(item => item.name?.value).filter(Boolean).map(item => item.toLocaleLowerCase());
  const roles = tree.nodes.map(item => item.role?.value).filter(Boolean);
  expect(names).toContain("workbench destinations");
  expect(names).toContain("modelforge coding assistant");
  expect(names.some(item => item.includes("local coding assistant host"))).toBeTruthy();
  expect(names).toContain("current run");
  expect(roles).toContain("main");
  expect(roles).toContain("navigation");
});
