/** Actual local game, public startup and physical controls; no pose/clock assignments. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { preview } from 'vite';
const out = resolve(process.env.GTASF_COFFEE_OUT ?? 'artifacts/city-life/coffee'); await mkdir(out, { recursive: true });
let base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173', server;
if (process.env.GTASF_COFFEE_APP) {
  server = await preview({ configFile: resolve('web/vite.config.ts'), root: resolve('web'), build: { outDir: resolve(process.env.GTASF_COFFEE_APP) }, preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } } });
  base = server.resolvedUrls.local[0];
}
const report = { startedAt: new Date().toISOString(), app: process.env.GTASF_COFFEE_APP ?? base, scope: 'Actual local coffee queue, counter contact, animated rigs and desktop/phone views; no device gate', errors: [], views: [], passed: false };
let browser, page;
async function openGame(phone = false) {
  page = await browser.newPage({ viewport: phone ? { width: 390, height: 844 } : { width: 1365, height: 900 }, isMobile: phone, hasTouch: phone }); page.setDefaultTimeout(45_000);
  page.on('pageerror', error => report.errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) report.errors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`); });
  const url = new URL(base); url.searchParams.set('preset', phone ? 'low' : 'medium');
  await page.goto(url.href); await page.waitForSelector('#world[data-ready="true"][data-connected="true"]'); await page.waitForSelector('#loading', { state: 'hidden' });
  const identity = page.locator('.gt-funding-onboarding[open]'); await identity.waitFor();
  await page.getByLabel('Startup name', { exact: true }).fill(`Coffee Round ${Date.now().toString(36)}`); await page.getByLabel('Your nickname', { exact: true }).fill('Coffee Visitor');
  await identity.getByRole('button', { name: 'Save startup', exact: true }).click(); await identity.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Game options', exact: true }).click(); await page.getByRole('button', { name: 'Find the coffee queue', exact: true }).click();
  await page.getByRole('dialog', { name: 'Game options', exact: true }).waitFor({ state: 'hidden', timeout: 5000 });
}
async function recordView(label) {
  const view = await page.evaluate(() => {
    const w = window.__gtasf.world, gl = document.querySelector('#world').getContext('webgl2'), debug = gl.getExtension('WEBGL_debug_renderer_info');
    return { capture: window.__gtasf.capture, connected: document.querySelector('#world').dataset.connected,
      renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
      mapErrors: [...w.map.stats.errors], directScene: w.coffeeQueue.root.parent === w.landmarks.parent };
  });
  assert.equal(view.capture, false); assert.equal(view.connected, 'true'); assert.equal(view.directScene, true); assert.deepEqual(view.mapErrors, []);
  report.views.push({ label, ...view }); await page.screenshot({ path: `${out}/${label}.png` });
}
const state = () => page.evaluate(() => { const w = window.__gtasf.world; return { foot: { ...w.foot }, yaw: w.camera.yaw }; });
const local = (x, z) => page.evaluate(({ x, z }) => { const p = window.__gtasf.world.landmarks.children.find(o => o.userData.landmarkId === 'ferry-building'); p.updateWorldMatrix(true, false); const v = p.position.clone().set(x, .18, z).applyMatrix4(p.matrixWorld); return { x: v.x, y: v.y, z: v.z }; }, { x, z });
const coffeeLocal = (x, z) => page.evaluate(({ x, z }) => { const w = window.__gtasf.world, cart = w.coffeeQueue.location, p = w.landmarks.children.find(o => o.userData.landmarkId === 'ferry-building'); p.updateWorldMatrix(true, false); const v = p.position.clone().set(cart.x + x, cart.y, cart.z + z).applyMatrix4(p.matrixWorld); return { x: v.x, y: v.y, z: v.z }; }, { x, z });
async function face(target) {
  for (let i = 0; i < 35; i++) {
    const s = await state(), a = Math.atan2(target.x - s.foot.x, target.z - s.foot.z) + Math.PI - s.yaw, delta = Math.atan2(Math.sin(a), Math.cos(a));
    if (Math.abs(delta) < .035) return;
    const key = delta > 0 ? 'ArrowLeft' : 'ArrowRight'; await page.keyboard.down(key); await page.waitForTimeout(Math.max(25, Math.min(400, Math.abs(delta) / 1.68 * 850))); await page.keyboard.up(key);
  } throw new Error('Unable to face coffee waypoint');
}
async function walk(point, radius = .5) {
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    const p = (await state()).foot, distance = Math.hypot(p.x - point.x, p.z - point.z); if (distance <= radius) return;
    await face(point); await page.keyboard.down('KeyW'); await page.keyboard.down('Shift'); await page.waitForTimeout(Math.min(600, Math.max(60, (distance - radius) / 6 * 750))); await page.keyboard.up('Shift'); await page.keyboard.up('KeyW');
  } throw new Error('Physical coffee approach was blocked');
}
try {
  browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  await openGame();
  report.cart = await page.evaluate(() => ({ ...window.__gtasf.world.coffeeQueue.location }));
  report.route = await page.evaluate(() => { const r = window.__gtasf.world.radar.route; return r && { approach: r.approach, distanceM: r.distanceM, points: r.points.length }; });
  assert.ok(report.route && report.route.points > 0, 'Coffee directions produce a real road route');
  // Use the open central aisle; the direct spawn-to-cart line crosses the parked courier.
  await walk(await local(0, 59)); await walk(await coffeeLocal(5.5, 9)); await face(await coffeeLocal(-.5, 1.5));
  assert.equal(await page.evaluate(() => !!window.__gtasf.world.landmarks.parent.getObjectByName('Ferry coffee queue')?.visible), true);
  const actorPose = () => page.evaluate(() => { const root = window.__gtasf.world.landmarks.parent.getObjectByName('Ferry coffee queue'); const actors = root.children.filter(o => o.name.startsWith('Coffee queue regular')); return actors.map(a => { let mesh; a.traverse(o => { if (o.isSkinnedMesh) mesh = o; }); return { visible:a.visible, bones:Array.from(mesh?.skeleton.boneMatrices ?? []), x:a.position.x, y:a.position.y, z:a.position.z }; }); });
  const before = await actorPose(); await page.waitForTimeout(900); const after = await actorPose();
  report.actors = { count: after.length, visible: after.filter(a=>a.visible).length, animated: before.some((a,i)=>a.bones.some((value,j)=>Math.abs(value-after[i].bones[j])>.00001)) };
  assert.equal(report.actors.count, 4, 'Medium tier creates exactly four finished characters');
  assert.equal(report.actors.visible, 4, 'All queue characters stand on loaded, clear ground');
  assert.ok(report.actors.animated, 'Real queue rigs animate with elapsed game time');
  await recordView('desktop');
  await walk(await coffeeLocal(0, 3)); await face(await coffeeLocal(0, -1)); await page.keyboard.down('KeyW'); await page.keyboard.down('Shift'); await page.waitForTimeout(1800); await page.keyboard.up('Shift'); await page.keyboard.up('KeyW');
  const blocked = await page.evaluate(() => { const w = window.__gtasf.world, p = w.landmarks.children.find(o => o.userData.landmarkId === 'ferry-building'); const v = p.position.clone().set(w.foot.x, w.foot.y, w.foot.z); p.worldToLocal(v); return { x: v.x, y: v.y, z: v.z }; });
  report.blocked = blocked; assert.ok(blocked.z >= report.cart.z + 1 && blocked.z < report.cart.z + 2, 'Coffee counter stops the direct physical approach');
  report.yielded = (await actorPose())[0].x;
  assert.ok(report.yielded < report.cart.x - .5, 'The first regular physically steps aside for the approaching player');
  // Pass inside the bollard line's gap, then between the counter and the façade.
  for (const [x, z] of [[3.4, 4], [3.4, -2], [0, -3]]) await walk(await coffeeLocal(x, z));
  report.walkedAround = await state(); await page.close();
  await openGame(true); await walk(await local(0, 59)); await walk(await coffeeLocal(5.5, 9)); await face(await coffeeLocal(-.5, 1.5));
  const phoneActors = await actorPose(); report.phoneActors = { count:phoneActors.length, visible:phoneActors.filter(a=>a.visible).length };
  assert.equal(report.phoneActors.count, 2, 'Fresh phone with low preset creates only two rigs');
  assert.equal(report.phoneActors.visible, 2, 'Both low-tier queue characters are visible');
  await recordView('phone');
  assert.deepEqual(report.errors, []); report.passed = true; console.log('TEST_PASSED:CoffeeQueue');
} catch (error) { report.failure = String(error); await page?.screenshot({ path: `${out}/failed.png` }).catch(() => {}); throw error; }
finally { for (const key of ['KeyW', 'Shift', 'ArrowLeft', 'ArrowRight']) await page?.keyboard.up(key).catch(() => {}); await browser?.close(); if (server) { server.httpServer.closeAllConnections(); await new Promise(done => server.httpServer.close(done)); } report.finishedAt = new Date().toISOString(); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n'); }
