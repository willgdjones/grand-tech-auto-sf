/** Freeze the current client while exercising keyboard controls against the running local city. */
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { build, preview } from 'vite';
import { resolve } from 'node:path';
const out = 'artifacts/playable';
await mkdir(out, { recursive: true });
const configFile = resolve('web/vite.config.ts'), app = resolve(out, 'camera-app');
await build({ configFile, root: resolve('web'), logLevel: 'warn', build: { outDir: app, emptyOutDir: true, reportCompressedSize: false } });
const server = await preview({ configFile, root: resolve('web'), build: { outDir: app }, preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } } });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
page.setDefaultTimeout(60_000);
const report = { checkedAt: new Date().toISOString(), errors: [], checks: [] };
page.on('pageerror', e => report.errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') report.errors.push(`${m.text()} ${m.location().url}`); });
const angle = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const state = () => page.evaluate(() => {
  const h = window.__gtasf, w = h.world;
  return { foot: { ...w.foot }, frame: h.frame, yaw: w.camera.yaw, pitch: w.camera.pitch,
    safe: w.camera.safe, boom: w.camera.renderedBoom, mode: w.mode, samples: h.perf.samples.slice(-90),
    controls: document.querySelector('.gt-game-options-controls button')?.textContent, errors: h.errors };
});
async function frames(n) {
  const start = await page.evaluate(() => window.__gtasf.frame);
  await page.waitForFunction(f => window.__gtasf.frame >= f, start + n);
}
async function hold(key, n) { await page.keyboard.down(key); await frames(n); await page.keyboard.up(key); }
try {
  await page.goto(process.env.GTASF_SMOKE_URL ?? `${server.resolvedUrls.local[0]}?perf=1`);
  await page.waitForFunction(() => window.__gtasf?.ready);
  const identity = page.locator('.gt-funding-onboarding[open]');
  if (await identity.isVisible()) {
    await page.getByLabel('Startup name', { exact: true }).fill(`Camera ${Date.now().toString(36)}`);
    await page.getByLabel('Your nickname', { exact: true }).fill('Camera Founder');
    await identity.getByRole('button', { name: 'Save startup', exact: true }).click();
    await identity.waitFor({ state: 'hidden' });
  }
  await page.keyboard.press('KeyC'); await frames(2);
  const before = await state();
  report.street = await page.locator('.gt-street-hud').innerText();
  assert.match(report.street, /The Embarcadero/);
  report.gpu = await page.evaluate(() => { const gl = document.querySelector('#world').getContext('webgl2'), debug = gl.getExtension('WEBGL_debug_renderer_info'); return debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); });
  assert.match(before.controls, /camera relative/);
  await hold('ArrowRight', 20);
  const right = await state();
  assert.ok(angle(right.yaw, before.yaw) > .25, 'ArrowRight orbits');
  assert.ok(Math.hypot(right.foot.x - before.foot.x, right.foot.z - before.foot.z) < .02, 'Arrows do not move player');
  await hold('ArrowUp', 10);
  const up = await state(); assert.ok(up.pitch > right.pitch + .05, 'ArrowUp pitches up');
  await page.keyboard.press('KeyC');
  await page.waitForFunction(() => { const w = window.__gtasf.world; return Math.abs(Math.atan2(Math.sin(w.camera.yaw - w.foot.yaw - Math.PI), Math.cos(w.camera.yaw - w.foot.yaw - Math.PI))) < .02; });
  const centered = await state(); assert.ok(angle(centered.yaw, centered.foot.yaw + Math.PI) < .02, 'C recenters');
  await hold('ArrowLeft', 12); const manual = await state();
  const autoAt = await page.evaluate(() => window.__gtasf.seconds + 2.5);
  await page.waitForFunction(t => window.__gtasf.seconds >= t, autoAt); const auto = await state();
  assert.ok(angle(auto.yaw, auto.foot.yaw + Math.PI) < angle(manual.yaw, manual.foot.yaw + Math.PI), 'Camera returns behind without mouse');
  report.checks.push({ name: 'arrow-orbit-pitch-recenter-autofollow', before, right, up, centered, auto });
  await page.keyboard.press('KeyE');
  await page.waitForFunction(() => document.querySelector('#world').dataset.mode === 'driver');
  const driver = await state(); await hold('ArrowLeft', 12); const orbitDriver = await state();
  assert.ok(Math.hypot(orbitDriver.foot.x - driver.foot.x, orbitDriver.foot.z - driver.foot.z) < .05, 'Arrows do not steer or accelerate');
  await page.keyboard.press('KeyE'); await page.waitForFunction(() => document.querySelector('#world').dataset.mode === 'on-foot');
  await page.getByRole('button', { name: 'Game options', exact: true }).click();
  await page.getByRole('button', { name: 'On foot: camera relative', exact: true }).click();
  await page.keyboard.press('Escape');
  const tank = await state(); await hold('KeyA', 12); const turned = await state();
  assert.ok(angle(turned.foot.yaw, tank.foot.yaw) > .1, 'Tank setting rotates player');
  assert.ok(Math.hypot(turned.foot.x - tank.foot.x, turned.foot.z - tank.foot.z) < .02, 'Tank turn stands in place');
  await page.getByRole('button', { name: 'Game options', exact: true }).click();
  await page.getByRole('button', { name: 'On foot: tank controls', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('KeyC'); await hold('KeyS', 8); const walked = await state();
  assert.ok(Math.hypot(walked.foot.x - turned.foot.x, walked.foot.z - turned.foot.z) > .1, 'WASD moves without mouse capture');
  report.checks.push({ name: 'driver-arrow-separation-and-on-foot-modes', driver, orbitDriver, tank, turned, walked });
  assert.deepEqual(report.errors, []); assert.deepEqual(walked.errors, []); assert.equal(walked.safe, true);
  await page.screenshot({ path: `${out}/keyboard-camera.png` });
  report.passed = true; console.log('TEST_PASSED:KeyboardOnlyCamera');
} catch (error) { report.failure = String(error); throw error; }
finally { await writeFile(`${out}/keyboard-camera-report.json`, JSON.stringify(report, null, 2) + '\n'); await browser.close(); server.httpServer.closeAllConnections(); await new Promise(resolve => server.httpServer.close(resolve)); }
