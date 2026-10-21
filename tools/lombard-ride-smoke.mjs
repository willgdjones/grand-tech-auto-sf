/** Real two-player Lombard ride. Observe native packets; never inject poses or trips. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { decodeS2C } from '../shared/protocol/s2c.ts';
import { decodeC2S } from '../shared/protocol/c2s.ts';

const out = resolve(process.env.GTASF_LOMBARD_OUT ?? 'artifacts/lombard-ride');
await mkdir(out, { recursive: true });
const report = { checkedAt: new Date().toISOString(), errors: [], httpErrors: [], peers: {}, movement: [], ride: [], passed: false };
let server, browser;
const pages = [];
function observe(page, name) {
  const wire = { welcomes: [], sent: [], taxi: [], seats: [], latestPeers: new Map(), snapshots: 0 };
  report.peers[name] = wire;
  page.on('pageerror', error => report.errors.push({ name, message: error.message }));
  page.on('console', message => { if (message.type() === 'error') report.errors.push({ name, message: message.text() }); });
  page.on('response', response => { if (response.status() >= 400) report.httpErrors.push({ name, path: new URL(response.url()).pathname, status: response.status() }); });
  page.on('websocket', socket => {
    if (new URL(socket.url()).pathname !== '/api/world') return;
    socket.on('framereceived', frame => {
      if (typeof frame.payload === 'string') return;
      const result = decodeS2C(frame.payload); if (!result.ok) return;
      const m = result.msg;
      // Explicitly exclude resume tokens, cookies and HELLO identity/auth fields.
      if (m.type === 'WELCOME') wire.welcomes.push({ id: m.id, resumed: m.resumed, pose: m.pose });
      if (m.type === 'SNAPSHOT') { wire.snapshots++; for (const entry of m.entries) wire.latestPeers.set(entry.id, entry); }
      if (m.type === 'ROBOTAXI_STATE') wire.taxi.push({ ...m, observedAt: Date.now() });
      if (m.type === 'VEHICLE_STATE') wire.seats.push(m);
    });
    socket.on('framesent', frame => {
      if (typeof frame.payload === 'string') return;
      const result = decodeC2S(frame.payload); if (!result.ok) return;
      if (['ROBOTAXI_HAIL', 'ROBOTAXI_CANCEL', 'VEHICLE_MOVE'].includes(result.msg.type)) wire.sent.push(result.msg);
    });
  });
  return wire;
}
async function state(page) {
  return page.evaluate(() => {
    const w = window.__gtasf.world, foot = { ...w.foot }, car = w.fleet.cars.get(w.vehicleId);
    const first = w.fleet.cars.values().next().value;
    let scene = first?.model.root; while (scene?.parent) scene = scene.parent;
    const avatars = [];
    scene?.traverse(object => {
      if (object.name !== 'on-foot-avatar' || !object.visible) return;
      const p = object.getWorldPosition(object.position.clone());
      avatars.push({ x: p.x, y: p.y, z: p.z });
    });
    const ground = w.map.surfaceHeightAt(foot.x, foot.z, foot.y);
    const road = w.map.nearestRoad(foot.x, foot.z, 20);
    return { foot, mode: w.mode, vehicleId: w.vehicleId, taxi: w.taxi.state, avatars, ground,
      road: road ? { x: road.x, y: road.y, z: road.z } : null,
      car: car ? { x: car.model.root.position.x, y: car.model.root.position.y, z: car.model.root.position.z,
        pitch: car.model.root.rotation.x, roll: car.model.root.rotation.z } : null,
      camera: w.camera.camera.position.toArray(), population: document.querySelector('#population')?.textContent,
      trip: document.querySelector('#trip-status')?.textContent, mapErrors: [...w.map.stats.errors] };
  });
}
const horizontal = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
async function boot(page, name, url) {
  page.setDefaultTimeout(45_000);
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket;
    window.__lombardSockets = [];
    window.WebSocket = class extends NativeWebSocket {
      constructor(...args) { super(...args); if (new URL(String(args[0]), location.href).pathname === '/api/world') window.__lombardSockets.push(this); }
    };
  });
  await page.goto(url);
  await page.waitForSelector('#world[data-ready="true"][data-connected="true"]');
  await page.waitForSelector('#loading', { state: 'hidden' });
  const identity = page.locator('.gt-funding-onboarding[open]');
  if (await identity.isVisible()) {
    await page.getByLabel('Startup name', { exact: true }).fill(`Lombard ${name} ${Date.now().toString(36)}`);
    await page.getByLabel('Your nickname', { exact: true }).fill(name);
    await identity.getByRole('button', { name: 'Save startup', exact: true }).click();
    await identity.waitFor({ state: 'hidden' });
  }
  await page.evaluate(() => document.activeElement?.blur());
}
async function checkMovement(mover, watcher, moverWire, watcherWire, key, duration) {
  await mover.bringToFront();
  const before = await state(mover), watchBefore = await state(watcher);
  await mover.keyboard.down(key); await mover.waitForTimeout(duration); await mover.keyboard.up(key);
  await mover.waitForTimeout(900);
  const after = await state(mover), watchAfter = await state(watcher);
  const id = moverWire.welcomes.at(-1).id, pose = watcherWire.latestPeers.get(id);
  assert.ok(horizontal(before.foot, after.foot) > .2, 'Physical keyboard moves the player');
  assert.ok(pose, 'Other browser receives this player in actual snapshots');
  const wirePoint = { x: pose.x / 100, z: pose.z / 100 };
  assert.ok(horizontal(wirePoint, after.foot) < .5, 'Observed wire pose follows the moving player');
  const candidates = watchAfter.avatars.filter(p => horizontal(p, watchAfter.foot) > .15);
  assert.ok(candidates.some(p => horizontal(p, after.foot) < .5), 'Other browser renders the moved avatar');
  assert.ok(watchAfter.avatars.length >= 2, 'Both rendered avatars are present');
  report.movement.push({ key, before: before.foot, after: after.foot, wirePoint, watchBefore: watchBefore.avatars, watchAfter: watchAfter.avatars });
}
try {
  let url = process.env.GTASF_SMOKE_URL;
  if (!url && process.env.GTASF_LOMBARD_APP) {
    const app = resolve(process.env.GTASF_LOMBARD_APP);
    server = await preview({ configFile: resolve('web/vite.config.ts'), root: resolve('web'), build: { outDir: app },
      preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } } });
    url = `${server.resolvedUrls.local[0]}go/lombard`;
    report.frozenApp = app;
  }
  url ??= 'http://127.0.0.1:5173/go/lombard';
  const safeUrl = new URL(url); safeUrl.searchParams.delete('invite'); report.url = safeUrl.href;
  browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
  const wires = [];
  for (const name of ['Rider', 'Observer']) {
    const context = await browser.newContext({ viewport: { width: 1120, height: 760 }, deviceScaleFactor: 1 });
    if (process.env.GTASF_INVITE_FILE) {
      const code = (await readFile(process.env.GTASF_INVITE_FILE, 'utf8')).trim();
      const response = await context.request.post(new URL('/api/invite', url).href, { data: { code } });
      assert.equal(response.status(), 200, 'Invite accepted without placing credentials in URLs');
    }
    const page = await context.newPage(); pages.push(page); wires.push(observe(page, name));
    await boot(page, name, url);
  }
  const [rider, observer] = pages, [riderWire, observerWire] = wires;
  await rider.waitForTimeout(1000);
  assert.notEqual(riderWire.welcomes[0].id, observerWire.welcomes[0].id);
  await checkMovement(observer, rider, observerWire, riderWire, 'KeyD', 550);
  await checkMovement(rider, observer, riderWire, observerWire, 'KeyW', 200);
  await observer.screenshot({ path: `${out}/two-players.png` });
  console.log('Two real players receive and render each other moving.');
  await rider.bringToFront();
  await rider.keyboard.press('KeyH');
  await rider.waitForSelector('#world[data-taxi-state="pickup"]');
  report.pickup = await state(rider);
  await rider.waitForSelector('#world[data-mode="passenger"][data-taxi-state="riding"]');
  report.boarded = await state(rider);
  const command = riderWire.sent.find(m => m.type === 'ROBOTAXI_HAIL');
  assert.ok(command); assert.ok(riderWire.taxi.some(m => m.state === 'riding' && m.requestId === command.requestId));
  console.log('Physical H hailed the real taxi; rider boarded as a passenger.');
  const rideStarted = Date.now();
  // Attempt every driving axis while seated. Only the authoritative route may move the car.
  await rider.keyboard.down('KeyW'); await rider.keyboard.down('KeyA'); await rider.keyboard.down('Space');
  report.ride.push(await state(rider));
  await rider.waitForTimeout(1000);
  await rider.keyboard.up('KeyW'); await rider.keyboard.up('KeyA'); await rider.keyboard.up('Space');
  report.ride.push(await state(rider));
  assert.equal(report.ride.at(-1).mode, 'passenger');
  const oldConnections = observerWire.welcomes.length;
  await observer.evaluate(() => window.__lombardSockets.at(-1).close(4000, 'Lombard observer reconnect'));
  const etaSeconds = riderWire.taxi.find(m => m.state === 'riding')?.etaSeconds;
  assert.ok(Number.isFinite(etaSeconds) && etaSeconds > 0 && etaSeconds < 180, 'Server supplies a bounded Lombard ETA');
  report.serverRideEtaSeconds = etaSeconds;
  const deadline = Date.now() + (etaSeconds + 35) * 1000;
  let capturedRide = false;
  while (Date.now() < deadline) {
    const current = await state(rider); report.ride.push(current);
    if (current.taxi === 'arrived') break;
    assert.equal(current.mode, 'passenger', 'Rider remains a passenger during observer reconnect');
    if (!capturedRide && Date.now() - rideStarted > etaSeconds * 500) {
      await rider.screenshot({ path: `${out}/riding.png` }); capturedRide = true;
      console.log(`Still following the real route; server ETA was ${etaSeconds}s.`);
    }
    await rider.waitForTimeout(350);
  }
  report.arrived = await state(rider); report.rideWallMs = Date.now() - rideStarted;
  await rider.screenshot({ path: `${out}/arrived.png` });
  assert.equal(report.arrived.taxi, 'arrived'); assert.equal(report.arrived.mode, 'on-foot'); assert.equal(report.arrived.vehicleId, 0);
  assert.match(report.arrived.trip, /ARRIVED/);
  const arrived = riderWire.taxi.find(m => m.state === 'arrived');
  assert.ok(arrived); assert.equal(arrived.requestId, command.requestId); assert.deepEqual(arrived.destination, command.destination);
  assert.ok(horizontal({ x: arrived.pose.x / 100, z: arrived.pose.z / 100 }, { x: arrived.destination.x / 100, z: arrived.destination.z / 100 }) < 2);
  assert.equal(riderWire.sent.filter(m => m.type === 'VEHICLE_MOVE').length, 0, 'Passenger controls never send steering');
  assert.ok(observerWire.welcomes.length > oldConnections, 'Observer reconnect receives a fresh real WELCOME');
  assert.equal(observerWire.welcomes.at(-1).id, observerWire.welcomes[0].id, 'Reconnect keeps the observer identity');
  assert.equal(observerWire.welcomes.at(-1).resumed, true);
  await observer.waitForSelector('#world[data-connected="true"]');
  report.observerReconnected = await state(observer);
  const ride = report.ride.filter(s => s.mode === 'passenger'); assert.ok(ride.length >= 8);
  const descent = ride[0].foot.y - ride.at(-1).foot.y;
  assert.ok(descent > 20, `Taxi descends real Lombard grade (${descent}m)`);
  assert.ok(ride.at(-1).foot.x - ride[0].foot.x > 100, 'Taxi reaches the downhill end');
  let previousSign = 0, reversals = 0;
  for (let i = 1; i < ride.length; i++) {
    const dz = ride[i].foot.z - ride[i - 1].foot.z;
    if (Math.abs(dz) < .2) continue;
    const sign = Math.sign(dz); if (previousSign && sign !== previousSign) reversals++; previousSign = sign;
  }
  assert.ok(reversals >= 4, `Ride follows real switchbacks (${reversals} z reversals)`);
  const groundErrors = ride.map(s => Math.abs(s.foot.y - s.ground));
  assert.ok(ride.every(s => s.ground !== null && s.road !== null));
  const roadOffsets = ride.map(s => horizontal(s.foot, s.road));
  assert.ok(Math.max(...roadOffsets) < 1, 'Taxi follows the source road centreline');
  assert.ok(Math.max(...groundErrors) < 1, 'Rendered taxi follows road grade within suspension tolerance');
  assert.ok(ride.every(s => horizontal(s.foot, s.car) < .001 && Math.abs(s.foot.y - s.car.y) < .001), 'Passenger follows taxi seat');
  assert.ok(ride.every(s => s.camera.every(Number.isFinite) && s.mapErrors.length === 0));
  report.grade = { descentM: descent, switchbackReversals: reversals, maximumGroundErrorM: Math.max(...groundErrors), maximumRoadOffsetM: Math.max(...roadOffsets), samples: ride.length };
  assert.deepEqual(report.errors, []); assert.deepEqual(report.httpErrors, []);
  report.passed = true;
  console.log(JSON.stringify({ passed: true, out, grade: report.grade, rideWallMs: report.rideWallMs, reconnectWelcomes: observerWire.welcomes.length }));
} catch (error) {
  report.failure = String(error);
  for (const [i, page] of pages.entries()) await page.screenshot({ path: `${out}/failed-${i}.png` }).catch(() => {});
  throw error;
} finally {
  for (const wire of Object.values(report.peers)) wire.latestPeers = [...wire.latestPeers.values()];
  await writeFile(`${out}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  await browser?.close();
  await server?.close();
}
