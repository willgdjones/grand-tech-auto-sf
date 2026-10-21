// Lane B: in-game evidence for policeAir (helicopter at wanted 4, SWAT vans at 5) with lane A's real art, on a
// flags-ON stack (policeAir + wanted + serverHits + openPvp). Shooter A raw-fires exact-aimed SMG rounds at two
// opted-in victims (B, C) until the SERVER raises A to 4-5 stars, then frames the helicopter and a SWAT van.
//   GTASF_COMBAT_URL=http://localhost:5374 [PHONE=1] node tools/_police-air-check.mjs
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.GTASF_COMBAT_URL ?? 'http://localhost:5374';
const out = process.env.COMBAT_OUT ?? 'docs/sf-data/combat';
const PHONE = process.env.PHONE === '1', tag = PHONE ? 'phone' : 'desktop';
const AT = { A: '37.795799,-122.394805,0', B: '37.795850,-122.394805,180', C: '37.795760,-122.394740,320' };
const log = []; const note = s => { log.push(s); console.log(s); };
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
const DESK = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 };
const PHONEV = { viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true };
async function open(label, view) {
  const ctx = await browser.newContext(view);
  await ctx.addInitScript(() => { const s = WebSocket.prototype.send; WebSocket.prototype.send = function (d) {
    try { const b = d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, 1) : null; if (b && b[0] === 2) window.__ws = this; } catch {}
    return s.call(this, d); }; });
  const p = await ctx.newPage(); p.setDefaultTimeout(60000); p.on('pageerror', e => errors.push(`${label}: ${e.message.slice(0, 120)}`));
  await p.goto(`${base}/?at=${AT[label]}&preset=low&bot=1`);
  await p.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 90000 });
  for (let i = 0; i < 15; i++) { await p.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await p.waitForTimeout(250); }
  try { const d = p.locator('.gt-funding-onboarding[open]'); if (await d.isVisible({ timeout: 800 })) { await d.getByLabel('Startup name', { exact: true }).fill('QA'); await d.getByLabel('Your nickname', { exact: true }).fill(label); await d.getByRole('button', { name: 'Save startup' }).click(); } } catch {}
  await p.evaluate(() => window.__gtasfCombat?.requestCombat?.());
  try { const b = p.locator('.gt-age-gate-enter'); await b.waitFor({ state: 'visible', timeout: 8000 }); await b.click(); } catch {}
  await p.waitForTimeout(800);
  return p;
}
const stars = p => p.evaluate(() => document.querySelectorAll('.gt-combat-wanted-star.lit').length);
const air = p => p.evaluate(() => { const w = window.__gtasf.world, f = w.foot, out = { heli: null, swat: null, cruisers: 0 };
  for (const c of w.fleet?.cars?.values?.() ?? []) if (c.data.flags & 0x40) {
    const q = c.model.root.position, d = Math.hypot(q.x - f.x, q.z - f.z), e = { x: q.x, y: q.y, z: q.z, d };
    if (c.data.kind === 'supercar') { if (!out.heli || d < out.heli.d) out.heli = e; }
    else if (c.data.kind === 'bus') { if (!out.swat || d < out.swat.d) out.swat = e; }
    else out.cruisers++;
  }
  return out; });
// Turn A's camera toward a world point (yaw by the rendered forward test, pitch from the elevation).
const look = (p, t, pitch) => p.evaluate(async ({ t, pitch }) => { const w = window.__gtasf.world, f = w.foot, cam = w.camera, dx = t.x - f.x, dz = t.z - f.z;
  let top = { s: -2, y: 0 }; for (const y of [Math.atan2(dx, dz), Math.atan2(dx, dz) + Math.PI, -Math.atan2(dx, dz), Math.PI - Math.atan2(dx, dz)]) {
    cam.setOrbit(y, pitch ?? cam.pitch); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const v = cam.camera.getWorldDirection(new cam.camera.position.constructor()); const s = (v.x * dx + v.z * dz) / (Math.hypot(v.x, v.z) * Math.hypot(dx, dz)); if (s > top.s) top = { s, y }; }
  cam.setOrbit(top.y, pitch ?? cam.pitch); await new Promise(r => setTimeout(r, 400)); }, { t, pitch });
let pass = false;
try {
  const A = await open('A', PHONE ? PHONEV : DESK), B = await open('B', DESK), C = await open('C', DESK);
  await A.evaluate(() => { window.__gtasfCombat.giveWeapon('smg'); window.__gtasfCombat.selectWeapon('smg'); });
  const fireAt = victim => victim.evaluate(() => ({ ...window.__gtasf.world.foot })).then(v => A.evaluate(v => {
    const f = window.__gtasf.world.foot, dir = [v.x - f.x, v.y - f.y, v.z - f.z];
    const buf = new ArrayBuffer(26), dv = new DataView(buf); dv.setUint8(0, 0x23); dv.setUint8(1, 3); dir.forEach((d, k) => dv.setFloat64(2 + k * 8, d, true)); window.__ws.send(buf); }, v));
  for (let i = 0; i < 60 && (await stars(A)) < 5; i++) { await fireAt(i % 2 ? C : B); await A.waitForTimeout(260); }
  note(`[police-air] A wanted: ${await stars(A)} star(s)`);
  let a = await air(A);
  for (let i = 0; i < 40 && !(a.heli && a.swat); i++) { await A.waitForTimeout(1000); a = await air(A); }
  note(`  heli: ${a.heli ? a.heli.d.toFixed(0) + ' m, ' + a.heli.y.toFixed(0) + ' m up' : 'none'}; SWAT: ${a.swat ? a.swat.d.toFixed(0) + ' m' : 'none'}; cruisers: ${a.cruisers}`);
  // The heli flies ~60 m up and orbits over the player; a third-person camera can only frame it when it is >= ~35 m
  // away horizontally, looking up (positive pitch, max +35°). Wait for such a moment, then shoot.
  for (let i = 0; i < 30 && a.heli && a.heli.d < 35; i++) { await A.waitForTimeout(500); a = await air(A); }
  if (a.heli) { await look(A, a.heli, 0.6); await A.screenshot({ path: `${out}/police-air-heli-${tag}.jpg`, type: 'jpeg', quality: 85 }); note(`  heli shot at ${a.heli.d.toFixed(0)} m`); }
  a = await air(A);
  if (a.swat) { await look(A, a.swat); await A.screenshot({ path: `${out}/police-air-swat-${tag}.jpg`, type: 'jpeg', quality: 85 }); }
  pass = (await stars(A)) >= 4 && !!a.heli && !!a.swat;
} catch (e) { note(`ABORTED: ${String(e.message).split('\n')[0]}`); }
finally {
  note(`RESULT: ${pass ? 'PASS' : 'FAIL'}  errors=${JSON.stringify(errors.slice(0, 6))}`);
  await writeFile(`${out}/police-air-log-${tag}.txt`, log.join('\n') + '\n');
  await browser.close();
}
