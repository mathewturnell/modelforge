import {expect, test} from "../support/workbench.js";


async function openSettings(page) {
  const settings = page.getByRole("button", {name: "Settings", exact: true});
  await expect(settings).toBeVisible();
  await settings.click();
  await expect(page.getByRole("heading", {name: "Settings", exact: true})).toBeVisible();
}

async function chooseProject(page, name) {
  await page.locator(".project-switcher").click();
  await page.getByRole("menuitem", {name: new RegExp(`^${name}`)}).click();
}

test("the real Modal status endpoint is non-live, visible, and actionable", async ({page, workbench}) => {
  await page.goto(await workbench.start("empty"), {waitUntil: "domcontentloaded"});
  await openSettings(page);
  await expect(page.getByText("Modal execution service", {exact: true})).toBeVisible();
  await expect(page.getByRole("link", {name: "Open owner setup guide"})).toBeVisible();
  const response = await page.evaluate(async () => {
    const token = sessionStorage.getItem("modelforge.public-alpha.token");
    const result = await fetch("/api/v1/providers/modal", {headers: {Authorization: `Bearer ${token}`}});
    return {status: result.status, value: await result.json()};
  });
  expect(response.status).toBe(200);
  expect(response.value).toMatchObject({provider: "modal", installed: expect.any(Boolean), message: expect.any(String), live_verified: false});
  expect(["unconfigured", "configured", "error"]).toContain(response.value.state);
});

test("authenticated Codex answer restores from durable ModelForge history", async ({page, workbench}) => {
  const url = await workbench.start("full");
  await page.goto(url, {waitUntil: "domcontentloaded"});
  await chooseProject(page, "BDD100K Road Scene Lab");
  await expect(page.getByText("Codex · ChatGPT Pro", {exact: true})).toBeVisible();
  await page.getByRole("textbox", {name: "Ask ModelForge Coding Assistant"}).fill("Summarize the registered dataset and annotation boundary");
  await page.getByRole("button", {name: "Send to ModelForge Coding Assistant"}).click();
  await expect(page.getByRole("heading", {name: "Authenticated Codex provider"})).toBeVisible();
  await expect(page.getByText(/reached the Codex App Server adapter/)).toBeVisible();

  await page.reload({waitUntil: "domcontentloaded"});
  await expect(page.getByText("Summarize the registered dataset and annotation boundary", {exact: true})).toBeVisible();
  await expect(page.getByRole("heading", {name: "Authenticated Codex provider"})).toBeVisible();
});

test("Settings shows the OS-user Codex account boundary", async ({page, workbench}) => {
  await page.goto(await workbench.start("full"), {waitUntil: "domcontentloaded"});
  await openSettings(page);
  await expect(page.getByTestId("workbench-center").getByText("ModelForge Coding Assistant", {exact: true})).toBeVisible();
  await expect(page.getByText("Codex connected", {exact: true})).toBeVisible();
  await expect(page.getByText("browser-fixture@example.test", {exact: true})).toBeVisible();
  await expect(page.getByText(/ModelForge receives account status, never the credential/)).toBeVisible();
});

test("Settings makes a signed-out Codex account explicit", async ({page, workbench}) => {
  await page.route("**/api/v1/assistant/status", route => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      available: false,
      state: "signed_out",
      provider: "Codex · account not connected",
      codex_connected: false,
      write_available: false,
      message: "Connect your ChatGPT account to use ModelForge Coding Assistant.",
    }),
  }));
  await page.goto(await workbench.start("full"), {waitUntil: "domcontentloaded"});
  await openSettings(page);
  await expect(page.getByText("signed_out", {exact: true})).toBeVisible();
  await expect(page.getByRole("button", {name: "Connect ChatGPT account"})).toBeVisible();
});

test("essential request failures and unknown routes remain visible and bounded", async ({page, workbench}) => {
  const url = await workbench.start("empty");
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.route("**/api/v1/projects", route => route.abort("failed"));
  await page.goto(url, {waitUntil: "domcontentloaded"});
  await expect(page.getByRole("alert")).toContainText(/failed to fetch/i);
  expect(pageErrors).toEqual([]);

  await page.unroute("**/api/v1/projects");
  const response = await page.request.get(new URL("/missing-route", url).href, {headers: {Authorization: "Bearer public-browser-fixture-token"}});
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
      body: JSON.stringify({provider: "modal", state, installed: state !== "unconfigured", profile: state === "configured" ? "default" : null, environment: state === "configured" ? "main" : null, message, live_verified: false}),
    }));
    await page.goto(url, {waitUntil: "domcontentloaded"});
    await openSettings(page);
    await expect(page.getByText(state, {exact: true}).last()).toBeVisible();
    await expect(page.getByText(message, {exact: true})).toBeVisible();
    await expect(page.getByRole("link", {name: "Open owner setup guide"})).toBeVisible();
  });
}

test("checked preview failures never present empty media as success", async ({page, workbench}) => {
  await page.goto(await workbench.start("full"), {waitUntil: "domcontentloaded"});
  await chooseProject(page, "BDD100K Road Scene Lab");
  await page.getByRole("button", {name: "Datasets", exact: true}).click();
  await page.getByRole("button", {name: "Run inference on Authored road scene"}).click();
  await page.route("**/api/v1/runs/*/artifacts/*", route => route.fulfill({status: 404, contentType: "application/json", body: '{"error":"changed"}'}));
  await page.getByRole("button", {name: "Launch inference"}).click();
  await expect(page.getByRole("alert")).toContainText("Checked artifact unavailable", {timeout: 15_000});
  await expect(page.getByText("Result unavailable", {exact: true})).toBeVisible();
  await expect(page.locator('img[alt="Inference result"], video[aria-label="Inference result playback"]')).toHaveCount(0);
});
