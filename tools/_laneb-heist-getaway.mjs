// Lane B (critic N47 acceptance, combat stack): the pitch-deck heist end to end with heistGetaway + heistHeatOnLeave + the
// escape bundle: walk into the start, E, follow the radar to the routed 'Getaway car', E to drive, drive the route (the
// car's pose is moved along radar.route at DRIVE_MPS, faster than the SFPD's 13 m/s, so distance breaks their sight —
// locally nothing else does), until 'Lose the heat' completes; then drive the route to First Round and finish.
// Frames at grab / getaway toast / escape / finish in OUT. Entry code from tools/heist-prod-verify.mjs.
//   GTASF_URL=http://localhost:5393 OUT=docs/qa/2026-10-20/laneb-heist-getaway node tools/_laneb-heist-getaway.mjs
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

setTimeout(() => { console.log('RESULT watchdog'); process.exit(2); }, 600_000).unref();
const base = process.env.GTASF_URL ?? 'http://localhost:5393';
const OUT = resolve(process.env.OUT ?? 'docs/qa/2026-10-20/laneb-heist-getaway'); await mkdir(OUT, { recursive: true });
const DRIVE_MPS = Number(process.env.DRIVE_MPS ?? 18);
const HEIST = [37.782190, -122.402980];
const log = [], note = s => { log.push(s); console.log(s); };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => { try {
  localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'QA Heist', foundedAt: 1, billboardSeen: true, preSeedClosed: true, lastRoundCloseDay: '2020-01-01' }));
  localStorage.setItem('gtasf.founder.bucket.v2', 'ladder'); } catch {} });
const page = await ctx.newPage(); page.setDefaultTimeout(90_000);
const errors = []; page.on('pageerror', e => errors.push(String(e.message).slice(0, 140)));
const api = []; page.on('response', r => { const p = new URL(r.url()).pathname; if (/mission-(start|complete)/.test(p)) r.json().then(b => api.push({ p, b })).catch(() => {}); });
const pressE = async () => { await page.keyboard.down('KeyE'); await page.waitForTimeout(90); await page.keyboard.up('KeyE'); };
let shots = 0; const shot = async name => { await page.screenshot({ path: resolve(OUT, `${String(++shots).padStart(2, '0')}-${name}.jpg`), quality: 80 }); note(`  frame ${name}`); };
const state = () => page.evaluate(() => { const w = window.__gtasf.world, text = document.body.innerText || ''; let cop = Infinity;
  const me = w.mode === 'driver' && w.driving ? w.driving : w.foot;
  for (const c of w.fleet?.cars?.values() ?? []) if (c.data.flags & 0x40) { const p = c.model?.root?.position ?? c.data; cop = Math.min(cop, Math.hypot(p.x - me.x, p.z - me.z)); }
  return { mode: w.mode, stars: document.querySelectorAll('.gt-combat-wanted-star.lit').length, cop: Number.isFinite(cop) ? Math.round(cop) : null,
    phase: (() => { const r = document.querySelector('.gt-combat-escape'); return r && !r.hidden ? (document.querySelector('.gt-combat-escape-label')?.textContent ?? '').trim().slice(0, 30) : ''; })(),
    obj: /MISSION PASSED/i.test(text) ? 'PASSED' : /Deliver the deck/i.test(text) ? 'DELIVER' : /Lose the heat/i.test(text) ? 'LOSE-HEAT' : /job failed|caught up/i.test(text) ? 'FAILED' : /BUSTED/i.test(text) ? 'BUSTED' : '',
    getaway: /Getaway car/i.test(text), route: w.radar?.route?.points?.length ?? 0 }; });
// Move the player (on foot 0.5 m / car DRIVE_MPS) along radar.route for up to maxS seconds or until stop() says so.
// Pure-pursuit follower from lane E's tools/_qa-heist-getaway.mjs (10-20): aiming at 'the point after the nearest' oscillated
// around a re-planned route's first points and stalled ~20 m short.
async function followRoute(maxS, stop, label) {
  const t0 = Date.now(); let last = '';
  while (Date.now() - t0 < maxS * 1000) {
    const moved = await page.evaluate(stepM => { const w = window.__gtasf.world, pts = w.radar?.route?.points; if (!pts?.length) return 'no-route';
      const me = w.mode === 'driver' && w.driving ? w.driving : w.foot;
      let bestD = Infinity, bestS = 0, acc = 0; const cum = [0];
      for (let j = 1; j < pts.length; j++) { const ax = pts[j - 1][0], az = pts[j - 1][2], vx = pts[j][0] - ax, vz = pts[j][2] - az, L = Math.hypot(vx, vz) || 1e-6;
        const t = Math.max(0, Math.min(1, ((me.x - ax) * vx + (me.z - az) * vz) / (L * L))), q = Math.hypot(me.x - (ax + vx * t), me.z - (az + vz * t));
        if (q < bestD) { bestD = q; bestS = acc + t * L; } acc += L; cum.push(acc); }
      if (acc - bestS < 0.6 && bestD < 1.5) return 'end';
      const goal = Math.min(acc, bestS + 8); let tgt = pts.at(-1);
      for (let j = 1; j < pts.length; j++) if (cum[j] >= goal) { const L = cum[j] - cum[j - 1] || 1e-6, t = (goal - cum[j - 1]) / L; tgt = [pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * t, 0, pts[j - 1][2] + (pts[j][2] - pts[j - 1][2]) * t]; break; }
      const dx = tgt[0] - me.x, dz = tgt[2] - me.z, d = Math.hypot(dx, dz); if (d < 0.3) return 'end';
      const k = Math.min(stepM, d) / d; me.x += dx * k; me.z += dz * k; me.yaw = Math.atan2(dx, dz); return 'ok'; }, (await page.evaluate(() => window.__gtasf.world.mode)) === 'driver' ? DRIVE_MPS * 0.11 : 0.5);
    const s = await state();
    const line = `${label} ${Math.round((Date.now() - t0) / 1000)}s ${s.mode} ${s.stars}* cop ${s.cop ?? '-'}m ${s.phase} [${s.obj}] ${moved}`;
    if (line.replace(/ \d+s /, ' ') !== last) { note(line); last = line.replace(/ \d+s /, ' '); }
    if (stop(s, moved)) return s;
    await page.waitForTimeout(110);
  }
  return state();
}
try {
  await page.goto(`${base}/?at=${(HEIST[0] + 0.0005).toFixed(6)},${HEIST[1]},180&bot=1&preset=low`);
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 120_000 });
  for (let i = 0; i < 12; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(400); }
  await page.evaluate(() => window.__gtasfCombat?.requestCombat?.()); await page.waitForTimeout(600);
  if (await page.locator('.gt-age-gate').isVisible().catch(() => false)) { await page.locator('.gt-age-gate-enter').click(); await page.waitForTimeout(1200); }
  await page.waitForTimeout(2000);
  // Kerb cars are street props, which mount after READY with the deferred scenery (critic 15:1x): the getaway can only
  // route to one if it's shown when the escape starts, so wait for the street props first.
  const propsAt = await page.waitForFunction(() => window.__gtasf.world.streetProps, null, { timeout: 120_000, polling: 1000 }).then(() => 'mounted', () => 'NOT mounted');
  note(`street props ${propsAt}`); await page.waitForTimeout(3000);
  // Walk into the 'H' start (global SF frame ENU, as heist-prod-verify).
  const target = await page.evaluate(([lat, lon]) => { const o = { lat: 37.7842, lon: -122.4078 }, rad = Math.PI / 180, f = 1 / 298.257223563, e2 = f * (2 - f);
    const ecef = (la, lo) => { const p = la * rad, l = lo * rad, n = 6378137 / Math.sqrt(1 - e2 * Math.sin(p) ** 2); return [n * Math.cos(p) * Math.cos(l), n * Math.cos(p) * Math.sin(l), n * (1 - e2) * Math.sin(p)]; };
    const a = ecef(o.lat, o.lon), b = ecef(lat, lon), dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2], p = o.lat * rad, l = o.lon * rad;
    return { x: -Math.sin(l) * dx + Math.cos(l) * dy, z: -(-Math.sin(p) * Math.cos(l) * dx - Math.sin(p) * Math.sin(l) * dy + Math.cos(p) * dz) }; }, HEIST);
  for (let i = 0; i < 900; i++) { const d = await page.evaluate(t => { const f = window.__gtasf.world.foot, dx = t.x - f.x, dz = t.z - f.z, d = Math.hypot(dx, dz); if (d > 5) { const k = 0.5 / d; f.x += dx * k; f.z += dz * k; } return d; }, target); if (d <= 5) break; await page.waitForTimeout(110); }
  await page.waitForTimeout(800);
  for (let i = 0; i < 6 && !api.some(a => a.b?.status === 'started'); i++) { await pressE(); await page.waitForTimeout(1200); }
  note(`start: ${JSON.stringify(api.find(a => /start/.test(a.p))?.b ?? null)}`);
  let s = await state(); note(`after start: ${JSON.stringify(s)}`);
  await shot('grab');
  // Escape: follow the route to the getaway car (heistGetaway routes it), then get in.
  await page.waitForTimeout(1500); s = await state(); if (s.getaway) await shot('getaway-toast');
  s = await followRoute(60, (x, m) => m === 'end' || x.obj === 'BUSTED', 'to-car');
  // The route ends at a walkable stop beside the getaway car, and a kerb car steals only within 3 m of it: search the
  // kerb around the route's end (rings of 1-6 m, 8 directions), pressing E at each point until we're driving.
  // Search around the route's APPROACH (the road point snapped from the destination: a kerb car sits at the road edge),
  // falling back to where the walk ended.
  const geo = await page.evaluate(() => { const w = window.__gtasf.world, r = w.radar?.route, f = w.foot;
    return { foot: { x: f.x, z: f.z }, approach: r?.approach ? { x: r.approach.x, z: r.approach.z } : null, destM: r?.destinationDistanceM ?? null, last: r?.points?.at(-1) ?? null }; });
  note(`route geometry: ${JSON.stringify(geo)}`);
  const hook = await page.evaluate(() => window.__gtasfGetaway ?? null); // lane C 15:4x: the routed getaway's pose
  if (hook) note(`getaway hook: ${JSON.stringify(hook)}`);
  const end = hook ? { x: hook.x, z: hook.z } : geo.approach ?? geo.foot;
  const isDriver = () => page.evaluate(() => window.__gtasf.world.mode === 'driver');
  await pressE(); await page.waitForTimeout(1300);
  search: for (let r = 1; r <= 6 && !(await isDriver()); r++) for (let k = 0; k < 8; k++) {
    const goal = { x: end.x + Math.cos(k * Math.PI / 4) * r, z: end.z + Math.sin(k * Math.PI / 4) * r };
    for (let i = 0; i < 40; i++) { const d = await page.evaluate(g => { const f = window.__gtasf.world.foot, dx = g.x - f.x, dz = g.z - f.z, d = Math.hypot(dx, dz); if (d > 0.3) { const k = Math.min(0.5, d) / d; f.x += dx * k; f.z += dz * k; } return d; }, goal); if (d <= 0.3) break; await page.waitForTimeout(110); }
    await pressE(); await page.waitForTimeout(900);
    if (await isDriver()) { note(`stole the getaway at ring ${r} m, dir ${k}`); break search; }
  }
  s = await state(); note(`in car: ${s.mode} stars ${s.stars}`);
  // Drive away along whatever the radar routes (getaway done -> the deliver route) until the heat is lost.
  s = await followRoute(150, x => x.obj === 'DELIVER' || x.obj === 'PASSED' || x.obj === 'FAILED' || x.obj === 'BUSTED', 'escape');
  await shot(`escape-${s.obj || 'end'}`);
  if (s.obj === 'DELIVER') {
    s = await followRoute(200, (x, m) => x.obj === 'PASSED' || m === 'end', 'deliver');
    for (let i = 0; i < 8 && (await state()).obj !== 'PASSED'; i++) await page.waitForTimeout(1000);
    s = await state(); await shot(`finish-${s.obj || 'end'}`);
  }
  note(`complete: ${JSON.stringify(api.find(a => /complete/.test(a.p))?.b ?? null)}`);
  note(`RESULT ${s.obj === 'PASSED' ? 'PASS: MISSION PASSED' : `NOT PASSED (${s.obj || 'no objective'})`} errors=${JSON.stringify(errors)}`);
} catch (e) { note(`FATAL ${e?.stack ?? e}`); }
await browser.close();
