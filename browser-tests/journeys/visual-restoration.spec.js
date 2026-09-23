import {expect, test} from '../support/workbench.js';
import {openOutput, openExactValues} from '../support/visible-evidence.js';

// Geometry comes from the published 1728 × 1080 workbench references, not from
// accepting a screenshot of the replacement. Authored fixtures do not claim
// historical dataset, model-quality, assistant, or scientific-result parity.
test.use({viewport: {width: 1728, height: 1080}});

async function open(page, workbench, project) {
  await page.goto(await workbench.start('full'));
  await expect(page.getByText('Connected', {exact: true})).toBeVisible();
  await page.getByRole('combobox', {name: 'Project', exact: true}).selectOption(project);
}
async function destination(page, name) {
  await page.getByRole('navigation', {name: 'Workbench destinations'})
    .getByRole('button', {name, exact: true}).click();
}
async function bounds(locator) {
  await expect(locator).toBeVisible();
  const rect = await locator.boundingBox();
  expect(rect).not.toBeNull();
  return rect;
}
function near(actual, expected, tolerance = 4) {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

test('desktop preserves the reference shell, dataset collection and functional bottom console', async ({page, workbench}, testInfo) => {
  await open(page, workbench, 'vision-fixture');
  await expect(page.locator('.title-bar')).toHaveClass(/MuiAppBar-root/);
  const title = await bounds(page.locator('.title-bar'));
  const rail = await bounds(page.getByRole('navigation', {name: 'Workbench destinations'}));
  const tabs = await bounds(page.getByRole('tablist', {name: 'Open workbench documents'}));
  near(title.height, 58);
  near(rail.width, 70);
  near(tabs.height, 39);
  near(rail.y, title.height);
  await expect(page.locator('.bottom-panel')).toHaveClass(/collapsed/);
  await expect(page.locator('.assistant-panel')).toContainText('not connected');
  await destination(page, 'Dataset');
  const collection = await bounds(page.locator('.collection-sidebar'));
  near(collection.width, 300, 10);
  near(collection.x, 70, 5);
  await page.getByRole('option', {name: /Success synthetic clip/i}).click();
  await destination(page, 'Inference');
  await page.getByRole('button', {name: 'Run synthetic vision fixture', exact: true}).click();
  await expect(page.locator('.run-inspector .badge')).toHaveText('completed', {timeout: 30_000});
  await openOutput(page);
  const consolePanel = await bounds(page.locator('.bottom-panel'));
  expect(consolePanel.width).toBeGreaterThan(850);
  expect(consolePanel.height).toBeGreaterThan(130);
  const log = page.getByRole('region', {name: 'Run log'}).getByRole('tabpanel');
  await expect(log).toContainText('Synthetic vision fixture started');
  await expect(log).toContainText(/\[\d{2}:\d{2}:\d{2}\]/);
  await page.getByRole('tab', {name: 'Logs', exact: true}).click();
  await expect(log).toContainText('Synthetic vision fixture started');
  await page.screenshot({path: testInfo.outputPath('restored-shell-output.png')});
  await page.getByRole('button', {name: 'Collapse output panel', exact: true}).click();
  await expect(page.locator('.bottom-panel')).toHaveClass(/collapsed/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test('model occupies the reference graph workspace with real zoom, minimap and selected-node inspector', async ({page, workbench}, testInfo) => {
  await open(page, workbench, 'vision-fixture');
  await destination(page, 'Models / Architecture');
  await expect(page.getByRole('heading', {name: 'Authored fixture architecture'})).toBeVisible();
  await expect(page.locator('.collection-sidebar')).toHaveCount(0);
  const canvas = await bounds(page.locator('.architecture-canvas'));
  const inspector = await bounds(page.locator('.architecture-inspector'));
  expect(canvas.width).toBeGreaterThan(650);
  expect(canvas.height).toBeGreaterThan(350);
  expect(inspector.x).toBeGreaterThan(canvas.x + canvas.width - 5);
  await expect(page.getByLabel('Architecture overview and visible viewport', {exact: true})).toBeVisible();
  await expect(page.locator('.react-flow__background')).toBeVisible();
  const viewport = page.locator('.react-flow__viewport');
  const before = await viewport.getAttribute('style');
  await page.getByRole('button', {name: /^zoom in$/i}).click();
  await expect.poll(() => viewport.getAttribute('style')).not.toBe(before);
  await page.getByRole('button', {name: /^fit view$/i}).click();
  const encoder = page.getByRole('group', {name: 'Image encoder', exact: true});
  await encoder.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.architecture-inspector')).toContainText('[B, 3, 8, 8]');
  await expect(page.locator('.architecture-inspector')).toContainText('Native Class Count');
  await expect(page.locator('.architecture-boundary')).toContainText('Authored fixture backbone');
  await expect(page.getByRole('heading', {name: 'Architecture summary', exact: true})).toBeVisible();
  await page.screenshot({path: testInfo.outputPath('restored-model-inspection.png')});
});

test('training uses the reference run collection and a real interactive chart with precise evidence', async ({page, workbench}, testInfo) => {
  await open(page, workbench, 'training-fixture');
  await destination(page, 'Dataset');
  await page.getByRole('option', {name: /Authored train target/}).click();
  await destination(page, 'Training');
  await page.getByRole('combobox', {name: 'Validation sample', exact: true}).selectOption('validation');
  await page.getByRole('button', {name: 'Train authored scalar', exact: true}).click();
  await expect(page.locator('.run-inspector .badge')).toHaveText('completed', {timeout: 30_000});
  await destination(page, 'Training');
  near((await bounds(page.locator('.collection-sidebar'))).width, 300, 10);
  await expect(page.getByRole('button', {name: 'Start training', exact: true})).toBeVisible();
  await expect(page.getByRole('button', {name: 'Start training', exact: true})).toHaveClass(/MuiButton-root/);
  const comparison = page.getByRole('checkbox', {name: /^Compare run /});
  await expect(comparison).toBeChecked();
  await comparison.uncheck();
  await comparison.check();
  await page.getByRole('combobox', {name: 'Comparison metric', exact: true}).selectOption('train/loss');
  const chart = page.getByRole('figure', {name: 'train/loss recorded metric evidence', exact: true});
  await expect(chart).toContainText('Recorded curve');
  expect((await bounds(chart)).width).toBeGreaterThan(650);
  await expect(chart.locator('.recharts-cartesian-axis-tick-value').first()).toBeVisible();
  await expect(chart.locator('.recharts-line')).toHaveCount(1);
  const point = chart.locator('.recharts-line-dots circle').first();
  await point.hover({force: true});
  await expect(chart.locator('.recharts-tooltip-wrapper')).toBeVisible();
  await expect(page.locator('details.advanced-metric-values')).not.toHaveAttribute('open', '');
  await openExactValues(page);
  const table = page.getByRole('table', {name: 'Exact recorded values · train/loss', exact: true});
  const values = await table.locator('tbody tr td:last-child').allTextContents();
  expect(values.map(Number)).toEqual([4, 2.5600000000000005, 1.6383999999999994]);
  await page.screenshot({path: testInfo.outputPath('restored-training-chart.png')});
});

test('annotation restores fullscreen media, tools, right objects and temporal context without inventing tools', async ({page, workbench}, testInfo) => {
  await open(page, workbench, 'vision-fixture');
  await destination(page, 'Dataset');
  await page.getByRole('option', {name: /Success synthetic clip/i}).click();
  await destination(page, 'Annotation');
  const editor = page.getByRole('dialog', {name: /Annotation editor/});
  const shell = await bounds(editor);
  expect(shell.x).toBeLessThanOrEqual(10);
  expect(shell.y).toBeLessThanOrEqual(10);
  expect(shell.width).toBeGreaterThan(1700);
  expect(shell.height).toBeGreaterThan(1050);
  const tools = await bounds(page.getByRole('navigation', {name: 'Annotation tools'}));
  expect(tools.width).toBeGreaterThanOrEqual(50);
  expect(tools.width).toBeLessThanOrEqual(85);
  const inspector = await bounds(editor.locator('.nae-inspector'));
  expect(inspector.width).toBeGreaterThanOrEqual(280);
  expect(inspector.width).toBeLessThanOrEqual(330);
  const viewport = await bounds(editor.locator('.nae-viewport'));
  expect(viewport.width).toBeGreaterThan(1200);
  expect(inspector.x).toBeGreaterThan(viewport.x + viewport.width - 5);
  const timeline = await bounds(editor.locator('.nae-timeline'));
  expect(timeline.y).toBeGreaterThan(viewport.y + viewport.height - 5);
  await expect(editor.getByRole('button', {name: 'Draw rectangle', exact: true})).toBeEnabled();
  await expect(editor.getByRole('button', {name: 'Polygon', exact: true})).toBeDisabled();
  await expect(editor.getByRole('button', {name: 'Easy annotate', exact: true})).toBeDisabled();
  await editor.getByRole('button', {name: 'Add rectangle', exact: true}).click();
  await expect(editor.getByRole('textbox', {name: 'Object label', exact: true})).toHaveValue('object');
  const stage = editor.locator('.nae-stage');
  const initial = await stage.getAttribute('style');
  await editor.getByRole('button', {name: 'Zoom in', exact: true}).click();
  await expect.poll(() => stage.getAttribute('style')).not.toBe(initial);
  await editor.getByRole('button', {name: 'Fit image', exact: true}).click();
  await editor.getByRole('button', {name: 'Save annotations', exact: true}).click();
  await expect(editor.getByRole('status')).toContainText('Saved revision 1');
  await page.screenshot({path: testInfo.outputPath('restored-fullscreen-annotation.png')});
  await editor.getByRole('button', {name: 'Close annotation editor', exact: true}).click();
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole('navigation', {name: 'Workbench destinations'})).toBeVisible();
});

test('203 recorded annotation frames keep readable timeline labels and exact frame selection', async ({page, workbench}, testInfo) => {
  await open(page, workbench, 'vision-fixture');
  await destination(page, 'Dataset');
  await page.getByRole('option', {name: /Long authored timeline/}).click();
  await destination(page, 'Annotation');
  const editor = page.getByRole('dialog', {name: /Annotation editor/});
  await expect(editor).toContainText('203 recorded frames');
  const ticks = editor.locator('.nae-track-heading button');
  expect(await ticks.count()).toBeGreaterThanOrEqual(2);
  expect(await ticks.count()).toBeLessThanOrEqual(12);
  await expect(ticks.first()).toHaveText('1');
  await expect(ticks.last()).toHaveText('203');
  const boxes = await ticks.evaluateAll(items => items.map(item => item.getBoundingClientRect().toJSON()));
  for (let index = 1; index < boxes.length; index++) expect(boxes[index].x).toBeGreaterThanOrEqual(boxes[index - 1].right);
  const last = editor.getByRole('button', {name: 'Track authored-track frame 203', exact: true});
  await last.focus();
  await page.keyboard.press('Enter');
  await expect(editor.getByRole('spinbutton', {name: 'Annotation frame', exact: true})).toHaveValue('203');
  await expect(editor.getByRole('textbox', {name: 'Object label', exact: true})).toHaveValue('authored object');
  await editor.getByRole('textbox', {name: 'Object label', exact: true}).fill('reviewed final frame');
  await editor.getByRole('button', {name: 'Save annotations', exact: true}).click();
  await expect(editor.getByRole('status')).toContainText('Saved revision 2');
  await page.screenshot({path: testInfo.outputPath('restored-203-frame-timeline.png')});
  await page.reload();
  await destination(page, 'Dataset');
  await page.getByRole('option', {name: /Long authored timeline/}).click();
  await destination(page, 'Annotation');
  await page.getByRole('button', {name: 'Track authored-track frame 203', exact: true}).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', {name: 'Object label', exact: true})).toHaveValue('reviewed final frame');
});
