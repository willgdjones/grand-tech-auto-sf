/** Mounted vehicle SFX: real key/touch gestures and fleet poses, no audio or world overrides. */
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { preview } from 'vite';

const out = process.env.GTASF_AUDIO_OUT ?? 'artifacts/vehicle-audio';
await mkdir(out, { recursive: true });
const report = { startedAt: new Date().toISOString(), errors: [], httpErrors: [], steps: [], passed: false };
let browser, page, server, base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
const state = () => page.evaluate(() => {
  const world = window.__gtasf.world;
  return { ...world.vehicleAudio.state, mode: world.mode, vehicleId: world.vehicleId,
    speed: Number(document.querySelector('#world').dataset.speed), connected: document.querySelector('#world').dataset.connected,
    modalOpen: !!document.querySelector('dialog[open]'),
    focusedTag: document.activeElement?.tagName, focusedLabel: document.activeElement?.textContent?.trim().slice(0, 80) };
});
async function record(name) {
  const data = await state(); report.steps.push({ name, data });
  await page.screenshot({ path: `${out}/${name}.png` });
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(`AUDIO_STEP:${name}`); return data;
}
try {
  if (process.env.GTASF_AUDIO_APP) {
    server = await preview({ configFile: resolve('web/vite.config.ts'), root: resolve('web'),
      build: { outDir: resolve(process.env.GTASF_AUDIO_APP) },
      preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } } });
    base = server.resolvedUrls.local[0];
  }
  const health = await fetch(new URL('/api/health', base), { signal: AbortSignal.timeout(5000) }); assert.equal(health.status, 200);
  browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true, deviceScaleFactor: 1 });
  page = await context.newPage(); page.setDefaultTimeout(30_000);
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) report.httpErrors.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  const url = new URL(process.env.GTASF_AUDIO_SPAWN ?? '/?at=37.80199520213967,-122.41963019831591,87.8', base); url.searchParams.set('touch', '1'); report.url = url.href;
  await page.goto(url.href);
  await page.waitForSelector('#world[data-ready="true"][data-connected="true"]'); await page.locator('#loading').waitFor({ state: 'hidden' });
  const identity = page.locator('.gt-funding-onboarding[open]'); await identity.waitFor();
  await page.getByLabel('Startup name', { exact: true }).fill(`Audio ${Date.now().toString(36)}`);
  await page.getByLabel('Your nickname', { exact: true }).fill('Audio Driver');
  await identity.getByRole('button', { name: 'Save startup', exact: true }).click(); await identity.waitFor({ state: 'hidden' });
  assert.equal((await state()).context, 'not-started', 'Loading the world must not create an audio context');
  await page.keyboard.press('KeyE'); await page.waitForSelector('#world[data-mode="driver"]');
  await page.getByRole('button', { name: 'Game options', exact: true }).click();
  await page.getByRole('button', { name: 'Enable vehicle sounds', exact: true }).click();
  await page.waitForFunction(() => window.__gtasf.world.vehicleAudio.state.context === 'running');
  await page.keyboard.press('Escape');
  await page.locator('dialog[open]').waitFor({ state: 'hidden' });
  // Closing the menu restores its button focus. Resume play with a real canvas
  // gesture so Space brakes instead of correctly activating that focused button.
  await page.locator('#world').click({ position: { x: 640, y: 400 } });
  assert.equal((await state()).modalOpen, false);
  assert.notEqual((await state()).focusedTag, 'BUTTON');
  await page.waitForFunction(() => window.__gtasf.world.vehicleAudio.state.peak > .00001);
  const idle = await record('desktop-idle-audible');
  const idleVoice = idle.voices.find(voice => voice.id === idle.vehicleId); assert.ok(idleVoice);
  await page.keyboard.down('KeyW');
  try { await page.waitForFunction(() => Number(document.querySelector('#world').dataset.speed) > 3); }
  finally { await page.keyboard.up('KeyW'); }
  const moving = await record('desktop-engine-accelerated');
  assert.ok(moving.voices.find(voice => voice.id === moving.vehicleId)?.frequency > idleVoice.frequency);
  assert.ok(moving.peak > 0 && moving.peak < .8); assert.ok(moving.voices.length <= 4);
  await page.keyboard.down('Space');
  try { await page.waitForFunction(() => Number(document.querySelector('#world').dataset.speed) === 0); }
  finally { await page.keyboard.up('Space'); }
  assert.equal((await state()).modalOpen, false, 'Braking must leave gameplay active for the horn');
  await page.keyboard.press('KeyF');
  await page.waitForFunction(() => window.__gtasf.world.vehicleAudio.state.hornCount === 1);
  await record('desktop-horn');
  if (await page.evaluate(() => !!document.pointerLockElement)) await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Horn', exact: true }).tap();
  await page.waitForFunction(() => window.__gtasf.world.vehicleAudio.state.hornCount === 2);
  await page.getByRole('button', { name: 'Game options', exact: true }).tap();
  await page.getByRole('button', { name: 'Mute effects', exact: true }).tap();
  await page.waitForFunction(() => window.__gtasf.world.vehicleAudio.state.context === 'suspended');
  assert.equal((await state()).voices.length, 0); await record('phone-effects-muted');
  await page.getByRole('button', { name: 'Unmute effects', exact: true }).tap();
  await page.waitForFunction(() => window.__gtasf.world.vehicleAudio.state.context === 'running');
  await page.getByLabel('Vehicle effects volume', { exact: true }).focus();
  await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  assert.equal((await state()).volume, .02); await record('phone-effects-volume');
  // Native hidden-tab lifecycle is checked separately without Playwright's focus emulation.
  await page.getByRole('button', { name: 'Pause vehicle sounds', exact: true }).tap();
  await page.waitForFunction(() => window.__gtasf.world.vehicleAudio.state.context === 'suspended');
  assert.equal((await state()).wanted, false); assert.equal((await state()).voices.length, 0);
  await page.getByRole('button', { name: 'Mute effects', exact: true }).tap();
  await page.reload();
  await page.waitForSelector('#world[data-ready="true"][data-connected="true"]'); await page.locator('#loading').waitFor({ state: 'hidden' });
  const restored = await state();
  assert.equal(restored.volume, .02); assert.equal(restored.muted, true);
  assert.equal(restored.wanted, false); assert.equal(restored.context, 'not-started');
  await page.getByRole('button', { name: 'Game options', exact: true }).tap();
  assert.equal(await page.getByLabel('Vehicle effects volume', { exact: true }).inputValue(), '2');
  await page.getByRole('button', { name: 'Unmute effects', exact: true }).waitFor();
  await record('phone-reloaded-preferences');
  assert.deepEqual(report.errors, []); assert.deepEqual(report.httpErrors, []); assert.equal((await state()).connected, 'true');
  report.passed = true;
} catch (error) {
  report.failure = String(error); report.failedState = page ? await state().catch(() => null) : null;
  await page?.screenshot({ path: `${out}/failed.png` }).catch(() => {}); process.exitCode = 1; console.error(report.failure);
} finally {
  report.finishedAt = new Date().toISOString(); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
  await browser?.close(); if (server) { server.httpServer.closeAllConnections(); await new Promise(done => server.httpServer.close(done)); }
  console.log(`AUDIO_REPORT:${out}/report.json`);
}
