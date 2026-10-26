import { test, expect } from '@playwright/test';

const people = ['Alice', 'Bob', 'Carol', 'Dana', 'Eli', 'Finn', 'Grace', 'Hana'];
const receipt = `Lidl Test
OMSCHRIJVING EUR
Coffee 10,00 B
----------------
Aantal 1 art.
15-10-2026`;
const pageErrors = new WeakMap();

test.beforeEach(async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  pageErrors.set(page, errors);
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({
    contentType: 'text/css', body: '',
  }));
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page)).toEqual([]);
});

async function parseReceipt(page, text = receipt) {
  await page.waitForFunction(() => typeof window.handleParse === 'function');
  await page.locator('#receipt-input').fill(text);
  await page.getByRole('button', { name: 'Parse Receipt' }).click();
  await expect(page.locator('#screen-assign')).toHaveClass(/active/);
}

async function openReceipt(page, count = 3, text = receipt) {
  await page.addInitScript(names => {
    if (!localStorage.getItem('people')) localStorage.setItem('people', JSON.stringify(names));
  }, people.slice(0, count));
  await page.goto('./');
  await parseReceipt(page, text);
  return page.locator('[data-item-index="0"]');
}

async function setPercentages(card, values) {
  for (let index = 0; index < values.length; index++) {
    await card.getByRole('spinbutton').nth(index).fill(String(values[index]));
  }
}

test('opens a compact percentage menu and shows Normalize only inside it', async ({ page }) => {
  const card = await openReceipt(page);
  const control = card.locator('.split-menu-button');
  await expect(control).toHaveText('%');
  await expect(control).toHaveAttribute('aria-expanded', 'false');
  await expect(card.getByRole('button', { name: 'Normalize', exact: true })).toHaveCount(0);
  await expect(card.getByText('Split by percentage', { exact: true })).toHaveCount(0);

  await control.click();
  await expect(control).toHaveAttribute('aria-expanded', 'true');
  await expect(card.getByRole('button', { name: 'Normalize', exact: true })).toBeVisible();
  await control.click();
  await expect(control).toHaveAttribute('aria-expanded', 'false');
  await expect(card.getByRole('button', { name: 'Normalize', exact: true })).toHaveCount(0);
});

test('changes two-person shares by five percent with keyboard arrows', async ({ page }) => {
  const card = await openReceipt(page, 2);
  await card.locator('.split-menu-button').click();
  const slider = card.getByRole('slider');
  await slider.focus();
  await slider.press('ArrowRight');
  await expect(card.getByRole('spinbutton')).toHaveValue('55');
  await expect(card.locator('[data-percentage-label]')).toHaveText(['55%', '45%']);
  await expect(card.locator('[data-share-price]')).toHaveText(['€5.50', '€4.50']);

  await card.getByRole('spinbutton').fill('33.33');
  await slider.press('ArrowRight');
  await expect(card.getByRole('spinbutton')).toHaveValue('38');
  await expect(card.locator('[data-percentage-label]')).toHaveText(['38%', '62%']);
});

test('shows live prices below and above 100% without adjusting other people', async ({ page }) => {
  const card = await openReceipt(page);
  await card.locator('.split-menu-button').click();
  await setPercentages(card, [10, 20, 30]);
  await expect(card.locator('[data-share-price]')).toHaveText(['€1.00', '€2.00', '€3.00']);
  await expect(card.locator('.split-status')).toContainText('60%');
  await expect(page.locator('#assign-done')).toBeDisabled();

  await card.getByRole('slider').first().focus();
  await card.getByRole('slider').first().press('ArrowRight');
  await expect(card.getByRole('spinbutton').first()).toHaveValue('15');
  await expect(card.getByRole('spinbutton').nth(1)).toHaveValue('20');
  await card.getByRole('spinbutton').first().fill('100');
  await expect(card.locator('[data-share-price]')).toHaveText(['€10.00', '€2.00', '€3.00']);
  await expect(card.locator('.split-status')).toContainText('150%');
  await expect(page.locator('#assign-done')).toBeDisabled();
});

test('normalizes the entered ratio to whole percentages and updates settlement', async ({ page }) => {
  const card = await openReceipt(page);
  await card.locator('.split-menu-button').click();
  await setPercentages(card, [50, 75, 0]);
  await expect(card.locator('[data-share-price]')).toHaveText(['€5.00', '€7.50', '€0.00']);
  await card.getByRole('button', { name: 'Normalize', exact: true }).click();
  await expect(card.getByRole('spinbutton').nth(0)).toHaveValue('40');
  await expect(card.getByRole('spinbutton').nth(1)).toHaveValue('60');
  await expect(card.getByRole('spinbutton').nth(2)).toHaveValue('0');
  await expect(card.getByRole('slider').nth(1)).toHaveValue('60');
  await expect(card.locator('[data-share-price]')).toHaveText(['€4.00', '€6.00', '€0.00']);
  await expect(card.locator('.split-status')).toHaveText('Total: 100%');

  await page.locator('#assign-done').click();
  const bob = page.locator('.settlement-card').filter({ hasText: 'Bob owes Alice' });
  await expect(bob.locator('.owes-amount')).toHaveText('€6.00');
  await expect(bob.locator('.settle-item-price')).toHaveText('€6.00');
});

test('rounds equal and all-zero ratios to whole shares totaling 100%', async ({ page }) => {
  const card = await openReceipt(page);
  await card.locator('.split-menu-button').click();
  for (const values of [[1, 1, 1], [0, 0, 0]]) {
    await setPercentages(card, values);
    await card.getByRole('button', { name: 'Normalize', exact: true }).click();
    await expect(card.getByRole('spinbutton').nth(0)).toHaveValue('34');
    await expect(card.getByRole('spinbutton').nth(1)).toHaveValue('33');
    await expect(card.getByRole('spinbutton').nth(2)).toHaveValue('33');
    await expect(card.locator('.split-status')).toHaveText('Total: 100%');
  }
});

test('remembers normalized values and whether the option is enabled on the next receipt', async ({ page }) => {
  const card = await openReceipt(page);
  await card.locator('.split-menu-button').click();
  await setPercentages(card, [50, 75, 0]);
  await card.getByRole('button', { name: 'Normalize', exact: true }).click();
  await page.reload();
  await parseReceipt(page, receipt.replace('10,00', '12,00'));
  await expect(card.locator('.split-menu-button')).toHaveAttribute('aria-pressed', 'true');
  await expect(card.getByRole('spinbutton').nth(0)).toHaveValue('40');
  await expect(card.locator('[data-share-price]')).toHaveText(['€4.80', '€7.20', '€0.00']);

  await card.locator('.split-menu-button').click();
  await page.reload();
  await parseReceipt(page);
  await expect(card.locator('.split-menu-button')).toHaveAttribute('aria-pressed', 'false');
  await expect(card.getByRole('button', { name: 'Normalize', exact: true })).toHaveCount(0);
  await card.locator('.split-menu-button').click();
  await expect(card.getByRole('spinbutton').nth(0)).toHaveValue('40');
});

test('keeps valid cent-rounded previews equal to the settlement charges', async ({ page }) => {
  const card = await openReceipt(page, 2, receipt.replace('10,00', '0,01'));
  await card.locator('.split-menu-button').click();
  await card.getByRole('spinbutton').fill('50');
  await expect(card.locator('[data-share-price]')).toHaveText(['€0.01', '€0.00']);
  await page.locator('#assign-done').click();
  await expect(page.locator('.owes-amount')).toHaveText('€0.00');
});

test('keeps remaining people’s prices when someone is removed and lets Normalize fix the total', async ({ page }) => {
  const card = await openReceipt(page);
  await card.locator('.split-menu-button').click();
  await setPercentages(card, [50, 30, 20]);
  await page.getByTitle('Settings').click();
  await page.locator('.settings-remove-btn').nth(1).click();
  await page.locator('#settings-modal').getByRole('button', { name: 'Save', exact: true }).click();
  await expect(card.locator('[data-share-price]')).toHaveText(['€5.00', '€2.00']);
  await expect(card.locator('.split-status')).toContainText('70%');
  await card.getByRole('button', { name: 'Normalize', exact: true }).click();
  await expect(card.locator('[data-percentage-label]')).toHaveText(['71%', '29%']);
  await expect(card.locator('[data-share-price]')).toHaveText(['€7.10', '€2.90']);
});

for (const count of [2, 3, 8]) {
  test(`fits the controls and percentage inputs for ${count} people`, async ({ page }, testInfo) => {
    if (testInfo.project.name === 'mobile') await page.setViewportSize({ width: 320, height: 740 });
    const card = await openReceipt(page, count);
    await card.locator('.split-menu-button').click();
    await expect(card.getByRole('slider')).toHaveCount(count === 2 ? 1 : count);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const rowsFit = await card.locator('.split-row').evaluateAll(rows => rows.every(row => {
      const box = row.querySelector('.percentage-field').getBoundingClientRect();
      const slider = row.querySelector('.percentage-slider').getBoundingClientRect();
      return box.right < slider.left && Math.abs(box.top + box.height / 2 - slider.top - slider.height / 2) < 3;
    }));
    expect(rowsFit).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('percentage-menu.png'), fullPage: true });
  });
}
