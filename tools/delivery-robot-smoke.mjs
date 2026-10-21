/** Actual local game, public startup and physical controls; no pose/clock assignments. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { preview } from 'vite';
const out = resolve(process.env.GTASF_COURIER_OUT ?? 'artifacts/city-life/courier'); await mkdir(out, { recursive: true });
let base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173', server;
if (process.env.GTASF_COURIER_APP) {
  server = await preview({ configFile: resolve('web/vite.config.ts'), root: resolve('web'), build: { outDir: resolve(process.env.GTASF_COURIER_APP) }, preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } } });
  base = server.resolvedUrls.local[0];
}
const report = { startedAt: new Date().toISOString(), scope: 'Actual local courier prop, physical collision/clearance and desktop/phone layout; no device gate', errors: [], passed: false };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] }), page = await browser.newPage({ viewport: { width: 1365, height: 900 }, hasTouch: true }); page.setDefaultTimeout(45_000);
page.on('pageerror', error => report.errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
page.on('response', response => { if (response.status() >= 400) report.errors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`); });
const state = () => page.evaluate(() => { const w = window.__gtasf.world; return { foot: { ...w.foot }, yaw: w.camera.yaw }; });
const local = (x, z) => page.evaluate(({ x, z }) => { const p = window.__gtasf.world.landmarks.children.find(o => o.userData.landmarkId === 'ferry-building'); p.updateWorldMatrix(true, false); const v = p.position.clone().set(x, .18, z).applyMatrix4(p.matrixWorld); return { x: v.x, y: v.y, z: v.z }; }, { x, z });
async function face(target) {
  for (let i = 0; i < 35; i++) {
    const s = await state(), a = Math.atan2(target.x - s.foot.x, target.z - s.foot.z) + Math.PI - s.yaw, delta = Math.atan2(Math.sin(a), Math.cos(a));
    if (Math.abs(delta) < .035) return;
    const key = delta > 0 ? 'ArrowLeft' : 'ArrowRight'; await page.keyboard.down(key); await page.waitForTimeout(Math.max(25, Math.min(400, Math.abs(delta) / 1.68 * 850))); await page.keyboard.up(key);
  } throw new Error('Unable to face courier waypoint');
}
async function walk(point, radius = .5) {
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    const p = (await state()).foot, distance = Math.hypot(p.x - point.x, p.z - point.z); if (distance <= radius) return;
    await face(point); await page.keyboard.down('KeyW'); await page.keyboard.down('Shift'); await page.waitForTimeout(Math.min(600, Math.max(60, (distance - radius) / 6 * 750))); await page.keyboard.up('Shift'); await page.keyboard.up('KeyW');
  } throw new Error('Physical courier approach was blocked');
}
try {
  await page.goto(base); await page.waitForSelector('#world[data-ready="true"][data-connected="true"]'); await page.waitForSelector('#loading', { state: 'hidden' });
  const identity = page.locator('.gt-funding-onboarding[open]'); await identity.waitFor();
  await page.getByLabel('Startup name', { exact: true }).fill(`Soup Round ${Date.now().toString(36)}`); await page.getByLabel('Your nickname', { exact: true }).fill('Courier Visitor');
  await identity.getByRole('button', { name: 'Save startup', exact: true }).click(); await identity.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Game options', exact: true }).click(); await page.getByRole('button', { name: 'Find the delivery robot', exact: true }).click();
  await page.getByRole('dialog', { name: 'Game options', exact: true }).waitFor({ state: 'hidden', timeout: 5000 });
  report.route = await page.evaluate(() => { const r = window.__gtasf.world.radar.route; return r && { approach: r.approach, distanceM: r.distanceM, points: r.points.length }; });
  assert.ok(report.route && report.route.points > 0, 'Courier directions produce a real road route');
  await walk(await local(-18.5, 70)); await face(await local(-15, 66.5));
  assert.equal(await page.evaluate(() => !!window.__gtasf.world.landmarks.parent.getObjectByName('Six-wheel delivery robot')?.visible), true);
  await page.screenshot({ path: `${out}/desktop.png` }); await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: `${out}/phone.png` }); await page.setViewportSize({ width: 1365, height: 900 });
  await walk(await local(-16, 71)); await face(await local(-16, 67)); await page.keyboard.down('KeyW'); await page.keyboard.down('Shift'); await page.waitForTimeout(1800); await page.keyboard.up('Shift'); await page.keyboard.up('KeyW');
  const blocked = await page.evaluate(() => { const w = window.__gtasf.world, p = w.landmarks.children.find(o => o.userData.landmarkId === 'ferry-building'); const v = p.position.clone().set(w.foot.x, w.foot.y, w.foot.z); p.worldToLocal(v); return { x: v.x, y: v.y, z: v.z }; });
  report.blocked = blocked; assert.ok(blocked.z >= 68 && blocked.z < 69, 'Body stops the direct physical approach');
  for (const [x, z] of [[-18, 70], [-18, 66], [-16, 64.5]]) await walk(await local(x, z));
  report.walkedAround = await state(); assert.deepEqual(report.errors, []); report.passed = true; console.log('TEST_PASSED:DeliveryRobot');
} catch (error) { report.failure = String(error); await page.screenshot({ path: `${out}/failed.png` }).catch(() => {}); throw error; }
finally { for (const key of ['KeyW', 'Shift', 'ArrowLeft', 'ArrowRight']) await page.keyboard.up(key).catch(() => {}); await browser.close(); if (server) { server.httpServer.closeAllConnections(); await new Promise(done => server.httpServer.close(done)); } report.finishedAt = new Date().toISOString(); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n'); }
