import { test, expect } from '@playwright/test';

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

async function mockVibration(page, mode = 'supported') {
  await page.addInitScript(mode => {
    window.vibrationCalls = [];
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value: mode === 'unsupported' ? undefined : duration => {
        window.vibrationCalls.push(duration);
        if (mode === 'throws') throw new Error('Vibration blocked');
        return mode !== 'denied';
      },
    });
  }, mode);
}

async function openSlider(page) {
  await page.goto('./');
  await page.waitForFunction(() => typeof window.handleParse === 'function');
  await page.locator('#receipt-input').fill(`Lidl Test
OMSCHRIJVING EUR
Coffee 10,00 B
----------------
Aantal 1 art.`);
  await page.getByRole('button', { name: 'Parse Receipt' }).click();
  await page.locator('.split-menu-button').click();
  return page.getByRole('slider');
}

async function dragSlider(page, slider, to = 0.8) {
  await slider.scrollIntoViewIfNeeded();
  const box = await slider.boundingBox();
  const fraction = Number(await slider.inputValue()) / 100;
  await page.mouse.move(box.x + box.width * fraction, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * to, box.y + box.height / 2, { steps: 10 });
  await page.mouse.up();
}

async function beginTouchDrag(slider) {
  await slider.dispatchEvent('pointerdown', {
    pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0,
  });
}

async function moveTouchDrag(slider, value) {
  await slider.evaluate((field, value) => {
    field.value = String(value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

test('drags the taller handle and requests brief haptic ticks', async ({ page }, testInfo) => {
  await mockVibration(page);
  const slider = await openSlider(page);
  await dragSlider(page, slider);
  expect(Number(await slider.inputValue())).toBeGreaterThan(50);
  await expect(page.getByRole('spinbutton')).toHaveValue(await slider.inputValue());
  const calls = await page.evaluate(() => window.vibrationCalls);
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every(duration => duration === 8)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('tall-slider-handle.png'), fullPage: true });
});

test('spaces out touch ticks and does not pulse twice for an unchanged percentage', async ({ page }) => {
  const time = new Date('2026-10-15T12:00:00Z');
  await page.clock.install({ time });
  await page.clock.pauseAt(new Date(time.getTime() + 1000));
  await mockVibration(page);
  const slider = await openSlider(page);
  await beginTouchDrag(slider);
  await moveTouchDrag(slider, 51);
  await moveTouchDrag(slider, 52);
  await page.clock.runFor(49);
  await moveTouchDrag(slider, 53);
  expect(await page.evaluate(() => window.vibrationCalls)).toEqual([8]);
  await page.clock.runFor(1);
  await moveTouchDrag(slider, 54);
  expect(await page.evaluate(() => window.vibrationCalls)).toEqual([8, 8]);
  await page.clock.runFor(50);
  await moveTouchDrag(slider, 54);
  expect(await page.evaluate(() => window.vibrationCalls)).toEqual([8, 8]);
  await expect(page.getByRole('spinbutton')).toHaveValue('54');
});

test('stops touch feedback on cancellation and mouse feedback after release', async ({ page }) => {
  await mockVibration(page);
  const slider = await openSlider(page);
  await beginTouchDrag(slider);
  await moveTouchDrag(slider, 51);
  await slider.dispatchEvent('pointercancel', { pointerId: 7 });
  await moveTouchDrag(slider, 52);
  expect(await page.evaluate(() => window.vibrationCalls)).toEqual([8]);

  await dragSlider(page, slider);
  const count = await page.evaluate(() => window.vibrationCalls.length);
  await slider.press('ArrowLeft');
  expect(await page.evaluate(() => window.vibrationCalls.length)).toBe(count);
});

test('does not vibrate for typed values, keyboard changes, or Normalize', async ({ page }) => {
  await mockVibration(page);
  const slider = await openSlider(page);
  await page.getByRole('spinbutton').fill('25');
  await slider.focus();
  await slider.press('ArrowRight');
  await page.getByRole('button', { name: 'Normalize', exact: true }).click();
  await expect(page.getByRole('spinbutton')).toHaveValue('26');
  expect(await page.evaluate(() => window.vibrationCalls)).toEqual([]);
});

for (const [mode, description] of Object.entries({
  unsupported: 'unavailable', denied: 'denied', throws: 'blocked by an error',
})) {
  test(`keeps native dragging and prices working when vibration is ${description}`, async ({ page }) => {
    await mockVibration(page, mode);
    const slider = await openSlider(page);
    await dragSlider(page, slider);
    const value = Number(await slider.inputValue());
    expect(value).toBeGreaterThan(50);
    await expect(page.getByRole('spinbutton')).toHaveValue(String(value));
    await expect(page.locator('[data-share-price]').first()).toHaveText(`€${(10 * value / 100).toFixed(2)}`);
    await expect(page.locator('#assign-done')).toBeEnabled();
  });
}

test('honors reduced motion and responds when the preference changes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await mockVibration(page);
  const slider = await openSlider(page);
  await dragSlider(page, slider);
  expect(await page.evaluate(() => window.vibrationCalls)).toEqual([]);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await dragSlider(page, slider, 0.2);
  expect(await page.evaluate(() => window.vibrationCalls.length)).toBeGreaterThan(0);
});
