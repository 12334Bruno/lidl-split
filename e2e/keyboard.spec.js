import { test, expect } from '@playwright/test';

const receipt = `Lidl Test
OMSCHRIJVING EUR
${Array.from({ length: 20 }, (_, index) => `Product ${index + 1} 10,00 B`).join('\n')}
----------------
Aantal 20 art.
15-10-2026`;

async function openReceipt(page, people = ['David', 'Bruno'], text = receipt) {
  await page.addInitScript(names => {
    localStorage.setItem('people', JSON.stringify(names));
    window.vibrationCalls = [];
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: duration => { window.vibrationCalls.push(duration); return true; },
    });
  }, people);
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
  await page.goto('./');
  await page.waitForFunction(() => typeof window.handleParse === 'function');
  await page.locator('#receipt-input').fill(text);
  await page.getByRole('button', { name: 'Parse Receipt' }).click();
  return page.locator('.item-card');
}

async function expectVisibleBetweenBars(target) {
  const visible = await target.evaluate(element => {
    const box = element.getBoundingClientRect();
    const header = document.querySelector('header').getBoundingClientRect();
    const footer = document.querySelector('#screen-assign .fab-bar').getBoundingClientRect();
    return box.top >= header.bottom && box.bottom <= footer.top;
  });
  expect(visible).toBe(true);
}

test('assigns initials and Common, advancing one row including already assigned rows', async ({ page }) => {
  const rows = await openReceipt(page);
  await rows.nth(1).click();
  await page.keyboard.press('b');
  await expect(rows.nth(1).locator('.assignment-badge')).toHaveText('Bruno');
  await rows.first().click();
  await page.keyboard.press('d');
  await expect(rows.first().locator('.assignment-badge')).toHaveText('David');
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press('c');
  await expect(rows.nth(1).locator('.assignment-badge')).toHaveText('Common');
  await expect(rows.nth(2)).toBeFocused();
  await page.keyboard.press('Shift+D');
  await expect(rows.nth(2).locator('.assignment-badge')).toHaveText('David');
});

test('resolves colliding initials and refreshes shortcuts after renaming', async ({ page }) => {
  const rows = await openReceipt(page, ['David', 'Daniel']);
  await expect(page.locator('#person-btns button').nth(1)).toHaveAttribute('aria-keyshortcuts', 'a');
  await page.keyboard.press('a');
  await expect(rows.first().locator('.assignment-badge')).toHaveText('Daniel');
  await page.getByTitle('Settings', { exact: true }).click();
  await page.locator('.settings-person-input').nth(1).fill('Bruno');
  await page.locator('#settings-modal').getByRole('button', { name: 'Save', exact: true }).click();
  await page.keyboard.press('b');
  await expect(rows.nth(1).locator('.assignment-badge')).toHaveText('Bruno');
});

for (const people of [['David', 'Bruno'], ['David', 'Bruno', 'Alice']]) {
  test(`navigates rows and all ${people.length === 2 ? 1 : 3} open sliders in both directions`, async ({ page }) => {
    const rows = await openReceipt(page, people);
    await page.keyboard.press('ArrowUp');
    await expect(rows.first()).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('%');
    await expect(rows.nth(1)).toBeFocused();
    const sliders = rows.nth(1).getByRole('slider');
    const count = await sliders.count();
    expect(count).toBe(people.length === 2 ? 1 : 3);
    for (let index = 0; index < count; index++) {
      await page.keyboard.press('ArrowDown');
      await expect(sliders.nth(index)).toBeFocused();
      await expectVisibleBetweenBars(sliders.nth(index));
    }
    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(2)).toBeFocused();
    for (let index = count - 1; index >= 0; index--) {
      await page.keyboard.press('ArrowUp');
      await expect(sliders.nth(index)).toBeFocused();
    }
    await page.keyboard.press('%');
    await expect(rows.nth(1)).toBeFocused();
    await expect(sliders).toHaveCount(0);
    await page.keyboard.press('ArrowDown');
    await expect(rows.nth(2)).toBeFocused();
  });
}

test('adjusts from the row or its slider by 5%, balances two shares, and clamps endpoints', async ({ page }) => {
  const rows = await openReceipt(page);
  await page.keyboard.press('%');
  await page.keyboard.press('ArrowRight');
  await expect(rows.first().getByRole('slider')).toHaveValue('55');
  await expect(rows.first().locator('[data-percentage-label]')).toHaveText(['55%', '45%']);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowLeft');
  await expect(rows.first().getByRole('slider')).toHaveValue('50');
  for (let index = 0; index < 12; index++) await page.keyboard.press('ArrowRight');
  await expect(rows.first().locator('[data-percentage-label]')).toHaveText(['100%', '0%']);
  for (let index = 0; index < 22; index++) await page.keyboard.press('ArrowLeft');
  await expect(rows.first().locator('[data-percentage-label]')).toHaveText(['0%', '100%']);
  await page.keyboard.press('d');
  await expect(rows.first().getByRole('slider')).toHaveCount(0);
  await expect(rows.nth(1)).toBeFocused();
  expect(await page.evaluate(() => window.vibrationCalls)).toEqual([]);
});

test('keeps keyboard focus visible on long receipts and stops at list boundaries', async ({ page }) => {
  const rows = await openReceipt(page);
  for (let index = 0; index < 22; index++) await page.keyboard.press('ArrowDown');
  await expect(rows.last()).toBeFocused();
  await expectVisibleBetweenBars(rows.last().locator('.item-main'));
  await page.keyboard.press('c');
  await expect(rows.last()).toBeFocused();
  for (let index = 0; index < 22; index++) await page.keyboard.press('ArrowUp');
  await expect(rows.first()).toBeFocused();
  await expectVisibleBetweenBars(rows.first().locator('.item-main'));
});

test('leaves typing, settings, and modified browser shortcuts alone', async ({ page }) => {
  const rows = await openReceipt(page);
  await page.keyboard.press('%');
  const input = rows.first().getByRole('spinbutton');
  await input.fill('25');
  await input.press('ArrowRight');
  await expect(input).toHaveValue('25');
  await expect(input).toBeFocused();
  await rows.first().focus();
  await page.keyboard.press('Control+d');
  await expect(rows.first().locator('.assignment-badge')).toHaveText('Percentages');
  await page.getByTitle('Settings', { exact: true }).click();
  await page.locator('.settings-person-input').first().fill('dcba');
  await page.locator('#settings-modal').getByRole('button', { name: 'Save', exact: true }).focus();
  await page.keyboard.press('b');
  await expect(rows.nth(1).locator('.assignment-badge')).toHaveText('—');
});

test('retains native slider dragging with independent group shares and no vibration', async ({ page, hasTouch }) => {
  const rows = await openReceipt(page, ['David', 'Bruno', 'Alice']);
  await rows.first().locator('.split-menu-button').click();
  const slider = rows.first().getByRole('slider').first();
  await slider.scrollIntoViewIfNeeded();
  const box = await slider.boundingBox();
  await page.mouse.move(box.x + box.width * 0.34, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
  expect(Number(await slider.inputValue())).toBeGreaterThan(60);
  if (hasTouch) {
    await page.touchscreen.tap(box.x + box.width * 0.2, box.y + box.height / 2);
    expect(Number(await slider.inputValue())).toBeLessThan(40);
  }
  await expect(rows.first().getByRole('spinbutton').nth(1)).toHaveValue('33.33');
  await expect(rows.first().getByRole('spinbutton').nth(2)).toHaveValue('33.33');
  expect(await page.evaluate(() => window.vibrationCalls)).toEqual([]);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
});


test('changes the focused group slider without changing other shares', async ({ page }) => {
  const rows = await openReceipt(page, ['David', 'Bruno', 'Alice']);
  await page.keyboard.press('%');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  const sliders = rows.first().getByRole('slider');
  await expect(sliders.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(rows.first().getByRole('spinbutton').first()).toHaveValue('33.34');
  await expect(rows.first().getByRole('spinbutton').nth(1)).toHaveValue('38');
  await expect(rows.first().getByRole('spinbutton').nth(2)).toHaveValue('33.33');
  await expect(sliders.nth(1)).toBeFocused();
});


for (const fromSlider of [false, true]) {
  test(`searches the focused item's name in a new tab from its ${fromSlider ? 'slider' : 'row'}`, async ({ page, context }) => {
    await context.route('https://www.google.com/search?*', route => route.fulfill({
      contentType: 'text/html', body: '<title>Search</title>',
    }));
    const rows = await openReceipt(page, ['David', 'Bruno'], receipt.replace('Product 1 ', 'Winterpeen '));
    await rows.first().click();
    if (fromSlider) {
      await page.keyboard.press('%');
      await page.keyboard.press('ArrowDown');
    }

    const popupOpened = page.waitForEvent('popup');
    await page.keyboard.press('?');
    const popup = await popupOpened;
    await expect(popup).toHaveURL('https://www.google.com/search?q=Winterpeen');
    expect(await popup.evaluate(() => window.opener)).toBeNull();
    await popup.close();
    await expect(rows.first()).toHaveClass(/selected/);
    if (fromSlider) await expect(rows.first().getByRole('slider')).toBeFocused();
    else await expect(rows.first()).toBeFocused();
  });
}

test('searches the current row and encodes accents and query punctuation', async ({ page, context }) => {
  await context.route('https://www.google.com/search?*', route => route.fulfill({
    contentType: 'text/html', body: '<title>Search</title>',
  }));
  await openReceipt(page, ['David', 'Bruno'], receipt.replace('Product 2 ', 'Crème & broccoli '));
  await page.keyboard.press('ArrowDown');
  const popupOpened = page.waitForEvent('popup');
  await page.keyboard.press('?');
  const popup = await popupOpened;
  await expect(popup).toHaveURL(`https://www.google.com/search?q=${encodeURIComponent('Crème & broccoli')}`);
  await popup.close();
});

test('does not search while typing, editing settings, or using modified shortcuts', async ({ page }) => {
  const rows = await openReceipt(page);
  await page.evaluate(() => {
    window.searchCalls = [];
    window.open = (...args) => { window.searchCalls.push(args); return null; };
  });
  await rows.first().focus();
  await page.keyboard.press('Control+?');
  await page.keyboard.press('%');
  await rows.first().getByRole('spinbutton').press('?');
  await page.getByTitle('Settings', { exact: true }).click();
  await page.locator('.settings-person-input').first().press('?');
  await page.locator('#settings-modal').getByRole('button', { name: 'Save', exact: true }).focus();
  await page.keyboard.press('?');
  expect(await page.evaluate(() => window.searchCalls)).toEqual([]);
});
