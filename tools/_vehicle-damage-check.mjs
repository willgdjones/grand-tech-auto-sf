// Lane B: in-game check for vehicle damage + explosions (flag vehicleDamage) on a flags-ON stack (seed prod collision
// with tools/_seed-prod-collision.mjs so shots are LoS-checked). Shooter A (Ferry plaza) shoots the nearest parked car
// 10–40 m away with the rifle; we log its damage bits (smoking → burning), catch the S2C EXPLOSION, screenshot each
// stage, and check that an opted-in player B standing beside the car takes the blast.
//   GTASF_COMBAT_URL=http://localhost:5374 [PHONE=1] node tools/_vehicle-damage-check.mjs
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.GTASF_COMBAT_URL ?? 'http://localhost:5374';
const out = process.env.COMBAT_OUT ?? 'docs/sf-data/combat';
const PHONE = process.env.PHONE === '1', tag = PHONE ? 'phone' : 'desktop';
const A_AT = { lat: 37.795799, lon: -122.394805 };
const log = []; const note = s => { log.push(s); console.log(s); };
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
async function open(at, label, view) {
  const ctx = await browser.newContext(view);
  await ctx.addInitScript(() => { window.__explosions = 0; const s = WebSocket.prototype.send; WebSocket.prototype.send = function (d) {
    try { const b = d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, 1) : null; if (b && b[0] === 2) window.__ws = this; } catch {}
    return s.call(this, d); }; });
  const p = await ctx.newPage(); p.setDefaultTimeout(60000); p.on('pageerror', e => errors.push(`${label}: ${e.message.slice(0, 120)}`));
  p.on('websocket', ws => ws.on('framereceived', f => { if (typeof f.payload !== 'string' && f.payload[0] === 0xad) p.evaluate(() => { window.__explosions++; }).catch(() => {}); }));
  await p.goto(`${base}/?at=${at}&preset=low&bot=1`);
  await p.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 90000 });
  for (let i = 0; i < 15; i++) { await p.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await p.waitForTimeout(250); }
  try { const d = p.locator('.gt-funding-onboarding[open]'); if (await d.isVisible({ timeout: 800 })) { await d.getByLabel('Startup name', { exact: true }).fill('QA'); await d.getByLabel('Your nickname', { exact: true }).fill(label); await d.getByRole('button', { name: 'Save startup' }).click(); } } catch {}
  await p.evaluate(() => window.__gtasfCombat?.requestCombat?.());
  try { const b = p.locator('.gt-age-gate-enter'); await b.waitFor({ state: 'visible', timeout: 8000 }); await b.click(); } catch {}
  await p.waitForTimeout(3500);
  return { p, ctx };
}
const view = PHONE ? { viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 };
const carState = (p, id) => p.evaluate(id => { const c = window.__gtasf.world.fleet.cars.get(id); if (!c) return null; const q = c.model.root.position; return { flags: c.data.flags, x: q.x, y: q.y, z: q.z }; }, id);
const face = (p, t) => p.evaluate(async t => { const w = window.__gtasf.world, f = w.foot, cam = w.camera, dx = t.x - f.x, dz = t.z - f.z;
  let top = { s: -2, y: 0 }; for (const y of [Math.atan2(dx, dz), Math.atan2(dx, dz) + Math.PI, -Math.atan2(dx, dz), Math.PI - Math.atan2(dx, dz)]) {
    cam.setOrbit(y, .15); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const v = cam.camera.getWorldDirection(new cam.camera.position.constructor()); const s = (v.x * dx + v.z * dz) / (Math.hypot(v.x, v.z) * Math.hypot(dx, dz)); if (s > top.s) top = { s, y }; }
  cam.setOrbit(top.y, .15); await new Promise(r => setTimeout(r, 200)); }, t);
let pass = false;
try {
  const A = await open(`${A_AT.lat},${A_AT.lon},0`, 'A', view);
  await A.p.evaluate(() => { window.__gtasfCombat.giveWeapon('rifle'); window.__gtasfCombat.selectWeapon('rifle'); });
  const fa = await A.p.evaluate(() => ({ ...window.__gtasf.world.foot }));
  const target = await A.p.evaluate(() => { const w = window.__gtasf.world, f = w.foot; let best = null;
    for (const c of w.fleet.cars.values()) { if (c.data.flags & 0x60 || c.data.driverId || c.data.kind === 'cable-car' || c.data.kind === 'bus') continue;
      const q = c.model.root.position, d = Math.hypot(q.x - f.x, q.z - f.z); if (d >= 10 && d <= 60 && (!best || d < best.d)) best = { id: c.data.id, d, x: q.x, z: q.z, kind: c.data.kind }; }
    return best; });
  if (!target) throw new Error('no parked car 10–60 m from the Ferry spawn');
  note(`[vehicle-damage] target car #${target.id} (${target.kind}) ${target.d.toFixed(1)} m away`);
  // Metres → lat/lon around A's known spawn. B stands right beside the target car; the shooter re-spawns ~12 m from it
  // so the smoke/fire/explosion are framed close (A was only used to find the car).
  const toLatLon = (x, z) => ({ lat: A_AT.lat - (z - fa.z) / 111_320, lon: A_AT.lon + (x - fa.x) / (111_320 * Math.cos(A_AT.lat * Math.PI / 180)) });
  const { lat, lon } = toLatLon(target.x + 2, target.z);
  await A.ctx.close();
  const near = toLatLon(target.x - 8, target.z + 9);
  const A2 = await open(`${near.lat.toFixed(6)},${near.lon.toFixed(6)},0`, 'A', view);
  await A2.p.evaluate(() => { window.__gtasfCombat.giveWeapon('rifle'); window.__gtasfCombat.selectWeapon('rifle'); });
  A.p = A2.p; A.ctx = A2.ctx;
  note(`  shooter now ${(await A.p.evaluate(t => Math.hypot(window.__gtasf.world.foot.x - t.x, window.__gtasf.world.foot.z - t.z), target)).toFixed(1)} m from the car`);
  const B = await open(`${lat.toFixed(6)},${lon.toFixed(6)},0`, 'B', { viewport: { width: 900, height: 600 } });
  const fb = await B.p.evaluate(() => ({ ...window.__gtasf.world.foot }));
  note(`  B stands ${Math.hypot(fb.x - target.x, fb.z - target.z).toFixed(1)} m from the car, health ${await B.p.evaluate(() => window.__gtasfCombat.state().health)}`);
  await face(A.p, target);
  const shots = { smoking: false, burning: false, explosion: false };
  for (let i = 0; i < 60 && !(await A.p.evaluate(() => window.__explosions)); i++) {
    const s = await carState(A.p, target.id);
    if (s) {
      await A.p.evaluate(t => { const f = window.__gtasf.world.foot, dir = [t.x - f.x, t.y + 1 - (f.y + 1.4), t.z - f.z];
        const buf = new ArrayBuffer(26), v = new DataView(buf); v.setUint8(0, 0x23); v.setUint8(1, 4); dir.forEach((d, k) => v.setFloat64(2 + k * 8, d, true)); window.__ws.send(buf); }, s);
      if (s.flags & 0x01 && !shots.smoking) { shots.smoking = true; note(`  shot ${i}: SMOKING`); await A.p.screenshot({ path: `${out}/vehicle-damage-smoking-${tag}.jpg`, type: 'jpeg', quality: 85 }); }
      if (s.flags & 0x02 && !shots.burning) { shots.burning = true; note(`  shot ${i}: BURNING`); await A.p.screenshot({ path: `${out}/vehicle-damage-burning-${tag}.jpg`, type: 'jpeg', quality: 85 }); }
    }
    await A.p.waitForTimeout(450);
  }
  shots.explosion = (await A.p.evaluate(() => window.__explosions)) > 0;
  if (shots.explosion) { await A.p.waitForTimeout(150); await A.p.screenshot({ path: `${out}/vehicle-damage-explosion-${tag}.jpg`, type: 'jpeg', quality: 85 }); }
  await A.p.waitForTimeout(2500);
  await A.p.screenshot({ path: `${out}/vehicle-damage-wreck-${tag}.jpg`, type: 'jpeg', quality: 85 });
  const wreck = await A.p.evaluate(() => [...window.__gtasf.world.fleet.cars.values()].some(c => c.data.flags & 0x04));
  const bState = await B.p.evaluate(() => { const s = window.__gtasfCombat.state(); return { hp: s.health, dead: s.dead }; });
  note(`  explosion ${shots.explosion}, wreck rendered ${wreck}, B after blast ${JSON.stringify(bState)}`);
  pass = shots.smoking && shots.burning && shots.explosion && wreck && (bState.dead || bState.hp < 100);
  await A.ctx.close(); await B.ctx.close();
} catch (e) { note(`ABORTED: ${String(e.message).split('\n')[0]}`); }
finally {
  note(`RESULT: ${pass ? 'PASS' : 'FAIL'}  errors=${JSON.stringify(errors.slice(0, 6))}`);
  await writeFile(`${out}/vehicle-damage-log-${tag}.txt`, log.join('\n') + '\n');
  await browser.close();
}
