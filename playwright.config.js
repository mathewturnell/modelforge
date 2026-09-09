import {defineConfig} from "@playwright/test";

const snapshotPathTemplate = process.env.GITHUB_ACTIONS === "true"
  ? "{testDir}/{testFilePath}-snapshots/{arg}-github-ubuntu-24.04{ext}"
  : "{testDir}/{testFilePath}-snapshots/{arg}-{platform}{ext}";

export default defineConfig({
  testDir: "./browser-tests/journeys",
  outputDir: process.env.MODELFORGE_PLAYWRIGHT_OUTPUT_ROOT || "./test-results",
  snapshotPathTemplate,
  timeout: 90_000,
  expect: {timeout: 10_000},
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ["line"],
    ["html", {outputFolder: "playwright-report", open: "never"}],
    ["junit", {outputFile: "test-results/junit.xml"}],
  ],
  use: {
    viewport: {width: 1280, height: 900},
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: process.env.CI ? "retain-on-failure" : "off",
    browserName: "chromium",
    channel: process.env.MODELFORGE_BROWSER_CHANNEL || "chromium",
  },
});
