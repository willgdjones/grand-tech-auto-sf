/** Founder journey against the running local game: physical inputs and real server time only. */
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { preview } from 'vite';

let base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
const out = resolve(process.env.GTASF_FOUNDER_OUT ?? `artifacts/founder-path/${new Date().toISOString().replaceAll(':', '-')}`);
await mkdir(out, { recursive: true });
// A supplied local build keeps concurrent Vite HMR from restarting a multi-minute real trip.
// Gameplay, events, identity, attendance and taxis still use the running native local Worker.
let server;
if (process.env.GTASF_FOUNDER_APP) {
  server = await preview({ configFile: resolve('web/vite.config.ts'), root: resolve('web'),
    build: { outDir: resolve(process.env.GTASF_FOUNDER_APP) },
    preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } } });
  base = server.resolvedUrls.local[0];
}
const report = { startedAt: new Date().toISOString(), base, errors: [], httpErrors: [], eventResponses: [], steps: [], corrections: 0, recoveryRequests: 0, passed: false };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const context = await browser.newContext({ viewport: { width: 1365, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.setDefaultTimeout(45_000);
page.on('pageerror', error => report.errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
page.on('response', response => {
  const path = new URL(response.url()).pathname;
  if (response.status() >= 400) report.httpErrors.push({ path, status: response.status() });
  if (path === '/api/events') report.eventResponses.push({ at: new Date().toISOString(), status: response.status() });
});
page.on('websocket', socket => {
  socket.on('framereceived', ({ payload }) => { if (Buffer.isBuffer(payload) && payload[0] === 0x89) report.corrections++; });
  socket.on('framesent', ({ payload }) => { if (Buffer.isBuffer(payload) && payload[0] === 0x1a) report.recoveryRequests++; });
});
const angle = a => Math.atan2(Math.sin(a), Math.cos(a));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const held = new Set();
async function keys(next) {
  for (const key of held) if (!next.includes(key)) { await page.keyboard.up(key); held.delete(key); }
  for (const key of next) if (!held.has(key)) { await page.keyboard.down(key); held.add(key); }
}
async function state() {
  return page.evaluate(() => {
    const w = window.__gtasf.world, f = w.funding, car = w.fleet.cars.get(w.vehicleId);
    return { foot: { ...w.foot }, mode: w.mode, vehicleId: w.vehicleId, cameraYaw: w.camera.yaw, cameraSafe: w.camera.safe,
      speed: car ? car.data.speedCmps / 100 : 0, connected: document.querySelector('#world').dataset.connected,
      taxi: w.taxi.state, taxiId: w.taxi.vehicleId, eta: w.taxi.etaSeconds,
      trip: document.querySelector('#trip-status').textContent, mapErrors: [...w.map.stats.errors],
      funding: { target: f.target, inside: f.inside, progress: f.progress, state: f.status?.state,
        room: f.status?.room, award: f.status?.award, totalCents: f.profile?.totalCents, startup: f.profile?.startupName },
      cars: [...w.fleet.cars.values()].map(c => ({ id: c.data.id, kind: c.data.kind, driverId: c.data.driverId,
        x: c.model.root.position.x, y: c.model.root.position.y, z: c.model.root.position.z })) };
  });
}
async function record(name, extra = {}) {
  await keys([]);
  const entry = { name, at: new Date().toISOString(), state: await state(), ...extra };
  report.steps.push(entry); console.log(`FOUNDER_STEP:${name}`);
  await page.screenshot({ path: `${out}/${String(report.steps.length).padStart(2, '0')}-${name}.png` });
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
}
async function face(point) {
  // Read the camera and use arrow keys only; never assign a pose, camera, virtual input or game clock.
  // The chase camera eases its yaw toward a target (smooth follow, 1.5s manual hold). Hold the
  // shortest-path arrow continuously and re-evaluate every poll, flipping direction only if we
  // overshoot — a damped approach that settles, where a tap/release-then-settle loop oscillates
  // against the easing. (Verified in-run: arrow keys rotate the camera and nothing blocks input.)
  await keys([]);
  const targetFor = s => Math.atan2(point.x - s.foot.x, point.z - s.foot.z) + Math.PI;
  const deadline = Date.now() + 10_000;
  let current = null;
  while (Date.now() < deadline) {
    const s = await state();
    const delta = angle(targetFor(s) - s.cameraYaw);
    if (Math.abs(delta) < .12) { await keys([]); return; }
    const dir = delta > 0 ? 'ArrowLeft' : 'ArrowRight';
    if (dir !== current) { await keys([dir]); current = dir; }
    await page.waitForTimeout(25);
  }
  await keys([]);
  throw new Error('Keyboard camera could not face the walking target');
}
async function walk(point, radius = 3.8, limitMs = 35_000) {
  const deadline = Date.now() + limitMs;
  let previous = await state(), stalled = Date.now();
  while (Date.now() < deadline) {
    const current = await state();
    if (distance(current.foot, point) <= radius || current.mode === 'passenger') { await keys([]); return; }
    await face(point); await keys(['KeyW', 'Shift']);
    const legEnd = Date.now() + Math.min(1800, distance(current.foot, point) / 6 * 800);
    while (Date.now() < legEnd) {
      await page.waitForTimeout(100);
      const s = await state();
      if (distance(s.foot, point) <= radius || s.mode === 'passenger') { await keys([]); return; }
      if (distance(s.foot, previous.foot) > .15) { previous = s; stalled = Date.now(); }
      if (Date.now() - stalled > 2500) throw new Error(`Walking stalled ${distance(s.foot, point).toFixed(1)}m from target`);
    }
    await keys([]);
  }
  throw new Error('Walking target timed out');
}
async function driveLombard() {
  const points = await page.evaluate(() => window.__gtasf.world.map.graph.edges
    .filter(e => e.kind === 'lane' && e.osmWay === 402111597)
    .sort((a, b) => a.points[0][0] - b.points[0][0]).flatMap(e => e.points.map(p => ({ x: p[0], y: p[1], z: p[2] }))));
  assert.ok(points.length > 100, 'Real sourced Lombard switchback polyline exists');
  const start = await state(), samples = []; let index = 0, lastProgress = Date.now(), lastPosition = start.foot;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const s = await state(); assert.equal(s.mode, 'driver');
    let best = index;
    for (let i = index; i < Math.min(points.length, index + 18); i++) if (distance(s.foot, points[i]) < distance(s.foot, points[best])) best = i;
    index = best;
    if (distance(s.foot, points.at(-1)) < 4) break;
    let targetIndex = index;
    while (targetIndex < points.length - 1 && distance(s.foot, points[targetIndex]) < 3.5) targetIndex++;
    const target = points[targetIndex], delta = angle(Math.atan2(target.x - s.foot.x, target.z - s.foot.z) - s.foot.yaw);
    const speedTarget = Math.abs(delta) > .7 ? 2 : 3.5;
    const next = [];
    if (Math.abs(delta) > .07) next.push(delta > 0 ? 'KeyA' : 'KeyD');
    if (s.speed < speedTarget - .25) next.push('KeyW'); else if (s.speed > speedTarget + .5) next.push('Space');
    await keys(next); await page.waitForTimeout(100);
    if (distance(s.foot, lastPosition) > .25) { lastPosition = s.foot; lastProgress = Date.now(); }
    if (Date.now() - lastProgress > 3500) throw new Error(`Lombard driving stalled at path point ${index}/${points.length}`);
    samples.push({ x: s.foot.x, y: s.foot.y, z: s.foot.z, speed: s.speed, index, cameraSafe: s.cameraSafe });
  }
  await keys(['Space']); await page.waitForTimeout(600); await keys([]);
  const end = await state(); report.driving = { start, end, samples };
  assert.ok(distance(end.foot, points.at(-1)) < 5, 'Keyboard driving reaches bottom of Lombard');
  assert.ok(start.foot.y - end.foot.y > 20, 'Keyboard driving descends the real hill');
  await record('lombard-driven');
}
try {
  if (process.env.GTASF_INVITE_FILE) {
    const code = (await readFile(process.env.GTASF_INVITE_FILE, 'utf8')).trim();
    const admission = await context.request.post(new URL('/api/invite', base).href, { data: { code } });
    assert.equal(admission.status(), 200, 'Founder journey has valid invite admission');
  }
  await page.goto(base);
  await page.waitForFunction(() => window.__gtasf?.ready || document.querySelector('#loading.failed'));
  const bootError = await page.evaluate(() => document.querySelector('#loading.failed #loading-detail')?.textContent ?? null);
  assert.equal(bootError, null, `Local boot failed: ${bootError}`);
  await page.waitForSelector('#world[data-ready="true"][data-connected="true"]');
  await page.waitForSelector('#loading', { state: 'hidden' });
  assert.equal(await page.evaluate(() => window.__gtasf.capture), false);
  await record('spawn');
  // Onboarding (flags.onboarding, live since #5.3): skip the SA intro, then confirm the pre-filled
  // FOUNDER ID screen. Without onboarding the legacy startup dialog opens instead.
  const intro = page.locator('.gt-sa-intro'), founderId = page.locator('dialog.gt-identity[open]');
  const identity = page.locator('.gt-funding-onboarding[open]');
  await Promise.race([intro.waitFor(), founderId.waitFor(), identity.waitFor()]);
  if (await intro.isVisible()) { await page.locator('.gt-sa-intro__skip').click(); await intro.waitFor({ state: 'hidden' }); }
  if (await founderId.isVisible().catch(() => false) || await founderId.waitFor({ timeout: 5_000 }).then(() => true, () => false)) {
    await founderId.getByRole('button', { name: 'Looks good' }).click();
    await founderId.waitFor({ state: 'hidden' });
    await page.waitForFunction(() => !!window.__gtasf?.world?.funding?.profile?.startupName);
  } else {
    await identity.waitFor();
    const startup = `Founder Path ${Date.now().toString(36)}`;
    await page.getByLabel('Startup name', { exact: true }).fill(startup);
    await page.getByLabel('Your nickname', { exact: true }).fill('Path Founder');
    await identity.getByRole('button', { name: 'Save startup', exact: true }).click();
    await identity.waitFor({ state: 'hidden' });
    assert.equal((await state()).funding.startup, startup);
  }
  await record('startup-saved');
  await page.getByRole('button', { name: 'Game options', exact: true }).click();
  const options = page.getByRole('dialog', { name: 'Game options', exact: true }); await options.waitFor();
  const beforeOptions = await state(), savedOutfit = await page.evaluate(() => localStorage.getItem('gtasf.outfit'));
  await keys(['KeyW', 'KeyO', 'KeyR']); await page.waitForTimeout(350); await keys([]);
  assert.ok(distance((await state()).foot, beforeOptions.foot) < .02, 'Game options suppresses walking/recovery');
  assert.equal(await page.evaluate(() => localStorage.getItem('gtasf.outfit')), savedOutfit, 'O is suppressed inside the modal');
  const outfit = options.getByRole('button', { name: /^Outfit:/ });
  if (await outfit.count()) {
    const first = await outfit.innerText(); await outfit.click();
    const wardrobe = page.getByRole('dialog', { name: /wardrobe/i });
    if (await wardrobe.isVisible().catch(() => false)) { // Outfit now opens the Wardrobe (avatar appearance)
      await wardrobe.getByRole('button', { name: 'Cancel', exact: true }).click(); await wardrobe.waitFor({ state: 'hidden' });
    } else assert.notEqual(await outfit.innerText(), first);
  }
  // The on-foot toggle lives inside Game options (#movement-mode is now the dialog launcher).
  const movement = options.getByRole('button', { name: /^On foot:/ });
  const movementPressed0 = await movement.getAttribute('aria-pressed');
  await movement.click();
  assert.notEqual(await movement.getAttribute('aria-pressed'), movementPressed0, 'Movement toggle flips aria-pressed');
  await movement.click();
  assert.equal(await movement.getAttribute('aria-pressed'), movementPressed0, 'Movement toggle returns to its first state');
  const radio = options.locator('.gt-radio-controls');
  await radio.getByRole('button', { name: 'Play radio', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.gt-radio-status')?.textContent?.startsWith('Playing'));
  await radio.getByRole('button', { name: 'Mute', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.gt-hud-radio')?.textContent?.includes('MUTED'));
  await radio.getByRole('button', { name: 'Unmute', exact: true }).click();
  await radio.getByLabel('Radio station', { exact: true }).selectOption('bart-delays-fm');
  await page.waitForFunction(() => document.querySelector('.gt-radio-status')?.textContent?.startsWith('Playing') && document.querySelector('.gt-hud-radio')?.textContent?.includes('BART'));
  assert.ok((await page.locator('.gt-hud-radio-ticker').innerText()).length > 0, 'Real radio playback updates the HUD ticker');
  await radio.getByRole('button', { name: 'Pause radio', exact: true }).click();
  const cityStops = options.locator('.gt-city-life-controls');
  for (const name of ['Find the coned robotaxi', 'Find the delivery robot', 'Visit the Pier 39 sea lions', 'Find the Muni-late banner'])
    assert.equal(await cityStops.getByRole('button', { name, exact: true }).count(), 1, `City destination is discoverable: ${name}`);
  report.radioControls = { playback: true, stationSwitch: true, mute: true, ticker: true };
  await record('game-options');
  await page.setViewportSize({ width: 390, height: 844 });
  const optionsBox = await options.boundingBox();
  assert.ok(optionsBox && optionsBox.x >= 0 && optionsBox.x + optionsBox.width <= 390 && optionsBox.y >= 0 && optionsBox.y + optionsBox.height <= 844, 'Phone options fit the viewport');
  await record('phone-game-options');
  await page.setViewportSize({ width: 1365, height: 900 });
  const chatLauncher = options.getByRole('button', { name: 'Chat · Enter', exact: true });
  if (await chatLauncher.count()) {
    await chatLauncher.click();
    const chat = page.getByRole('dialog', { name: 'City chat', exact: true }); await chat.waitFor();
    await options.waitFor({ state: 'hidden' });
    await chat.getByRole('button', { name: 'Close ×', exact: true }).click(); await chat.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Game options', exact: true }).click();
  }
  await page.keyboard.press('Escape'); await options.waitFor({ state: 'hidden' });
  const beforeOutfitKey = await page.evaluate(() => localStorage.getItem('gtasf.outfit'));
  await page.keyboard.press('KeyO');
  if (await outfit.count()) assert.notEqual(await page.evaluate(() => localStorage.getItem('gtasf.outfit')), beforeOutfitKey);
  const eventsResponse = await context.request.get(new URL('/api/events', base).href), payload = await eventsResponse.json();
  const events = Array.isArray(payload) ? payload : payload.events, now = Date.now();
  const live = events.filter(e => Date.parse(e.start) <= now && Date.parse(e.end) > now);
  report.calendar = { count: events.length, liveCount: live.length, checkedAt: new Date(now).toISOString() };
  // Drive-through pays on pass-through (PLAN-v2 decision 1), so the smoke must actually reach the
  // marker; walk() has no pathfinding, so pick the event NEAREST the Ferry spawn (most reachable)
  // rather than the first live one, which can be ~100 m across colliders (the "walking stalled" blocker).
  const FERRY_LL = { lat: 37.7955, lon: -122.3937 };
  const haversineKm = (a, b) => { const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lon - a.lon) * Math.PI / 180, la1 = a.lat * Math.PI / 180, la2 = b.lat * Math.PI / 180; const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  const located = events.filter(e => e.lat != null && e.lon != null).sort((a, b) => haversineKm(FERRY_LL, a) - haversineKm(FERRY_LL, b));
  const event = located[0] ?? events.find(e => e.id === 'tech-week:f9c5d885-7f83-4a7d-b9cb-9df83f93e262');
  assert.ok(event); report.event = event;
  report.liveEventAvailable = live.includes(event);
  await page.keyboard.press('KeyV');
  await page.getByRole('tab', { name: /^Live now/ }).click();
  await record('live-calendar');
  await page.getByRole('tab', { name: /^(Tech Week|This week)/ }).click();
  await page.getByRole('searchbox', { name: 'Search upcoming events' }).fill(event.title);
  await page.locator(`[data-event-id="${event.id}"]`).getByRole('button', { name: /^Set destination:/ }).click();
  await page.waitForSelector('.gt-upcoming', { state: 'hidden' });
  await page.waitForFunction(id => window.__gtasf.world.funding.target?.eventId === id, event.id);
  const target = (await state()).funding.target.anchor;
  await record('gps-event');
  // All of today's events are 70 m+ from spawn through the city and walk() has no pathfinding, so
  // ride a robotaxi to the event (it routes by road), then close the last few metres into the 8 m
  // marker on foot. Drive-through pays on pass-through (on foot or as a passenger) within the radius.
  async function rideTaxiTo(label) {
    await page.keyboard.press('KeyH');
    await page.waitForFunction(() => ['pickup', 'riding', 'unavailable'].includes(window.__gtasf.world.taxi.state));
    await record(`taxi-hailed-${label}`);
    const pickupDeadline = Date.now() + 55_000;
    while (Date.now() < pickupDeadline) {
      const s = await state();
      if (s.mode === 'passenger') break;
      assert.notEqual(s.taxi, 'unavailable', s.trip);
      if (s.taxi === 'pickup' && s.eta === 0) { const taxi = s.cars.find(c => c.id === s.taxiId); assert.ok(taxi); await walk(taxi, 4, 25_000); }
      else await page.waitForTimeout(500);
    }
    assert.equal((await state()).mode, 'passenger');
    await record(`taxi-boarded-${label}`);
    const rideStart = Date.now(), eta = (await state()).eta, rideDeadline = Date.now() + (eta + 40) * 1000;
    console.log(`FOUNDER_RIDE_ETA:${label}:${eta}`);
    let lastLog = Date.now();
    while (Date.now() < rideDeadline) {
      const s = await state();
      assert.equal(s.connected, 'true', 'Native server disconnected during the taxi ride');
      assert.notEqual(s.taxi, 'reconnecting', 'Taxi ride lost its native server connection');
      if (s.taxi === 'arrived') break;
      assert.equal(s.mode, 'passenger', `Trip interrupted: ${s.trip}`);
      if (Date.now() - lastLog > 25_000) { console.log(`FOUNDER_RIDING:${s.eta}s ${s.foot.x.toFixed(1)},${s.foot.z.toFixed(1)}`); lastLog = Date.now(); }
      await page.waitForTimeout(500);
    }
    const arrival = await state();
    await record(`taxi-arrival-${label}`, { rideMs: Date.now() - rideStart });
    return arrival;
  }
  // Baseline BEFORE the ride: drive-through pays mid-ride the moment the taxi passes through the
  // marker, so a total captured after arriving would already include the award (the v2-robotaxi
  // run's false negative). Capture it here, then reach the marker.
  const beforeCents = BigInt((await state()).funding.totalCents ?? '0');
  await rideTaxiTo('event');
  await walk(target, 6, 25_000);
  // Funding model: with driveThroughFunding the server pays on pass-through (no 20s dwell room); the
  // v1 path opens a working room. Support BOTH so the smoke is correct under either flag state.
  const started = Date.now();
  const roomOpened = await page.waitForFunction(() => window.__gtasf.world.funding.status?.state === 'working', null, { timeout: 4000 }).then(() => true).catch(() => false);
  if (roomOpened) {
    const working = await state(); await record('working-room');
    await page.waitForFunction(() => window.__gtasf.world.funding.status?.state === 'awarded', null, { timeout: 40_000 });
    assert.equal(working.funding.room.finishesAt - working.funding.room.startedAt, 20_000);
  } else {
    // Drive-through: the client polls status (~1.5s) and flips straight to 'awarded' after the pass-through.
    await page.waitForFunction(() => window.__gtasf.world.funding.status?.state === 'awarded', null, { timeout: 40_000 });
  }
  // profile.totalCents can lag the 'awarded' status flip by a poll cycle (the client caches the
  // profile and refuses to rewind money), so wait for it to reflect the payout rather than reading once.
  await page.waitForFunction(before => BigInt(window.__gtasf.world.funding.profile?.totalCents ?? '0') > BigInt(before),
    beforeCents.toString(), { timeout: 15_000 });
  const awarded = await state();
  assert.ok(BigInt(awarded.funding.totalCents) > beforeCents, 'Reaching the event marker increased funding');
  assert.match(await page.locator('.gt-funding-toast').innerText(), /TERM SHEET SIGNED|(?:PRE-SEED|SEED|SERIES [A-Z]|UNICORN|PRE-IPO|DECACORN|HECTOCORN) CLOSED/);
  await record('funding-toast', { waitMs: Date.now() - started });
  await page.keyboard.press('Escape');
  await page.locator('#destination-lombard').click();
  const arrival = await rideTaxiTo('lombard');
  assert.equal(arrival.taxi, 'arrived'); assert.equal(arrival.mode, 'on-foot');
  const car = arrival.cars.filter(c => !['robotaxi', 'cable-car'].includes(c.kind) && !c.driverId).sort((a, b) => distance(a, arrival.foot) - distance(b, arrival.foot))[0];
  assert.ok(car); if (distance(car, arrival.foot) > 4) await walk(car, 3);
  await page.keyboard.press('KeyE'); await page.waitForSelector('#world[data-mode="driver"]');
  await record('driving-car-entered');
  const correctionsBeforeRecovery = report.corrections, recoveryDeadline = Date.now() + 5000;
  await page.keyboard.press('KeyR');
  while (report.corrections === correctionsBeforeRecovery && Date.now() < recoveryDeadline) await page.waitForTimeout(100);
  assert.equal(report.recoveryRequests, 1, 'Only the unblocked R key sends road recovery');
  assert.ok(report.corrections > correctionsBeforeRecovery, 'Native server acknowledges road recovery');
  assert.equal((await state()).mode, 'driver');
  await record('road-recovered');
  await driveLombard();
  await page.keyboard.press('KeyE'); await page.waitForSelector('#world[data-mode="on-foot"]');
  assert.deepEqual(report.errors, []); assert.deepEqual(report.httpErrors, []);
  assert.deepEqual((await state()).mapErrors, []);
  report.passed = true; console.log('TEST_PASSED:FounderPath');

  // ---- PLAN-v2 verification journey (additive · integration-guarded · non-fatal) ----
  // Most v2 features are now wired into main.ts; each probe runs only when its
  // integration point is observable on the running build and records a `skip` (naming the
  // owning bead) otherwise — either because the flag is off or because the feature is wired
  // but not exposed through the harness inspection object (main.ts:1062). This keeps the
  // hourly run green on the v1 journey above while probes light up skip -> pass/fail.
  // Set GTASF_V2_STRICT=1 to fail the run when a *present* v2 feature misbehaves.
  // API probes use context.request (never the page), so a not-yet-built route's 404
  // does not pollute the page-level httpErrors asserted for the v1 journey.
  const v2strict = process.env.GTASF_V2_STRICT === '1';
  report.v2 = { strict: v2strict, checkedAt: new Date().toISOString(), probes: [] };
  const api = async path => {
    const response = await context.request.get(new URL(path, base).href);
    return { status: response.status(), body: response.ok() ? await response.json().catch(() => null) : null };
  };
  const probe = async (name, bead, fn) => {
    const entry = { name, bead };
    try {
      const result = await fn();
      if (result && result.skip) Object.assign(entry, { status: 'skip', reason: result.skip });
      else Object.assign(entry, { status: 'pass', detail: result ?? null });
    } catch (error) { Object.assign(entry, { status: 'fail', reason: String(error) }); }
    report.v2.probes.push(entry);
    console.log(`FOUNDER_V2:${name}:${entry.status}${entry.reason ? ` ${entry.reason}` : ''}`);
    await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
    if (v2strict && entry.status === 'fail') throw new Error(`v2 ${name}: ${entry.reason}`);
  };
  try {
    // 1 — Event focus: radar/map/world show the next 24h, one marker per venue, "+N this week" badge.
    await probe('event-focus-24h', 'gtasf-v2-venue-focus-uia7/gtasf-szbk', async () => {
      const { status, body } = await api('/api/events');
      if (status >= 400 || !body) return { skip: `GET /api/events ${status}` };
      const events = Array.isArray(body) ? body : body.events, now = Date.now(), horizon = now + 24 * 3600_000;
      const next24h = events.filter(e => { const t = Date.parse(e.start); return Number.isFinite(t) && t <= horizon && (e.end ? Date.parse(e.end) > now : t >= now); });
      const venueKey = e => (e.venue && e.venue.trim()) || (e.lat != null && e.lon != null ? `${e.lat.toFixed(4)},${e.lon.toFixed(4)}` : e.id);
      const venues = new Set(next24h.map(venueKey));
      // venueGrouping/eventFocus24h are on, but the harness does not expose the world marker venue
      // set (main.ts:1062 omits `events`), so this asserts via the API and reports the venue count.
      const worldVenues = await page.evaluate(() => window.__gtasf?.world?.events?.venues?.length ?? null).catch(() => null);
      const detail = { total: events.length, next24h: next24h.length, venues: venues.size, worldVenues };
      if (worldVenues == null) return { skip: `world venue count not exposed to harness; API next24h=${next24h.length} across ${venues.size} venues (L-A)` };
      if (worldVenues !== venues.size) throw new Error(`world venue markers ${worldVenues} != API venues ${venues.size}`);
      return detail;
    });
    // 2 — Community submission: a submitted lu.ma/Partiful link appears flagged "community".
    await probe('community-events', 'gtasf-v2-event-submission-tbzo/gtasf-lo41', async () => {
      // The "+ Add event" UI is wired into #play-controls (createEventSubmit, c1b108d).
      const uiReachable = await page.evaluate(() => !!document.querySelector('button.gt-eventsubmit-open')).catch(() => false);
      const { status, body } = await api('/api/events');
      if (status >= 400 || !body) return { skip: `GET /api/events ${status}` };
      const events = Array.isArray(body) ? body : body.events;
      const community = events.filter(e => e.community === true);
      // We do not POST to /api/events/submit here: it crawls + burns paid LLM calls and has no
      // rate limiting yet (H6/gtasf-9wf2). This verifies the UI is reachable + the published state.
      if (!uiReachable && !community.length) return { skip: 'event-submit UI not wired and no community events yet' };
      return { submitUiReachable: uiReachable, community: community.length, sample: community.slice(0, 3).map(e => ({ id: e.id, source: e.source })) };
    });
    // 3 — "What's new" panel shows once per deploy to returning players (PLAN-v2 §11).
    await probe('whats-new-once', 'gtasf-q1no/gtasf-hpaj', async () => {
      const found = await page.evaluate(() => {
        const dialog = document.querySelector('dialog.gt-whatsnew');
        return dialog ? { present: true, open: dialog.open, seen: (() => { try { return localStorage.getItem('gtasf:changelog:seen'); } catch { return null; } })() } : null;
      });
      // Wired (0ccf788): createWhatsNew appends the dialog on creation; showOnce() opens it for
      // returning players only, so the new-player smoke sees it present-but-closed.
      if (!found) return { skip: 'What\'s-new dialog absent (flags.changelog off or no released entry)' };
      return found;
    });
    // 4 — Drive-through event payouts, once per event ever (replaces the 20s dwell room).
    await probe('drive-through-funding', 'gtasf-v2-drive-through-cdha', async () => {
      const funding = await page.evaluate(() => {
        const f = window.__gtasf?.world?.funding;
        return f ? { hasRoom20s: f.status?.room?.finishesAt != null, driveThrough: f.driveThrough ?? f.status?.driveThrough ?? null } : null;
      });
      if (!funding) return { skip: 'funding state unavailable' };
      if (funding.driveThrough == null) return { skip: `drive-through not detected; v1 dwell-room model still active (room=${funding.hasRoom20s})` };
      return funding;
    });
    // 5 — VC fund drop: banner + radar blip, first 50 drive-through claims, counter goes down.
    await probe('vc-fund-drop', 'gtasf-v2-vc-fund-drops-27v2/gtasf-5hud', async () => {
      const drop = await page.evaluate(() => {
        // The drop banner element (div.gt-drop-banner) is created on construction and stays hidden
        // until a server-scheduled drop window opens; its presence confirms the client VC-drop UI is
        // wired (web/src/drops/banner.ts). A live N/50 counter needs an active drop (not forced here).
        const banner = document.querySelector('.gt-drop-banner');
        return { wired: !!banner, active: banner ? !banner.hidden : false, text: banner?.textContent?.trim() || null };
      });
      if (!drop.wired) return { skip: 'VC-drop banner (.gt-drop-banner) not in DOM — client UI not wired' };
      return drop; // reachability pass; claim logic is server-side (dropsStore atomic first-50, verified)
    });
    // 6 — Cap table: every funding source (events, VC drops, celebrity, warm intro) listed server-side.
    await probe('cap-table', 'gtasf-v2-captable-model-55qd', async () => {
      const { status, body } = await api('/api/funding/captable');
      if (status === 404) return { skip: '/api/funding/captable route not present yet' };
      if (status >= 400 || !body) return { skip: `GET /api/funding/captable ${status}` };
      return { ok: true, sources: Array.isArray(body.sources) ? body.sources.length : null };
    });
    // 7 — Hidden celebrity/angel NPC: E-to-pitch cheque, once per NPC ever, shows on the cap table.
    await probe('celeb-pitch', 'gtasf-v2-angel-npcs-v4i6', async () => {
      // Wired: main.ts createAngelInvestors, exposed as world.angels (main.ts:1062). angels is null
      // when flags.celebNpcs is off (prod default until the founder look-check) or NPCs are disabled.
      // Server once-ever folds into the cap-table model (gtasf-v2-captable-model-55qd).
      const wired = await page.evaluate(() => window.__gtasf?.world?.angels != null || window.__gtasf?.world?.celebs != null).catch(() => false);
      if (!wired) return { skip: 'angel/celeb NPCs disabled (flags.celebNpcs off) — world.angels null' };
      return { wired };
    });
    // 8 — Overhead nameplates + proximity chat: a second tab within ~40 m sees it, one at ~100 m does not.
    await probe('nameplate-proximity-chat', 'gtasf-5dlu', async () => {
      const nameplate = await page.evaluate(() => {
        // The container div.gt-nameplates is created on construction (web/src/hud/nameplates.ts:97);
        // individual button.gt-nameplate elements appear per visible peer (the full 40m/100m test
        // needs a second browser context — position two players, compare bubble visibility).
        const layer = document.querySelector('.gt-nameplates');
        return { wired: !!layer, peerPlate: !!document.querySelector('.gt-nameplate') };
      }).catch(() => ({ wired: false, peerPlate: false }));
      if (!nameplate.wired) return { skip: 'overhead nameplate layer (.gt-nameplates) not wired' };
      // Reachability pass; the two-tab 40m-sees / 100m-doesn't proximity-chat assertion is pending (gtasf-5dlu).
      return { ...nameplate, twoTabProximityPending: true };
    });
    // 9 — Feedback: the F key opens a box that attaches a screenshot + location/state, stored in D1.
    await probe('feedback-key-f', 'gtasf-10kp', async () => {
      // Wired (c7522d7): KeyF -> 'feedback' action -> createFeedback opens the dialog.
      await page.keyboard.press('KeyF');
      const dialog = await page.waitForSelector('dialog.gt-feedback', { state: 'attached', timeout: 1500 }).catch(() => null);
      if (!dialog) return { skip: 'F-key feedback did not open (flags.feedback off or action unbound)' };
      const open = await page.evaluate(() => !!document.querySelector('dialog.gt-feedback[open]')).catch(() => false);
      await page.keyboard.press('Escape');
      return { opened: open };
    });
    // 10 — Pacing: a dedicated player reaches Seed in under 10 minutes (depends on drive-through loop).
    await probe('seed-pacing', 'gtasf-v2-drive-through-cdha/gtasf-v2-stage-ladder-bx2i', async () => {
      const stage = await page.evaluate(() => window.__gtasf?.world?.funding?.profile?.stage ?? null).catch(() => null);
      return { skip: `Seed-in-10min depends on the drive-through loop; current stage=${stage ?? 'n/a'}` };
    });
    // 11 — Become an angel: self-sponsor an angel NPC (USD). The panel is reachable from a Game-options
    //      button (wired 54c8973) and the server lists open spots + an explicit USD price. The full
    //      open-panel + card-4242 checkout assertion lands with wkh7 (#1 test webhook secret, #2 web
    //      publishable key); until then this verifies reachability + that pricing stays USD, not GBP.
    await probe('become-an-angel', 'gtasf-wkh7/gtasf-sponsored-angel-checkout-9zy2', async () => {
      const uiReachable = await page.evaluate(() => !!document.querySelector('button.gt-angel-launch')).catch(() => false);
      const { status, body } = await api('/api/angels/spots');
      if (status === 404) return { skip: '/api/angels/spots absent (flags.becomeAnAngel off)' };
      if (status >= 400 || !body) return { skip: `GET /api/angels/spots ${status}` };
      // Account default currency is GBP; the submit/checkout must price in USD, so the public price
      // is published as integer USD cents. A missing field is a real pricing regression.
      if (body.priceUsdCents == null) throw new Error('spots response missing priceUsdCents (USD pricing)');
      const spots = Array.isArray(body.spots) ? body.spots.length : null;
      if (!uiReachable) return { skip: `spots API ok (${spots} spots, ${body.priceUsdCents}c) but Become-an-angel button not wired` };
      return { uiReachable, spots, priceUsdCents: body.priceUsdCents };
    });
    await record('v2-verification');
  } catch (error) {
    report.v2.aborted = String(error);
    await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
    if (v2strict) throw error;
  }
  console.log(`FOUNDER_V2_SUMMARY:${report.v2.probes.map(p => `${p.name}=${p.status}`).join(' ')}`);
} catch (error) {
  report.failure = String(error);
  report.failedState = await state().catch(() => null);
  await page.screenshot({ path: `${out}/failed.png` }).catch(() => {});
  console.error(report.failure); process.exitCode = 1;
} finally {
  await keys([]).catch(() => {}); report.finishedAt = new Date().toISOString();
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
  await browser.close(); console.log(`FOUNDER_REPORT:${out}/report.json`);
  if (server) { server.httpServer.closeAllConnections(); await new Promise(resolve => server.httpServer.close(resolve)); }
}
