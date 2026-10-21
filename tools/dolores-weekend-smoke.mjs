/** Actual local game, public deep link and physical controls; no pose/clock assignments. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { preview } from 'vite';
const out = resolve(process.env.GTASF_DOLORES_OUT ?? 'artifacts/dolores-weekend/game'); await mkdir(out, { recursive: true });
let base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173', server;
if (process.env.GTASF_DOLORES_APP) {
  server = await preview({ configFile: resolve('web/vite.config.ts'), root: resolve('web'), build: { outDir: resolve(process.env.GTASF_DOLORES_APP) }, preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } } });
  base = server.resolvedUrls.local[0];
}
const report = { startedAt: new Date().toISOString(), app: process.env.GTASF_DOLORES_APP ?? base, scope: 'Actual local SF-weekend picnic, directions, physical approach, animated rigs and desktop/phone views; no device gate', errors: [], views: [], passed: false };
let browser, page;
async function openGame(phone) {
  page = await browser.newPage({ viewport: phone ? { width: 390, height: 844 } : { width: 1365, height: 900 }, isMobile: phone, hasTouch: phone }); page.setDefaultTimeout(45_000);
  page.on('pageerror', error => report.errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) report.errors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`); });
  const url = new URL(base); url.searchParams.set('preset', phone ? 'low' : 'medium'); url.searchParams.set('at', '37.7595,-122.42605');
  await page.goto(url.href); await page.waitForSelector('#world[data-ready="true"][data-connected="true"]'); await page.waitForSelector('#loading', { state: 'hidden' });
  const identity = page.locator('.gt-funding-onboarding[open]'); await identity.waitFor();
  await page.getByLabel('Startup name', { exact: true }).fill(`Blanket Round ${Date.now().toString(36)}`); await page.getByLabel('Your nickname', { exact: true }).fill('Park Visitor');
  await identity.getByRole('button', { name: 'Save startup', exact: true }).click(); await identity.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Game options', exact: true }).click(); await page.getByRole('button', { name: 'Find the Dolores picnic', exact: true }).click();
  await page.getByRole('dialog', { name: 'Game options', exact: true }).waitFor({ state: 'hidden', timeout: 5000 });
}
const state = () => page.evaluate(() => { const w = window.__gtasf.world; return { foot: { ...w.foot }, yaw: w.camera.yaw }; });
async function face(target) {
  for (let i = 0; i < 35; i++) {
    const s = await state(), a = Math.atan2(target.x - s.foot.x, target.z - s.foot.z) + Math.PI - s.yaw, delta = Math.atan2(Math.sin(a), Math.cos(a));
    if (Math.abs(delta) < .035) return;
    const key = delta > 0 ? 'ArrowLeft' : 'ArrowRight'; await page.keyboard.down(key); await page.waitForTimeout(Math.max(25, Math.min(400, Math.abs(delta) / 1.68 * 850))); await page.keyboard.up(key);
  } throw new Error('Unable to face park waypoint');
}
async function walk(point, radius = .5) {
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    const p = (await state()).foot, distance = Math.hypot(p.x - point.x, p.z - point.z); if (distance <= radius) return;
    await face(point); await page.keyboard.down('KeyW'); await page.keyboard.down('Shift'); await page.waitForTimeout(Math.min(600, Math.max(60, (distance - radius) / 6 * 750))); await page.keyboard.up('Shift'); await page.keyboard.up('KeyW');
  } throw new Error('Physical Dolores approach was blocked');
}
const actors = () => page.evaluate(() => {
  const w = window.__gtasf.world, root = w.doloresWeekend.root;
  return root.children.filter(a => a.name.startsWith('Dolores park friend')).map(a => {
    let mesh; a.traverse(o => { if (o.isSkinnedMesh) mesh = o; });
    const x = root.position.x + a.position.x, z = root.position.z + a.position.z;
    return { visible: a.visible, bones: Array.from(mesh?.skeleton.boneMatrices ?? []), x, y: a.position.y, z, ground: w.map.surfaceHeightAt(x, z) };
  });
});
try {
  browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  for (const phone of [false, true]) {
    await openGame(phone);
    const destination = await page.evaluate(() => window.__gtasf.world.doloresWeekend.destination());
    const start = await state(), route = await page.evaluate(() => { const r = window.__gtasf.world.radar.route; return r && { distanceM: r.distanceM, approach: r.approach, points: r.points.length }; });
    assert.ok(route && route.points > 0, 'Picnic directions use a real road route');
    await walk({ x: destination.x + 7, z: destination.z + 6 }); await face(destination);
    const before = await actors(); await page.waitForTimeout(900); const after = await actors();
    assert.equal(after.length, phone ? 2 : 4); assert.equal(after.filter(a => a.visible).length, phone ? 2 : 4);
    assert.ok(before.some((a, i) => a.bones.some((value, j) => Math.abs(value - after[i].bones[j]) > .00001)), 'Real park rigs animate with elapsed time');
    assert.ok(after.every(a => Number.isFinite(a.ground) && Math.abs(a.y - a.ground) < .02), 'Each friend stands on the actual hill');
    const runtime = await page.evaluate(() => {
      const w = window.__gtasf.world, gl = document.querySelector('#world').getContext('webgl2'), debug = gl.getExtension('WEBGL_debug_renderer_info');
      return { capture: window.__gtasf.capture, connected: document.querySelector('#world').dataset.connected,
        renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), mapErrors: [...w.map.stats.errors],
        directScene: w.doloresWeekend.root.parent === w.landmarks.parent, visible: w.doloresWeekend.root.visible, stats: { ...w.doloresWeekend.stats } };
    });
    assert.equal(runtime.capture, false); assert.equal(runtime.connected, 'true'); assert.equal(runtime.directScene, true);
    assert.equal(runtime.visible, true); assert.equal(runtime.stats.weekend, true); assert.deepEqual(runtime.mapErrors, []);
    const label = phone ? 'phone' : 'desktop'; await page.screenshot({ path: `${out}/${label}.png` });
    // Cross the soft picnic footprint through ordinary movement, then leave the gathering.
    await walk({ x: destination.x, z: destination.z }); await walk({ x: destination.x - 7, z: destination.z - 6 });
    report.views.push({ label, destination, start, route, runtime, actors: after.map(({ bones, ...rest }) => rest), end: await state() }); await page.close();
  }
  assert.deepEqual(report.errors, []); report.passed = true; console.log('TEST_PASSED:DoloresWeekend');
} catch (error) { report.failure = String(error); await page?.screenshot({ path: `${out}/failed.png` }).catch(() => {}); throw error; }
finally { for (const key of ['KeyW', 'Shift', 'ArrowLeft', 'ArrowRight']) await page?.keyboard.up(key).catch(() => {}); await browser?.close(); if (server) { server.httpServer.closeAllConnections(); await new Promise(done => server.httpServer.close(done)); } report.finishedAt = new Date().toISOString(); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n'); }
