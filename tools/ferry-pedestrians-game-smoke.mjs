/** Actual game loop and public controls; no pose, clock or feature overrides. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { preview } from 'vite';

const out = resolve(process.env.GTASF_PEDESTRIANS_OUT ?? 'artifacts/ferry-pedestrians/game');
await mkdir(out, { recursive: true });
const report = { startedAt: new Date().toISOString(), app: process.env.GTASF_PEDESTRIANS_APP ?? null,
  scope: 'Actual main-loop pedestrian animation and grounded desktop/phone views; no performance or real-device gate', errors: [], views: [], passed: false };
let server, browser, page;
let base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
async function state(inspectActors = false) {
  return page.evaluate(inspectActors => {
    const w = window.__gtasf.world, crowd = w.ferryPedestrians;
    if (!inspectActors) return { foot: { ...w.foot }, yaw: w.camera.yaw, stats: crowd && { ...crowd.stats } };
    const ferry = w.landmarks.children.find(o => o.userData.landmarkId === 'ferry-building');
    const gl = document.querySelector('#world').getContext('webgl2'), debug = gl.getExtension('WEBGL_debug_renderer_info');
    ferry.updateWorldMatrix(true, false);
    return { capture: window.__gtasf.capture, connected: document.querySelector('#world').dataset.connected,
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      mapErrors: [...w.map.stats.errors],
      foot: { ...w.foot }, yaw: w.camera.yaw, stats: crowd && { ...crowd.stats },
      directScene: crowd?.root.parent === w.landmarks.parent,
      actors: crowd?.root.children.map(actor => {
        let skin; actor.traverse(o => { if (o.isSkinnedMesh) skin = o; });
        return { name: actor.name, visible: actor.visible, position: actor.position.toArray(),
          local: ferry.worldToLocal(actor.position.clone()).toArray(),
          bones: Array.from(skin?.skeleton.boneMatrices ?? []), skinned: !!skin };
      }) ?? [] };
  }, inspectActors);
}
async function target(x, z) {
  return page.evaluate(({ x, z }) => {
    const ferry = window.__gtasf.world.landmarks.children.find(o => o.userData.landmarkId === 'ferry-building');
    ferry.updateWorldMatrix(true, false);
    const point = ferry.position.clone().set(x, .18, z).applyMatrix4(ferry.matrixWorld);
    return { x: point.x, z: point.z };
  }, { x, z });
}
async function face(point) {
  for (let i = 0; i < 35; i++) {
    const value = await state();
    const raw = Math.atan2(point.x - value.foot.x, point.z - value.foot.z) + Math.PI - value.yaw;
    const delta = Math.atan2(Math.sin(raw), Math.cos(raw));
    if (Math.abs(delta) < .04) return;
    const key = delta > 0 ? 'ArrowLeft' : 'ArrowRight';
    await page.keyboard.down(key);
    await page.waitForTimeout(Math.max(25, Math.min(350, Math.abs(delta) / 1.68 * 850)));
    await page.keyboard.up(key);
  }
  throw new Error('Unable to face the pedestrian plaza using arrow keys');
}
async function walk(point) {
  const until = Date.now() + 25_000;
  while (Date.now() < until) {
    const foot = (await state()).foot, distance = Math.hypot(point.x - foot.x, point.z - foot.z);
    if (distance < .7) return;
    await face(point); await page.keyboard.down('KeyW'); await page.keyboard.down('Shift');
    await page.waitForTimeout(Math.max(50, Math.min(500, (distance - .6) / 6 * 750)));
    await page.keyboard.up('Shift'); await page.keyboard.up('KeyW');
  }
  throw new Error('Physical approach to the plaza pedestrians was blocked');
}
try {
  if (process.env.GTASF_PEDESTRIANS_APP) {
    server = await preview({ configFile: resolve('web/vite.config.ts'), root: resolve('web'),
      build: { outDir: resolve(process.env.GTASF_PEDESTRIANS_APP) },
      preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } } });
    base = server.resolvedUrls.local[0];
  }
  browser = await chromium.launch({ headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  for (const low of [false, true]) {
    page = await browser.newPage({ viewport: low ? { width: 390, height: 844 } : { width: 1365, height: 900 }, isMobile: low, hasTouch: low });
    page.setDefaultTimeout(45_000);
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400) report.errors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`); });
    const url = new URL(base); url.searchParams.set('preset', low ? 'low' : 'medium');
    if (low) url.searchParams.set('touch', '1');
    await page.goto(url.href);
    await page.waitForSelector('#world[data-ready="true"][data-connected="true"]');
    await page.waitForSelector('#loading', { state: 'hidden' });
    const identity = page.locator('.gt-funding-onboarding[open]'); await identity.waitFor();
    await page.getByLabel('Startup name', { exact: true }).fill(`Plaza Round ${Date.now().toString(36)}`);
    await page.getByLabel('Your nickname', { exact: true }).fill('Plaza Visitor');
    await identity.getByRole('button', { name: 'Save startup', exact: true }).click();
    await identity.waitFor({ state: 'hidden' });
    assert.ok((await state()).stats, 'Pedestrians must be enabled in the recorded candidate');
    await walk(await target(-16, 38)); await face(await target(-20, 29));
    const before = await state(true); await page.waitForTimeout(850); const after = await state(true);
    assert.equal(after.capture, false); assert.equal(after.connected, 'true'); assert.equal(after.directScene, true);
    assert.deepEqual(after.mapErrors, []);
    assert.equal(after.stats.count, low ? 4 : 8);
    assert.ok(after.stats.visible >= (low ? 3 : 7), 'Nearby rigs remain visible; distant low-tier rigs may cull');
    assert.ok(after.actors.some((actor, i) => Math.hypot(actor.position[0] - before.actors[i].position[0], actor.position[2] - before.actors[i].position[2]) > .05), 'Main loop advances real pedestrian positions');
    assert.ok(after.actors.some((actor, i) => actor.bones.some((value, j) => Math.abs(value - before.actors[i].bones[j]) > .00001)), 'Elapsed game time animates the real skeletons');
    const routeBounds = [[-28, -10, 26, 34], [10, 31, 26, 34], [-82, -53, 26, 29], [53, 82, 26, 29]];
    for (const [i, actor] of after.actors.entries()) {
      if (!actor.visible) continue;
      assert.ok(actor.skinned); assert.ok(Math.abs(actor.local[1] - .18) < .025, 'Feet remain on the mounted plaza paving');
      const [minX, maxX, minZ, maxZ] = routeBounds[i % routeBounds.length];
      assert.ok(actor.local[0] >= minX - .01 && actor.local[0] <= maxX + .01
        && actor.local[2] >= minZ - .01 && actor.local[2] <= maxZ + .01, 'Walker remains within its own verified lane-clear path');
    }
    assert.deepEqual(report.errors, []);
    const label = low ? 'phone' : 'desktop'; await page.screenshot({ path: `${out}/${label}.png` });
    report.views.push({ label, ...after, actors: after.actors.map(({ bones, ...actor }) => ({ ...actor, boneValues: bones.length })) });
    await page.close(); page = undefined;
  }
  report.passed = true; console.log('TEST_PASSED:FerryPedestriansGame');
} catch (error) {
  report.failure = String(error); await page?.screenshot({ path: `${out}/failed.png` }).catch(() => {}); throw error;
} finally {
  if (page) for (const key of ['KeyW', 'Shift', 'ArrowLeft', 'ArrowRight']) await page.keyboard.up(key).catch(() => {});
  await browser?.close();
  if (server) { server.httpServer.closeAllConnections(); await new Promise(done => server.httpServer.close(done)); }
  report.finishedAt = new Date().toISOString(); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
}
