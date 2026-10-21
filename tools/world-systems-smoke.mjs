/** Actual desktop/phone controls and server boarding; no injected poses, packets or clock. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { preview } from 'vite';

const out = resolve(process.env.GTASF_WORLD_SMOKE_OUT ?? 'artifacts/world-systems/game');
await mkdir(out, { recursive: true });
const codecFile = `${out}/inspection.mjs`;
await build({ stdin: { contents: `export {decodeC2S} from './shared/protocol/c2s.ts';
export {decodeS2C} from './shared/protocol/s2c.ts';
export {cableCarIds,sampleCableCar} from './shared/transit/cableCars.ts';
export {worldToGeodetic} from './tools/map/src/geo.ts'; export {SF_FRAME} from './tools/map/src/config.ts';`,
  resolveDir: resolve('.'), loader: 'ts' }, bundle: true, platform: 'node', format: 'esm', outfile: codecFile, logLevel: 'error' });
const { decodeC2S, decodeS2C, cableCarIds, sampleCableCar, worldToGeodetic, SF_FRAME } = await import(pathToFileURL(codecFile).href);
const report = { at: new Date().toISOString(), app: process.env.GTASF_WORLD_APP ?? null,
  mapArea: process.env.GTASF_MAP_AREA ?? 'active local map', errors: [], httpErrors: [], profiles: [], passed: false };
let base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173', browser, server;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
async function inspect(page) {
  return page.evaluate(() => {
    const w = window.__gtasf.world, car = w.fleet.cars.get(w.vehicleId);
    return { foot: { ...w.foot }, mode: w.mode, vehicleId: w.vehicleId, cruise: w.fleet.cruiseMode,
      cars: [...w.fleet.cars.values()].map(c => ({ id: c.data.id, kind: c.data.kind, flags: c.data.flags,
        visible: c.model.root.visible, speed: c.data.speedCmps, x: c.model.root.position.x, y: c.model.root.position.y, z: c.model.root.position.z })),
      car: car ? { x: car.model.root.position.x, y: car.model.root.position.y, z: car.model.root.position.z } : null,
      ground: car ? w.map.surfaceHeightAt(car.model.root.position.x, car.model.root.position.z, car.model.root.position.y) : null,
      prompt: document.querySelector('#prompt').textContent,
      routePoints: w.radar.route?.points.length ?? 0,
      gps: w.guidance.element.textContent, mapErrors: [...w.map.stats.errors],
      ready: document.querySelector('#world').dataset.ready, connected: document.querySelector('#world').dataset.connected };
  });
}
async function boot(page, url, name) {
  await page.goto(url);
  await page.waitForFunction(() => window.__gtasf?.ready || document.querySelector('#loading.failed'));
  const error = await page.locator('#loading.failed').count() ? await page.locator('#loading-detail').innerText() : null;
  assert.equal(error, null, error ?? 'World boot');
  await page.waitForSelector('#world[data-ready="true"][data-connected="true"]');
  await page.waitForSelector('#loading', { state: 'hidden' });
  await page.waitForFunction(() => !!window.__gtasf.world.funding?.profile);
  const identity = page.locator('.gt-funding-onboarding[open]');
  if (await identity.isVisible()) {
    await page.getByLabel('Startup name', { exact: true }).fill(`Transit ${name} ${Date.now().toString(36)}`);
    await page.getByLabel('Your nickname', { exact: true }).fill(`Transit ${name}`);
    await identity.getByRole('button', { name: 'Save startup', exact: true }).click();
    await identity.waitFor({ state: 'hidden' });
  }
  assert.equal(await page.evaluate(() => window.__gtasf.capture), false);
}
function observe(page, entry) {
  page.on('pageerror', e => report.errors.push({ profile: entry.name, message: e.message }));
  page.on('console', e => { if (e.type() === 'error') report.errors.push({ profile: entry.name, message: e.text() }); });
  page.on('response', r => { if (r.status() >= 400) report.httpErrors.push({ profile: entry.name, path: new URL(r.url()).pathname, status: r.status() }); });
  page.on('websocket', socket => {
    if (new URL(socket.url()).pathname !== '/api/world') return;
    socket.on('framereceived', frame => {
      if (typeof frame.payload === 'string') return;
      const decoded = decodeS2C(frame.payload);
      if (!decoded.ok) { report.errors.push({ profile: entry.name, message: 'Invalid native S2C frame' }); return; }
      const m = decoded.msg;
      // Never retain resume tokens, HELLO identities, grants or cookies.
      if (m.type === 'WELCOME') entry.welcomes.push({ id: m.id, pose: m.pose });
      if (m.type === 'VEHICLE_STATE') entry.seats.push(m);
    });
    socket.on('framesent', frame => {
      if (typeof frame.payload === 'string') return;
      const decoded = decodeC2S(frame.payload);
      if (!decoded.ok) { report.errors.push({ profile: entry.name, message: 'Invalid native C2S frame' }); return; }
      if (['VEHICLE_ENTER', 'VEHICLE_EXIT', 'VEHICLE_MOVE'].includes(decoded.msg.type)) entry.sent.push(decoded.msg);
    });
  });
}
async function trafficOptions(page, entry) {
  await page.waitForFunction(() => [...window.__gtasf.world.fleet.cars.values()].some(c => (c.data.flags & 0x20) && c.data.speedCmps > 0));
  await page.getByRole('button', { name: 'Game options', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Game options', exact: true }); await dialog.waitFor();
  assert.equal(await dialog.getByRole('button', { name: /GPS to stop/ }).count(), 3);
  const checkbox = dialog.getByRole('checkbox', { name: 'Cruise mode', exact: true });
  await checkbox.check();
  await page.waitForFunction(() => window.__gtasf.world.fleet.cruiseMode && [...window.__gtasf.world.fleet.cars.values()]
    .filter(c => c.data.flags & 0x20).every(c => !c.model.root.visible));
  entry.cruise = await inspect(page);
  assert(entry.cruise.cars.filter(c => c.flags & 0x20).length > 0);
  assert(entry.cruise.cars.filter(c => !(c.flags & 0x20)).every(c => c.visible), 'Cruise preserves player cars, taxis and cable cars');
  assert.equal(await page.evaluate(() => localStorage.getItem('gtasf-cruise-mode')), '1');
  await page.screenshot({ path: `${out}/${entry.name}-options.png` });
  await dialog.getByRole('button', { name: 'California · GPS to stop', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForFunction(() => window.__gtasf.world.radar.route?.points.length > 1 && window.__gtasf.world.guidance.element.textContent.includes('California'));
  entry.gps = await inspect(page);
  await page.screenshot({ path: `${out}/${entry.name}-gps.png` });
}
function nextBoarding(line) {
  const now = Date.now();
  // Public location links take us to a real upcoming stop. The car still runs on
  // wall time, and boarding below uses only the actual E/touch action.
  for (let delay = 45_000; delay < 150_000; delay += 500) {
    for (const id of cableCarIds) {
      const state = sampleCableCar(id, now + delay);
      if (state.line === line && state.boarding && sampleCableCar(id, now + delay + 5000).boarding) return { ...state, arrivesAt: now + delay };
    }
  }
  throw new Error(`No upcoming ${line} boarding window`);
}
async function ride(page, entry, line, touch) {
  const target = nextBoarding(line), geo = worldToGeodetic(target.entry.x / 100, target.entry.z / 100, SF_FRAME);
  const url = new URL(base); url.searchParams.set('at', `${geo.lat},${geo.lon},${(540 - target.entry.yaw / 256 * 360) % 360}`);
  if (touch) url.searchParams.set('touch', '1');
  const ride = { line, carId: target.entry.id, stop: target.stop, selectedAt: new Date().toISOString(),
    scheduledAt: target.arrivesAt, location: url.href, target: target.entry, initial: null, samples: [] };
  entry.rides.push(ride);
  await boot(page, url.href, entry.name);
  const initial = await inspect(page);
  ride.initial = initial;
  assert(initial.cruise, 'Cruise preference persists through public location navigation');
  assert(distance(initial.foot, { x: target.entry.x / 100, z: target.entry.z / 100 }) < 5.5, 'Location link lands within boarding distance of the real stop');
  await page.waitForFunction(id => {
    const w = window.__gtasf.world, car = w.fleet.cars.get(id);
    return car && car.data.speedCmps === 0 && Math.hypot(car.model.root.position.x - w.foot.x, car.model.root.position.z - w.foot.z) < 5.5;
  }, target.entry.id, { timeout: 160_000 });
  assert.match((await inspect(page)).prompt, /Board cable car/);
  const sentBefore = entry.sent.length;
  if (touch) await page.locator('.gtasf-touch [data-action="enter-exit"]').tap();
  else await page.keyboard.press('KeyE');
  await page.waitForSelector('#world[data-mode="passenger"]');
  ride.boarded = await inspect(page);
  assert.equal(ride.boarded.vehicleId, target.entry.id);
  assert(entry.seats.some(s => s.playerId === entry.welcomes.at(-1).id && s.vehicleId === target.entry.id && s.mode === 'passenger'));
  assert(entry.sent.slice(sentBefore).some(s => s.type === 'VEHICLE_ENTER' && s.vehicleId === target.entry.id));
  if (!touch) { await page.keyboard.down('KeyW'); await page.keyboard.down('KeyA'); }
  else {
    await page.waitForSelector('.gtasf-touch[data-mode="passenger"]');
    assert.deepEqual(await page.locator('.gtasf-touch button:visible').allTextContents(), ['Exit ride', 'Bell', 'Map']);
    assert.equal(await page.locator('.gtasf-touch .stick').isVisible(), false);
    const cdp = await page.context().newCDPSession(page);
    const before = await page.evaluate(() => window.__gtasf.world.camera.yaw);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 170, y: 300, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 220, y: 300, id: 1 }] });
    await page.waitForFunction(yaw => Math.abs(window.__gtasf.world.camera.yaw - yaw) > .05, before);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    ride.touchLook = { before, after: await page.evaluate(() => window.__gtasf.world.camera.yaw) };
    await page.getByRole('button', { name: 'Bell', exact: true }).tap();
    await page.locator('.gtasf-touch [data-action="map"]').tap();
    await page.waitForFunction(() => window.__gtasf.world.radar.isExpanded);
    await page.getByRole('button', { name: 'Close event map', exact: true }).tap();
    await page.waitForFunction(() => !window.__gtasf.world.radar.isExpanded);
    await cdp.detach();
  }
  const until = Date.now() + 15_000;
  while (Date.now() < until) { ride.samples.push(await inspect(page)); await page.waitForTimeout(250); }
  if (!touch) { await page.keyboard.up('KeyW'); await page.keyboard.up('KeyA'); }
  ride.after = await inspect(page);
  assert.equal(ride.after.mode, 'passenger');
  assert(distance(ride.boarded.foot, ride.after.foot) > 8, 'Cable car travels on the live clock');
  assert(ride.samples.every(s => s.car && distance(s.foot, s.car) < .001 && Math.abs(s.foot.y - s.car.y) < .001), 'Passenger stays attached to cable car');
  assert(ride.samples.every(s => s.ground !== null && Math.abs(s.car.y - s.ground) < 1), 'Cable car follows loaded road ground');
  assert.equal(entry.sent.slice(sentBefore).filter(s => s.type === 'VEHICLE_MOVE').length, 0, 'Passenger controls never send steering');
  await page.screenshot({ path: `${out}/${entry.name}-${line}-riding.png` });
  if (touch) await page.getByRole('button', { name: 'Exit ride', exact: true }).tap();
  else await page.keyboard.press('KeyE');
  await page.waitForSelector('#world[data-mode="on-foot"]');
  ride.exited = await inspect(page);
  if (touch) {
    await page.waitForSelector('.gtasf-touch[data-mode="on-foot"]');
    assert.equal(await page.locator('.gtasf-touch .stick').isVisible(), true);
    assert.deepEqual(await page.locator('.gtasf-touch button:visible').allTextContents(), ['Enter / exit', 'Hail', 'Map']);
    await page.screenshot({ path: `${out}/${entry.name}-${line}-exited.png` });
  }
  assert(entry.sent.slice(sentBefore).some(s => s.type === 'VEHICLE_EXIT' && s.vehicleId === target.entry.id));
  assert.deepEqual(ride.exited.mapErrors, []);
  console.log(`WORLD_GAME:${entry.name} ${line} ride and exit passed`);
}
try {
  if (process.env.GTASF_WORLD_APP) {
    server = await preview({ configFile: resolve('web/vite.config.ts'), root: resolve('web'), build: { outDir: resolve(process.env.GTASF_WORLD_APP) },
      preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } } });
    base = server.resolvedUrls.local[0];
  }
  assert(['127.0.0.1', 'localhost'].includes(new URL(base).hostname), 'This smoke uses the local native game');
  const health = await (await fetch(new URL('/api/health', base))).json();
  assert(health.flags.traffic && health.flags.cableCars, 'Native world traffic/cable flags enabled');
  report.flags = health.flags;
  browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  const profiles = [
    { name: 'desktop', viewport: { width: 1365, height: 900 }, lines: ['PH', 'C'], touch: false },
    { name: 'phone', viewport: { width: 393, height: 852 }, lines: ['PM'], touch: true },
  ].filter(profile => !process.env.GTASF_WORLD_PROFILE || process.env.GTASF_WORLD_PROFILE === profile.name);
  assert(profiles.length > 0, 'GTASF_WORLD_PROFILE must be desktop or phone');
  for (const profile of profiles) {
    const context = await browser.newContext({ viewport: profile.viewport, deviceScaleFactor: 1, isMobile: profile.touch, hasTouch: profile.touch });
    const page = await context.newPage(); page.setDefaultTimeout(45_000);
    const entry = { name: profile.name, viewport: profile.viewport, welcomes: [], sent: [], seats: [], rides: [] }; report.profiles.push(entry); observe(page, entry);
    try {
      await boot(page, `${base}${profile.touch ? '?touch=1' : ''}`, profile.name);
      await trafficOptions(page, entry);
      for (const line of profile.lines) await ride(page, entry, line, profile.touch);
      assert.deepEqual((await inspect(page)).mapErrors, []);
    } catch (e) { await page.screenshot({ path: `${out}/${profile.name}-failed.png` }).catch(() => {}); throw e; }
    finally { await context.close(); }
  }
  assert.deepEqual(report.errors, []); assert.deepEqual(report.httpErrors, []); report.passed = true;
} catch (e) { report.failure = e.stack ?? String(e); throw e; }
finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
  await browser?.close();
  if (server) { server.httpServer.closeAllConnections(); await new Promise(resolve => server.httpServer.close(resolve)); }
  console.log(JSON.stringify({ passed: report.passed, out, failure: report.failure }));
}
