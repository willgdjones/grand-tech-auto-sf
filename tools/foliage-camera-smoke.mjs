/** Actual cable-exit location, ordinary camera/movement inputs; no pose or clock overrides. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { preview } from 'vite';
import { chromium } from '@playwright/test';
import { worldToGeodetic } from './map/src/geo.ts';
import { SF_FRAME } from './map/src/config.ts';

const app = process.env.GTASF_FOLIAGE_APP;
assert(app, 'GTASF_FOLIAGE_APP must name a frozen game build');
const out = resolve(process.env.GTASF_FOLIAGE_OUT ?? 'artifacts/foliage-camera/native');
const expectedFade = process.env.GTASF_FOLIAGE_EXPECT_FADE === '1';
process.env.GTASF_MAP_AREA = 'sf';
await mkdir(out, { recursive: true });
const original = JSON.parse(await readFile('artifacts/passenger-controls/game-1209/report.json', 'utf8'));
const exit = original.profiles[0].rides[0].exited.foot;
const geo = worldToGeodetic(exit.x, exit.z, SF_FRAME), heading = (540 - exit.yaw * 180 / Math.PI) % 360;
const manifest = await readFile('tools/map/out/sf/manifest.json');
const report = { startedAt: new Date().toISOString(), app, expectedFade, originalExit: exit,
  manifestSha256: createHash('sha256').update(manifest).digest('hex'), cases: [], passed: false };
const server = await preview({ configFile: resolve('web/vite.config.ts'), root: resolve('web'),
  build: { outDir: resolve(app) }, preview: { host: '127.0.0.1', port: 0,
    proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } } });
let browser;
try {
  browser = await chromium.launch({ headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  for (const profile of [{ name: 'phone', viewport: { width: 393, height: 852 }, touch: true },
    { name: 'desktop', viewport: { width: 1365, height: 900 }, touch: false }]) {
    const context = await browser.newContext({ viewport: profile.viewport, deviceScaleFactor: 1,
      isMobile: profile.touch, hasTouch: profile.touch });
    const page = await context.newPage(), row = { name: profile.name, errors: [], steps: [], passed: false };
    report.cases.push(row); page.setDefaultTimeout(60_000);
    page.on('pageerror', e => row.errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') row.errors.push(m.text()); });
    page.on('response', r => { if (r.status() >= 400) row.errors.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`); });
    const state = () => page.evaluate(() => {
      const w = window.__gtasf.world, camera = w.camera.camera, p = w.foot;
      const trees = w.streetProps.root.children.filter(m => /SF (palm|plane|cypress) instances/.test(m.name));
      return { foot: { ...p }, camera: camera.position.toArray(), yaw: w.camera.yaw, pitch: w.camera.pitch,
        safe: w.camera.safe, opacity: w.camera.avatarOpacity,
        projection: camera.position.clone().set(p.x, p.y + 1, p.z).project(camera).toArray(),
        trees: trees.map(m => ({ name: m.name, count: m.count, fade: m.material.userData.gtasfFoliageCameraFade === true,
          alphaTest: m.material.alphaTest, transparent: m.material.transparent, depthWrite: m.material.depthWrite })),
        propsPending: w.streetProps.stats.refreshPending, mapErrors: [...w.map.stats.errors],
        capture: window.__gtasf.capture, connected: document.querySelector('#world').dataset.connected };
    });
    const record = async name => {
      const value = await state(); row.steps.push({ name, ...value });
      assert(value.safe); assert.equal(value.capture, false); assert.equal(value.connected, 'true');
      assert.deepEqual(value.mapErrors, []); assert(value.trees.some(t => t.count > 0));
      assert(value.trees.every(t => t.fade === expectedFade && t.alphaTest === .5 && !t.transparent && t.depthWrite));
      assert(value.opacity > .2, 'Local avatar retains camera clearance');
      assert(value.projection.every(Number.isFinite) && Math.abs(value.projection[0]) < 1 && Math.abs(value.projection[1]) < 1);
      await page.screenshot({ path: resolve(out, `${profile.name}-${name}.png`) });
      return value;
    };
    try {
      const url = new URL(server.resolvedUrls.local[0]);
      url.searchParams.set('at', `${geo.lat},${geo.lon},${heading}`);
      if (profile.touch) { url.searchParams.set('touch', '1'); url.searchParams.set('preset', 'low'); }
      row.link = url.href; await page.goto(url.href);
      await page.waitForSelector('#world[data-ready="true"][data-connected="true"]');
      await page.locator('#loading').waitFor({ state: 'hidden' });
      await page.waitForFunction(() => !!window.__gtasf.world.funding?.profile);
      const identity = page.locator('.gt-funding-onboarding[open]');
      if (await identity.isVisible()) {
        await page.getByLabel('Startup name', { exact: true }).fill(`Foliage ${Date.now().toString(36)}`);
        await page.getByLabel('Your nickname', { exact: true }).fill('Camera Survey');
        await identity.getByRole('button', { name: 'Save startup', exact: true }).click();
        await identity.waitFor({ state: 'hidden' });
      }
      await page.waitForFunction(() => { const w = window.__gtasf.world;
        return w.streetProps.stats.visible > 0 && !w.streetProps.stats.refreshPending && !w.map.stats.loading && !w.map.stats.queuedUploads; });
      await page.waitForTimeout(1500);
      // Public links snap to the centre of a clear lane; a cable exit can be on
      // its shoulder. Walk back using ordinary keys rather than moving the pose.
      row.snappedSpawn = await state();
      for (let attempt = 0; attempt < 35; attempt++) {
        const s = await state(), dx = exit.x - s.foot.x, dz = exit.z - s.foot.z;
        if (Math.hypot(dx, dz) < .22) break;
        const x = dx*Math.cos(s.yaw) - dz*Math.sin(s.yaw), z = dx*Math.sin(s.yaw) + dz*Math.cos(s.yaw);
        const key = Math.abs(x) > Math.abs(z) ? (x > 0 ? 'KeyD' : 'KeyA') : (z > 0 ? 'KeyS' : 'KeyW');
        await page.keyboard.down(key); await page.waitForTimeout(60); await page.keyboard.up(key);
      }
      // Walking changes the player's facing; restore the recorded view through
      // the normal orbit keys. Read-only feedback bounds each physical key hold.
      for (let attempt = 0; attempt < 18; attempt++) {
        const s = await state(), delta = Math.atan2(Math.sin(exit.yaw + Math.PI - s.yaw), Math.cos(exit.yaw + Math.PI - s.yaw));
        if (Math.abs(delta) < .018) break;
        const key = delta > 0 ? 'ArrowLeft' : 'ArrowRight';
        await page.keyboard.down(key); await page.waitForTimeout(Math.max(15, Math.min(160, Math.abs(delta)/1.8*1000)));
        await page.keyboard.up(key); await page.waitForTimeout(160);
      }
      for (let attempt = 0; attempt < 8; attempt++) {
        const s = await state(), delta = -.15 - s.pitch;
        if (Math.abs(delta) < .015) break;
        const key = delta > 0 ? 'ArrowUp' : 'ArrowDown';
        await page.keyboard.down(key); await page.waitForTimeout(Math.max(15, Math.min(100, Math.abs(delta)/1.2*1000)));
        await page.keyboard.up(key); await page.waitForTimeout(160);
      }
      const initial = await record('exit-view');
      assert(Math.hypot(initial.foot.x - exit.x, initial.foot.z - exit.z) < .35, 'Physical walking reproduces the real exit location');
      if (profile.touch) {
        const cdp = await context.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 165, y: 335, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 285, y: 335, id: 1 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      } else {
        await page.keyboard.down('ArrowRight'); await page.waitForTimeout(250); await page.keyboard.up('ArrowRight');
      }
      await page.waitForTimeout(250); const orbit = await record('orbit');
      assert(Math.abs(Math.atan2(Math.sin(orbit.yaw - initial.yaw), Math.cos(orbit.yaw - initial.yaw))) > .15);
      await page.waitForTimeout(2400); await record('restored');
      await page.keyboard.down('KeyW'); await page.waitForTimeout(1700); await page.keyboard.up('KeyW');
      await page.waitForTimeout(400); const walked = await record('walk-away');
      assert(Math.hypot(walked.foot.x - initial.foot.x, walked.foot.z - initial.foot.z) > 3, 'Ordinary walking moves away from foliage');
      assert.deepEqual(row.errors, []); row.passed = true;
    } catch (error) {
      row.failure = String(error); row.failedState = await state().catch(() => null);
      await page.screenshot({ path: resolve(out, `${profile.name}-failed.png`) }).catch(() => {}); throw error;
    } finally { await context.close(); }
  }
  report.passed = true;
} finally {
  report.finishedAt = new Date().toISOString(); await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close(); server.httpServer.closeAllConnections(); await new Promise(done => server.httpServer.close(done));
  console.log(JSON.stringify({ passed: report.passed, out }));
}
