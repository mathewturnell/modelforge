import AxeBuilder from "@axe-core/playwright";

import {expect, test} from "../support/workbench.js";


async function open(page, workbench) {
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(await workbench.start("full"), {waitUntil: "domcontentloaded"});
  await expect(page.getByRole("heading", {name: "Synthetic Threshold Lab", exact: true})).toBeVisible();
  return pageErrors;
}

async function chooseProject(page, name) {
  await page.locator(".project-switcher").click();
  await page.getByRole("menuitem", {name: new RegExp(`^${name}`)}).click();
  await expect(page.getByRole("heading", {name: new RegExp(`^${name}`)}).first()).toBeVisible();
}

async function chooseInferenceSample(page, name) {
  await page.getByRole("button", {name: "Datasets", exact: true}).click();
  await page.getByRole("button", {name: `Run inference on ${name}`}).click();
  await expect(page.getByText(name, {exact: true}).last()).toBeVisible();
}

test("vision execution exposes checked media, durable identity, reload, and restart recovery", async ({page, workbench}) => {
  const errors = await open(page, workbench);
  await chooseProject(page, "BDD100K Road Scene Lab");
  await chooseInferenceSample(page, "Authored road scene");
  await page.getByRole("button", {name: "Launch inference"}).click();
  await expect(page.getByText("Result ready", {exact: true})).toBeVisible({timeout: 15_000});
  await expect(page.locator('img[alt="Inference result"], video[aria-label="Inference result playback"]')).toHaveCount(1);

  const durable = await page.evaluate(async () => {
    const token = sessionStorage.getItem("modelforge.public-alpha.token");
    const response = await fetch("/api/v1/runs?project_id=bdd100k-conformance-fixture", {headers: {Authorization: `Bearer ${token}`}});
    return response.json();
  });
  const completed = durable.runs.find(run => run.status === "completed" && run.configuration?.action_kind === "inference");
  expect(completed.id).toMatch(/^[a-f0-9]{32}$/);
  expect(completed.artifacts.some(artifact => artifact.kind === "image" || artifact.kind === "video")).toBeTruthy();

  await page.reload({waitUntil: "domcontentloaded"});
  await expect(page.getByText("Result ready", {exact: true})).toBeVisible({timeout: 15_000});

  await page.goto(await workbench.restart(), {waitUntil: "domcontentloaded"});
  await chooseProject(page, "BDD100K Road Scene Lab");
  await page.getByRole("button", {name: "Inference", exact: true}).click();
  await expect(page.getByText("Result ready", {exact: true})).toBeVisible({timeout: 15_000});
  expect(errors).toEqual([]);
});

test("prompt execution renders checked text and retains the registered training path", async ({page, workbench}) => {
  const errors = await open(page, workbench);
  await chooseProject(page, "Qwen2.5-7B Prompt Lab");
  await page.getByRole("button", {name: "Training", exact: true}).click();
  await expect(page.getByRole("button", {name: "Start training"})).toBeVisible();
  await page.getByRole("button", {name: "LLM Lab", exact: true}).click();
  await page.getByRole("button", {name: "Prompt console"}).click();
  await page.getByPlaceholder(/Ask the model about/).fill("Why are durable local runs useful?");
  await page.getByRole("button", {name: "Run prompt"}).click();
  await expect(page.getByText(/Synthetic Qwen conformance response/)).toBeVisible({timeout: 15_000});
  const accessibility = await new AxeBuilder({page}).analyze();
  expect(accessibility.violations.filter(item => item.impact === "critical")).toEqual([]);
  expect(errors).toEqual([]);
});

test("failed and invalid outputs remain explicit and expose no successful result", async ({page, workbench}) => {
  await open(page, workbench);
  await chooseProject(page, "BDD100K Road Scene Lab");
  for (const name of ["Failure synthetic clip", "Invalid synthetic clip"]) {
    await chooseInferenceSample(page, name);
    await page.getByRole("button", {name: "Launch inference"}).click();
    await expect(page.getByText("Failed", {exact: true})).toBeVisible({timeout: 15_000});
    await expect(page.getByText("Result ready", {exact: true})).toHaveCount(0);
  }
});

test("cancellation uses the shared lifecycle and reaches cancelled", async ({page, workbench}) => {
  await open(page, workbench);
  await chooseProject(page, "BDD100K Road Scene Lab");
  await chooseInferenceSample(page, "Cancel synthetic clip");
  await page.getByRole("button", {name: "Launch inference"}).click();
  await page.getByRole("button", {name: "Stop inference"}).click();
  await expect(page.getByText("Cancelled", {exact: true})).toBeVisible({timeout: 15_000});
  await expect(page.getByText("Result ready", {exact: true})).toHaveCount(0);
});
