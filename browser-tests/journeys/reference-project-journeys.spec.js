import {expect, test} from "../support/workbench.js";


const projects = [
  {
    slug: "bdd100k",
    name: "BDD100K Road Scene Lab · synthetic conformance fixture",
    sample: /Authored road scene/i,
    labels: "car, road, drivable-area",
    training: "Train synthetic BDD100K Road Scene Lab adapter",
    inference: "Run synthetic vision fixture",
    result: /annotated-road-scene\.svg/,
  },
  {
    slug: "soccernet",
    name: "SoccerNet Match Intelligence · synthetic conformance fixture",
    sample: /Authored match clip/i,
    labels: "player, ball, referee",
    training: "Train synthetic SoccerNet Match Intelligence adapter",
    inference: "Run synthetic SoccerNet inference",
    result: /tracked-match\.mp4/,
  },
  {
    slug: "tastematch",
    name: "TasteMatch · synthetic conformance fixture",
    sample: /Authored food plate/i,
    labels: "pizza, tomato, basil",
    training: "Train synthetic TasteMatch adapter",
    inference: "Run synthetic base-SigLIP fixture",
    result: /base-siglip-scores\.json/,
  },
  {
    slug: "qwen",
    name: "Qwen2.5-7B Prompt Lab · synthetic conformance fixture",
    sample: /Authored conversation/i,
    labels: "helpful, grounded, concise",
    training: "Train synthetic Qwen2.5-7B Prompt Lab adapter",
    inference: "Run synthetic prompt fixture",
    result: /^assistant\.txt/,
    prompt: "Explain why checked artifacts make an experiment easier to review.",
  },
];


async function chooseProject(page, project) {
  await page.getByLabel("Project", {exact: true}).selectOption({label: project.name});
  await expect(page.locator(".project-heading")).toHaveText(project.name);
}


async function openDestination(page, name) {
  const accessibleName = name === "Annotation" ? "Annotat" : name;
  await page.getByRole("button", {name: new RegExp(`^${accessibleName}`)}).click();
}


async function chooseSample(page, project) {
  await openDestination(page, "Dataset");
  const sample = page.getByRole("option", {name: project.sample});
  await sample.click();
  await expect(sample).toHaveAttribute("aria-selected", "true");
}


async function expectCompleted(page) {
  await expect(page.locator(".run-summary .badge")).toHaveText("completed", {
    timeout: 30_000,
  });
}


async function attachScreenshot(page, testInfo, name) {
  const body = await page.screenshot({fullPage: true, animations: "disabled"});
  await testInfo.attach(name, {body, contentType: "image/png"});
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}


for (const project of projects) {
  test(`${project.slug} completes dataset, annotation, training, and inference`, async ({page, workbench}, testInfo) => {
    test.setTimeout(120_000);
    const pageErrors = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.setViewportSize({width: 1440, height: 960});
    await page.goto(await workbench.start("full"), {waitUntil: "domcontentloaded"});
    await expect(page.getByText("Connected", {exact: true})).toBeVisible();
    await chooseProject(page, project);

    await chooseSample(page, project);
    await openDestination(page, "Annotation");
    if (["bdd100k", "tastematch"].includes(project.slug)) {
      const image = page.getByAltText(new RegExp(`Annotation target`, "i"));
      await expect(image).toBeVisible();
      await expect.poll(() => image.evaluate(element => element.naturalWidth)).toBeGreaterThan(0);
    }
    await page.getByLabel("Labels").fill(project.labels);
    const note = `${project.slug} synthetic conformance review`;
    await page.getByLabel("Review note").fill(note);
    await page.getByRole("button", {name: "Save annotation"}).click();
    await expect(page.getByLabel("Review note")).toHaveValue(note);
    await attachScreenshot(page, testInfo, `${project.slug}-annotation`);

    // A browser reload must reconstruct annotation state from the backend,
    // rather than preserving it only in React state.
    await page.reload({waitUntil: "domcontentloaded"});
    await expect(page.getByText("Connected", {exact: true})).toBeVisible();
    await chooseProject(page, project);
    await chooseSample(page, project);
    await openDestination(page, "Annotation");
    await expect(page.getByLabel("Labels")).toHaveValue(project.labels);
    await expect(page.getByLabel("Review note")).toHaveValue(note);

    await openDestination(page, "Training");
    await page.getByRole("button", {name: project.training, exact: true}).click();
    await expectCompleted(page);
    await expect(page.getByRole("button", {name: /^training-metrics\.json/}).first()).toBeVisible();
    await expect(page.getByRole("button", {name: /^candidate-checkpoint\.bin/}).first()).toBeVisible();
    await page.getByRole("button", {name: /^training-metrics\.json/}).first().click();
    await expect(page.getByRole("heading", {name: "training-metrics.json"})).toBeVisible();
    await expect(page.getByLabel("Checked text artifact training-metrics.json")).toContainText('"annotation_revision": 1');
    await attachScreenshot(page, testInfo, `${project.slug}-training`);

    await openDestination(page, "Inference");
    if (project.prompt) await page.getByRole("textbox", {name: "Prompt"}).fill(project.prompt);
    await page.getByRole("button", {name: project.inference, exact: true}).click();
    await expectCompleted(page);
    const result = page.getByRole("button", {name: project.result}).first();
    await expect(result).toBeVisible();
    await result.click();
    if (project.prompt) {
      await expect(page.getByLabel("Checked assistant response")).toContainText(project.prompt);
    } else if (project.slug === "bdd100k") {
      await expect(page.getByAltText("Checked artifact annotated-road-scene.svg")).toBeVisible();
    } else if (project.slug === "soccernet") {
      await expect(page.getByLabel("tracked-match.mp4 result preview")).toBeVisible();
    } else {
      await expect(page.getByRole("heading", {name: "base-siglip-scores.json"})).toBeVisible();
    }
    await attachScreenshot(page, testInfo, `${project.slug}-inference`);
    expect(pageErrors).toEqual([]);
  });
}


test("reference fixture lifecycle covers cancellation, worker failure, and invalid evidence", async ({page, workbench}) => {
  test.setTimeout(120_000);
  await page.goto(await workbench.start("full"), {waitUntil: "domcontentloaded"});
  const project = projects[0];
  await chooseProject(page, project);

  await openDestination(page, "Dataset");
  await page.getByRole("option", {name: /Cancel synthetic clip/i}).click();
  await openDestination(page, "Inference");
  await page.getByRole("button", {name: project.inference, exact: true}).click();
  await expect(page.getByRole("region", {name: "Run log"})).toContainText("fixture_heartbeat");
  await page.getByRole("button", {name: "Request cancellation"}).click();
  await expect(page.locator(".run-summary .badge")).toHaveText("cancelled", {timeout: 30_000});

  await openDestination(page, "Dataset");
  await page.getByRole("option", {name: /Failure synthetic clip/i}).click();
  await openDestination(page, "Inference");
  await page.getByRole("button", {name: project.inference, exact: true}).click();
  await expect(page.locator(".run-summary .badge")).toHaveText("failed", {timeout: 30_000});
  await expect(page.getByRole("complementary", {name: "Current run"})).toContainText("exited with code 7");

  await openDestination(page, "Dataset");
  await page.getByRole("option", {name: /Invalid synthetic clip/i}).click();
  await openDestination(page, "Inference");
  await page.getByRole("button", {name: project.inference, exact: true}).click();
  await expect(page.locator(".run-summary .badge")).toHaveText("failed", {timeout: 30_000});
  await expect(page.getByRole("complementary", {name: "Current run"})).toContainText(/digest|SHA-256|differs/i);
});
