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
  const menu = page.locator('.split-menu-button');
  if (await menu.getAttribute('aria-expanded') !== 'true') await menu.click();
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
  expect(calls.every(duration => duration === 20)).toBe(true);
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
  await page.clock.runFor(79);
  await moveTouchDrag(slider, 53);
  expect(await page.evaluate(() => window.vibrationCalls)).toEqual([20]);
  await page.clock.runFor(1);
  await moveTouchDrag(slider, 54);
  expect(await page.evaluate(() => window.vibrationCalls)).toEqual([20, 20]);
  await page.clock.runFor(80);
  await moveTouchDrag(slider, 54);
  expect(await page.evaluate(() => window.vibrationCalls)).toEqual([20, 20]);
  await expect(page.getByRole('spinbutton')).toHaveValue('54');
});

test('stops touch feedback on cancellation and mouse feedback after release', async ({ page }) => {
  await mockVibration(page);
  const slider = await openSlider(page);
  await beginTouchDrag(slider);
  await moveTouchDrag(slider, 51);
  await slider.dispatchEvent('pointercancel', { pointerId: 7 });
  await moveTouchDrag(slider, 52);
  expect(await page.evaluate(() => window.vibrationCalls)).toEqual([20]);

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

test('retries a refused touch request on release, and never on cancellation', async ({ page }) => {
  await page.addInitScript(() => {
    window.vibrationCalls = [];
    window.vibrationAllowed = false;
    document.addEventListener('pointerup', () => { window.vibrationAllowed = true; }, true);
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: duration => {
      window.vibrationCalls.push({ duration, accepted: window.vibrationAllowed });
      return window.vibrationAllowed;
    } });
  });
  const slider = await openSlider(page);
  await page.evaluate(() => { window.vibrationAllowed = false; window.vibrationCalls = []; });
  await beginTouchDrag(slider);
  await moveTouchDrag(slider, 60);
  await slider.dispatchEvent('pointercancel', { pointerId: 7 });
  expect(await page.evaluate(() => window.vibrationCalls)).toEqual([{ duration: 20, accepted: false }]);

  await beginTouchDrag(slider);
  await moveTouchDrag(slider, 70);
  await slider.dispatchEvent('pointerup', { pointerId: 7 });
  expect(await page.evaluate(() => window.vibrationCalls)).toEqual([
    { duration: 20, accepted: false }, { duration: 20, accepted: false }, { duration: 20, accepted: true },
  ]);
  await expect(page.getByRole('spinbutton')).toHaveValue('70');
});

test('handles a real Android-style touch drag without adding an iOS switch', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium' || testInfo.project.name !== 'mobile', 'Chromium touch input check');
  await mockVibration(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/150.0.0.0 Mobile Safari/537.36' });
    Object.defineProperty(navigator, 'brave', { value: { isBrave: async () => true } });
  });
  const slider = await openSlider(page);
  const box = await slider.boundingBox();
  const session = await page.context().newCDPSession(page);
  const point = fraction => ({ x: box.x + box.width * fraction, y: box.y + box.height / 2 });
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point(0.5)] });
  for (const fraction of [0.55, 0.6, 0.65, 0.7, 0.75, 0.8]) {
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point(fraction)] });
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
  expect(Number(await slider.inputValue())).toBeGreaterThan(50);
  expect(await page.evaluate(() => window.vibrationCalls.length)).toBeGreaterThan(0);
  await expect(page.locator('.ios-slider-haptic-pad')).toHaveCount(0);
  await expect(page.getByRole('spinbutton')).toHaveValue(await slider.inputValue());
});

test.describe('iPhone native-switch slider fallback', () => {
  test.beforeEach(async ({ page, browserName }) => {
    test.skip(browserName !== 'webkit', 'iOS interaction checks run in WebKit');
    await mockVibration(page, 'unsupported');
    await page.addInitScript(() => {
      // Linux WebKit lacks Apple's switch setting and vibration hardware.
      // Supply the feature flag to check the iOS interaction path here.
      if (!('switch' in HTMLInputElement.prototype)) {
        Object.defineProperty(HTMLInputElement.prototype, 'switch', { configurable: true, get() { return this.hasAttribute('switch'); } });
      }
    });
  });

  test('drags the switch over the handle while retaining one accessible slider and live prices', async ({ page }, testInfo) => {
    const slider = await openSlider(page);
    await expect(page.locator('.ios-slider-haptic-pad')).toHaveCount(1);
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    const hit = await slider.evaluate(field => {
      const box = field.getBoundingClientRect();
      return document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2).className;
    });
    expect(hit).toBe('ios-slider-haptic-switch');
    await dragSlider(page, slider);
    const value = Number(await slider.inputValue());
    expect(value).toBeGreaterThan(50);
    await expect(page.getByRole('spinbutton')).toHaveValue(String(value));
    await expect(page.locator('[data-share-price]').first()).toHaveText(`€${(value / 10).toFixed(2)}`);
    await expect(page.locator('[data-share-price]').last()).toHaveText(`€${((100 - value) / 10).toFixed(2)}`);
    expect(await page.evaluate(() => window.vibrationCalls)).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('iphone-slider-fallback.png'), fullPage: true });
  });

  test('does not jump on grabbing the handle and keeps the endpoints and keyboard usable', async ({ page }) => {
    const slider = await openSlider(page);
    const box = await slider.boundingBox();
    const start = box.x + box.width / 2 + 5;
    const y = box.y + box.height / 2;
    await page.mouse.move(start, y);
    await page.mouse.down();
    await expect(slider).toHaveValue('50');
    await page.mouse.move(start + (box.width - 16) / 10, y);
    await expect(slider).toHaveValue('60');
    await page.mouse.move(box.x + box.width + 10, y);
    await expect(slider).toHaveValue('100');
    await page.mouse.move(box.x - 10, y);
    await page.mouse.up();
    await expect(slider).toHaveValue('0');
    await slider.press('ArrowRight');
    await expect(slider).toHaveValue('1');
    await expect(page.getByRole('spinbutton')).toHaveValue('1');
  });

  test('keeps the helper aligned after typing, normalization, toggling, and reloading', async ({ page }) => {
    const slider = await openSlider(page);
    await page.getByRole('spinbutton').fill('25');
    await expect(slider).toHaveValue('25');
    const clipFraction = () => page.locator('.ios-slider-haptic-clip').evaluate(clip => {
      const host = clip.closest('.percentage-slider-wrap').getBoundingClientRect();
      return (clip.getBoundingClientRect().x - host.x) / (host.width - 16);
    });
    expect(await clipFraction()).toBeCloseTo(0.25, 2);
    await page.getByRole('button', { name: 'Normalize', exact: true }).click();
    await expect(page.locator('.ios-slider-haptic-pad')).toHaveCount(1);
    await page.locator('.split-menu-button').click();
    await expect(page.locator('.ios-slider-haptic-pad')).toHaveCount(0);
    await page.locator('.split-menu-button').click();
    await expect(page.locator('.ios-slider-haptic-pad')).toHaveCount(1);
    await openSlider(page);
    await expect(page.getByRole('slider')).toHaveValue('25');
    await expect(page.locator('.ios-slider-haptic-pad')).toHaveCount(1);
    await dragSlider(page, page.getByRole('slider'));
    expect(Number(await page.getByRole('slider').inputValue())).toBeGreaterThan(25);
  });

  test('drags each person separately in a larger group and keeps prices visible before normalization', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('people', JSON.stringify(['Alice', 'Bob', 'Carol'])));
    const sliders = await openSlider(page);
    await expect(sliders).toHaveCount(3);
    await expect(page.locator('.ios-slider-haptic-pad')).toHaveCount(3);
    const inputs = page.getByRole('spinbutton');
    const before = await inputs.evaluateAll(fields => fields.map(field => field.value));
    await dragSlider(page, sliders.nth(1));
    const value = Number(await sliders.nth(1).inputValue());
    expect(value).toBeGreaterThan(50);
    await expect(inputs.nth(0)).toHaveValue(before[0]);
    await expect(inputs.nth(2)).toHaveValue(before[2]);
    await expect(page.locator('[data-share-price="1"]')).toHaveText(`€${(value / 10).toFixed(2)}`);
    await expect(page.locator('#assign-done')).toBeDisabled();
    await page.getByRole('button', { name: 'Normalize', exact: true }).click();
    await expect(page.locator('.ios-slider-haptic-pad')).toHaveCount(3);
    await expect(page.locator('#assign-done')).toBeEnabled();
    const shares = await inputs.evaluateAll(fields => fields.map(field => Number(field.value)));
    expect(shares.every(Number.isInteger)).toBe(true);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(100);
    await dragSlider(page, sliders.nth(2), 0.6);
    expect(Number(await sliders.nth(2).inputValue())).toBeGreaterThan(shares[2]);
  });

  test('stops a cancelled drag and restores the normal slider when reduced motion is enabled', async ({ page }) => {
    const slider = await openSlider(page);
    const input = page.locator('.ios-slider-haptic-switch');
    const box = await slider.boundingBox();
    const pointer = { pointerId: 11, pointerType: 'touch', isPrimary: true, button: 0, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
    await input.dispatchEvent('pointerdown', pointer);
    await input.dispatchEvent('pointermove', { ...pointer, clientX: pointer.clientX + 20 });
    expect(Number(await slider.inputValue())).toBeGreaterThan(50);
    const value = await slider.inputValue();
    await input.dispatchEvent('pointercancel', pointer);
    await input.dispatchEvent('pointermove', { ...pointer, clientX: pointer.clientX + 50 });
    await expect(slider).toHaveValue(value);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('.ios-slider-haptic-pad')).toBeHidden();
    await dragSlider(page, slider, 0.2);
    expect(Number(await slider.inputValue())).toBeLessThan(50);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(page.locator('.ios-slider-haptic-pad')).toBeVisible();
    await dragSlider(page, slider, 0.8);
    expect(Number(await slider.inputValue())).toBeGreaterThan(50);
  });
});
