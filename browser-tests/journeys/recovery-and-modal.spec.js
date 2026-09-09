import {expect, test} from "../support/workbench.js";


test("the real default Modal status endpoint is non-live and actionable", async ({page, workbench}) => {
  await page.goto(await workbench.start("empty"), {waitUntil: "domcontentloaded"});
  await expect(page.locator("#modal-status")).toContainText(/unconfigured|configured|error/);
  await expect(page.locator("#modal-message")).not.toBeEmpty();
  const response = await page.evaluate(async () => {
    const token = sessionStorage.getItem("modelforge.alpha.session-token");
    const result = await fetch("/api/v1/providers/modal", {headers: {Authorization: `Bearer ${token}`}});
    return {status: result.status, value: await result.json()};
  });
  expect(response.status).toBe(200);
  expect(response.value).toMatchObject({
    provider: "modal",
    installed: expect.any(Boolean),
    message: expect.any(String),
    live_verified: false,
  });
  expect(["unconfigured", "configured", "error"]).toContain(response.value.state);
  expect(response.value.profile === null || typeof response.value.profile === "string").toBeTruthy();
  expect(response.value.environment === null || typeof response.value.environment === "string").toBeTruthy();
});

test("essential request failures and broken routes remain visible and bounded", async ({page, workbench}) => {
  const url = await workbench.start("empty");
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.route("**/api/v1/projects", route => route.abort("failed"));
  await page.goto(url, {waitUntil: "domcontentloaded"});
  await expect(page.locator("#connection")).toContainText("Disconnected · retry");
  await expect(page.getByRole("alert")).toContainText("project catalog could not be loaded");
  expect(pageErrors).toEqual([]);

  await page.unroute("**/api/v1/projects");
  const response = await page.request.get(new URL("/missing-route", url).href, {
    headers: {Authorization: "Bearer public-browser-fixture-token"},
  });
  expect(response.status()).toBe(404);
  await expect(response.json()).resolves.toEqual({error: "Not found"});
});

for (const state of ["unconfigured", "configured", "error"]) {
  test(`Modal setup presents the ${state} provider state without a provider call`, async ({page, workbench}) => {
    const url = await workbench.start("empty");
    await page.route("**/api/v1/providers/modal", route => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        provider: "modal",
        state,
        installed: state !== "unconfigured",
        profile: state === "configured" ? "default" : null,
        environment: state === "configured" ? "main" : null,
        message: state === "error" ? "Local Modal authentication needs attention." : `Modal is ${state}.`,
        live_verified: false,
      }),
    }));
    await page.goto(url, {waitUntil: "domcontentloaded"});
    await expect(page.locator("#modal-status")).toHaveText(state);
    await expect(page.locator("#modal-message")).toContainText(state === "error" ? "needs attention" : state);
    await expect(page.getByRole("link", {name: "Modal setup guide"})).toBeVisible();
  });
}

test("checked preview fetch failures do not expose empty media as a successful result", async ({page, workbench}) => {
  await page.goto(await workbench.start("full"), {waitUntil: "domcontentloaded"});
  await page.getByRole("button", {name: /Synthetic Vision Lab/}).click();
  await page.getByRole("button", {name: /Success synthetic clip/}).click();
  await page.route("**/api/v1/runs/*/artifacts/*", route => route.fulfill({status: 404, contentType: "application/json", body: '{"error":"changed"}'}));
  await page.getByRole("button", {name: "Run synthetic vision fixture", exact: true}).click();
  await expect(page.locator("#run-status")).toHaveText("completed");
  await expect(page.getByRole("alert")).toContainText("Checked preview unavailable");
  await expect(page.getByLabel(/result preview/)).toHaveCount(0);
});
