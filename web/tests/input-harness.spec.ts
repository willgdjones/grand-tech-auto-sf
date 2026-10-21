import { expect, test } from '@playwright/test';

test('capture steps exactly and runs the mounted input scenario', async ({ page }) => {
  const markers: string[] = [], errors: string[] = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); else markers.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?capture=1&fps=20&test=input');
  await page.waitForFunction(() => window.__gtasf?.status === 'passed');
  const before = await page.evaluate(() => ({ frame: window.__gtasf!.frame, seconds: window.__gtasf!.seconds }));
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__gtasf!.frame)).toBe(before.frame);
  await page.evaluate(() => window.__gtasf!.step(10));
  const after = await page.evaluate(() => ({ frame: window.__gtasf!.frame, seconds: window.__gtasf!.seconds, samples: window.__gtasf!.perf.samples }));
  expect(after.frame).toBe(before.frame + 10); expect(after.seconds - before.seconds).toBeCloseTo(.5);
  expect(after.samples).toEqual([]); expect(errors).toEqual([]);
  expect(markers.indexOf('READY')).toBeLessThan(markers.indexOf('TEST_PASSED:input'));
});

test('keyboard, touch and text focus share a single frame input state', async ({ page }) => {
  await page.goto('/?capture=1&touch=1'); await page.waitForFunction(() => window.__gtasf?.ready);
  await page.keyboard.down('KeyW'); await page.keyboard.down('KeyF');
  await page.evaluate(() => window.__gtasf!.step());
  expect(await page.evaluate(() => ({ y: window.__gtasf!.input!.move.y, horn: window.__gtasf!.input!.pressed('horn') }))).toEqual({ y: 1, horn: true });
  await page.keyboard.up('KeyW'); await page.keyboard.up('KeyF');
  await page.locator('[data-action=brake]').dispatchEvent('pointerdown', { pointerId: 42, pointerType: 'touch', clientX: 1, clientY: 1 });
  await page.evaluate(() => window.__gtasf!.step());
  expect(await page.evaluate(() => window.__gtasf!.input!.brake)).toBe(1);
  await page.locator('[data-action=brake]').dispatchEvent('pointercancel', { pointerId: 42, pointerType: 'touch' });
  await page.evaluate(() => { const field = document.createElement('input'); document.body.append(field); field.focus(); });
  await page.keyboard.down('KeyW'); await page.evaluate(() => window.__gtasf!.step());
  expect(await page.evaluate(() => ({ y: window.__gtasf!.input!.move.y, brake: window.__gtasf!.input!.brake }))).toEqual({ y: 0, brake: 0 });
  await page.keyboard.up('KeyW');
});

test('console errors fail even a previously passed scenario', async ({ page }) => {
  const markers: string[] = []; page.on('console', message => markers.push(message.text()));
  await page.goto('/?test=smoke'); await page.waitForFunction(() => window.__gtasf?.status === 'passed');
  await page.evaluate(() => console.error('Harness error regression probe'));
  expect(await page.evaluate(() => window.__gtasf!.status)).toBe('failed');
  expect(markers).toContain('TEST_FAILED:smoke');
});
