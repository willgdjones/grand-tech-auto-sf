/** One native-game desktop/phone check. Uses real controls and server replies, never poses or a fixed clock. */
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { preview } from 'vite';

let base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173', server;
if (process.env.GTASF_POLISH_APP) {
  server = await preview({ configFile: resolve('web/vite.config.ts'), root: resolve('web'),
    build: { outDir: resolve(process.env.GTASF_POLISH_APP) },
    preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } } });
  base = server.resolvedUrls.local[0];
}
const url = new URL(process.env.GTASF_POLISH_SPAWN ?? '/?at=37.80199520213967,-122.41963019831591,87.8', base).href;
const out = process.env.GTASF_POLISH_OUT ?? 'artifacts/character-vehicle-polish';
await mkdir(out, { recursive: true });
const report = { startedAt: new Date().toISOString(), url, errors: [], httpErrors: [], steps: [], passed: false, corrections: 0 };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
const page = await context.newPage(); page.setDefaultTimeout(45_000);
page.on('pageerror', error => report.errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
page.on('response', response => { if (response.status() >= 400) report.httpErrors.push({ path: new URL(response.url()).pathname, status: response.status() }); });
page.on('websocket', socket => socket.on('framereceived', ({ payload }) => { if (Buffer.isBuffer(payload) && payload[0] === 0x89) report.corrections++; }));
async function state() {
  return page.evaluate(() => {
    const w = window.__gtasf.world, car = w.fleet.cars.get(w.vehicleId);
    const scene = [...w.fleet.cars.values()][0]?.model.root.parent;
    const avatar = car?.model.seat.children.find(child => child.name === 'on-foot-avatar') ?? scene?.children.find(child => child.name === 'on-foot-avatar' && Math.hypot(child.position.x - w.foot.x, child.position.z - w.foot.z) < .1);
    const colours = [];
    avatar?.traverse(object => { if (object.isMesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) if (material.name === 'Purple') colours.push(material.color.getHex()); });
    const road = w.map.nearestRoad(w.foot.x, w.foot.z, 100);
    return { ...document.querySelector('#world').dataset, pose: { ...w.foot }, outfit: Number(localStorage.getItem('gtasf.outfit') ?? 0), colours,
      roadDistance: road ? Math.hypot(road.x - w.foot.x, road.z - w.foot.z) : null,
      shadow: avatar?.getObjectByName('soft-contact-shadow')?.visible,
      avatarOpacity: w.camera.avatarOpacity, cameraBoom: w.camera.renderedBoom,
      chrome: !!car?.model.root.getObjectByName('chrome-front-bumper'),
      upperArm: avatar?.getObjectByName('UpperArmL')?.quaternion.toArray(),
      mapErrors: [...w.map.stats.errors] };
  });
}
async function checkpoint(name) {
  const data = await state(); report.steps.push({ name, data });
  await page.screenshot({ path: `${out}/${name}.png` });
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(`POLISH_STEP:${name}`); return data;
}
async function hold(keys, ms, name) {
  for (const key of keys) await page.keyboard.down(key);
  try { await page.waitForTimeout(ms); if (name) await checkpoint(name); } finally { for (const key of [...keys].reverse()) await page.keyboard.up(key); }
}
try {
  await page.goto(url);
  await page.waitForSelector('#world[data-ready="true"][data-connected="true"]');
  await page.locator('#loading').waitFor({ state: 'hidden' });
  const identity = page.locator('.gt-funding-onboarding[open]');
  await identity.waitFor();
  await page.getByLabel('Startup name', { exact: true }).fill(`Polish ${Date.now().toString(36)}`);
  await page.getByLabel('Your nickname', { exact: true }).fill('Polish Driver');
  await identity.getByRole('button', { name: 'Save startup', exact: true }).click();
  await identity.waitFor({ state: 'hidden' });
  // A road-centre link can intersect the parked body. Ordinary enter/exit places us beside its door.
  await page.keyboard.press('KeyE'); await page.waitForSelector('#world[data-mode="driver"]');
  await page.waitForTimeout(150);
  await page.keyboard.press('KeyE'); await page.waitForSelector('#world[data-mode="on-foot"]');
  await page.waitForTimeout(800);
  const initial = await checkpoint('desktop-idle');
  assert.equal(initial.shadow, true); assert.ok(initial.colours.length);
  assert.ok(initial.avatarOpacity > .95, 'Outfit evidence needs an unobscured avatar at the normal chase distance');
  const palettes = [initial.colours.join(',')];
  for (let i = 1; i < 4; i++) {
    await page.keyboard.press('KeyO'); await page.waitForTimeout(150);
    const outfit = await checkpoint(`desktop-outfit-${i}`);
    assert.equal(outfit.outfit, (initial.outfit + i) % 4); palettes.push(outfit.colours.join(','));
  }
  assert.equal(new Set(palettes).size, 4, 'All four outfit controls must change rendered clothing');
  await hold(['KeyW'], 200, 'desktop-walk');
  await hold(['Shift', 'KeyS'], 180, 'desktop-run');
  await page.keyboard.press('KeyE'); await page.waitForSelector('#world[data-mode="driver"]');
  await page.keyboard.press('KeyC'); await page.waitForTimeout(800);
  const seated = await checkpoint('desktop-driving-pose');
  assert.equal(seated.shadow, false); assert.equal(seated.chrome, true);
  // Stop by observed movement, so a busy shared laptop cannot skip a short timed key press.
  await page.keyboard.down('KeyW');
  try {
    await page.waitForFunction(origin => {
      const canvas = document.querySelector('#world');
      return Math.hypot(Number(canvas.dataset.x) - origin.x, Number(canvas.dataset.z) - origin.z) > 3;
    }, seated.pose, { timeout: 12_000 });
  } finally { await page.keyboard.up('KeyW'); }
  await hold(['KeyD', 'Space'], 220);
  await page.keyboard.down('Space');
  try { await page.waitForFunction(() => Number(document.querySelector('#world').dataset.speed) === 0, undefined, { timeout: 8000 }); }
  finally { await page.keyboard.up('Space'); }
  const stopped = await checkpoint('desktop-braked');
  assert.equal(Number(stopped.speed), 0, 'Handbrake stops the actual occupied car');
  assert.ok(Math.hypot(stopped.pose.x - seated.pose.x, stopped.pose.z - seated.pose.z) > 1);
  const beforeRecovery = report.corrections;
  await page.keyboard.press('KeyR');
  await page.waitForFunction(() => /road/i.test(document.querySelector('#trip-status').textContent));
  for (let i = 0; i < 40 && report.corrections === beforeRecovery; i++) await page.waitForTimeout(100);
  assert.ok(report.corrections > beforeRecovery, 'R must produce a real server correction');
  const recovered = await checkpoint('desktop-road-recovered');
  assert.equal(recovered.mode, 'driver'); assert.equal(Number(recovered.speed), 0);
  assert.ok(recovered.roadDistance < 4, 'Server returns the driver and car to the road');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Game options', exact: true }).click();
  const options = page.getByRole('dialog', { name: 'Game options', exact: true });
  await options.waitFor();
  const old = (await state()).outfit;
  await options.getByRole('button', { name: /^Outfit:/ }).click();
  assert.equal((await state()).outfit, (old + 1) % 4);
  // Global O/R are suppressed while the options dialog has focus.
  await page.keyboard.press('KeyO'); await page.keyboard.press('KeyR');
  assert.equal((await state()).outfit, (old + 1) % 4);
  await checkpoint('phone-options');
  await page.waitForTimeout(3200);
  const phoneBeforeRecovery = report.corrections;
  await options.getByRole('button', { name: 'Return to road · R', exact: true }).click();
  for (let i = 0; i < 40 && report.corrections === phoneBeforeRecovery; i++) await page.waitForTimeout(100);
  assert.ok(report.corrections > phoneBeforeRecovery, 'Phone recovery button reaches the server');
  await checkpoint('phone-car');
  await page.keyboard.press('KeyE'); await page.waitForSelector('#world[data-mode="on-foot"]');
  await page.waitForTimeout(800);
  await checkpoint('phone-avatar');
  assert.deepEqual(report.errors, []); assert.deepEqual(report.httpErrors, []);
  assert.deepEqual((await state()).mapErrors, []);
  report.passed = true;
} catch (error) {
  report.failure = String(error); report.failedState = await state().catch(() => null);
  await page.screenshot({ path: `${out}/failed.png` }).catch(() => {});
  console.error(report.failure); process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
  await browser.close(); console.log(`POLISH_REPORT:${out}/report.json`);
  if (server) { server.httpServer.closeAllConnections(); await new Promise(resolve => server.httpServer.close(resolve)); }
}
