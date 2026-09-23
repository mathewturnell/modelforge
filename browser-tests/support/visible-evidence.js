import {expect} from './workbench.js';

export async function openRunDetails(page) {
  const details = page.getByRole('button', {name: 'Run details', exact: true});
  await expect(details).toBeVisible();
  await details.click();
}

export async function openOutput(page) {
  await page.getByRole('tab', {name: 'Output', exact: true}).click();
  await expect(page.getByRole('region', {name: 'Run log'}).getByRole('tabpanel')).toBeVisible();
}

export async function openExactValues(page) {
  const disclosure = page.locator('details.advanced-metric-values');
  await expect(disclosure).toBeVisible();
  if (!(await disclosure.evaluate(element => element.open))) await disclosure.locator('summary').click();
}
