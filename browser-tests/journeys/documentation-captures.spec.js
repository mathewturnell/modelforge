import {mkdir} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

import {expect, test} from "../support/workbench.js";


const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(repository, "docs/assets/screenshots");
const BDD = "BDD100K Road Scene Lab · synthetic docs fixture";
const QWEN = "Qwen2.5-7B Prompt Lab · synthetic docs fixture";
const TASTE = "TasteMatch · synthetic docs fixture";

test.skip(
  process.env.MODELFORGE_CAPTURE_DOCUMENTATION !== "1",
  "Documentation captures are regenerated only through npm run docs:screenshots",
);

async function chooseProject(page, name) {
  await page.getByLabel("Project").selectOption({label: name});
  await expect(page.locator(".project-heading")).toHaveText(name);
}

async function openDestination(page, name) {
  await page.getByRole("button", {name: new RegExp(`^${name}`)}).click();
}

async function capture(page, filename) {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: path.join(output, filename),
    fullPage: true,
    animations: "disabled",
  });
}

async function expectCompleted(page) {
  await expect(page.locator(".run-inspector .badge")).toHaveText("completed", {
    timeout: 30_000,
  });
}

test("capture current workbench journeys with redistributable fixtures", async ({page, workbench}) => {
  test.setTimeout(120_000);
  await mkdir(output, {recursive: true});
  await page.setViewportSize({width: 1440, height: 960});
  await page.goto(await workbench.start("documentation"), {waitUntil: "domcontentloaded"});
  await expect(page.getByText("Connected", {exact: true})).toBeVisible();

  await chooseProject(page, BDD);
  await openDestination(page, "Overview");
  await expect(page.getByText(/Safe authored media/)).toBeVisible();
  await capture(page, "01-project-overview.png");

  await openDestination(page, "Dataset");
  const clip = page.getByRole("option", {name: /Success synthetic clip/i});
  await clip.click();
  await expect(page.locator(".preview video")).toBeVisible();
  await capture(page, "02-dataset-selection.png");

  await openDestination(page, "Inference");
  await page.getByRole("button", {name: "Run synthetic vision fixture", exact: true}).click();
  await expectCompleted(page);
  await page.getByRole("button", {name: /result\.mp4/}).first().click();
  const video = page.getByLabel("result.mp4 result preview");
  await expect(video).toBeVisible();
  await video.evaluate(element => { element.currentTime = 0.2; });
  await capture(page, "03-vision-result.png");

  await chooseProject(page, QWEN);
  await openDestination(page, "Inference");
  const prompt = "Explain why keeping experiment results attached to saved runs is useful.";
  await page.getByRole("textbox", {name: "Prompt"}).fill(prompt);
  await capture(page, "04-qwen-prompt.png");

  await page.getByRole("button", {name: "Run synthetic prompt fixture", exact: true}).click();
  await expectCompleted(page);
  await page.getByRole("button", {name: /^assistant\.txt/}).first().click();
  await expect(page.getByLabel("Checked assistant response")).toContainText(prompt);
  await capture(page, "05-qwen-result.png");

  await chooseProject(page, TASTE);
  await openDestination(page, "Dataset");
  await page.getByRole("option", {name: /Authored food plate/i}).click();
  await expect(page.locator(".preview img")).toBeVisible();
  await openDestination(page, "Inference");
  await page.getByRole("button", {name: "Run synthetic base-SigLIP fixture", exact: true}).click();
  await expectCompleted(page);
  await page.getByRole("button", {name: /^base-siglip-scores\.json/}).click();
  await expect(page.locator(".result-table-scroll table")).toBeVisible();
  await capture(page, "06-tastematch-result.png");

  await page.setViewportSize({width: 390, height: 844});
  await chooseProject(page, QWEN);
  await page.getByRole("button", {name: /^assistant\.txt/}).first().click();
  await openDestination(page, "Jobs / Runs");
  await expect(page.getByLabel("Checked assistant response")).toBeVisible();
  await capture(page, "07-mobile-saved-run.png");
});
