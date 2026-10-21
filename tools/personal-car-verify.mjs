// Personal car (flag personalCar, GTA V critique #20 slice 2) on a LOCAL stack:
//   SNAP=/tmp/gtasf-lanec-verify WEB_PORT=5319 WORKER_PORT=8988 COMBAT_FLAGS="founderLadder pitching economyV3 missions" tools/combat-stack.sh up
//   tools/heavy.sh node tools/personal-car-verify.mjs          (stack OUTSIDE heavy.sh; only this capture inside)
// Fresh device per profile: no car yet -> E into the nearest parked car, drive ~3 s, E out -> it's yours (GET live,
// radar blip, YOUR CAR row) -> walk 40 m away -> Deliver (lands ~9 m ahead, on a road, not on you) -> reload -> the car is
// re-parked where it was (server restore from D1).
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const base = process.env.GTASF_VERIFY_URL ?? 'http://localhost:5319';
const out = process.env.OUT ?? 'docs/sf-data/personal-car'; mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const results = {};
for (const [tag, opts] of [['desktop', { viewport: { width: 1280, height: 800 } }], ['phone', { ...devices['Pixel 7'] }]].filter(([t]) => !process.env.ONLY || process.env.ONLY === t)) {
  const r = results[tag] = { notes: [] };
  const context = await browser.newContext(opts);
  // guidedOpener (b6a71d58) is newer than this check: a fresh device would sit in its drive-to-Pear step and the jobs-phone row
  // check collides with it, so play as a device that has already seen the opener (OPENER=1 keeps it).
  if (!process.env.OPENER) await context.addInitScript(() => { try { localStorage.setItem('gtasf.opener.v1', 'skipped'); } catch { /* storage blocked */ } });
  let page = await context.newPage(); page.setDefaultTimeout(60000);
  const errs = [];
  const watch = p => { p.on('pageerror', e => errs.push(e.message.slice(0, 160))); p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) errs.push(m.text().slice(0, 160)); }); };
  watch(page);
  const touch = tag === 'phone';
  const boot = async () => {
    await page.goto(`${base}/?bot=1${touch ? '&preset=low' : ''}`);
    await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 120000 });
    await page.waitForTimeout(2500);
  };
  const state = () => page.evaluate(() => { const w = window.__gtasf.world; return { mode: w.mode, vehicleId: w.vehicleId, x: w.foot.x, z: w.foot.z }; });
  const api = () => page.evaluate(async () => (await (await fetch('/api/funding/personal-car', { cache: 'no-store' })).json()).car ?? null);
  const pressE = async () => { await page.keyboard.down('KeyE'); await page.waitForTimeout(90); await page.keyboard.up('KeyE'); };
  const nearestCar = () => page.evaluate(() => { const w = window.__gtasf.world, f = w.foot; let best = null;
    for (const [id, c] of w.fleet.cars) { const d = Math.hypot(c.data.x / 100 - f.x, c.data.z / 100 - f.z); if (c.data.kind !== 'robotaxi' && c.data.kind !== 'bus' && c.data.kind !== 'cable-car' && !c.data.driverId && (!best || d < best.d)) best = { id, d, x: c.data.x / 100, z: c.data.z / 100, kind: c.data.kind }; }
    return best; });
  const walkToXZ = async (p, stop) => { for (let i = 0; i < 3000; i++) {
    const d = await page.evaluate(({ x, z, stop }) => { const f = window.__gtasf.world.foot, dx = x - f.x, dz = z - f.z, d = Math.hypot(dx, dz); if (d > stop) { const k = Math.min(0.6, d - stop) / d; f.x += dx * k; f.z += dz * k; } return d; }, { x: p.x, z: p.z, stop });
    if (d <= stop + 0.2) return Math.round(d); await page.waitForTimeout(110); } return -1; };
  const openPhone = async () => {
    if (touch) { for (const sel of ['.gt-pause-launch', '#movement-mode']) { await page.locator(sel).first().tap({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(600); }
      await page.getByRole('button', { name: /Phone: jobs/ }).first().tap({ timeout: 8000 }).catch(() => {}); }
    else await page.keyboard.press('KeyN');
    await page.waitForTimeout(1500);
  };
  const closePhone = async () => { await page.locator('.gt-mission-phone-close').first()[touch ? 'tap' : 'click']({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(500); };
  const carRow = () => page.evaluate(() => { const row = document.querySelector('.gt-mission-phone-car'); return row && !row.hidden ? row.textContent.replace(/\s+/g, ' ').trim() : null; });
  try {
    await boot();
    r.before = await api();
    await openPhone(); r.rowBefore = await carRow(); await closePhone();
    // 1. Drive the nearest parked car a little and leave it.
    for (let i = 0; i < 4 && (await state()).mode !== 'driver'; i++) {
      const car = await nearestCar(); r.notes.push(`try ${i}: nearest car ${JSON.stringify(car)}`);
      if (car) await walkToXZ(car, 2.6);
      await page.waitForTimeout(1500); // let the server pose catch up with the walk (entry is proximity-checked server-side)
      r.notes.push(`prompt before E: ${await page.evaluate(() => document.querySelector('#prompt')?.textContent?.trim() ?? '')}`);
      await pressE(); await page.waitForTimeout(1800);
    }
    r.entered = (await state()).mode === 'driver';
    await page.keyboard.down('KeyW'); await page.waitForTimeout(2500); await page.keyboard.up('KeyW'); await page.waitForTimeout(2500);
    await pressE(); await page.waitForTimeout(2500);
    r.exited = (await state()).mode === 'on-foot';
    r.owned = await api(); r.notes.push(`owned ${JSON.stringify(r.owned)}`);
    await page.screenshot({ path: `${out}/owned-${tag}.jpg`, type: 'jpeg', quality: 72 });
    await openPhone(); r.rowOwned = await carRow();
    await page.screenshot({ path: `${out}/phone-row-${tag}.jpg`, type: 'jpeg', quality: 72 });
    await closePhone();
    // 2. Walk 40 m away, then Deliver from the phone.
    const s0 = await state(); await walkToXZ({ x: s0.x + 28, z: s0.z + 28 }, 1);
    const s1 = await state();
    await openPhone();
    await page.locator('.gt-mission-phone-car-deliver').first()[touch ? 'tap' : 'click']({ timeout: 5000 }).catch(e => r.notes.push(`deliver click: ${e.message.slice(0, 80)}`));
    await page.waitForTimeout(2500); r.rowDelivered = await carRow();
    await closePhone(); await page.waitForTimeout(1500);
    r.delivered = await api(); const s2 = await state();
    r.deliverDistM = r.delivered ? Math.round(Math.hypot(r.delivered.x - s2.x, r.delivered.z - s2.z) * 10) / 10 : null;
    r.carMovedM = r.delivered && r.owned ? Math.round(Math.hypot(r.delivered.x - r.owned.x, r.delivered.z - r.owned.z)) : null;
    r.walkedM = Math.round(Math.hypot(s1.x - s0.x, s1.z - s0.z));
    r.fleetHasIt = await page.evaluate(({ x, z }) => [...window.__gtasf.world.fleet.cars.values()].some(c => Math.hypot(c.data.x / 100 - x, c.data.z / 100 - z) < 1), r.delivered ?? { x: 1e9, z: 1e9 });
    await page.screenshot({ path: `${out}/delivered-${tag}.jpg`, type: 'jpeg', quality: 72 });
    // 3. Reload: the server re-parks it where it was.
    await boot(); await page.waitForTimeout(3000);
    r.afterReload = await api();
    r.reparkedM = r.afterReload && r.delivered ? Math.round(Math.hypot(r.afterReload.x - r.delivered.x, r.afterReload.z - r.delivered.z) * 10) / 10 : null;
    r.fleetHasItAfterReload = await page.evaluate(({ x, z }) => [...window.__gtasf.world.fleet.cars.values()].some(c => Math.hypot(c.data.x / 100 - x, c.data.z / 100 - z) < 1), r.afterReload ?? { x: 1e9, z: 1e9 });
    await page.screenshot({ path: `${out}/after-reload-${tag}.jpg`, type: 'jpeg', quality: 72 });
  } catch (e) { r.failure = e.message.slice(0, 200); }
  r.errors = errs.slice(0, 5);
  r.checks = {
    noCarAtFirst: r.before === null && /No car yet/.test(r.rowBefore ?? ''),
    droveAndLeft: !!r.entered && !!r.exited,
    ownedLive: !!r.owned?.live,
    phoneRow: /m away/.test(r.rowOwned ?? ''),
    delivered: /Delivered/.test(r.rowDelivered ?? '') && !!r.delivered?.live && r.deliverDistM >= 3 && r.deliverDistM <= 30 && r.fleetHasIt,
    reparkedOnReload: !!r.afterReload?.live && r.reparkedM !== null && r.reparkedM < 1 && r.fleetHasItAfterReload,
    noConsoleErrors: errs.length === 0,
  };
  await context.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 1));
const ok = Object.values(results).every(r => Object.values(r.checks).every(Boolean));
console.log(`RESULT: PERSONAL CAR ${ok ? 'PASS ✅' : 'CHECK FAILED ❌'} ${JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.checks])))}`);
