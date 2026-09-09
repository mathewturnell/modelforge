import AxeBuilder from "@axe-core/playwright";

import {expect, test} from "../support/workbench.js";


async function openWorkbench(page, workbench, mode = "full") {
  const errors = [];
  page.on("pageerror", error => errors.push(`pageerror: ${error.message}`));
  page.on("console", message => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  await page.goto(await workbench.start(mode), {waitUntil: "domcontentloaded"});
  await expect(page.getByRole("status", {name: ""}).filter({hasText: "Connected"}).first()).toBeVisible();
  return errors;
}

async function expectNoSeriousAccessibilityViolations(page) {
  const result = await new AxeBuilder({page}).analyze();
  const blocking = result.violations.filter(item => ["serious", "critical"].includes(item.impact));
  expect(blocking, blocking.map(item => `${item.id}: ${item.help}`).join("\n")).toEqual([]);
}

async function mockUnconfiguredModalBoundary(page) {
  await page.route("**/api/v1/providers/modal", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      provider: "modal",
      state: "unconfigured",
      installed: false,
      profile: null,
      environment: null,
      message: "Modal is not configured; no provider call was made.",
      live_verified: false,
    }),
  }));
}

test("first use explains local project and Modal setup without private state", async ({page, workbench}) => {
  const requests = [];
  page.on("request", request => requests.push(request.url()));
  await mockUnconfiguredModalBoundary(page);
  const errors = await openWorkbench(page, workbench, "empty");
  await expect(page.getByRole("heading", {name: "First-use setup"})).toBeVisible();
  await expect(page.getByRole("list", {name: "Example setup steps"})).toContainText("examples setup plan");
  await expect(page.getByRole("list", {name: "Example setup steps"})).toContainText("It performs no fetch or install");
  await expect(page.getByRole("list", {name: "Example setup steps"})).toContainText("examples setup fetch");
  await expect(page.getByRole("list", {name: "Example setup steps"})).toContainText("examples setup install");
  const qualification = page.getByRole("region", {name: "Real example qualification"});
  await expect(qualification).toContainText("BDD100K Road Scene Lab");
  await expect(qualification).toContainText("Inference · supported with prerequisites");
  await expect(qualification).toContainText("Qwen2.5-7B Prompt Lab");
  await expect(qualification).toContainText("Prompt · supported with prerequisites");
  await expect(qualification).toContainText("SoccerNet Tracking");
  await expect(qualification).toContainText("selected sequence");
  await expect(qualification).toContainText("TasteMatch");
  await expect(qualification).toContainText("base-SigLIP Modal inference is bounded");
  await expect(page.getByText(/local project actions are trusted code/i)).toBeVisible();
  await expect(page.getByRole("button", {name: /Synthetic Threshold Lab/})).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("No recorded Synthetic Threshold Lab runs in this state root.")).toBeVisible();
  await expect(page.getByRole("link", {name: "Modal setup guide"})).toHaveAttribute("href", "/modal-setup.html");
  await expect(page.locator("#modal-status")).toContainText(/unconfigured|configured|error/);
  await expectNoSeriousAccessibilityViolations(page);
  expect(requests.every(url => new URL(url).hostname === "127.0.0.1")).toBeTruthy();
  expect(errors).toEqual([]);
  await expect(page).toHaveScreenshot("first-use-desktop.png", {fullPage: true, animations: "disabled"});
});

test("small viewport keeps setup and primary actions operable by keyboard", async ({page, workbench}) => {
  await page.setViewportSize({width: 390, height: 844});
  await mockUnconfiguredModalBoundary(page);
  const errors = await openWorkbench(page, workbench, "empty");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", {name: "Skip to workbench"});
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#workspace")).toBeFocused();
  await page.getByRole("button", {name: /Synthetic Threshold Lab/}).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", {name: "Synthetic Threshold Lab"})).toBeFocused();
  await expect(page.getByRole("button", {name: "Run offline smoke test"})).toBeVisible();
  await expect(page.getByRole("list", {name: "Example setup steps"})).toContainText("performs no fetch or install");
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

test("browser accessibility tree exposes setup order, qualifications, and workbench controls", async ({page, workbench}) => {
  await mockUnconfiguredModalBoundary(page);
  await openWorkbench(page, workbench, "empty");
  const session = await page.context().newCDPSession(page);
  const tree = await session.send("Accessibility.getFullAXTree");
  const names = tree.nodes.map(item => item.name?.value).filter(Boolean);
  const normalizedNames = names.map(item => item.toLocaleLowerCase());
  const roles = tree.nodes.map(item => item.role?.value).filter(Boolean);
  expect(normalizedNames).toContain("example setup steps");
  expect(normalizedNames).toContain("real example qualification");
  expect(normalizedNames).toContain("projects");
  expect(normalizedNames).toContain("run evidence");
  expect(normalizedNames).toContain("run offline smoke test");
  expect(roles).toContain("main");
  expect(roles).toContain("navigation");
  expect(roles).toContain("list");
});
