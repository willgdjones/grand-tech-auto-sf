/** Real phone Hail/Cancel gestures against the connected game; no state injection. */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

/** Run after the caller's checks: returns this touch-enabled page to the Ferry spawn. */
export async function checkRobotaxiTouch(page, options = {}) {
  const url = options.url ?? process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173/?touch=1';
  const out = options.out ?? 'artifacts/robotaxi-touch';
  await mkdir(out, { recursive: true });
  const safeUrl = new URL(url); safeUrl.searchParams.delete('invite');
  const report = { url: safeUrl.href, checkedAt: new Date().toISOString(), errors: [], checkpoints: [], passed: false };
  const onPageError = error => report.errors.push(error.message);
  const onConsole = message => { if (message.type() === 'error') report.errors.push(message.text()); };
  page.on('pageerror', onPageError); page.on('console', onConsole);
  try {
    page.setDefaultTimeout(60_000);
    await page.goto(url);
    await page.waitForSelector('#world[data-ready="true"][data-connected="true"]');
    await page.waitForSelector('#loading', { state: 'hidden' });
    const identity = page.locator('.gt-funding-onboarding[open]');
    if (await identity.isVisible()) {
      await page.getByLabel('Startup name', { exact: true }).fill(`Taxi Touch ${Date.now().toString(36)}`);
      await page.getByLabel('Your nickname', { exact: true }).fill('Touch Smoke');
      await identity.getByRole('button', { name: 'Save startup' }).tap();
      await identity.waitFor({ state: 'hidden' });
    }
    const checkpoint = async name => {
      const state = await page.locator('#world').evaluate(canvas => ({ ...canvas.dataset }));
      const taxi = await page.evaluate(() => {
        const t = window.__gtasf?.world?.taxi;
        return t ? { state: t.state, vehicleId: t.vehicleId, etaSeconds: t.etaSeconds, destination: t.destinationTitle } : null;
      });
      report.checkpoints.push({ name, state, taxi, button: await page.locator('#hail').textContent() });
      return { state, taxi };
    };
    const touch = page.locator('.gtasf-touch.on button[data-action="hail"]');
    await touch.waitFor({ state: 'visible' });
    assert.equal((await checkpoint('ready')).state.mode, 'on-foot');
    await touch.tap();
    await page.waitForSelector('#world[data-taxi-state="pickup"]');
    const pickup = await checkpoint('touch-pickup');
    assert.equal(pickup.state.mode, 'on-foot');
    if (pickup.taxi) { assert.ok(pickup.taxi.vehicleId > 0); assert.ok(pickup.taxi.etaSeconds <= 20); }
    assert.match(await page.locator('#hail').textContent(), /Cancel robotaxi/);
    await page.screenshot({ path: `${out}/touch-pickup.png` });
    await touch.tap();
    await page.waitForSelector('#world[data-taxi-state="cancelled"]');
    assert.equal((await checkpoint('touch-cancelled')).state.mode, 'on-foot');
    assert.match(await page.locator('#hail').textContent(), /Hail robotaxi/);
    await page.screenshot({ path: `${out}/touch-cancelled.png` });
    assert.deepEqual(report.errors, [], 'Console/page errors fail touch acceptance');
    report.passed = true;
    return report;
  } catch (error) {
    report.failure = String(error);
    await page.screenshot({ path: `${out}/failed.png` }).catch(() => {});
    throw error;
  } finally {
    await writeFile(`${out}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
    page.off('pageerror', onPageError); page.off('console', onConsole);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    console.log(JSON.stringify(await checkRobotaxiTouch(page)));
  } finally { await browser.close(); }
}
