/** Fresh tutorial using real controls, normal flags and a disposable Worker. Run via tools/heavy.sh. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';
import { build as buildWorker } from 'esbuild';
import { startLocalPool } from './local-pool/pool.mjs';
import { WALK_MARKER, ORIENTATION_RING, ORIENTATION_SOURCE_REF, orientationAwardCents } from '../shared/onboarding/tutorial.ts';

const phone = process.env.GTASF_ONBOARDING_DEVICE !== 'desktop';
// Explicit disposable acceptance fixture: exercise the recovery feature already enabled in production.
// Never edits shared flags or uses production secrets; local recovery uses its existing local pepper.
const recoveryFixture = process.env.GTASF_ONBOARDING_RECOVERY === '1';
const stamp = new Date().toISOString().replaceAll(':', '-');
const out = resolve(process.env.GTASF_ONBOARDING_OUT ?? `docs/perf/onboarding-journey/${phone ? 'phone' : 'desktop'}-${stamp}`);
const app = resolve(process.env.GTASF_ONBOARDING_APP ?? `artifacts/onboarding-journey/${stamp}/app`);
const report = { startedAt: new Date().toISOString(), device: phone ? 'phone' : 'desktop',
  scope: `Fresh actual-input tutorial; no seeded identity, pose, progress or clock; ${recoveryFixture ? 'explicit accountRecovery=true fixture on web and Worker' : 'normal source flags'}; not a production/performance/device gate`,
  runnerCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  app, errors: [], httpErrors: [], friendsRequests: [], steps: [], checks: [],
  coreJourneyPassed: false, scenarioAcceptancePassed: false };
await mkdir(out, { recursive: true });
report.harnessSha256 = createHash('sha256').update(await readFile(new URL(import.meta.url))).digest('hex');
let browser, context, page, cdp, server, pool, base;
let touchActive = false;
const held = new Set();
const save = () => writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
const angle = value => Math.atan2(Math.sin(value), Math.cos(value));
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const metres = p => ({ x: p.x / 100, y: p.y / 100, z: p.z / 100 });
const touch = async (type, points = []) => {
  await cdp.send('Input.dispatchTouchEvent', { type,
    touchPoints: points.map((p, i) => ({ ...p, id: i + 1, radiusX: 5, radiusY: 5, force: 1 })) });
  touchActive = type !== 'touchCancel' && (type !== 'touchEnd' || points.length > 0);
};
async function keys(next) {
  for (const key of held) if (!next.includes(key)) { await page.keyboard.up(key); held.delete(key); }
  for (const key of next) if (!held.has(key)) { await page.keyboard.down(key); held.add(key); }
}
async function release() { await keys([]); if (phone && touchActive) await touch('touchCancel'); }
async function activate(locator) { if (phone) await locator.tap(); else await locator.click(); }
async function centre(locator) {
  const box = await locator.boundingBox(); assert(box, 'Control is visible');
  const p = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  assert(await locator.evaluate((el, p) => el.contains(document.elementFromPoint(p.x, p.y)), p), 'Control receives input');
  return p;
}
const button = action => page.locator(`.gtasf-touch [data-action="${action}"]`);
const state = () => page.evaluate(() => {
  const h = window.__gtasf, w = h?.world, c = document.querySelector('#world');
  if (!w) return null;
  const car = w.fleet.nearest(w.foot, 400), f = w.funding, route = w.radar?.route;
  return { frame: h.frame, capture: h.capture, connected: c.dataset.connected,
    pose: { ...w.foot }, cameraYaw: w.camera.yaw, mode: w.mode, speed: Number(c.dataset.speed),
    nearestCar: car ? { id: car.data.id, kind: car.data.kind, x: car.model.root.position.x, z: car.model.root.position.z } : null,
    taxi: w.taxi.state, eta: w.taxi.etaSeconds, input: h.input.source,
    mission: document.querySelector('.gt-sa-mission')?.innerText ?? null,
    locked: document.body.getAttribute('data-onb-locked'), ride: document.querySelector('#ride')?.textContent,
    route: route ? { distanceM: route.distanceM, approach: route.approach, destinationDistanceM: route.destinationDistanceM } : null,
    funding: f ? { totalCents: f.profile?.totalCents, startupName: f.profile?.startupName, nickname: f.profile?.nickname,
      target: f.target, award: f.status?.award, error: f.error } : null,
    dialogs: [...document.querySelectorAll('dialog[open]')].map(d => ({ className: d.className, name: d.getAttribute('aria-label') })),
    mapErrors: [...w.map.stats.errors] };
});
async function api(path) {
  const response = await page.request.get(new URL(path, base).href); assert.equal(response.status(), 200, `GET ${path}`);
  return response.json();
}
async function progress() { const { state } = await api('/api/onboarding/state'); return typeof state === 'string' ? JSON.parse(state) : state; }
async function record(name, extra = {}) {
  await release();
  report.steps.push({ name, at: new Date().toISOString(), state: await state(), progress: await progress(), ...extra });
  await page.screenshot({ path: `${out}/${String(report.steps.length).padStart(2, '0')}-${name}.png`, timeout: 15000, scale: 'css' });
  await save(); console.log(`ONBOARDING_JOURNEY:${name}`);
}
async function until(check, label, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await page.waitForTimeout(150); }
  throw new Error(`Timed out: ${label}`);
}
async function walk(target, radius = 3, timeout = 45000) {
  const start = await state(), samples = [], end = Date.now() + timeout;
  while (Date.now() < end) {
    const s = await state(), d = distance(s.pose, target); samples.push({ pose: s.pose, distance: d, source: s.input });
    if (d <= radius) break;
    assert.equal(s.mode, 'on-foot');
    const dx = target.x - s.pose.x, dz = target.z - s.pose.z, sin = Math.sin(s.cameraYaw), cos = Math.cos(s.cameraYaw);
    const x = (dx * cos - dz * sin) / d, z = (dx * sin + dz * cos) / d;
    try {
      if (phone) { const stick = await centre(page.locator('.gtasf-touch .stick'));
        await touch('touchStart', [stick]); await touch('touchMove', [{ x: stick.x + x * 55, y: stick.y + z * 55 }]); }
      else { const next = ['Shift']; if (x > .35) next.push('KeyD'); if (x < -.35) next.push('KeyA');
        if (z > .35) next.push('KeyS'); if (z < -.35) next.push('KeyW'); await keys(next); }
      await page.waitForTimeout(Math.max(70, Math.min(250, (d - radius) / 8 * 1000)));
    } finally { await release(); }
    await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  }
  const final = await state(); report.checks.push({ name: 'walk', target, start: start.pose, final: final.pose, samples });
  assert(distance(final.pose, target) <= radius, 'Actual movement reaches walking target');
}
// HUD-minimal moved Game options (#movement-mode) into the pause menu: open it from the ☰ launcher first when needed.
async function openOptions() {
  if (!await page.locator('#movement-mode').isVisible()) { await activate(page.locator('.gt-pause-launch')); await page.locator('#movement-mode').waitFor({ state: 'visible' }); }
  await activate(page.locator('#movement-mode'));
}
// The phone HUD no longer shows the touch Map button: fall back to the radar's 'Open event map' button, then a tap on the
// minimap (a tap away from a blip opens the full map).
async function openMap() {
  if (!phone) { await page.keyboard.press('KeyM'); return; }
  if (await button('map').isVisible()) { await activate(button('map')); return; }
  const expand = page.locator('.gt-radar [aria-label="Open event map"]');
  if (await expand.isVisible()) { await activate(expand); return; }
  const box = await page.locator('.gt-radar canvas').first().boundingBox(); assert(box, 'Minimap is visible');
  for (const [fx, fy] of [[.5, .12], [.15, .5], [.85, .5], [.5, .88]]) {
    await page.touchscreen.tap(box.x + box.width * fx, box.y + box.height * fy);
    if (await page.locator('.gt-radar[data-expanded="true"]').count()) return;
    await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(400); // a blip tap opened a venue card
  }
}
// Hail on a phone: the touch Hail button when shown, else #hail inside the pause menu (HUD-minimal).
async function hail() {
  if (!phone) { await page.keyboard.press('KeyH'); return; }
  if (await button('hail').isVisible()) { await activate(button('hail')); return; }
  if (!await page.locator('#hail').isVisible()) { await activate(page.locator('.gt-pause-launch')); await page.locator('#hail').waitFor({ state: 'visible' }); }
  await activate(page.locator('#hail'));
}
// quickRobotaxi: a hail opens the 'Where to?' picker; ride to the current destination (the first row; enabled once its
// fare is quoted).
async function pickTaxiDestination() {
  const picker = page.locator('dialog.gt-taxi-picker[open]');
  try { await picker.waitFor({ state: 'visible', timeout: 5000 }); } catch { return; } // flag off: the hail went straight out
  const row = picker.locator('h3 + button').first();
  await until(async () => await row.isEnabled(), 'Robotaxi fare quoted', 20000);
  await record('taxi-picker');
  await activate(row);
}
async function ride() {
  if (phone && await button('ride').isVisible()) { await activate(button('ride')); return; } // the touch RIDE / HOP OFF button
  if (phone) {
    await openOptions();
    await page.getByRole('dialog', { name: 'Game options', exact: true }).waitFor();
    await activate(page.locator('#ride'));
    await page.getByRole('dialog', { name: 'Game options', exact: true }).waitFor({ state: 'hidden' });
  } else await page.keyboard.press('KeyG');
}
async function drive(target, radius = 7) {
  const samples = [], end = Date.now() + 60000;
  while (Date.now() < end) {
    const s = await state(), d = distance(s.pose, target); samples.push({ pose: s.pose, speed: s.speed, distance: d });
    if (d <= radius || s.dialogs.some(d => d.className === 'gt-identity')) break;
    assert.equal(s.mode, 'driver');
    const delta = angle(Math.atan2(target.x - s.pose.x, target.z - s.pose.z) - s.pose.yaw);
    const targetSpeed = Math.abs(delta) > .65 ? 3 : 6;
    try {
      if (phone) {
        const stick = await centre(page.locator('.gtasf-touch .stick')), points = [{ x: stick.x - Math.max(-1, Math.min(1, delta * 2)) * 55, y: stick.y }];
        if (s.speed < targetSpeed) points.push(await centre(button('throttle')));
        else if (s.speed > targetSpeed + 1) points.push(await centre(button('handbrake')));
        await touch('touchStart', points);
      } else {
        const next = []; if (Math.abs(delta) > .08) next.push(delta > 0 ? 'KeyA' : 'KeyD');
        if (s.speed < targetSpeed) next.push('KeyW'); else if (s.speed > targetSpeed + 1) next.push('Space'); await keys(next);
      }
      await page.waitForTimeout(120);
    } catch (error) {
      // The server award can open the real modal between a pose read and the next control hit check.
      if (await page.getByRole('dialog', { name: 'Create your founder', exact: true }).isVisible()) break;
      throw error;
    } finally { await release(); }
  }
  report.checks.push({ name: 'drive-orientation', target, samples, final: await state() }); await save();
  assert(distance((await state()).pose, target) < ORIENTATION_RING.radiusCm / 100 + 1, 'Car reaches actual Orientation ring');
  if (!(await state()).dialogs.length) {
    try {
      if (phone) await touch('touchStart', [await centre(button('handbrake'))]);
      else await keys(['Space']);
      await page.waitForTimeout(700);
    } catch (error) {
      if (!await page.getByRole('dialog', { name: 'Create your founder', exact: true }).isVisible()) throw error;
    } finally { await release(); }
  }
}

try {
  let flagsFixture, workerPath;
  const flagsPath = resolve('shared/flags.ts');
  if (recoveryFixture) {
    const fixturePath = resolve(app, '../recovery-flags.ts');
    if (process.env.GTASF_ONBOARDING_APP) flagsFixture = await readFile(fixturePath, 'utf8');
    else {
      const sourceFlags = await readFile(flagsPath, 'utf8');
      assert.equal((sourceFlags.match(/accountRecovery: false/g) ?? []).length, 1);
      flagsFixture = sourceFlags.replace('accountRecovery: false', 'accountRecovery: true');
      await mkdir(resolve(app, '..'), { recursive: true }); await writeFile(fixturePath, flagsFixture);
    }
    assert(flagsFixture.includes('accountRecovery: true'));
    report.featureFixture = { accountRecovery: true, flagsSha256: createHash('sha256').update(flagsFixture).digest('hex') };
    workerPath = resolve(`artifacts/onboarding-journey/${stamp}/recovery-worker.mjs`);
    await mkdir(resolve(workerPath, '..'), { recursive: true });
    await buildWorker({ entryPoints: [resolve('worker/src/index.ts')], outfile: workerPath, bundle: true,
      format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:*', 'node:*'], logLevel: 'warning',
      plugins: [{ name: 'explicit-recovery-fixture', setup(plugin) {
        plugin.onLoad({ filter: /shared\/flags\.ts$/ }, ({ path }) => path === flagsPath ? { contents: flagsFixture, loader: 'ts' } : undefined);
      } }] });
    report.workerSha256 = createHash('sha256').update(await readFile(workerPath)).digest('hex');
  }
  if (!process.env.GTASF_ONBOARDING_APP) await build({ root: resolve('web'), configFile: resolve('web/vite.config.ts'),
    plugins: recoveryFixture ? [{ name: 'explicit-recovery-fixture', enforce: 'pre',
      transform(_code, id) { if (id.split('?')[0] === flagsPath) return { code: flagsFixture, map: null }; } }] : [],
    logLevel: 'warn', build: { outDir: app, emptyOutDir: true, reportCompressedSize: false } });
  report.assets = await Promise.all((await readdir(`${app}/assets`)).filter(n => /\.(js|css)$/.test(n)).map(async name => {
    const bytes = await readFile(`${app}/assets/${name}`); return { name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }));
  const area = process.env.GTASF_MAP_AREA ?? JSON.parse(await readFile('tools/map/out/active-map.json', 'utf8')).area;
  const manifestBytes = await readFile(`tools/map/out/${area}/manifest.json`), manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.roadGraph.encoding, 'roadpack-v1');
  report.map = { area, manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'), roadGraph: manifest.roadGraph };
  pool = await startLocalPool({ bundlePath: workerPath, worldRoadGraphPath: resolve(`tools/map/out/${area}/${manifest.roadGraph.path}`) });
  assert.equal(pool.worldRoadGraphHash, manifest.roadGraph.sha256, 'Browser and Worker use the same real city graph');
  server = await preview({ root: resolve('web'), configFile: resolve('web/vite.config.ts'), build: { outDir: app },
    preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: pool.url.origin, ws: true } } } });
  base = server.resolvedUrls.local[0];
  browser = await chromium.launch({ headless: true,
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
  context = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1365, height: 900 },
    deviceScaleFactor: 1, isMobile: phone, hasTouch: phone });
  page = await context.newPage(); page.setDefaultTimeout(30000); cdp = await context.newCDPSession(page);
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
  page.on('request', r => { if (new URL(r.url()).pathname.startsWith('/api/friends/')) report.friendsRequests.push(new URL(r.url()).pathname); });
  page.on('response', r => { if (r.status() >= 400) report.httpErrors.push({ path: new URL(r.url()).pathname, status: r.status() }); });
  report.bootStartedAt = new Date().toISOString();
  await page.goto(new URL('/?preset=low', base).href, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#world[data-ready="true"][data-connected="true"]', { timeout: 180000 });
  await page.locator('#loading').waitFor({ state: 'hidden' });
  assert.equal((await state()).capture, false); assert.equal((await progress()).step, 'intro');
  const intro = page.locator('.gt-sa-intro'); await intro.waitFor({ state: 'visible' });
  report.readyAt = new Date().toISOString();
  for (let i = 0; i < 3; i++) {
    assert.equal(await intro.getByRole('button', { name: 'Skip', exact: true }).isVisible(), true);
    if (i === 2) assert.equal(await intro.locator('.gt-sa-intro__title').textContent(), phone ? 'Touch controls' : 'Keyboard controls');
    await record(`slide-${i + 1}`);
    if (phone) await page.touchscreen.tap(190, 250); else await page.keyboard.press('Enter');
  }
  await intro.waitFor({ state: 'detached' });
  report.tutorialStartedAt = new Date().toISOString();
  await until(async () => (await progress()).step === 'walk', 'Walk tutorial starts');
  await record('walk-start');
  await walk(metres(WALK_MARKER), 3);
  if (await page.locator('#ride').isVisible() || phone && await page.locator('#ride').count()) {
    await ride(); await until(async () => (await state()).ride?.includes('Hop off'), 'Scooter mounted');
    await record('scooter-mounted'); await ride();
  }
  await until(async () => (await progress()).step === 'drive_ring', 'Walk, sprint and scooter checklist completes');
  await record('orientation-start');
  // Parked cars near the walk marker are intermittent (10-19: none within 150 m for 45 s on one run, one 30 m away on the
  // next): search 400 m and wait up to 60 s; walk() covers the distance.
  // fleet.nearest(p, maxDistance) only returns a car inside its ENTRY radius (~5.5 m; maxDistance can only shrink that),
  // so 'search 400 m' through state().nearestCar never saw a car more than a few metres away (lane E, 10-19: a Prius 27 m
  // off was invisible for the whole 60 s). Scan the fleet for the nearest visible car a player can DRIVE (vehicleEntryMode
  // 'driver': no driver, not robotaxi / cable car / bus, not moving traffic 0x20).
  const parkedCar = () => page.evaluate(() => { const w = window.__gtasf?.world; if (!w) return null; let best = null, bd = 400;
    for (const car of w.fleet.cars.values()) { const d0 = car.data;
      if (!car.model.root.visible || d0.driverId || (d0.flags & 0x20) || ['robotaxi', 'cable-car', 'bus'].includes(d0.kind)) continue;
      const p = car.model.root.position, d = Math.hypot(p.x - w.foot.x, p.z - w.foot.z);
      if (d < bd) { bd = d; best = { id: d0.id, kind: d0.kind, x: p.x, z: p.z, distanceM: Math.round(d) }; } }
    return best; });
  await until(async () => Boolean(await parkedCar()), 'Parked car near the tutorial', 60000);
  const car = await parkedCar(); assert(car, 'Parked car near the tutorial'); report.parkedCar = car;
  await walk(car, 4.5);
  if (phone) await activate(button('enter-exit')); else await page.keyboard.press('KeyE');
  await page.waitForSelector('#world[data-mode="driver"]'); await record('entered-car');
  await drive(metres(ORIENTATION_RING));
  journey: {
  // GTASF_ONBOARDING_RELOAD_AT_AWARD=1 (critic 06:4x, chequeOnce): the Orientation award lands -> reload AT ONCE (inside the
  // window before the client persists the step) -> after the reload the step must be past drive_ring and the cheque card
  // must not replay. Ends the journey there.
  // =1 reloads the moment the SERVER credits it (the client may not have shown it yet: then it must show once after the
  // reload); =seen waits until the client has shown it (chequeOnce ring) and reloads at once: no card after the reload.
  const reloadAt = process.env.GTASF_ONBOARDING_RELOAD_AT_AWARD;
  if (reloadAt === '1' || reloadAt === 'seen') {
    const seenRing = () => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('gtasf.funding.seenAwards.v1') ?? '[]'); } catch { return []; } });
    const credited = async () => (await api('/api/funding/captable')).groups.flatMap(g => g.entries).some(e => e.label === 'Founder Orientation');
    await until(credited, 'Orientation award credited', 25000);
    if (reloadAt === 'seen') await until(async () => (await seenRing()).length > 0, 'Client showed the Orientation cheque', 15000);
    report.reloadAtAward = { mode: reloadAt, seenBeforeReload: (await seenRing()).length > 0, stepBeforeReload: (await progress()).step };
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#world[data-ready="true"][data-connected="true"]', { timeout: 180000 });
    await page.locator('#loading').waitFor({ state: 'hidden' });
    await until(async () => (await progress()).step !== 'drive_ring', 'Orientation step cleared after an immediate reload', 20000);
    await page.waitForTimeout(3000);
    report.reloadAtAward.stepAfterReload = (await progress()).step;
    report.reloadAtAward.chequeCardShown = await page.locator('.gt-funding-toast:not([hidden])').count() > 0;
    await record('orientation-reload');
    report.reloadAtAward.cardTitle = await page.locator('.gt-funding-toast-title').textContent().catch(() => null);
    // A cheque the client already showed must not replay; one it never showed shows once.
    assert.equal(report.reloadAtAward.chequeCardShown, !report.reloadAtAward.seenBeforeReload, 'chequeOnce: the cheque card shows after the reload only if it was never shown before it');
    report.checks.push({ name: 'orientation-reload-step-cleared', ...report.reloadAtAward, passed: true });
    assert.deepEqual(report.errors, []); assert.deepEqual(report.httpErrors, []);
    report.coreJourneyPassed = true; report.pendingAcceptance = []; report.scenarioAcceptancePassed = true;
    break journey;
  }
  await page.getByRole('dialog', { name: 'Create your founder', exact: true }).waitFor({ state: 'visible', timeout: 25000 });
  const orientation = await api('/api/funding/captable');
  const entry = orientation.groups.flatMap(g => g.entries).find(e => e.label === 'Founder Orientation');
  assert(entry, 'Actual server Orientation receipt exists, not just the fallback timer');
  report.orientationReceipt = entry; report.orientationSource = ORIENTATION_SOURCE_REF;
  report.expectedOrientationCents = orientationAwardCents().toString();
  report.firstChequeSeconds = (entry.awardedAt - Date.parse(report.tutorialStartedAt)) / 1000;
  assert.equal((await state()).funding.totalCents, report.expectedOrientationCents);
  await record('orientation-paid-identity');
  await until(async () => Math.abs((await state()).speed) < .1, 'Identity modal applies the normal parking brake', 15000);
  const parked = await state(); await page.waitForTimeout(2000); const stillParked = await state();
  assert(distance(parked.pose, stillParked.pose) < .1, 'Car remains parked while the founder form is open');
  report.checks.push({ name: 'identity-modal-parking', start: parked.pose, end: stillParked.pose, passed: true });
  await activate(page.getByRole('dialog', { name: 'Create your founder', exact: true }).getByRole('button', { name: 'Looks good', exact: true }));
  await page.getByRole('dialog', { name: 'Create your founder', exact: true }).waitFor({ state: 'hidden' });
  await until(async () => (await progress()).step === 'gps', 'Identity saved');
  const recoveryEnabled = (await api('/api/health')).flags.accountRecovery;
  if (recoveryFixture) assert.equal(recoveryEnabled, true, 'Disposable Worker has the same explicit recovery feature');
  if (recoveryEnabled) await page.getByRole('dialog', { name: 'Save your startup', exact: true }).waitFor();
  report.recovery = { offered: await page.locator('.gt-recovery[open]').count() > 0, enabled: recoveryEnabled };
  if (report.recovery.offered) {
    await page.getByRole('button', { name: 'Generate my recovery code', exact: true }).waitFor();
    await record('recovery-offered'); // Do not generate, screenshot or persist a recovery credential.
    await activate(page.locator('.gt-recovery[open]').getByRole('button', { name: 'Close', exact: true }));
  }
  await record('identity-saved');
  // Sitting in the same ring across repeated server ticks must not pay twice.
  await page.waitForTimeout(2500);
  const repeated = await api('/api/funding/captable');
  assert.deepEqual(repeated.groups.flatMap(g => g.entries).filter(e => e.label === 'Founder Orientation'), [entry]);
  report.checks.push({ name: 'orientation-once-ever', passed: true, receipt: entry });
  if (phone) await activate(button('enter-exit')); else await page.keyboard.press('KeyE');
  await page.waitForSelector('#world[data-mode="on-foot"]');
  await openMap();
  await page.locator('.gt-radar[data-expanded="true"]').waitFor();
  await record('map-open-before-selection', { rows: await page.locator('.gt-radar-list button').allTextContents() });
  await activate(page.locator('.gt-radar-list button').first());
  await record('nearest-event-card');
  await activate(page.locator('.gt-radar-card').getByRole('button', { name: 'Set destination', exact: true }));
  await until(async () => (await progress()).step === 'taxi', 'GPS choice advances tutorial');
  await record('gps-set');
  const destination = (await state()).route?.approach; assert(destination, 'Real road route to selected event');
  await hail(); await pickTaxiDestination();
  await until(async () => ['pickup', 'riding', 'arrived'].includes((await state()).taxi), 'Robotaxi accepted', 25000); // quickRobotaxi can finish before a poll sees pickup/riding
  await record('robotaxi-accepted');
  await until(async () => (await state()).mode === 'on-foot' && distance((await state()).pose, destination) < 90, 'Robotaxi arrives at event', 180000); // quickRobotaxi drops ~60 m off the approach; walk() covers the rest
  await record('robotaxi-arrived');
  if (!(await progress()).completed) await walk(destination, 6, 60000);
  await until(async () => (await progress()).completed, 'Real event award completes tutorial');
  assert(BigInt((await state()).funding.totalCents) > BigInt(report.expectedOrientationCents));
  report.missionSeconds = (Date.now() - Date.parse(report.tutorialStartedAt)) / 1000;
  await record('mission-complete');
  assert.equal((await state()).locked, null, 'Full HUD unlocked');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#world[data-ready="true"][data-connected="true"]', { timeout: 180000 });
  await page.locator('#loading').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.gt-sa-intro').count(), 0); assert.equal((await progress()).completed, true);
  const whatsNew = page.getByRole('dialog', { name: "What's new in GTASF", exact: true });
  if (await whatsNew.isVisible()) {
    await record('returning-whats-new');
    await activate(whatsNew.getByRole('button', { name: "Let's go", exact: true }));
    await whatsNew.waitFor({ state: 'hidden' });
  }
  await record('returning-profile');
  assert.equal(await page.locator('.gt-recovery[open]').count(), 0, 'Recovery offer is not repeated on reload');
  await openOptions();
  await activate(page.getByRole('button', { name: 'Replay tutorial', exact: true }));
  await page.getByRole('dialog', { name: 'Game options', exact: true }).waitFor({ state: 'hidden' });
  await page.locator('.gt-sa-intro').waitFor({ state: 'visible' }); await record('replay-visible');
  const replayTitle = await page.locator('.gt-sa-intro__title').textContent();
  const replayPoint = await centre(page.locator('.gt-sa-intro'));
  if (phone) await page.touchscreen.tap(replayPoint.x, replayPoint.y); else await page.keyboard.press('Enter');
  await page.waitForFunction(title => {
    const next = document.querySelector('.gt-sa-intro__title'); return Boolean(next && next.textContent !== title);
  }, replayTitle);
  await record('replay-advanced');
  const finalTable = await api('/api/funding/captable');
  assert.deepEqual(finalTable.groups.flatMap(g => g.entries).filter(e => e.label === 'Founder Orientation'), [entry]);
  assert.deepEqual(report.errors, []); assert.deepEqual(report.httpErrors, []);
  assert.deepEqual((await state()).mapErrors, []); report.coreJourneyPassed = true;
  report.pendingAcceptance = [];
  if (!report.recovery.offered) report.pendingAcceptance.push('Recovery code was not offered (feature currently disabled).');
  if (report.firstChequeSeconds >= 60) report.pendingAcceptance.push('First cheque exceeded 60 seconds.');
  if (report.missionSeconds > 180) report.pendingAcceptance.push('Mission exceeded three minutes.');
  report.scenarioAcceptancePassed = report.pendingAcceptance.length === 0;
  } // journey
} catch (error) {
  report.failure = String(error.stack ?? error); await save();
  report.failureState = page ? await state().catch(() => null) : null;
  await page?.screenshot({ path: `${out}/failure.png`, timeout: 10000, scale: 'css' }).catch(() => {});
  console.error(`ONBOARDING_JOURNEY_FAIL ${String(error)}`);
} finally {
  await release().catch(() => {}); await browser?.close();
  if (server) { server.httpServer.closeAllConnections(); await new Promise(done => server.httpServer.close(done)); }
  await pool?.close(); report.finishedAt = new Date().toISOString(); await save();
  console.log(`ONBOARDING_JOURNEY_REPORT ${out}/report.json`); if (!report.coreJourneyPassed) process.exitCode = 1;
}
