// "Drive a Fare" (mission taxi-fare, flag taxiFareJob) end-to-end on a LOCAL stack with missions on:
//   SNAP=/tmp/gtasf-lanec-verify WEB_PORT=5319 WORKER_PORT=8988 COMBAT_FLAGS="founderLadder pitching" tools/combat-stack.sh up
//   tools/heavy.sh node tools/taxi-fare-verify.mjs
// E at the F (Ferry taxi stand) on foot -> an instant claim and standing at the stand on foot are refused (drive
// objectives count only from the driver's seat) -> into the nearest parked car -> pull up at the stand -> drive Market St
// to Union Square in server-legal steps -> the runner's mission-complete pays once.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
setTimeout(() => { console.log('RESULT: CHECK FAILED (watchdog 6 min)'); process.exit(2); }, 360_000).unref();
const base = process.env.GTASF_VERIFY_URL ?? 'http://localhost:5319';
const out = process.env.OUT ?? 'docs/sf-data/missions/taxi-fare'; mkdirSync(out, { recursive: true });
const START = { lat: 37.795000, lon: -122.394200 }; // shared/founder/missions.ts 'taxi-fare' (stand = pickup)
const ROUTE = [{ lat: 37.79460, lon: -122.39490 }, { lat: 37.78940, lon: -122.40130 }, { lat: 37.78510, lon: -122.40680 }, { lat: 37.787696, lon: -122.407555 }]; // Embarcadero -> Market -> Powell -> Geary
const result = { base, at: new Date().toISOString(), legs: [] };
const project = (lat, lon) => { const rad = Math.PI / 180, f = 1 / 298.257223563, e2 = f * (2 - f);
  const ecef = (la, lo) => { const phi = la * rad, lam = lo * rad, n = 6378137 / Math.sqrt(1 - e2 * Math.sin(phi) ** 2); return [n * Math.cos(phi) * Math.cos(lam), n * Math.cos(phi) * Math.sin(lam), n * (1 - e2) * Math.sin(phi)]; };
  const o = { lat: 37.7842, lon: -122.4078 }, a = ecef(o.lat, o.lon), b = ecef(lat, lon), d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const phi = o.lat * rad, lam = o.lon * rad;
  return { x: -Math.sin(lam) * d[0] + Math.cos(lam) * d[1], z: -(-Math.sin(phi) * Math.cos(lam) * d[0] - Math.sin(phi) * Math.sin(lam) * d[1] + Math.cos(phi) * d[2]) }; };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
// The guided opener (b6a71d58) is newer than this check: play as a device that has already seen it (OPENER=1 keeps it).
if (!process.env.OPENER) await ctx.addInitScript(() => { try { localStorage.setItem('gtasf.opener.v1', 'skipped'); } catch { /* storage blocked */ } });
await ctx.addInitScript(() => { try {
  localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'QA Fares', foundedAt: 1, billboardSeen: true, preSeedClosed: true, lastRoundCloseDay: '2020-01-01' }));
  localStorage.setItem('gtasf.founder.bucket.v2', 'ladder'); } catch {} });
const page = await ctx.newPage(); page.setDefaultTimeout(90000);
const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 160)));
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) errs.push(m.text().slice(0, 160)); });
const api = []; page.on('response', r => { const p = new URL(r.url()).pathname; if (p.startsWith('/api/funding/mission-')) r.json().then(b => api.push({ p, http: r.status(), ...b })).catch(() => {}); });
const toasts = []; await page.exposeFunction('__toast', t => toasts.push(t));
async function clearOnboarding(p) {
  for (let i = 0; i < 20; i++) { const b = await p.evaluate(() => { const v = s => { const e = document.querySelector(s); return !!(e && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })); }; return { intro: v('.gt-sa-intro') || v('.gt-sa-intro__skip'), id: v('.gt-identity-go'), fund: !!document.querySelector('.gt-funding-onboarding[open]') }; });
    if (!b.intro && !b.id && !b.fund) break;
    if (b.fund) { try { const d = p.locator('.gt-funding-onboarding[open]'); await d.getByLabel('Startup name', { exact: true }).fill('QA Fares'); await d.getByLabel('Your nickname', { exact: true }).fill('q'); await d.getByRole('button', { name: 'Save startup' }).click({ timeout: 3000 }); } catch {} await p.waitForTimeout(600); continue; }
    if (b.id) { try { await p.locator('.gt-identity-go').click({ timeout: 3000 }); } catch {} await p.waitForTimeout(500); continue; }
    if (b.intro) { await p.evaluate(() => document.querySelector('.gt-sa-intro__skip')?.click()); await p.waitForTimeout(500); continue; } }
  await p.waitForTimeout(800);
}
// Walk the server pose: 0.7 m nudges ~every 110 ms (under the 8 m/s on-foot cap); stops within `stop` m.
async function walkTo(t, stop, maxSteps = 4000) {
  const target = project(t.lat, t.lon); let last = Infinity, stuck = 0, d = Infinity;
  for (let i = 0; i < maxSteps; i++) {
    d = await page.evaluate(({ tx, tz, stop }) => { const f = window.__gtasf.world.foot; const dx = tx - f.x, dz = tz - f.z, d = Math.hypot(dx, dz);
      if (d > stop) { const k = Math.min(0.7, d - stop + 0.1) / d; f.x += dx * k; f.z += dz * k; } return d; }, { tx: target.x, tz: target.z, stop });
    if (d <= stop + 0.2) break;
    if (i % 150 === 0) await page.keyboard.press('ShiftLeft'); // real input, or the 5-min idle kick ends the session
    if (last - d < 0.05) { if (++stuck > 40) break; } else stuck = 0;
    last = d; await page.waitForTimeout(110);
  }
  await page.waitForTimeout(900);
  return Math.round(d);
}
// Move the server pose in legal steps: on foot 0.7 m / 110 ms, in the car 2.5 m / 110 ms (~23 m/s, cap 75).
async function moveTo(p, stop) {
  let d = Infinity, last = Infinity, stuck = 0, sidesteps = 0;
  for (let i = 0; i < 6000; i++) {
    d = await page.evaluate(({ x, z, stop }) => { const w = window.__gtasf.world, car = w.mode === 'driver' && w.driving, f = car ? w.driving : w.foot, step = car ? 2.5 : 0.7;
      const dx = x - f.x, dz = z - f.z, d = Math.hypot(dx, dz);
      if (d > stop) { const k = Math.min(step, d - stop) / d; let nx = f.x + dx * k, nz = f.z + dz * k;
        // In the car, keep each step on a road lane (a straight line between waypoints clips the raised sidewalk = a wall).
        if (car && d > 20) { const r = w.map.nearestRoad(nx, nz, 12); if (r && Math.hypot(r.x - nx, r.z - nz) < 8) { const m = Math.hypot(r.x - f.x, r.z - f.z) || 1, s2 = Math.min(step, m) / m; nx = f.x + (r.x - f.x) * s2; nz = f.z + (r.z - f.z) * s2; } }
        if (car) f.yaw = Math.atan2(nx - f.x, nz - f.z); f.x = nx; f.z = nz; } return d; }, { x: p.x, z: p.z, stop });
    if (d <= stop + 0.2) break;
    if (i % 150 === 0) await page.keyboard.press('ShiftLeft');
    if (last - d < 0.05) { // blocked (traffic, a prop, a kerb): sidestep a few metres and retry, then give up the leg
      if (++stuck > 25) {
        if (++sidesteps > 6) break;
        const side = sidesteps % 2 ? 1 : -1;
        await page.evaluate(({ x, z, side }) => { const w = window.__gtasf.world, f = w.mode === 'driver' && w.driving ? w.driving : w.foot;
          const dx = x - f.x, dz = z - f.z, n = Math.hypot(dx, dz) || 1; for (let k = 0; k < 2; k++) { f.x += -dz / n * 2.5 * side; f.z += dx / n * 2.5 * side; } }, { x: p.x, z: p.z, side });
        stuck = 0;
      }
    } else stuck = 0;
    last = d; await page.waitForTimeout(110);
  }
  await page.waitForTimeout(600);
  return Math.round(d);
}
const pressE = async () => { await page.keyboard.down('KeyE'); await page.waitForTimeout(90); await page.keyboard.up('KeyE'); };
const claim = () => page.evaluate(async () => { const r = await fetch('/api/funding/mission-complete', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' }); return { http: r.status, body: await r.json().catch(() => null) }; });
try {
  await page.goto(`${base}/?at=${(START.lat + 0.0003).toFixed(6)},${START.lon.toFixed(6)},180&bot=1&preset=low`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 120000 });
  await clearOnboarding(page);
  await page.waitForSelector('.gt-mission-phone', { state: 'attached', timeout: 180000 }).catch(() => {});
  await clearOnboarding(page);
  await page.keyboard.press('KeyN'); await page.waitForTimeout(900);
  result.phoneJobs = await page.evaluate(() => [...document.querySelectorAll('.gt-mission-phone-item-title')].map(e => e.textContent));
  result.phoneFramed = await page.evaluate(() => { const p = document.querySelector('.gt-mission-phone'); return !!p && !p.hidden && p.classList.contains('gt-mission-phone--framed') && /\d:\d\d/.test(p.querySelector('.gt-mission-phone-clock')?.textContent ?? ''); });
  await page.screenshot({ path: `${out}/phone-desktop.jpg`, type: 'jpeg', quality: 78 });
  await page.keyboard.press('KeyN');
  result.legs.push({ to: 'F', dist: await moveTo(project(START.lat, START.lon), 3) });
  await page.screenshot({ path: `${out}/stand-desktop.jpg`, type: 'jpeg', quality: 78 });
  await pressE(); await page.waitForTimeout(2000);
  result.started = api.find(a => a.p === '/api/funding/mission-start') ?? null;
  result.instantClaim = await claim();        // on foot at the stand = the pickup point: must not count
  const car = await page.evaluate(() => { const w = window.__gtasf.world, f = w.foot; let best = null, bd = 120; // nearest parked road car (fleet.nearest only sees cars already in reach)
    for (const c of w.fleet.cars.values()) { if (!c.model.root.visible || !['prius', 'tesla', 'subaru'].includes(c.data.kind)) continue;
      const p = c.model.root.position, d = Math.hypot(p.x - f.x, p.z - f.z); if (d < bd) { bd = d; best = { x: p.x, z: p.z, kind: c.data.kind, d: Math.round(d) }; } }
    return best; });
  result.carAt = car;
  if (car) { result.legs.push({ to: 'car', dist: await moveTo(car, 3.5) }); await pressE(); }
  await page.waitForFunction(() => window.__gtasf.world.mode === 'driver', null, { timeout: 10000 }).catch(() => {});
  result.mode = await page.evaluate(() => window.__gtasf.world.mode);
  if (result.mode !== 'driver') throw new Error(`not seated (mode ${result.mode}, car ${JSON.stringify(car)})`);
  result.legs.push({ to: 'stand', dist: await moveTo(project(START.lat, START.lon), 6) });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/pickup-desktop.jpg`, type: 'jpeg', quality: 78 });
  // taxiFarePassenger (gtasf-l9j3r): the fare walks to the passenger door and sits — where is it, and is it in the car?
  const fare = () => page.evaluate(() => { const w = window.__gtasf.world;
    const roots = [w.landmarks, ...[...w.fleet.cars.values()].map(c => c.model.root)].filter(Boolean);
    let n = null; for (const r of roots) { r.traverse(o => { if (!n && o.name === 'Taxi fare passenger') n = o; }); if (n) break; }
    if (!n) return null;
    const p = n.getWorldPosition(n.position.clone()), f = w.foot;
    return { parent: n.parent?.name || n.parent?.type || null, visible: n.visible, distToPlayer: Math.round(Math.hypot(p.x - f.x, p.z - f.z) * 10) / 10 }; });
  result.fareAtPickup = await fare();
  await page.waitForTimeout(3000);
  result.fareSeated = await fare();
  await page.screenshot({ path: `${out}/seated-desktop.jpg`, type: 'jpeg', quality: 78 });
  for (const [side, turn] of [['left', Math.PI / 2], ['right', -Math.PI / 2]]) { // the chase cam is behind: swing to each side
    await page.evaluate(t => { const c = window.__gtasf.world.camera; c.setOrbit?.(c.yaw + t, -0.12); }, turn);
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${out}/seated-${side}-desktop.jpg`, type: 'jpeg', quality: 78 });
    await page.evaluate(t => { const c = window.__gtasf.world.camera; c.setOrbit?.(c.yaw - t, -0.12); }, turn);
  }
  // Drive the GPS's own A* road path to the drop-off (straight lines between waypoints clip the raised sidewalks).
  const drop = project(ROUTE[ROUTE.length - 1].lat, ROUTE[ROUTE.length - 1].lon);
  await page.evaluate(({ x, z }) => { const w = window.__gtasf.world; w.radar.setDestination({ id: 'qa-fare', title: 'Union Square', x, y: w.foot.y, z, walkingStop: true }); }, drop);
  const path = await page.waitForFunction(() => { const r = window.__gtasf.world.radar.route; return r?.points?.length ? r.points.map(p => ({ x: p[0], z: p[2] })) : null; }, null, { timeout: 20000 }).then(h => h.jsonValue()).catch(() => null);
  result.pathPoints = path?.length ?? 0;
  if (path) { for (const [i, q] of path.entries()) if (i % 3 === 0 || i === path.length - 1) await moveTo(q, 1.5); }
  result.legs.push({ to: 'dropoff', dist: await moveTo(drop, 4) });
  await page.waitForTimeout(1100);
  result.fareAlighting = await fare?.().catch(() => null);
  await page.screenshot({ path: `${out}/alighting-desktop.jpg`, type: 'jpeg', quality: 78 });
  await page.waitForTimeout(2900);
  await page.screenshot({ path: `${out}/dropoff-desktop.jpg`, type: 'jpeg', quality: 78 });
  result.completes = api.filter(a => a.p === '/api/funding/mission-complete');
} catch (e) { result.failure = String(e?.message ?? e).slice(0, 240); }
result.errs = errs; result.toasts = toasts.slice(-8);
const paid = result.completes?.find(c => c.http === 200 && c.status === 'completed' && c.outcome?.credited === true);
result.checks = { phoneFramed: !!result.phoneFramed, listed: (result.phoneJobs ?? []).includes('Drive a Fare'), started: result.started?.http === 200, instantRefused: result.instantClaim?.body?.status === 'incomplete',
  driving: result.mode === 'driver', paid: !!paid, noConsoleErrors: !errs.length };
console.log(JSON.stringify(result, null, 1));
console.log(`\nRESULT: ${Object.values(result.checks).every(Boolean) ? 'TAXI FARE PASS' : 'CHECK FAILED'} ${JSON.stringify(result.checks)}`);
await browser.close();
