/** Real local game, public deep link and physical keyboard walking. No pose/clock changes. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { preview } from 'vite';
let base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173', server;
const out = process.env.GTASF_CITY_LIFE_OUT ?? 'artifacts/city-life/game';
const pierOnly = process.env.GTASF_CITY_LIFE_PIER_ONLY === '1';
const ferryOnly = process.env.GTASF_CITY_LIFE_FERRY_ONLY === '1';
const checkGps = process.env.GTASF_CITY_LIFE_GPS_CHECK === '1';
const checkRadarArrival = process.env.GTASF_CITY_LIFE_RADAR_ARRIVAL === '1';
assert.ok(!(pierOnly && ferryOnly), 'Choose one bounded city area');
await mkdir(out, { recursive: true });
if (process.env.GTASF_CITY_LIFE_APP) {
  server = await preview({ configFile: resolve('web/vite.config.ts'), root: resolve('web'), build: { outDir: resolve(process.env.GTASF_CITY_LIFE_APP) },
    preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } } }); base = server.resolvedUrls.local[0];
}
const report = { startedAt: new Date().toISOString(), scope: 'Actual local game controls and source landmark placements; no device/performance gate', pierOnly, ferryOnly, checkGps, errors: [], httpErrors: [], steps: [], passed: false };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, hasTouch: true });
const page = await context.newPage(); page.setDefaultTimeout(45_000);
page.on('pageerror', error => report.errors.push(error.message)); page.on('console', msg => { if (msg.type() === 'error') report.errors.push(msg.text()); });
page.on('response', response => { if (response.status() >= 400) report.httpErrors.push({ path: new URL(response.url()).pathname, status: response.status() }); });
const angle = a => Math.atan2(Math.sin(a), Math.cos(a));
async function state() { return page.evaluate(() => { const w = window.__gtasf.world; return { foot: { ...w.foot }, yaw: w.camera.yaw, mode: w.mode, mapErrors: [...w.map.stats.errors] }; }); }
async function local(id, x, z) { return page.evaluate(({ id, x, z }) => { const p = window.__gtasf.world.landmarks.children.find(o => o.userData.landmarkId === id); p.updateWorldMatrix(true, false); const v = p.position.clone().set(x, 0, z).applyMatrix4(p.matrixWorld); return { x: v.x, y: v.y, z: v.z }; }, { id, x, z }); }
async function face(target) {
  for (let i = 0; i < 30; i++) { const s = await state(), delta = angle(Math.atan2(target.x - s.foot.x, target.z - s.foot.z) + Math.PI - s.yaw); if (Math.abs(delta) < .055) return;
    const key = delta > 0 ? 'ArrowLeft' : 'ArrowRight'; await page.keyboard.down(key); await page.waitForTimeout(Math.max(35, Math.min(500, Math.abs(delta) / 1.68 * 850))); await page.keyboard.up(key); await page.waitForTimeout(70);
  } throw new Error('Camera could not face city stop');
}
async function walk(target, radius = 2.5, maxMs = 50_000) {
  const until = Date.now() + maxMs; let previous = (await state()).foot, changed = Date.now();
  while (Date.now() < until) {
    const s = await state(), distance = Math.hypot(s.foot.x - target.x, s.foot.z - target.z); if (distance <= radius) return;
    await face(target); await page.keyboard.down('KeyW'); await page.keyboard.down('Shift');
    await page.waitForTimeout(Math.min(1000, Math.max(70, (distance - radius) / 6 * 700))); await page.keyboard.up('Shift'); await page.keyboard.up('KeyW');
    const next = (await state()).foot; if (Math.hypot(next.x - previous.x, next.z - previous.z) > .15) { previous = next; changed = Date.now(); }
    if (Date.now() - changed > 3500) throw new Error(`City route blocked ${distance.toFixed(1)}m from target`);
  } throw new Error('City stop walk timed out');
}
async function enter(url) {
  await page.goto(url); await page.waitForSelector('#world[data-ready="true"][data-connected="true"]'); await page.waitForSelector('#loading', { state: 'hidden' });
  const identity = page.locator('.gt-funding-onboarding[open]');
  if (await identity.isVisible()) { await page.getByLabel('Startup name', { exact: true }).fill(`City Life ${Date.now().toString(36)}`); await page.getByLabel('Your nickname', { exact: true }).fill('City Visitor'); await identity.getByRole('button', { name: 'Save startup', exact: true }).click(); await identity.waitFor({ state: 'hidden' }); }
}
async function record(name) {
  const data = await state(); report.steps.push({ name, data }); assert.deepEqual(data.mapErrors, []);
  await page.screenshot({ path: `${out}/${name}-desktop.png` }); await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${out}/${name}-phone.png` }); await page.setViewportSize({ width: 1365, height: 900 });
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n'); console.log(`CITY_LIFE_STEP:${name}`);
}
async function chooseStop(name) {
  await page.getByRole('button', { name: 'Game options', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
  await page.getByRole('dialog', { name: 'Game options', exact: true }).waitFor({ state: 'hidden', timeout: 5000 });
  const route = await page.evaluate(() => { const r = window.__gtasf.world.radar.route; return r && { approach: r.approach, distanceM: r.distanceM, points: r.points.length }; });
  assert.ok(route && route.points > 0, 'City stop directions produce a real road route');
  report.steps.push({ name, route });
}
async function reachedStop(name, target) {
  const foot = (await state()).foot;
  assert.ok(Math.hypot(foot.x - target.x, foot.z - target.z) < 8, 'Physical walk reaches the exact local stop');
  await page.waitForFunction(() => {
    const guidance = window.__gtasf.world.guidance;
    return guidance.element.hidden && !guidance.root.getObjectByName('GPS destination').visible
      && !guidance.root.getObjectByName('GPS route ribbon').visible;
  }, undefined, { timeout: 5000 });
  if (checkRadarArrival) await page.waitForFunction(() => window.__gtasf.world.radar.element.querySelector('.gt-radar-navigation').hidden);
  report.steps.push({ name: `arrived-${name}`, foot, target, gpsHidden: true, markerHidden: true, ribbonHidden: true, ...(checkRadarArrival ? { radarNavigationHidden: true } : {}) });
}
try {
  if (!pierOnly) {
    await enter(base);
    await chooseStop('Find the coned robotaxi');
    await walk(await local('ferry-building', 25, 69), 2); await face(await local('ferry-building', 25, 64));
    assert.equal(await page.evaluate(() => !!window.__gtasf.world.landmarks.parent.getObjectByName('Coned robotaxi')), true);
    if (checkGps) await reachedStop('coned-robotaxi', await local('ferry-building', 25, 64));
    await record('coned-robotaxi');
    if (checkGps) await chooseStop('Find the Muni-late banner');
    await walk(await local('ferry-building', 0, 73)); await walk(await local('ferry-building', -35, 81), 1.5); await face(await local('ferry-building', -35, 76));
    if (checkGps) await reachedStop('muni-late-banner', await local('ferry-building', -35, 76));
    await record('muni-late-banner');
    if (!ferryOnly) await chooseStop('Visit the Pier 39 sea lions');
  }
  if (!ferryOnly) {
  // Public deep-link entry reaches the real sourced waterfront road; then walk onto the actual pier.
  await enter(new URL('/?at=37.8080612,-122.4098805,0', base).href);
  // The approach starts 25 m outside the authored apron; both crossings exercise its real quay seam.
  for (const [x, z] of [[0, 220], [0, 205], [0, 184], [0, 145], [-41, 145], [-42, 105], [-42, 55], [-42, 4], [-43, -62]]) await walk(await local('pier-39', x, z), 1.5);
  // This gap between shop gables keeps both the sign and rear camera clear of the viewing axis.
  await walk(await local('pier-39', -43, -62), .25);
  await face(await local('pier-39', -65, -62));
  const head = () => page.evaluate(() => window.__gtasf.world.landmarks.getObjectByName('Sea lion head and whiskers')?.rotation.toArray());
  const before = await head(); assert.ok(before); await page.waitForTimeout(800); assert.notDeepEqual(await head(), before, 'Sea lions animate in the actual game loop');
  await record('pier39-sea-lions');
  // Return on the same clear outer boardwalk; no collider/pose bypass.
  for (const [x, z] of [[-42, 4], [-42, 55], [-42, 105], [-41, 145], [0, 145], [0, 184], [0, 205], [0, 220]]) await walk(await local('pier-39', x, z), 1.5);
  await record('pier39-exit');
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.httpErrors, []); report.passed = true; console.log('TEST_PASSED:CityLifeGame');
} catch (error) { report.failure = String(error); await page.screenshot({ path: `${out}/failed.png` }).catch(() => {}); throw error;
} finally { for (const key of ['KeyW', 'Shift', 'ArrowLeft', 'ArrowRight']) await page.keyboard.up(key).catch(() => {}); await browser.close();
  if (server) { server.httpServer.closeAllConnections(); await new Promise(done => server.httpServer.close(done)); }
  report.finishedAt = new Date().toISOString(); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n'); }
