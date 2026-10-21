/** Native phone touch controls: real pointers/server/time, read-only game inspection. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { preview } from 'vite';

const out = process.env.GTASF_TOUCH_OUT ?? 'artifacts/touch-running';
await mkdir(out, { recursive: true });
const report = { startedAt: new Date().toISOString(), errors: [], httpErrors: [], steps: [], passed: false };
let browser, server, page, cdp;
let base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
const touch = (type, points = []) => cdp.send('Input.dispatchTouchEvent', { type,
  touchPoints: points.map((point, index) => ({ x: point.x, y: point.y, id: point.id ?? index + 1, radiusX: 6, radiusY: 6, force: 1 })) });
const centre = async locator => { const b = await locator.boundingBox(); assert.ok(b); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
const state = () => page.evaluate(() => {
  const h = window.__gtasf, w = h.world, input = h.input;
  return { mode: w.mode, pose: { ...w.foot }, speed: Number(document.querySelector('#world').dataset.speed),
    connected: document.querySelector('#world').dataset.connected, source: input.source, run: input.held('run'),
    move: { ...input.move }, steer: input.steer, throttle: input.throttle, brake: input.brake,
    mapErrors: [...w.map.stats.errors] };
});
async function record(name) {
  const data = await state(); report.steps.push({ name, data });
  assert.equal(data.connected, 'true'); assert.deepEqual(data.mapErrors, []);
  assert.deepEqual(report.errors, []); assert.deepEqual(report.httpErrors, []);
  await page.screenshot({ path: `${out}/${name}.png` });
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(`TOUCH_STEP:${name}`); return data;
}
async function speedBetween(low, high) {
  await page.waitForFunction(({ low, high }) => {
    const c = document.querySelector('#world');
    if (c.dataset.connected !== 'true') throw new Error('Native backend disconnected during touch check');
    const speed = Number(c.dataset.speed); return speed >= low && speed <= high;
  }, { low, high }, { timeout: 10_000 });
}
try {
  if (process.env.GTASF_TOUCH_APP) {
    server = await preview({ configFile: resolve('web/vite.config.ts'), root: resolve('web'),
      build: { outDir: resolve(process.env.GTASF_TOUCH_APP) },
      preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } } });
    base = server.resolvedUrls.local[0];
  }
  const health = await fetch(new URL('/api/health', base), { signal: AbortSignal.timeout(5000) });
  assert.equal(health.status, 200, 'Native backend must be available before opening a browser');
  const url = new URL(process.env.GTASF_TOUCH_SPAWN ?? '/?at=37.80199520213967,-122.41963019831591,87.8', base);
  url.searchParams.set('touch', '1'); report.url = url.href;
  browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
  page = await context.newPage(); page.setDefaultTimeout(30_000);
  cdp = await context.newCDPSession(page);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) report.httpErrors.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  await page.goto(url.href);
  await page.waitForSelector('#world[data-ready="true"][data-connected="true"]');
  await page.locator('#loading').waitFor({ state: 'hidden' });
  const identity = page.locator('.gt-funding-onboarding[open]');
  await identity.waitFor();
  await page.getByLabel('Startup name', { exact: true }).fill(`Touch ${Date.now().toString(36)}`);
  await page.getByLabel('Your nickname', { exact: true }).fill('Touch Driver');
  await identity.getByRole('button', { name: 'Save startup', exact: true }).tap();
  await identity.waitFor({ state: 'hidden' });
  await page.locator('.gtasf-touch.on').waitFor();
  assert.deepEqual(await page.locator('.gtasf-touch button:visible').allTextContents(), ['Enter / exit', 'Hail', 'Map']);
  await record('phone-idle');

  // Driving first keeps the original nearby parked car reachable before the running check.
  await page.getByRole('button', { name: 'Enter / exit', exact: true }).tap();
  await page.waitForSelector('#world[data-mode="driver"]');
  assert.deepEqual(await page.locator('.gtasf-touch button:visible').allTextContents(), ['Go', 'Brake', 'H-brake', 'Enter / exit', 'Hail', 'Horn', 'Map']);
  assert.equal(await page.locator('.stick-hint').isVisible(), false);
  let stick = await centre(page.locator('.gtasf-touch .stick'));
  const go = await centre(page.getByRole('button', { name: 'Go', exact: true }));
  await touch('touchStart', [{ x: stick.x + 50, y: stick.y, id: 1 }, { ...go, id: 2 }]);
  await speedBetween(1, 8);
  const driving = await state();
  assert.equal(driving.mode, 'driver'); assert.equal(driving.run, true);
  assert.ok(Math.abs(driving.steer - 50 / 56) < .02); assert.equal(driving.throttle, 1);
  report.steps.push({ name: 'simultaneous-driving-controls', data: driving });
  await touch('touchEnd');
  const brake = await centre(page.getByRole('button', { name: 'H-brake', exact: true }));
  await touch('touchStart', [brake]); await speedBetween(0, 0); await touch('touchEnd');
  await record('phone-driven');
  await page.getByRole('button', { name: 'Enter / exit', exact: true }).tap();
  await page.waitForSelector('#world[data-mode="on-foot"]');
  assert.deepEqual(await page.locator('.gtasf-touch button:visible').allTextContents(), ['Enter / exit', 'Hail', 'Map']);
  assert.equal(await page.locator('.stick-hint').isVisible(), true);
  stick = await centre(page.locator('.gtasf-touch .stick'));

  await touch('touchStart', [{ x: stick.x, y: stick.y - 4 }]);
  await page.waitForTimeout(150);
  const neutral = await state(); assert.equal(neutral.speed, 0); assert.equal(neutral.run, false);
  assert.equal(Math.hypot(neutral.move.x, neutral.move.y), 0);
  await touch('touchMove', [{ x: stick.x, y: stick.y - 28 }]);
  await speedBetween(1.3, 1.7);
  const walking = await state(); assert.equal(walking.run, false); assert.equal(walking.source, 'touch');
  await touch('touchEnd'); await speedBetween(0, 0);
  report.steps.push({ name: 'partial-deflection-walk', data: walking });

  await touch('touchStart', [{ x: stick.x, y: stick.y - 54 }]);
  await speedBetween(5.4, 6.01);
  const running = await state(); assert.equal(running.run, true);
  report.steps.push({ name: 'full-deflection-run', data: running });
  await touch('touchCancel'); await speedBetween(0, 0);
  assert.equal((await state()).run, false);
  await record('phone-run-released');

  // A second finger opens the modal while the first remains at full deflection.
  const optionsPoint = await centre(page.getByRole('button', { name: 'Game options', exact: true }));
  const held = { x: stick.x, y: stick.y - 54, id: 1 };
  await touch('touchStart', [held]); await speedBetween(5.4, 6.01);
  await touch('touchStart', [held, { ...optionsPoint, id: 2 }]);
  // Secondary touches do not synthesize click; the launcher opens on pointerdown.
  // Keep both fingers held until the modal has cleared movement, then cancel them together.
  await page.getByRole('dialog', { name: 'Game options', exact: true }).waitFor();
  await speedBetween(0, 0);
  assert.equal((await state()).run, false);
  await touch('touchCancel'); await record('phone-modal-released');
  report.passed = true;
} catch (error) {
  report.failure = String(error); report.failedState = page ? await state().catch(() => null) : null;
  await page?.screenshot({ path: `${out}/failed.png` }).catch(() => {});
  process.exitCode = 1; console.error(report.failure);
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
  await browser?.close();
  if (server) { server.httpServer.closeAllConnections(); await new Promise(done => server.httpServer.close(done)); }
  console.log(`TOUCH_REPORT:${out}/report.json`);
}
