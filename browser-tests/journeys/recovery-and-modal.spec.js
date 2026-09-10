import {expect, test} from "../support/workbench.js";


async function openSettings(page) {
  await expect(page.getByText("Connected", {exact: true})).toBeVisible();
  await page.getByRole("button", {name: /^Settings/}).click();
  await expect(page.getByRole("heading", {name: "Settings"})).toBeVisible();
}

test("the real default Modal status endpoint is non-live and actionable", async ({page, workbench}) => {
  await page.goto(await workbench.start("empty"), {waitUntil: "domcontentloaded"});
  await openSettings(page);
  await expect(page.getByText(/Modal SDK|Modal is optional|readiness could not/i)).toBeVisible();
  await expect(page.getByRole("link", {name: "Open owner setup guide"})).toBeVisible();
  const response = await page.evaluate(async () => {
    const token = sessionStorage.getItem("modelforge.public-alpha.token");
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
});

test("essential request failures and unknown routes remain visible and bounded", async ({page, workbench}) => {
  const url = await workbench.start("empty");
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.route("**/api/v1/projects", route => route.abort("failed"));
  await page.goto(url, {waitUntil: "domcontentloaded"});
  await expect(page.getByText("Disconnected", {exact: true})).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(/failed to fetch/i);
  expect(pageErrors).toEqual([]);

  await page.unroute("**/api/v1/projects");
  const response = await page.request.get(new URL("/missing-route", url).href, {
    headers: {Authorization: "Bearer public-browser-fixture-token"},
  });
  expect(response.status()).toBe(404);
  await expect(response.json()).resolves.toEqual({error: "Not found"});
});

for (const state of ["unconfigured", "configured", "error"]) {
  test(`Settings presents the ${state} Modal state without a provider call`, async ({page, workbench}) => {
    const url = await workbench.start("empty");
    const message = state === "error" ? "Local Modal authentication needs attention." : `Modal is ${state}.`;
    await page.route("**/api/v1/providers/modal", route => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        provider: "modal",
        state,
        installed: state !== "unconfigured",
        profile: state === "configured" ? "default" : null,
        environment: state === "configured" ? "main" : null,
        message,
        live_verified: false,
      }),
    }));
    await page.goto(url, {waitUntil: "domcontentloaded"});
    await openSettings(page);
    await expect(page.locator(".workspace .badge")).toHaveText(state);
    await expect(page.getByText(message, {exact: true})).toBeVisible();
    await expect(page.getByRole("link", {name: "Open owner setup guide"})).toBeVisible();
  });
}

test("checked preview failures never expose empty media as success", async ({page, workbench}) => {
  await page.goto(await workbench.start("full"), {waitUntil: "domcontentloaded"});
  await page.getByLabel("Project").selectOption({label: "Synthetic Vision Lab"});
  await page.getByRole("button", {name: /^Dataset/}).click();
  await page.getByRole("option", {name: /Success synthetic clip/i}).click();
  await page.getByRole("button", {name: /^Inference/}).click();
  await page.getByRole("button", {name: "Run synthetic vision fixture", exact: true}).click();
  await expect(page.locator(".run-inspector .badge")).toHaveText("completed", {timeout: 30_000});
  await page.route("**/api/v1/runs/*/artifacts/*", route => route.fulfill({
    status: 404,
    contentType: "application/json",
    body: '{"error":"changed"}',
  }));
  await page.getByRole("button", {name: /result\.mp4/}).first().click();
  await expect(page.getByRole("alert")).toContainText("Checked artifact unavailable");
  await expect(page.getByLabel(/result preview/)).toHaveCount(0);
});
