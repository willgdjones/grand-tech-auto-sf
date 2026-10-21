// Opening drive (flag openingDrive, GTA V critique #13 — orchestrator 2026-10-15) on a LOCAL stack (the server must know
// C2S OPENING_CAR, so prod can't run this until it ships):
//   SNAP=/tmp/gtasf-lanec-verify WEB_PORT=5319 WORKER_PORT=8988 COMBAT_FLAGS="founderLadder pitching" tools/combat-stack.sh up
//   tools/heavy.sh node tools/opening-drive-verify.mjs        (stack OUTSIDE heavy.sh; only this capture inside)
// Fresh device per profile: spawns at Howard St IN the opening car -> billboard reveal -> 'Drive to Pear VC' + GPS ->
// drives up the Embarcadero (gradual car moves, under the server's speed cap) -> 'You made it' -> E out -> walk to the
// partner -> E -> conversation -> reply 1 -> cheque -> the Seed drive quest.
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const base = process.env.GTASF_VERIFY_URL ?? 'http://localhost:5319';
const out = process.env.OUT ?? 'docs/sf-data/opening-drive'; mkdirSync(out, { recursive: true });
const START = { lat: 37.79215, lon: -122.39065 }, PEAR = { lat: 37.795570, lon: -122.393771 }; // shared FOUNDER_OPENING_DRIVE_START / FOUNDER_PLAZA_ANGEL
const project = (lat, lon) => { const rad = Math.PI / 180, f = 1 / 298.257223563, e2 = f * (2 - f);
  const ecef = (la, lo) => { const phi = la * rad, lam = lo * rad, n = 6378137 / Math.sqrt(1 - e2 * Math.sin(phi) ** 2); return [n * Math.cos(phi) * Math.cos(lam), n * Math.cos(phi) * Math.sin(lam), n * (1 - e2) * Math.sin(phi)]; };
  const o = { lat: 37.7842, lon: -122.4078 }, a = ecef(o.lat, o.lon), b = ecef(lat, lon), d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], phi = o.lat * rad, lam = o.lon * rad;
  return { x: -Math.sin(lam) * d[0] + Math.cos(lam) * d[1], z: -(-Math.sin(phi) * Math.cos(lam) * d[0] - Math.sin(phi) * Math.sin(lam) * d[1] + Math.cos(phi) * d[2]) }; };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const results = {};
for (const [tag, opts] of [['desktop', { viewport: { width: 1280, height: 800 } }], ['phone', { ...devices['Pixel 7'] }]].filter(([t]) => !process.env.ONLY || process.env.ONLY === t)) {
  const r = results[tag] = { notes: [] };
  const page = await (await browser.newContext(opts)).newPage(); page.setDefaultTimeout(60000);
  const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) errs.push(m.text().slice(0, 160)); });
  const pitches = []; page.on('response', async res => { if (/\/api\/funding\/pitch/.test(res.url())) { try { pitches.push({ status: res.status(), body: (await res.text()).slice(0, 200) }); } catch {} } });
  const quest = () => page.evaluate(() => document.querySelector('.gt-founder-quest')?.textContent?.replace(/\s+/g, ' ').trim() ?? null);
  const waitQuest = async (re, ms = 90000) => { const t = Date.now(); while (Date.now() - t < ms) { const q = await quest(); if (q && re.test(q)) return q; await page.waitForTimeout(500); } return null; };
  const world = () => page.evaluate(() => { const w = window.__gtasf.world; return { mode: w.mode, vehicleId: w.vehicleId, foot: { x: w.foot.x, z: w.foot.z }, driving: w.driving ? { x: w.driving.x, z: w.driving.z } : null }; });
  // Gradual moves: 2.5 m per ~110 ms (~23 m/s) in the car (server cap 75 m/s), 0.6 m on foot (cap ~8 m/s).
  const moveTo = async (p, stop, step) => { for (let i = 0; i < 6000; i++) {
    const d = await page.evaluate(({ x, z, stop, step }) => { const w = window.__gtasf.world, f = w.mode === 'driver' && w.driving ? w.driving : w.foot;
      const dx = x - f.x, dz = z - f.z, d = Math.hypot(dx, dz); if (d > stop) { const k = Math.min(step, d - stop) / d; f.x += dx * k; f.z += dz * k; if (f.yaw !== undefined) f.yaw = Math.atan2(dx, dz); } return d; }, { x: p.x, z: p.z, stop, step });
    if (d <= stop + 0.2) return Math.round(d); await page.waitForTimeout(110); } return -1; };
  const pressE = async () => { await page.keyboard.down('KeyE'); await page.waitForTimeout(90); await page.keyboard.up('KeyE'); };
  const shot = name => page.screenshot({ path: `${out}/${name}-${tag}.jpg`, type: 'jpeg', quality: 72 });
  try {
    await page.goto(`${base}/?bot=1${tag === 'phone' ? '&preset=low' : ''}`);
    await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 120000 });
    const start = project(START.lat, START.lon);
    const w0 = await world(); r.spawnFromStart = Math.round(Math.hypot(w0.foot.x - start.x, w0.foot.z - start.z));
    await page.waitForFunction(() => window.__gtasf.world.mode === 'driver', null, { timeout: 15000 }).catch(() => {});
    r.seated = (await world()).mode;
    r.firstQuest = await quest();
    await page.waitForTimeout(2200); await shot('01-reveal');
    r.driveQuest = await waitQuest(/Drive to Pear VC/, 30000);
    await page.waitForTimeout(1200); await shot('02-drive-quest');
    r.route = await page.evaluate(() => document.querySelector('#trip-status')?.textContent?.trim() ?? null);
    const pear = project(PEAR.lat, PEAR.lon);
    r.driveHalfway = await moveTo(pear, 300, 2.5);
    await shot('03-driving');
    const partner = await page.evaluate(() => { const p = window.__gtasf.world.founderPlazaInvestor?.position; return p ? { x: p.x, z: p.z } : null; }) ?? pear;
    r.driveToPlaza = await moveTo(partner, 60, 2.5); // stop on the approach (the controller arrives at 70 m), short of the arcade
    r.atStop = await page.evaluate(() => { const w = window.__gtasf.world, p = w.founderPlazaInvestor?.position, c = w.driving ?? w.foot;
      const road = p ? w.map.nearestRoad(p.x, p.z, 300) : null;
      return { carToPartner: p ? Math.round(Math.hypot(c.x - p.x, c.z - p.z)) : null, partnerToRoad: road ? Math.round(Math.hypot(road.x - p.x, road.z - p.z)) : null }; });
    r.arrived = await waitQuest(/You made it/, 20000);
    await page.waitForTimeout(800); await shot('04-arrived');
    await pressE(); await page.waitForFunction(() => window.__gtasf.world.mode === 'on-foot', null, { timeout: 10000 }).catch(() => {});
    r.outOfCar = (await world()).mode;
    const npc = await page.evaluate(() => { const p = window.__gtasf.world.founderPlazaInvestor?.position; return p ? { x: p.x, z: p.z } : null; });
    r.walkPear = await moveTo(npc ?? pear, 2.5, 0.6);
    await pressE();
    await page.waitForSelector('.gt-convo:not([hidden])', { timeout: 15000 });
    await shot('05-pitch');
    await page.keyboard.press('Digit1');
    await page.waitForFunction(() => /\$/.test([...document.querySelectorAll('.gt-convo-cheque')].map(e => e.hidden ? '' : e.textContent).join('')), null, { timeout: 30000 }).catch(() => {});
    r.cheque = await page.evaluate(() => [...document.querySelectorAll('.gt-convo-cheque')].map(e => e.textContent).join(''));
    await page.waitForTimeout(1500); await shot('06-cheque');
    r.seedQuest = await waitQuest(/wants a meeting/, 20000);
    await shot('07-seed-quest');
  } catch (e) { r.failure = String(e?.message ?? e).slice(0, 240); }
  r.pitches = pitches; r.errs = errs;
  r.checks = { spawnedAtStart: (r.spawnFromStart ?? 99) <= 20, seatedInCar: r.seated === 'driver', driveQuest: !!r.driveQuest, arrived: !!r.arrived,
    gotOut: r.outOfCar === 'on-foot', preSeedCheque: /\$/.test(r.cheque ?? ''), seedNext: !!r.seedQuest,
    pitchesOk: pitches.length >= 1 && pitches.every(p => p.status === 200), noConsoleErrors: !errs.length };
  await page.context().close();
}
await browser.close();
console.log(JSON.stringify(results, null, 1));
const all = Object.values(results).every(r => Object.values(r.checks).every(Boolean));
console.log(`\nRESULT: ${all ? 'OPENING DRIVE PASS ✅' : 'CHECK FAILED ❌'} ${JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.checks])))}`);
