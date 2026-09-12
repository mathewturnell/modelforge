import {expect, test} from "../support/workbench.js";


const projects = [
  {slug: "bdd100k", name: "BDD100K Road Scene Lab", dataset: "Authored road scenes", sample: "Authored road scene", result: "image"},
  {slug: "soccernet", name: "SoccerNet Match Intelligence", dataset: "Authored match clips", sample: "Authored match clip", result: "video"},
  {slug: "tastematch", name: "TasteMatch", dataset: "Authored food images", sample: "Authored food plate", result: "table"},
  {slug: "qwen", name: "Qwen2.5-7B Prompt Lab", dataset: "Authored conversations", sample: "Authored conversation", result: "prompt"},
];

async function chooseProject(page, name) {
  await page.locator(".project-switcher").click();
  await page.getByRole("menuitem", {name: new RegExp(`^${name}`)}).click();
  await expect(page.getByRole("heading", {name: new RegExp(`^${name}`)}).first()).toBeVisible();
}

async function annotateVisualSample(page, sample) {
  await page.getByRole("button", {name: `Preview ${sample}`}).click();
  await page.getByRole("button", {name: "Open annotation editor"}).click();
  await page.getByRole("button", {name: "Box", exact: true}).click();
  const stage = page.locator(".annotation-stage svg");
  const bounds = await stage.boundingBox();
  expect(bounds).not.toBeNull();
  await page.mouse.move(bounds.x + bounds.width * .2, bounds.y + bounds.height * .2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .48, bounds.y + bounds.height * .54);
  await page.mouse.up();
  await expect(page.locator(".object-list button")).toHaveCount(1);
  await expect(page.getByText("Autosaved", {exact: true})).toBeVisible();
  await page.getByRole("button", {name: "Done", exact: true}).click();
}

async function annotateConversation(page, slug) {
  await page.getByRole("button", {name: "LLM Lab", exact: true}).click();
  await page.locator(".llm-message-editor textarea").nth(1).fill("Explain checked experiment evidence.");
  await page.getByPlaceholder("instruction-following, résumé, extraction").fill("grounded, reviewed");
  await page.getByPlaceholder("Why this example belongs in the set").fill(`${slug} curation evidence`);
  await page.getByRole("button", {name: "Save example"}).click();
  await expect.poll(() => page.evaluate(async () => {
    const token = sessionStorage.getItem("modelforge.public-alpha.token");
    const response = await fetch("/api/v1/projects/qwen-conformance-fixture/datasets/conformance-data/samples/conversation/annotations", {headers: {Authorization: `Bearer ${token}`}});
    return Number((await response.json()).revision || 0);
  })).toBeGreaterThan(0);
  await page.reload({waitUntil: "domcontentloaded"});
  await expect(page.getByPlaceholder("Why this example belongs in the set")).toHaveValue(`${slug} curation evidence`);
}

async function runTraining(page) {
  await page.getByRole("button", {name: "Training", exact: true}).click();
  await page.getByRole("button", {name: "Start training"}).click();
  await page.getByRole("button", {name: "Validate and start training"}).click();
  await expect(page.locator(".run-detail .mf-badge", {hasText: "Completed"})).toBeVisible({timeout: 15_000});
  await expect(page.getByText("0.31", {exact: true})).toBeVisible();
}

async function runInference(page, project) {
  if (project.result === "prompt") {
    await page.getByRole("button", {name: "LLM Lab", exact: true}).click();
    await page.getByRole("button", {name: "Prompt console"}).click();
    await page.getByPlaceholder(/Ask the model about/).fill("Why retain checked evidence?");
    await page.getByRole("button", {name: "Run prompt"}).click();
    await expect(page.getByText(/Synthetic Qwen conformance response/)).toBeVisible({timeout: 15_000});
    return;
  }
  await page.getByRole("button", {name: "Datasets", exact: true}).click();
  await page.getByRole("button", {name: `Run inference on ${project.sample}`}).click();
  await page.getByRole("button", {name: "Launch inference"}).click();
  await expect(page.getByText("Result ready", {exact: true})).toBeVisible({timeout: 15_000});
  if (project.result === "image") await expect(page.getByAltText("Inference result")).toBeVisible();
  if (project.result === "video") await expect(page.getByLabel("Inference result playback")).toBeVisible();
  if (project.result === "table") await expect(page.getByRole("cell", {name: "pizza", exact: true})).toBeVisible();
}

for (const project of projects) {
  test(`${project.slug} completes dataset loading, annotation, training, and inference`, async ({page, workbench}, testInfo) => {
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => {if (message.type() === "error") errors.push(message.text());});
    await page.setViewportSize({width: 1440, height: 960});
    await page.goto(await workbench.start("full"), {waitUntil: "domcontentloaded"});
    await expect(page.getByRole("heading", {name: "Synthetic Threshold Lab", exact: true})).toBeVisible();
    await chooseProject(page, project.name);
    await page.getByRole("button", {name: "Datasets", exact: true}).click();
    await expect(page.getByText(project.dataset, {exact: true}).first()).toBeVisible();
    if (project.result === "prompt") await annotateConversation(page, project.slug);
    else await annotateVisualSample(page, project.sample);
    await runTraining(page);
    await runInference(page, project);
    await testInfo.attach(`${project.slug}-complete-journey`, {body: await page.screenshot({fullPage: true, animations: "disabled"}), contentType: "image/png"});
    expect(errors).toEqual([]);
  });
}

test("reference lifecycle covers cancellation, worker failure, and invalid evidence", async ({page, workbench}) => {
  await page.goto(await workbench.start("full"), {waitUntil: "domcontentloaded"});
  await chooseProject(page, "BDD100K Road Scene Lab");
  for (const sample of ["Cancel synthetic clip", "Failure synthetic clip", "Invalid synthetic clip"]) {
    await page.getByRole("button", {name: "Datasets", exact: true}).click();
    await page.getByRole("button", {name: `Run inference on ${sample}`}).click();
    await page.getByRole("button", {name: "Launch inference"}).click();
    if (sample.startsWith("Cancel")) {
      await page.getByRole("button", {name: "Stop inference"}).click();
      await expect(page.getByText("Cancelled", {exact: true})).toBeVisible({timeout: 15_000});
    } else {
      await expect(page.getByText("Failed", {exact: true})).toBeVisible({timeout: 15_000});
    }
    await expect(page.getByText("Result ready", {exact: true})).toHaveCount(0);
  }
});
