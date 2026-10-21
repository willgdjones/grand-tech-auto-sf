/** Normal native game and physical gestures; camera/player state is read-only. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { preview } from 'vite';
import { chromium } from '@playwright/test';

const app = process.env.GTASF_RECENTER_APP;
assert(app, 'GTASF_RECENTER_APP must name a frozen common build');
const out = resolve(process.env.GTASF_RECENTER_OUT ?? 'artifacts/camera-recenter/native');
await mkdir(out, { recursive: true });
const report = { startedAt: new Date().toISOString(), app,
  source: JSON.parse(await readFile(resolve(dirname(app), 'source.json'), 'utf8')), views: [], lifecycle: [], passed: false };
const lifecycle = (event, details = {}) => report.lifecycle.push({ at: new Date().toISOString(), event, ...details });
const server = await preview({ configFile: resolve('web/vite.config.ts'), root: resolve('web'),
  build: { outDir: resolve(app) }, preview: { host: '127.0.0.1', port: 0,
    proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } } });
let browser, closingBrowser = false;
try {
  const health = await (await fetch(new URL('/api/health', server.resolvedUrls.local[0]))).json();
  assert(health.ok && health.flags.unifiedInput && health.flags.mobile);
  report.flags = health.flags;
  browser = await chromium.launch({ headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  browser.on('disconnected', () => lifecycle('browser-disconnected', { expected: closingBrowser }));
  lifecycle('browser-launched');
  for (const phone of [true, false]) {
    const row = { name: phone ? 'phone' : 'desktop', errors: [], steps: [], passed: false };
    report.views.push(row);
    const context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1365, height: 900 },
      deviceScaleFactor: 1, hasTouch: phone, isMobile: phone });
    let closingContext = false;
    context.on('close', () => lifecycle('context-closed', { view: row.name, expected: closingContext }));
    const page = await context.newPage(); page.setDefaultTimeout(30_000);
    page.on('close', () => lifecycle('page-closed', { view: row.name, expected: closingContext }));
    page.on('crash', () => lifecycle('page-crashed', { view: row.name }));
    page.on('pageerror', error => row.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') row.errors.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400) row.errors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`); });
    const state = () => page.evaluate(() => {
      const h = window.__gtasf, w = h.world;
      return { foot: { ...w.foot }, yaw: w.camera.yaw, pitch: w.camera.pitch, safe: w.camera.safe,
        mode: w.mode, move: { ...h.input.move }, capture: h.capture, mapErrors: [...w.map.stats.errors],
        connected: document.querySelector('#world').dataset.connected,
        menu: !!document.querySelector('.gt-game-options')?.open };
    });
    const record = async name => {
      const value = await state(); row.steps.push({ name, ...value });
      assert.equal(value.capture, false); assert.equal(value.connected, 'true'); assert(value.safe);
      assert.deepEqual(value.mapErrors, []); assert.deepEqual(row.errors, []);
      await page.screenshot({ path: resolve(out, `${row.name}-${name}.png`) });
      return value;
    };
    const cdp = phone ? await context.newCDPSession(page) : null;
    const touch = (type, touchPoints = []) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
    const orbit = async () => {
      const before = await state();
      if (phone) {
        await touch('touchStart', [{ x: 170, y: 365, id: 1 }]);
        await touch('touchMove', [{ x: 295, y: 385, id: 1 }]);
        await touch('touchEnd');
      } else {
        await page.keyboard.down('ArrowRight'); await page.waitForTimeout(450); await page.keyboard.up('ArrowRight');
      }
      await page.waitForFunction(yaw => Math.abs(Math.atan2(Math.sin(window.__gtasf.world.camera.yaw - yaw),
        Math.cos(window.__gtasf.world.camera.yaw - yaw))) > .25, before.yaw);
    };
    const centered = () => page.waitForFunction(() => {
      const w = window.__gtasf.world, delta = w.camera.yaw - w.foot.yaw - Math.PI;
      return !document.querySelector('.gt-game-options').open && Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta))) < .02;
    });
    try {
      const url = new URL(server.resolvedUrls.local[0]);
      if (phone) { url.searchParams.set('touch', '1'); url.searchParams.set('preset', 'low'); }
      row.url = url.href; lifecycle('navigation-start', { view: row.name }); await page.goto(url.href);
      await page.waitForSelector('#world[data-ready="true"][data-connected="true"]');
      lifecycle('game-ready', { view: row.name });
      await page.locator('#loading').waitFor({ state: 'hidden' });
      const identity = page.locator('.gt-funding-onboarding[open]'); await identity.waitFor();
      await page.getByLabel('Startup name', { exact: true }).fill(`Recenter ${Date.now().toString(36)}`);
      await page.getByLabel('Your nickname', { exact: true }).fill('Camera Check');
      await identity.getByRole('button', { name: 'Save startup', exact: true }).click();
      await identity.waitFor({ state: 'hidden' });
      row.renderer = await page.evaluate(() => {
        const gl = document.querySelector('#world').getContext('webgl2');
        const ext = gl?.getExtension('WEBGL_debug_renderer_info');
        return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
      });
      assert.match(row.renderer, /Metal/, 'Use the native game renderer');
      await orbit(); await record('look-away');
      await page.getByRole('button', { name: 'Game options', exact: true })[phone ? 'tap' : 'click']();
      await page.getByRole('dialog', { name: 'Game options', exact: true }).waitFor();
      await record('options');
      const recenter = page.getByRole('button', { name: 'Recenter view', exact: true });
      if (phone) await recenter.tap();
      else { await recenter.focus(); await page.keyboard.press('Enter'); }
      await centered(); const reset = await record('recentered');
      assert.deepEqual(reset.move, { x: 0, y: 0 });
      if (phone) {
        const box = await page.locator('.gtasf-touch .stick').boundingBox(); assert(box);
        await touch('touchStart', [{ x: box.x + box.width / 2, y: box.y + box.height / 2 - 28, id: 2 }]);
      } else await page.keyboard.down('KeyW');
      await page.waitForFunction(p => Math.hypot(window.__gtasf.world.foot.x - p.x, window.__gtasf.world.foot.z - p.z) > .3, reset.foot);
      if (phone) await touch('touchCancel'); else await page.keyboard.up('KeyW');
      await page.waitForFunction(() => !window.__gtasf.input.move.x && !window.__gtasf.input.move.y);
      await record('input-restored');
      if (!phone) { await orbit(); await page.keyboard.press('KeyC'); await centered(); await record('keyboard-c'); }
      assert.deepEqual(row.errors, []); row.passed = true;
    } catch (error) {
      lifecycle('scenario-failed', { view: row.name, browserConnected: browser.isConnected(), pageClosed: page.isClosed() });
      row.failure = String(error); row.failedState = await state().catch(() => null);
      await page.screenshot({ path: resolve(out, `${row.name}-failed.png`) }).catch(() => {}); throw error;
    } finally { closingContext = true; await context.close(); }
  }
  report.passed = true;
} finally {
  report.finishedAt = new Date().toISOString(); closingBrowser = true; await browser?.close();
  server.httpServer.closeAllConnections(); await new Promise(done => server.httpServer.close(done));
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, out }));
}
