// LANE E: reproduce the founder's 2026-10-14 desktop feedback around Union Square / Powell on prod, headless,
// on a fresh is_bot device (desktop Mac-like: 1440x900 @2, default preset). Each check writes shots + numbers.
//   node tools/qa-founder-repro.mjs [checks]     checks = cars,robotaxi,pit,flash,shoot,police (default all)
//   GTASF_QA_URL=… OUT=docs/qa/<day>/founder node tools/qa-founder-repro.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const BASE = (process.env.GTASF_QA_URL ?? 'https://gtasf.com').replace(/\/$/, '');
const OUT = process.env.OUT ?? 'docs/qa/2026-10-14/founder'; mkdirSync(OUT, { recursive: true });
const CHECKS = new Set((process.argv[2] ?? 'cars,robotaxi,pit,flash,shoot,police').split(','));
const UNION = '37.789100,-122.409600,90';
const R = { base: BASE, at: new Date().toISOString(), checks: {}, consoleErrors: [], http: [] };
const note = (k, s) => { ((R.checks[k] ??= {}).notes ??= []).push(s); console.log(`[${k}] ${s}`); };

const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2,
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36' });
// A returning founder (the founder plays as one): skip the first-run spine so the full HUD + combat entry are live.
await ctx.addInitScript(() => { try { localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'QA Founder', foundedAt: 1, billboardSeen: true, preSeedClosed: true, lastRoundCloseDay: '2020-01-01' })); } catch {} });
const page = await ctx.newPage(); page.setDefaultTimeout(30000);
let tag = 'boot';
// Server→client opcodes worth counting (shared/protocol/constants.ts S2C): hits, busts, explosions, officers, vitals.
const OPS = { 0xa8: 'COMBAT_HIT', 0xa9: 'WANTED', 0xaa: 'BUSTED', 0xab: 'OFFICERS', 0xad: 'EXPLOSION', 0xae: 'COMBAT_VITALS', 0xb2: 'POLICE_RAM' };
const opCount = {}; const resetOps = () => { for (const k of Object.keys(opCount)) delete opCount[k]; };
page.on('pageerror', e => R.consoleErrors.push(`${tag}: ${e.message.slice(0, 200)}`));
page.on('websocket', ws => ws.on('framereceived', f => { if (typeof f.payload === 'string') return; const op = OPS[f.payload[0]]; if (op) opCount[op] = (opCount[op] ?? 0) + 1; }));
page.on('console', m => { if (m.type() === 'error') R.consoleErrors.push(`${tag}: ${m.text().slice(0, 200)}`); });
page.on('response', r => { if (r.status() >= 400) R.http.push(`${tag}: ${r.status()} ${new URL(r.url()).pathname}`); });
let n = 0; const shot = async name => { const f = `${OUT}/${String(++n).padStart(2, '0')}-${name}.jpg`; await page.screenshot({ path: f, type: 'jpeg', quality: 72 }); return f; };
const press = async (code, ms = 90) => { await page.keyboard.down(code); await page.waitForTimeout(ms); await page.keyboard.up(code); };
const W = (fn, arg) => page.evaluate(fn, arg);

async function boot(at) {
  await page.goto(`${BASE}/?at=${at}&bot=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 150000 });
  for (let i = 0; i < 12; i++) { await W(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(300); }
  await page.waitForSelector('.gt-mission-phone', { state: 'attached', timeout: 120000 }).catch(() => {});
  for (let i = 0; i < 6; i++) { await W(() => { document.querySelector('.gt-sa-intro__skip')?.click(); }); await page.waitForTimeout(300); }
  await page.waitForTimeout(2500);
}
const state = () => W(() => { const w = window.__gtasf.world; return { mode: w.mode, vehicleId: w.vehicleId, taxi: w.taxiState, foot: { x: +w.foot.x.toFixed(2), y: +w.foot.y.toFixed(2), z: +w.foot.z.toFixed(2) } }; });
async function walkToXZ(tx, tz, stop = 1.5, maxMs = 40000) {
  const t0 = Date.now(); let d = Infinity;
  while (Date.now() - t0 < maxMs) {
    d = await page.evaluate(({ tx, tz, stop }) => { const f = window.__gtasf.world.foot; const dx = tx - f.x, dz = tz - f.z, d = Math.hypot(dx, dz);
      if (d > stop) { const k = Math.min(0.6, d - stop + 0.05) / d; f.x += dx * k; f.z += dz * k; } return d; }, { tx, tz, stop });
    if (d <= stop + 0.1) break; await page.waitForTimeout(110);
  }
  return d;
}

// Walk for real (keyboard + client collision, so the server accepts every MOVE): aim the chase camera so W heads at
// the target, short bursts, re-aim. Lane B (gtasf-b4wtu): the foot.x/z nudge above bypasses collision, the server
// rejects those MOVEs, and a kerb-car take is then refused for reach. Use this for anything the server range-checks.
async function keyWalkToXZ(tx, tz, stop = 2.2, maxMs = 40000) {
  const t0 = Date.now(); let d = Infinity;
  while (Date.now() - t0 < maxMs) {
    d = await W(({ tx, tz }) => { const w = window.__gtasf.world, f = w.foot; const d = Math.hypot(tx - f.x, tz - f.z);
      w.camera.setOrbit(Math.atan2(tx - f.x, tz - f.z) + Math.PI, -0.2); return d; }, { tx, tz });
    if (d <= stop) break;
    await page.keyboard.down('KeyW'); await page.waitForTimeout(Math.min(400, 120 + d * 60)); await page.keyboard.up('KeyW');
    await page.waitForTimeout(150);
  }
  return d;
}
// Kerb-parked cars stream in with the street props (they mount well after READY); wait up to 45 s for one.
async function nearestKerbCar() {
  for (let i = 0; i < 90; i++) {
    const k = await W(() => { const w = window.__gtasf.world, f = w.foot; return [...w.kerbCarBodies()].map(k => ({ x: k.x, z: k.z, d: Math.hypot(k.x - f.x, k.z - f.z) })).sort((a, b) => a.d - b.d)[0] ?? null; });
    if (k) return k; await page.waitForTimeout(500);
  }
  throw new Error('no kerb-parked car streamed in within 45 s');
}
try {
  tag = 'boot'; await boot(UNION); await shot('spawn-union-square');

  if (CHECKS.has('cars')) {
    tag = 'cars';
    // Try the nearest few cars: walk beside each, press E, see whether we end up in it.
    const cars = await W(() => { const w = window.__gtasf.world, f = w.foot; return [...(w.fleet?.cars?.values?.() ?? [])].map(c => { const p = c.model.root.position;
      return { id: c.data.id, kind: c.data.kind, flags: c.data.flags, speed: +(c.data.speed ?? 0), x: p.x, z: p.z, d: Math.hypot(p.x - f.x, p.z - f.z) }; }).sort((a, b) => a.d - b.d).slice(0, 4); });
    note('cars', `nearest cars: ${cars.map(c => `#${c.id} ${c.kind} flags=0x${c.flags.toString(16)} ${c.d.toFixed(0)}m`).join(', ')}`);
    const tries = [];
    for (const c of cars.slice(0, 3)) {
      const live = await W(id => { const c = [...window.__gtasf.world.fleet.cars.values()].find(v => v.data.id === id); if (!c) return null; const p = c.model.root.position; return { x: p.x, z: p.z }; }, c.id);
      if (!live) { tries.push({ id: c.id, gone: true }); continue; }
      const d = await walkToXZ(live.x + 2.2, live.z, 1.2, 30000);
      await page.waitForTimeout(500);
      const prompt = await W(() => [...document.querySelectorAll('[class*="prompt"], [class*="interact"]')].filter(e => e.checkVisibility()).map(e => e.textContent.trim()).filter(Boolean).join(' | ').slice(0, 160));
      await press('KeyE'); await page.waitForTimeout(1800);
      const s = await state();
      const g = await W(() => { const w = window.__gtasf.world, f = w.foot; return { ground: +(w.surfaceHeightAt?.(f.x, f.z) ?? NaN).toFixed(2), terrain: +(w.terrainHeightAt?.(f.x, f.z) ?? NaN).toFixed(2) }; });
      tries.push({ id: c.id, kind: c.kind, distM: +d.toFixed(1), prompt, after: s.mode, vehicleId: s.vehicleId, foot: s.foot, ...g });
      await shot(`car-${c.id}-${s.mode}`);
      if (s.mode !== 'on-foot') { await press('KeyE'); await page.waitForTimeout(1500); }
    }
    // The cars a player actually walks up to: the kerb-parked ones (render/props/kerbCars) — are they enterable?
    for (let i = 0; i < 3 && (await state()).mode !== 'on-foot'; i++) { await press('KeyE'); await page.waitForTimeout(1800); }
    // The fleet tries nudge foot.x/z without collision, which can carry us through a building onto its ROOF (seen at
    // y 38 m on Union Sq roofs); a keyboard walk can't get back down. Re-boot at the street spawn before the kerb try.
    await boot(UNION);
    // Wait for kerb cars to stream in around the fresh spawn.
    await nearestKerbCar().catch(() => null);
    const kerb = await W(() => { const w = window.__gtasf.world, f = w.foot; return [...w.kerbCarBodies()].map(k => ({ x: k.x, z: k.z, d: Math.hypot(k.x - f.x, k.z - f.z) })).sort((a, b) => a.d - b.d).slice(0, 2); });
    note('cars', `kerb-parked cars shown: nearest ${kerb.map(k => k.d.toFixed(0) + 'm').join(', ')}`);
    if (kerb[0]) {
      for (let i = 0; i < 3 && (await state()).mode !== 'on-foot'; i++) { await press('KeyE'); await page.waitForTimeout(1800); }
      const before = await state(); note('cars', `before kerb try: ${before.mode} vehicle ${before.vehicleId}`);
      const k0 = (await W(() => { const w = window.__gtasf.world, f = w.foot; return [...w.kerbCarBodies()].map(k => ({ x: k.x, z: k.z, d: Math.hypot(k.x - f.x, k.z - f.z) })).sort((a, b) => a.d - b.d)[0]; }));
      await keyWalkToXZ(k0.x, k0.z, 2.2, 30000); await page.waitForTimeout(500);
      await press('KeyE'); await page.waitForTimeout(1800);
      const v = await W(k => { const w = window.__gtasf.world; const c = [...w.fleet.cars.values()].find(c => c.data.id === w.vehicleId); const p = c?.model.root.position;
        return p ? { id: w.vehicleId, kind: c.data.kind, dToKerb: +Math.hypot(p.x - k.x, p.z - k.z).toFixed(1) } : null; }, k0);
      note('cars', `kerb E → ${JSON.stringify(v)}`); R.checks.cars.kerbEntered = !!v && v.dToKerb < 4;
      if (v) { await press('KeyW', 1500); const moved = await W(() => window.__gtasf.world.driving ? { speed: +window.__gtasf.world.driving.speed.toFixed(1) } : null); note('cars', `drive W 1.5 s: ${JSON.stringify(moved)}`); }
      const toast = await W(() => [...document.querySelectorAll('[class*="notice"], [class*="toast"]')].filter(e => e.checkVisibility()).map(e => e.textContent.trim()).join(' | ').slice(0, 160));
      const s = await state(); tries.push({ kerbParked: true, after: s.mode, notice: toast });
      await shot(`car-kerb-parked-${s.mode}`);
    }
    R.checks.cars.tries = tries;
    note('cars', JSON.stringify(tries));
    R.checks.cars.entered = tries.some(t => t.after === 'driver' || t.after === 'passenger');
  }

  if (CHECKS.has('robotaxi')) {
    tag = 'robotaxi';
    await press('KeyH'); await page.waitForTimeout(1500);
    await shot('robotaxi-picker');
    const pick = page.locator('.gt-taxi-picker[open] button', { hasText: /Ferry Building/i }).first();
    if (await pick.count()) await pick.click(); else note('robotaxi', 'no Ferry Building row in the picker');
    // Sample the ride: our vehicle's position + heading every 100 ms for 45 s.
    const samples = []; const t0 = Date.now();
    while (Date.now() - t0 < 45000) {
      const s = await W(() => { const w = window.__gtasf.world; const car = w.vehicleId ? [...w.fleet.cars.values()].find(v => v.data.id === w.vehicleId) : null;
        const p = car?.model.root.position, cam = w.camera.camera.position;
        return { t: performance.now(), mode: w.mode, taxi: w.taxiState, car: p ? { x: p.x, y: p.y, z: p.z, yaw: car.model.root.rotation.y } : null, cam: { x: cam.x, y: cam.y, z: cam.z } }; });
      samples.push(s);
      if (samples.length % 30 === 0) await shot(`robotaxi-ride-${samples.length / 30}`);
      await page.waitForTimeout(100);
    }
    // Motion anomalies: teleports, reversals, heading snaps, vertical bobbing.
    let tele = 0, reverse = 0, snaps = 0, bob = 0, maxStep = 0; const ride = samples.filter(s => s.car && s.mode !== 'on-foot');
    for (let i = 2; i < ride.length; i++) {
      const a = ride[i - 2].car, b = ride[i - 1].car, c = ride[i].car, dt = (ride[i].t - ride[i - 1].t) / 1000;
      const v1 = [b.x - a.x, b.z - a.z], v2 = [c.x - b.x, c.z - b.z], step = Math.hypot(...v2); maxStep = Math.max(maxStep, step / Math.max(dt, 0.05));
      if (step > 15) tele++;
      if (Math.hypot(...v1) > 0.2 && step > 0.2 && v1[0] * v2[0] + v1[1] * v2[1] < 0) reverse++;
      let dy = Math.abs(c.yaw - b.yaw); dy = Math.min(dy, 2 * Math.PI - dy); if (dy > 0.6) snaps++;
      if (Math.abs((c.y - b.y) - (b.y - a.y)) > 0.4) bob++;
    }
    R.checks.robotaxi = { ...(R.checks.robotaxi ?? {}), samples: samples.length, rideSamples: ride.length, teleports: tele, reversals: reverse, headingSnaps: snaps, verticalJerks: bob, maxSpeedMps: +maxStep.toFixed(1),
      states: [...new Set(samples.map(s => `${s.mode}/${s.taxi}`))] };
    writeFileSync(`${OUT}/robotaxi-samples.json`, JSON.stringify(samples));
    note('robotaxi', JSON.stringify(R.checks.robotaxi));
  }

  if (CHECKS.has('pit')) {
    tag = 'pit';
    await boot('37.784600,-122.407900,30'); // Powell & Market: Hallidie Plaza / the cable car turntable
    // 200 m square around Powell/Market (Hallidie Plaza, the turntable, the BART/Muni stairs) at 2 m spacing.
    const grid = await W(() => { const w = window.__gtasf.world, f = w.foot, out = [];
      for (let dz = -100; dz <= 100; dz += 2) for (let dx = -100; dx <= 100; dx += 2) { const h = w.map.surfaceHeightAt(f.x + dx, f.z + dz); out.push(h == null ? null : +h.toFixed(2)); }
      return { foot: { x: f.x, y: f.y, z: f.z }, grid: out }; });
    const vals = grid.grid.filter(v => v != null).sort((a, b) => a - b); const med = vals[vals.length >> 1];
    const holes = grid.grid.map((v, i) => ({ v, i })).filter(o => o.v != null && o.v < med - 2).map(o => ({ dx: (o.i % 101) * 2 - 100, dz: Math.floor(o.i / 101) * 2 - 100, h: o.v }));
    R.checks.pit = { notes: [], foot: grid.foot, medianH: med, minH: vals[0], maxH: vals.at(-1), nulls: grid.grid.filter(v => v == null).length, holeCells: holes.length, deepest: holes.sort((a, b) => a.h - b.h).slice(0, 8) };
    note('pit', JSON.stringify({ ...R.checks.pit, notes: undefined }));
    for (const [i, yaw] of [0, Math.PI / 2, Math.PI, -Math.PI / 2].entries()) { await W(y => window.__gtasf.world.camera.setOrbit(y, -0.35), yaw); await page.waitForTimeout(900); await shot(`pit-powell-market-${i}`); }
    // Walk to the deepest cell's rim and look into it.
    const deep = R.checks.pit.deepest[0];
    if (deep) {
      const f0 = grid.foot; const tx = f0.x + deep.dx, tz = f0.z + deep.dz;
      const k = 8 / Math.max(1, Math.hypot(deep.dx, deep.dz));
      await walkToXZ(tx - deep.dx * k, tz - deep.dz * k, 1.5, 40000);
      const yaw = Math.atan2(-(tx - (await state()).foot.x), -(tz - (await state()).foot.z));
      for (const [i, p] of [-0.5, -0.9].entries()) { await W(([y, p]) => window.__gtasf.world.camera.setOrbit(y, p), [yaw, p]); await page.waitForTimeout(1200); await shot(`pit-deepest-${i}`); }
      R.checks.pit.lookedFrom = await state();
    }
  }

  if (CHECKS.has('flash')) {
    tag = 'flash';
    await boot(process.env.FLASH_AT ?? UNION);
    // Still camera, 4 headings × 10 frames 120 ms apart; per-pixel luma change between consecutive frames.
    const results = [];
    for (const [i, yaw] of [0, Math.PI / 2, Math.PI, -Math.PI / 2].entries()) {
      await W(y => window.__gtasf.world.camera.setOrbit(y, -0.12), yaw); await page.waitForTimeout(1500);
      const frames = [];
      for (let k = 0; k < 10; k++) { frames.push(await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 1440, height: 760 } })); await page.waitForTimeout(120); }
      const raw = await Promise.all(frames.map(b => sharp(b).resize(360, 190).greyscale().raw().toBuffer()));
      let worst = { frac: 0, k: 0 }; const heat = new Uint16Array(360 * 190);
      for (let k = 1; k < raw.length; k++) { let changed = 0; for (let p = 0; p < raw[k].length; p++) if (Math.abs(raw[k][p] - raw[k - 1][p]) > 40) { changed++; heat[p]++; }
        const frac = changed / raw[k].length; if (frac > worst.frac) worst = { frac, k }; }
      // Flicker = pixels that toggle in many frame pairs (moving peds/cars toggle once or twice as they pass).
      let flicker = 0; const bbox = [360, 190, 0, 0];
      for (let p = 0; p < heat.length; p++) if (heat[p] >= 5) { flicker++; const x = p % 360, y = Math.floor(p / 360); bbox[0] = Math.min(bbox[0], x); bbox[1] = Math.min(bbox[1], y); bbox[2] = Math.max(bbox[2], x); bbox[3] = Math.max(bbox[3], y); }
      const f = `${OUT}/${String(++n).padStart(2, '0')}-flash-${(process.env.FLASH_AT ?? 'union').replace(/[^0-9]/g, '').slice(0, 8)}-heading-${i}.png`;
      await sharp(frames[worst.k]).toFile(f);
      if (flicker > 30) { // contact sheet of the 10 still frames (2 rows × 5) so a human can see what toggles
        const tiles = await Promise.all(frames.map(b => sharp(b).resize(576, 304).toBuffer()));
        await sharp({ create: { width: 576 * 5, height: 304 * 2, channels: 3, background: '#000' } })
          .composite(tiles.map((t, k) => ({ input: t, left: (k % 5) * 576, top: Math.floor(k / 5) * 304 }))).jpeg({ quality: 70 })
          .toFile(f.replace('.png', '-sheet.jpg'));
      }
      results.push({ heading: i, worstPairChangedPct: +(worst.frac * 100).toFixed(2), flickerPixels: flicker, flickerBox4x: flicker ? bbox.map(v => v * 4) : null, shot: f });
    }
    R.checks.flash = { notes: [], results };
    note('flash', JSON.stringify(results));
  }

  if (CHECKS.has('shoot') || CHECKS.has('police')) {
    tag = 'shoot';
    await boot(UNION);
    const st0 = await W(() => window.__gtasfCombat?.state?.() ?? null);
    note('shoot', `fresh combat state: ${JSON.stringify(st0)}`);
    // A player's first instinct: click the world to shoot.
    await page.mouse.move(720, 430); await page.mouse.click(720, 430); await page.waitForTimeout(1200);
    const gate1 = await page.locator('.gt-age-gate').isVisible().catch(() => false);
    const lock1 = await W(() => !!document.pointerLockElement);
    await shot('shoot-first-click');
    note('shoot', `after 1st click: ageGate=${gate1} pointerLock=${lock1} state=${JSON.stringify(await W(() => window.__gtasfCombat?.state?.()))}`);
    if (gate1) { await page.locator('.gt-age-gate-enter').click(); await page.waitForTimeout(800); }
    for (let i = 0; i < 3; i++) { await page.mouse.click(720, 430); await page.waitForTimeout(500); }
    const st1 = await W(() => window.__gtasfCombat?.state?.());
    note('shoot', `after 3 clicks: ${JSON.stringify(st1)} pointerLock=${await W(() => !!document.pointerLockElement)}`);
    await shot('shoot-after-clicks');
    // Second instinct: pick the pistol (the weapon chip / number key) and click again.
    await press('Digit3'); await page.waitForTimeout(400);
    const a0 = (await W(() => window.__gtasfCombat?.state?.()))?.ammo?.pistol;
    for (let i = 0; i < 3; i++) { await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up(); await page.waitForTimeout(350); }
    const st2 = await W(() => window.__gtasfCombat?.state?.());
    note('shoot', `after Digit3 + 3 clicks: weapon=${st2?.weapon} pistol ammo ${a0}→${st2?.ammo?.pistol}`);
    R.checks.shoot.fired = st2?.ammo?.pistol < a0;
    R.checks.shoot.hints = await W(() => [...document.querySelectorAll('body *')].filter(e => e.children.length === 0 && e.checkVisibility() && /click|fire|shoot|aim|weapon|Tab/i.test(e.textContent)).map(e => e.textContent.trim()).slice(0, 10));
    note('shoot', `visible hints: ${JSON.stringify(R.checks.shoot.hints)}`);
    await shot('shoot-pistol');

    // The key legend now says "F shoot": does F open the 18+ gate / fire for a fresh player?
    await press('KeyF'); await page.waitForTimeout(900);
    const gateF = await page.locator('.gt-age-gate').isVisible().catch(() => false);
    note('shoot', `F opens the 18+ gate: ${gateF}`); R.checks.shoot.fOpensGate = gateF;
    if (gateF) { await shot('shoot-f-gate'); await page.locator('.gt-age-gate-enter').click(); await page.waitForTimeout(800);
      const b = (await W(() => window.__gtasfCombat?.state?.()))?.ammo?.pistol; await press('KeyF', 120); await page.waitForTimeout(500);
      const c = (await W(() => window.__gtasfCombat?.state?.()))?.ammo?.pistol; note('shoot', `F after accept: pistol ammo ${b}→${c}`); R.checks.shoot.fFires = c < b;
      const d = c; await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up(); await page.waitForTimeout(500);
      const e = (await W(() => window.__gtasfCombat?.state?.()))?.ammo?.pistol; note('shoot', `click after accept: pistol ammo ${d}→${e}`); R.checks.shoot.clickFires = e < d; }
    // Get a wanted level the way a player would: Tab (opens the 18+ gate) → accept → fire the pistol.
    await press('Tab'); await page.waitForTimeout(800);
    const gate2 = await page.locator('.gt-age-gate').isVisible().catch(() => false);
    note('shoot', `Tab opens the 18+ gate: ${gate2}`);
    if (gate2) { await page.locator('.gt-age-gate-enter').click(); await page.waitForTimeout(800); }
    if (await page.locator('.gt-weapon-wheel').isVisible().catch(() => false)) await press('Tab');
    await press('Digit3'); await page.waitForTimeout(300);
    const a1 = (await W(() => window.__gtasfCombat?.state?.()))?.ammo?.pistol;
    for (let i = 0; i < 4; i++) { await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up(); await page.waitForTimeout(350); }
    const a2 = (await W(() => window.__gtasfCombat?.state?.()))?.ammo?.pistol;
    note('shoot', `after 18+ accept: click fires? pistol ammo ${a1}→${a2}`); R.checks.shoot.firesAfterGate = a2 < a1;
    await shot('shoot-after-gate');
    tag = 'police';
    const samples = []; const t0 = Date.now();
    for (let i = 0; i < 20; i++) {
      samples.push(await W(() => { const w = window.__gtasf.world, f = w.foot; const near = [];
        for (const c of w.fleet?.cars?.values?.() ?? []) if (c.data.flags & 0x40) { const p = c.model.root.position; near.push(Math.round(Math.hypot(p.x - f.x, p.z - f.z))); }
        return { stars: document.querySelectorAll('.gt-combat-wanted-star.lit').length, escaping: !!document.querySelector('.gt-combat-wanted-escaping'), police: near.sort((a, b) => a - b) }; }));
      if (i === 6) await shot('police-close');
      await page.waitForTimeout(2000);
    }
    R.checks.police = { notes: [], samples, secs: Math.round((Date.now() - t0) / 1000),
      escapeHints: await W(() => [...document.querySelectorAll('body *')].filter(e => e.children.length === 0 && e.checkVisibility() && /lose|escape|hide|line of sight|out of sight|stars|wanted/i.test(e.textContent)).map(e => e.textContent.trim()).slice(0, 10)) };
    note('police', JSON.stringify(R.checks.police));
  }
  if (CHECKS.has('combat')) {
    // #6.16: police fire / busts / officers on foot / car explosions / frame rate with police around.
    tag = 'combat'; await boot(UNION);
    await press('KeyF'); await page.waitForTimeout(900);
    if (await page.locator('.gt-age-gate').isVisible().catch(() => false)) { await page.locator('.gt-age-gate-enter').click(); await page.waitForTimeout(800); }
    await press('Digit3');
    for (let i = 0; i < 24 && (await W(() => document.querySelectorAll('.gt-combat-wanted-star.lit').length)) < 2; i++) { await press('KeyF', 60); await page.waitForTimeout(450); if (i % 10 === 9) await press('KeyR'); }
    resetOps();
    const fps = () => W(() => new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(+(n / ((performance.now() - t0) / 1000)).toFixed(1)); }; requestAnimationFrame(f); }));
    const samples = [];
    for (let i = 0; i < 15; i++) {
      const s0 = await W(() => { const w = window.__gtasf.world, f = w.foot, st = window.__gtasfCombat?.state?.(); const near = [];
        for (const c of w.fleet?.cars?.values?.() ?? []) if (c.data.flags & 0x40) { const p = c.model.root.position; near.push(Math.round(Math.hypot(p.x - f.x, p.z - f.z))); }
        return { stars: document.querySelectorAll('.gt-combat-wanted-star.lit').length, health: st?.health, dead: st?.dead, police: near.sort((a, b) => a - b).slice(0, 4),
          busted: /BUSTED/i.test(document.body.innerText.slice(0, 4000)), wasted: /WASTED/i.test(document.body.innerText.slice(0, 4000)) }; });
      s0.fps = await fps(); samples.push(s0);
      if (i === 3 || i === 10) await shot(`combat-police-${i}`);
    }
    R.checks.combat = { notes: [], samples, ops: { ...opCount } };
    note('combat', `ops during 45 s with police: ${JSON.stringify(opCount)}`);
    note('combat', `samples: ${JSON.stringify(samples.map(x => `${x.stars}★ hp${x.health} cops${JSON.stringify(x.police)} ${x.fps}fps${x.busted ? ' BUSTED' : ''}${x.wasted ? ' WASTED' : ''}`))}`);
    // Car explosion: aim at the nearest traffic car and empty the pistol into it (reloading), count EXPLOSION frames.
    resetOps();
    for (let round = 0; round < 6; round++) {
      await W(() => { const w = window.__gtasf.world, f = w.foot; let best = null, bd = 1e9;
        for (const c of w.fleet.cars.values()) { if (c.data.flags & 0x40) continue; const p = c.model.root.position, d = Math.hypot(p.x - f.x, p.z - f.z); if (d > 4 && d < bd) { bd = d; best = p; } }
        if (best) w.camera.setOrbit(Math.atan2(-(best.x - f.x), -(best.z - f.z)), -0.05); });
      for (let k = 0; k < 12; k++) { await press('KeyF', 50); await page.waitForTimeout(260); }
      await press('KeyR'); await page.waitForTimeout(1600);
      if (opCount.EXPLOSION) break;
    }
    R.checks.combat.explosionOps = { ...opCount };
    note('combat', `car-shooting ops: ${JSON.stringify(opCount)}`);
    await shot('combat-car-shooting');
  }
  if (CHECKS.has('explode')) {
    // vehicleDamage: steal a kerb car (static target), get out, step back 7 m and empty the pistol into it.
    tag = 'explode'; await boot(UNION);
    await press('KeyF'); await page.waitForTimeout(900);
    if (await page.locator('.gt-age-gate').isVisible().catch(() => false)) { await page.locator('.gt-age-gate-enter').click(); await page.waitForTimeout(800); }
    await press('Digit3');
    const k0 = await nearestKerbCar();
    await keyWalkToXZ(k0.x, k0.z, 2.2, 40000); await page.waitForTimeout(400); await press('KeyE'); await page.waitForTimeout(1800);
    const carId = (await state()).vehicleId; await press('KeyE'); await page.waitForTimeout(2200);
    const car = await W(id => { const c = [...window.__gtasf.world.fleet.cars.values()].find(c => c.data.id === id); const p = c?.model.root.position; return p ? { x: p.x, z: p.z } : null; }, carId);
    note('explode', `stole kerb car ${carId} at ${JSON.stringify(car)}; now ${(await state()).mode}`);
    if (car) {
      const f = (await state()).foot; const dx = f.x - car.x, dz = f.z - car.z, d = Math.hypot(dx, dz) || 1;
      await walkToXZ(car.x + dx / d * 7, car.z + dz / d * 7, 0.8, 20000);
      resetOps(); const t0 = Date.now();
      for (let shotN = 0; shotN < 40 && !opCount.EXPLOSION; shotN++) {
        await W(c => { const w = window.__gtasf.world, f = w.foot; w.camera.setOrbit(Math.atan2(-(c.x - f.x), -(c.z - f.z)), -0.08); }, car);
        await press('KeyF', 50); await page.waitForTimeout(330);
        if (shotN % 12 === 11) { await press('KeyR'); await page.waitForTimeout(1400); }
        if (shotN === 20) await shot('explode-damaged');
      }
      for (let i = 0; i < 20 && !opCount.EXPLOSION; i++) await page.waitForTimeout(500);
      R.checks.explode = { ...(R.checks.explode ?? {}), ops: { ...opCount }, secs: Math.round((Date.now() - t0) / 1000), state: await state() };
      note('explode', `ops ${JSON.stringify(opCount)} after ${R.checks.explode.secs}s`);
      await shot('explode-after');
    }
  }
  if (CHECKS.has('explodeparked')) {
    // vehicleDamage: a STATIONARY fleet car (Ferry parked bays) as the target — 23 pistol hits set it burning (33 HP/hit
    // of 1000, fire below 25%), then it burns down and explodes. Count EXPLOSION frames.
    tag = 'explodeparked'; await boot('37.795570,-122.393900,270');
    await press('KeyF'); await page.waitForTimeout(900);
    if (await page.locator('.gt-age-gate').isVisible().catch(() => false)) { await page.locator('.gt-age-gate-enter').click(); await page.waitForTimeout(800); }
    await press('Digit3');
    const target = await W(() => { const w = window.__gtasf.world, f = w.foot; let best = null, d = 1e9;
      for (const c of w.fleet.cars.values()) { if ((c.data.flags & 0x60) || c.data.driverId || Math.abs(c.data.speedCmps ?? 0) > 10) continue;
        const p = c.model.root.position, dd = Math.hypot(p.x - f.x, p.z - f.z); if (dd < d) { d = dd; best = { id: c.data.id, x: p.x, z: p.z, kind: c.data.kind, d: Math.round(dd) }; } }
      return best; });
    note('explodeparked', `target ${JSON.stringify(target)}`);
    if (target) {
      const f = (await state()).foot, dx = f.x - target.x, dz = f.z - target.z, dd = Math.hypot(dx, dz) || 1;
      await walkToXZ(target.x + dx / dd * 6, target.z + dz / dd * 6, 0.8, 30000);
      resetOps(); const t0 = Date.now();
      for (let n = 0; n < 48 && !opCount.EXPLOSION; n++) {
        await W(t => { const w = window.__gtasf.world, f = w.foot; w.camera.setOrbit(Math.atan2(-(t.x - f.x), -(t.z - f.z)), -0.12); }, target);
        await press('KeyF', 40); await page.waitForTimeout(320);
        if (n % 12 === 11) { await press('KeyR'); await page.waitForTimeout(1300); }
        if (n === 24) await shot('explodeparked-burning');
      }
      for (let i = 0; i < 24 && !opCount.EXPLOSION; i++) await page.waitForTimeout(500);
      R.checks.explodeparked = { ...(R.checks.explodeparked ?? {}), ops: { ...opCount }, secs: Math.round((Date.now() - t0) / 1000), exploded: !!opCount.EXPLOSION };
      note('explodeparked', `ops ${JSON.stringify(opCount)} after ${R.checks.explodeparked.secs}s`);
      await shot('explodeparked-after');
    }
  }
  if (CHECKS.has('crash')) {
    // vehicleDamage via crashes (no wanted level, so no busts): steal a kerb car, ram ahead / back up repeatedly.
    tag = 'crash'; await boot(UNION);
    const k0 = await nearestKerbCar();
    await keyWalkToXZ(k0.x, k0.z, 2.2, 40000); await page.waitForTimeout(400); await press('KeyE'); await page.waitForTimeout(1800);
    note('crash', `in ${(await state()).mode} vehicle ${(await state()).vehicleId}`);
    resetOps(); const speeds = [];
    for (let i = 0; i < 10 && !opCount.EXPLOSION; i++) {
      await page.keyboard.down('KeyW'); for (let t = 0; t < 8; t++) { await page.waitForTimeout(450); speeds.push(await W(() => +(window.__gtasf.world.driving?.speed ?? 0).toFixed(1))); } await page.keyboard.up('KeyW');
      await page.keyboard.down('KeyS'); await page.waitForTimeout(1500); await page.keyboard.up('KeyS');
      if (i === 4) await shot('crash-mid');
    }
    for (let i = 0; i < 16 && !opCount.EXPLOSION; i++) await page.waitForTimeout(500);
    R.checks.crash = { ...(R.checks.crash ?? {}), ops: { ...opCount }, speeds, state: await state(), health: (await W(() => window.__gtasfCombat?.state?.()))?.health };
    note('crash', `ops ${JSON.stringify(opCount)} health ${R.checks.crash.health} mode ${R.checks.crash.state.mode} maxSpeed ${Math.max(...speeds)}`);
    await shot('crash-after');
  }
  if (CHECKS.has('respawn')) {
    // sfGeneralArrival (#6.19): die (harness hook → the real /api/combat/death + server respawn at SF General), then
    // look at where the player lands from 4 headings.
    tag = 'respawn'; await boot('37.795570,-122.393900,270'); // the Ferry, like the ws soak (where the kill path is proven)
    await press('KeyF'); await page.waitForTimeout(900);
    if (await page.locator('.gt-age-gate').isVisible().catch(() => false)) { await page.locator('.gt-age-gate-enter').click(); await page.waitForTimeout(800); }
    await page.waitForFunction(() => window.__gtasfCombat?.state?.()?.started === true, null, { timeout: 10000 }).catch(() => note('respawn', 'combat never started'));
    const before = (await state()).foot;
    note('respawn', `before kill: ${JSON.stringify(await W(() => window.__gtasfCombat?.state?.()))}`);
    await W(() => { window.__gtasfCombat?.kill?.(); }); await page.waitForTimeout(1500); await shot('respawn-wasted');
    await page.waitForFunction(b => { const f = window.__gtasf.world.foot; return Math.hypot(f.x - b.x, f.z - b.z) > 500; }, before, { timeout: 20000 }).catch(() => note('respawn', 'no respawn teleport within 20 s'));
    await page.waitForTimeout(4000);
    const after = (await state()).foot; R.checks.respawn = { notes: [], movedM: Math.round(Math.hypot(after.x - before.x, after.z - before.z)) };
    note('respawn', `moved ${R.checks.respawn.movedM} m after WASTED`);
    for (const [i, yaw] of [0, Math.PI / 2, Math.PI, -Math.PI / 2].entries()) { await W(y => window.__gtasf.world.camera.setOrbit(y, -0.2), yaw); await page.waitForTimeout(1200); await shot(`respawn-sfgeneral-${i}`); }
  }
  if (CHECKS.has('policedeath')) {
    // A REAL (server-applied) death: rob the corner market (2★), then keep firing at the nearest cruiser — firing is
    // "resisting", so no bust — until SFPD return fire kills us; the server teleports us to SF General (CORRECTION).
    tag = 'policedeath'; await boot('37.796823,-122.398323,0');
    await press('KeyF'); await page.waitForTimeout(900);
    if (await page.locator('.gt-age-gate').isVisible().catch(() => false)) { await page.locator('.gt-age-gate-enter').click(); await page.waitForTimeout(800); }
    await press('Digit3'); await page.waitForTimeout(6000); // stand in the robbery zone through the hold
    const start = (await state()).foot, t0 = Date.now(); let died = null, minHp = 100, sawZeroHp = false;
    while (Date.now() - t0 < 150000) {
      const s0 = await W(() => { const w = window.__gtasf.world, f = w.foot, st = window.__gtasfCombat?.state?.(); let best = null, d = 1e9;
        for (const c of w.fleet.cars.values()) if (c.data.flags & 0x40) { const p = c.model.root.position, dd = Math.hypot(p.x - f.x, p.z - f.z); if (dd < d) { d = dd; best = p; } }
        if (best) w.camera.setOrbit(Math.atan2(-(best.x - f.x), -(best.z - f.z)), -0.05);
        return { hp: st?.health, dead: st?.dead, stars: document.querySelectorAll('.gt-combat-wanted-star.lit').length, cop: best ? Math.round(d) : null, x: f.x, z: f.z }; });
      minHp = Math.min(minHp, s0.hp ?? 100);
      // nearestHospitalRespawn (gtasf-ceent): the respawn may be the nearest hospital (Saint Francis is ~1 km from Union Sq),
      // not always SF General 4.6 km away, so a death is a server teleport > 300 m (sawZeroHp records hp 0 seen before it).
      if (s0.hp === 0) sawZeroHp = true;
      if (Math.hypot(s0.x - start.x, s0.z - start.z) > 300) { died = { afterS: Math.round((Date.now() - t0) / 1000), sawZeroHp, ...s0 }; break; }
      await press('KeyF', 50); await page.waitForTimeout(700);
      if (Math.round((Date.now() - t0) / 1000) % 12 === 0) await press('KeyR');
    }
    R.checks.policedeath = { notes: [], died, minHp };
    note('policedeath', died ? `server death + respawn teleport after ${died.afterS}s (${Math.round(Math.hypot(died.x - start.x, died.z - start.z))} m from the death spot)` : `no death in 150 s (min hp ${minHp})`);
    if (died) {
      // gtasf-6hwgg: the 'Hospital bill' / cost toasts must not draw over the valuation pill (or quest card).
      const overlaps = new Set(); const seen = new Set();
      for (let i = 0; i < 26; i++) {
        const r = await W(() => { const box = e => { const b = e.getBoundingClientRect(); return b.width && b.height ? b : null; };
          const pill = [...document.querySelectorAll('.gt-founder-valuation, .gt-founder-quest')].filter(e => e.checkVisibility()).map(e => ({ c: e.className.split(' ')[0], b: box(e) })).filter(p => p.b);
          return [...document.querySelectorAll('[class*="toast"], [class*="notice"]')].filter(e => e.checkVisibility() && e.textContent.trim()).map(e => { const b = box(e); if (!b) return null;
            const hit = pill.filter(p => b.left < p.b.right && b.right > p.b.left && b.top < p.b.bottom && b.bottom > p.b.top).map(p => p.c);
            return { t: e.textContent.trim().slice(0, 60), hit }; }).filter(Boolean); });
        for (const t of r) { seen.add(t.t); for (const h of t.hit) overlaps.add(`${t.t} over ${h}`); }
        if (i === 6) await shot('death-toasts'); await page.waitForTimeout(300);
      }
      R.checks.policedeath.toasts = [...seen]; R.checks.policedeath.toastOverlaps = [...overlaps];
      note('policedeath', `toasts: ${[...seen].join(' | ')}; overlaps: ${[...overlaps].join(' | ') || 'none'}`);
      await page.waitForTimeout(1000); const end = (await state()).foot; note('policedeath', `still far from the death spot 5 s later: ${Math.round(Math.hypot(end.x - start.x, end.z - start.z))} m`);
      for (const [i, yaw] of [0, Math.PI / 2, Math.PI, -Math.PI / 2].entries()) { await W(y => window.__gtasf.world.camera.setOrbit(y, -0.2), yaw); await page.waitForTimeout(1200); await shot(`sfgeneral-arrival-${i}`); } }
  }

  if (CHECKS.has('personalcar')) {
    // personalCar (#6.22): drive a road car and leave it → it is yours (YOUR CAR row on the jobs phone + blue blip);
    // a reload on the same device re-parks it where you left it; Deliver puts it on the road ahead of you.
    tag = 'personalcar'; const pc = (R.checks.personalcar = { notes: [] });
    const carRow = async () => { await press('KeyN'); await page.waitForTimeout(1500);
      const r = await W(() => { const t = s => document.querySelector(s)?.textContent?.trim() ?? null;
        return { shown: !!document.querySelector('.gt-mission-phone-car') && !document.querySelector('.gt-mission-phone-car').hidden, name: t('.gt-mission-phone-car .gt-mission-phone-pilgrim-name'), note: t('.gt-mission-phone-car .gt-mission-phone-pilgrim-blurb') }; });
      return r; };
    const closePhone = async () => { await W(() => document.querySelector('.gt-mission-phone-close')?.click()); await page.waitForTimeout(500); };
    const r0 = await carRow(); await shot('pc-phone-before'); await closePhone(); note('personalcar', `before: ${JSON.stringify(r0)}`);
    const cars = await W(() => { const w = window.__gtasf.world, f = w.foot; return [...(w.fleet?.cars?.values?.() ?? [])].map(c => { const p = c.model.root.position;
      return { id: c.data.id, kind: c.data.kind, x: p.x, z: p.z, d: Math.hypot(p.x - f.x, p.z - f.z) }; }).sort((a, b) => a.d - b.d).slice(0, 5); });
    let drove = null;
    for (const c of cars) {
      const live = await W(id => { const c = [...window.__gtasf.world.fleet.cars.values()].find(v => v.data.id === id); if (!c) return null; const p = c.model.root.position; return { x: p.x, z: p.z }; }, c.id);
      if (!live) continue;
      await walkToXZ(live.x + 2.2, live.z, 1.2, 30000); await page.waitForTimeout(400); await press('KeyE'); await page.waitForTimeout(1800);
      const st = await state(); note('personalcar', `E at fleet #${c.id} ${c.kind} (${c.d.toFixed(0)} m) → ${st.mode}`);
      if (st.mode !== 'driver') { if (st.mode !== 'on-foot') { await press('KeyE'); await page.waitForTimeout(1500); } continue; }
      drove = { id: st.vehicleId, kind: c.kind }; await press('KeyW', 1800); await page.waitForTimeout(1500); break;
    }
    // Fallback: a kerb-parked car (stealing one makes it a road car you drive).
    for (let i = 0; i < 3 && !drove; i++) {
      const k0 = await nearestKerbCar().catch(() => null); if (!k0) break;
      await keyWalkToXZ(k0.x, k0.z, 2.2, 40000); await page.waitForTimeout(400); await press('KeyE'); await page.waitForTimeout(1800);
      const st = await state(); note('personalcar', `E at kerb car ${k0.d.toFixed(0)} m → ${st.mode} vehicle ${st.vehicleId}`);
      if (st.mode === 'driver') { drove = { id: st.vehicleId, kerb: true }; await press('KeyW', 1800); await page.waitForTimeout(1500); }
      else { if (st.mode !== 'on-foot') { await press('KeyE'); await page.waitForTimeout(1500); } const f = (await state()).foot; await walkToXZ(f.x + 12, f.z, 1.5, 10000); }
    }
    note('personalcar', `drove ${JSON.stringify(drove)}`);
    if (drove) {
      const leftAt = await W(() => { const d = window.__gtasf.world.driving; return d ? { x: d.x, z: d.z } : null; });
      await press('KeyE'); await page.waitForTimeout(3500); await shot('pc-left-car');
      const r1 = await carRow(); await shot('pc-phone-after-leave'); await closePhone(); note('personalcar', `after leaving: ${JSON.stringify(r1)}`);
      pc.owned = !!r1.name && !/No car yet/.test(r1.name);
      // Walk ~25 m away so the restore is not refused for standing on the spot (review LOW), then reload (same device).
      const f = (await state()).foot; await walkToXZ(f.x + 18, f.z + 18, 1.5, 20000);
      tag = 'personalcar-reload'; await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 150000 });
      await page.waitForSelector('.gt-mission-phone', { state: 'attached', timeout: 120000 }).catch(() => {}); await page.waitForTimeout(5000);
      const r2 = await carRow(); await shot('pc-phone-after-reload'); note('personalcar', `after reload: ${JSON.stringify(r2)}`);
      pc.restored = pc.owned && !!r2.name && !/No car yet/.test(r2.name);
      if (leftAt) { const near = await W(a => [...window.__gtasf.world.fleet.cars.values()].map(c => c.model.root.position).map(p => Math.hypot(p.x - a.x, p.z - a.z)).sort((x, y) => x - y)[0] ?? null, leftAt);
        pc.carNearSpotM = near == null ? null : +near.toFixed(1); note('personalcar', `nearest fleet car to where it was left: ${pc.carNearSpotM} m`); }
      // Deliver (bot device; the server picks the road ahead).
      const deliver = page.locator('.gt-mission-phone-car-deliver');
      if (await deliver.isVisible().catch(() => false)) { await deliver.click(); await page.waitForTimeout(3500);
        pc.deliverNote = await W(() => document.querySelector('.gt-mission-phone-car .gt-mission-phone-pilgrim-blurb')?.textContent?.trim() ?? null);
        await shot('pc-deliver'); await closePhone(); await page.waitForTimeout(1500); await shot('pc-delivered-world');
        note('personalcar', `deliver: ${pc.deliverNote}`); }
      else { pc.deliverNote = 'no Deliver button'; await closePhone(); }
    }
  }
} catch (e) { R.failure = String(e?.message ?? e).split('\n')[0]; console.log('FAILURE', R.failure); await shot('failure').catch(() => {}); }
// Verdicts: exit non-zero when a founder item regressed (qa-post-deploy.sh reads the exit code).
const verdicts = [];
const c = R.checks;
if (c.cars) verdicts.push(['cars: kerb car stolen', c.cars.kerbEntered === true]);
if (c.shoot && 'fFires' in c.shoot) verdicts.push(['shoot: F fires after the 18+ gate', c.shoot.fFires === true]);
if (c.pit && 'holeCells' in c.pit) verdicts.push([`pit: Powell/Market dip (${c.pit.holeCells} cells >2 m low)`, c.pit.holeCells < 50]);
if (c.policedeath?.toastOverlaps) verdicts.push([`policedeath: toasts clear of the valuation pill (${c.policedeath.toastOverlaps.join('; ') || 'none'})`, c.policedeath.toastOverlaps.length === 0]);
if (c.personalcar) verdicts.push([`personalcar: owned ${c.personalcar.owned}, restored after reload ${c.personalcar.restored}, deliver "${c.personalcar.deliverNote}"`, c.personalcar.owned === true && c.personalcar.restored === true && /Delivered|on its way/.test(c.personalcar.deliverNote ?? '')]);
if (c.robotaxi && 'teleports' in c.robotaxi) verdicts.push(['robotaxi: smooth boarding', !c.robotaxi.headingSnaps && !c.robotaxi.reversals && !c.robotaxi.teleports]);
if (R.failure) verdicts.push([`run: ${R.failure}`, false]);
for (const [what, ok] of verdicts) console.log(`${ok ? 'OK  ' : 'BAD '} ${what}`);
R.verdicts = verdicts;
if (verdicts.some(([, ok]) => !ok)) process.exitCode = 1;
writeFileSync(`${OUT}/result.json`, JSON.stringify(R, null, 2));
console.log(`console errors ${R.consoleErrors.length}, http>=400 ${R.http.length} → ${OUT}`);
setTimeout(() => process.exit(process.exitCode ?? 0), 8000).unref(); // never hold the heavy lock on a hung close
await browser.close();
