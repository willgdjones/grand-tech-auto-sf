// Lane B: in-game check for health + armour pickups (flag vitalsPickups) on a flags-ON stack (seed prod collision with
// tools/_seed-prod-collision.mjs so shots are LoS-checked). Viewer V stands a few metres from the Corner Market armour
// pickup and screenshots it; taker T deep-links onto it and must be granted 50 server armour (COMBAT_VITALS) while V
// sees the pickup vanish (PICKUP_STATE). Then V shoots T with the pistol: armour must absorb before health. Finally
// T's weapon wheel shows the body-armour buy button.
//   GTASF_COMBAT_URL=http://localhost:5374 [PHONE=1] node tools/_vitals-pickups-check.mjs
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.GTASF_COMBAT_URL ?? 'http://localhost:5374';
const out = process.env.COMBAT_OUT ?? 'docs/sf-data/combat';
const PHONE = process.env.PHONE === '1', tag = PHONE ? 'phone' : 'desktop';
const SPOT = { lat: 37.796850, lon: -122.398300 }; // PICKUP_SPOTS[1] (armour)
const log = []; const note = s => { log.push(s); console.log(s); };
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
async function open(at, label, view) {
  const ctx = await browser.newContext(view);
  await ctx.addInitScript(() => { window.__pickupMsgs = []; const s = WebSocket.prototype.send; WebSocket.prototype.send = function (d) {
    try { const b = d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, 1) : null; if (b && b[0] === 2) window.__ws = this; } catch {}
    return s.call(this, d); }; });
  const p = await ctx.newPage(); p.setDefaultTimeout(60000); p.on('pageerror', e => errors.push(`${label}: ${e.message.slice(0, 120)}`));
  p.on('websocket', ws => ws.on('framereceived', f => { if (typeof f.payload !== 'string' && f.payload[0] === 0xaf) { const m = [f.payload[1], f.payload[2]]; p.evaluate(m => window.__pickupMsgs.push(m), m).catch(() => {}); } }));
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
const vitals = p => p.evaluate(() => { const s = window.__gtasfCombat.state(); return { health: s.health, armour: s.armour }; });
let pass = false;
try {
  const vAt = { lat: SPOT.lat - 7 / 111_320, lon: SPOT.lon + 3 / (111_320 * Math.cos(SPOT.lat * Math.PI / 180)) }; // beside, not behind, the player
  const V = await open(`${vAt.lat.toFixed(6)},${vAt.lon.toFixed(6)},0`, 'V', view);
  const spot = await V.p.evaluate(() => { let ps = [...window.__gtasf.world.fleet.cars.values()][0]?.model.root; while (ps?.parent) ps = ps.parent; let best = null;
    ps.traverse(o => { if (o.isSprite && o.parent?.children?.length === 2 && o.parent.children[0].isMesh && o.parent.children[0].geometry?.parameters?.height === 2) {
      const g = o.parent.position, f = window.__gtasf.world.foot, d = Math.hypot(g.x - f.x, g.z - f.z); if (!best || d < best.d) best = { d, x: g.x, z: g.z, visible: o.parent.visible }; } });
    return best; });
  note(`[vitals-pickups] nearest pickup ${spot ? spot.d.toFixed(1) + ' m from V, visible ' + spot.visible : 'NOT FOUND'}`);
  if (spot) await V.p.evaluate(async t => { const w = window.__gtasf.world, f = w.foot, cam = w.camera, dx = t.x - f.x, dz = t.z - f.z;
    let top = { s: -2, y: 0 }; for (const y of [Math.atan2(dx, dz), Math.atan2(dx, dz) + Math.PI, -Math.atan2(dx, dz), Math.PI - Math.atan2(dx, dz)]) {
      cam.setOrbit(y, .15); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const v = cam.camera.getWorldDirection(new cam.camera.position.constructor()); const s = (v.x * dx + v.z * dz) / (Math.hypot(v.x, v.z) * Math.hypot(dx, dz)); if (s > top.s) top = { s, y }; }
    cam.setOrbit(top.y, .15); await new Promise(r => setTimeout(r, 300)); }, spot);
  await V.p.screenshot({ path: `${out}/vitals-pickup-armour-${tag}.jpg`, type: 'jpeg', quality: 85 });

  const T = await open(`${SPOT.lat},${SPOT.lon},0`, 'T', { viewport: { width: 900, height: 600 } });
  const tFoot = await T.p.evaluate(() => ({ ...window.__gtasf.world.foot }));
  if (spot) note(`  T spawned ${Math.hypot(tFoot.x - spot.x, tFoot.z - spot.z).toFixed(2)} m from the pickup`);
  await T.p.waitForTimeout(1500);
  const tAfter = await vitals(T.p);
  const vSaw = await V.p.evaluate(() => window.__pickupMsgs.slice());
  const vHidden = await V.p.evaluate(() => { let hidden = null, sc = [...window.__gtasf.world.fleet.cars.values()][0]?.model.root; while (sc?.parent) sc = sc.parent; sc.traverse(o => { if (o.isSprite && o.parent?.children?.length === 2 && o.parent.children[0].geometry?.parameters?.height === 2 && !o.parent.visible) hidden = true; }); return hidden === true; });
  note(`  T vitals after pickup ${JSON.stringify(tAfter)}; V got PICKUP_STATE ${JSON.stringify(vSaw)}; a pickup hidden on V: ${vHidden}`);
  await V.p.screenshot({ path: `${out}/vitals-pickup-taken-${tag}.jpg`, type: 'jpeg', quality: 85 });
  const granted = tAfter.armour === 50 && vSaw.some(([i, a]) => i === 1 && a === 0) && vHidden;

  // V shoots T with the pistol (22 dmg): the server's armour soaks it first.
  await V.p.evaluate(() => { window.__gtasfCombat.giveWeapon('pistol'); window.__gtasfCombat.selectWeapon('pistol'); });
  const tPos = await T.p.evaluate(() => ({ ...window.__gtasf.world.foot }));
  for (let i = 0; i < 2; i++) {
    await V.p.evaluate(t => { const f = window.__gtasf.world.foot, dir = [t.x - f.x, t.y - f.y, t.z - f.z];
      const buf = new ArrayBuffer(26), v = new DataView(buf); v.setUint8(0, 0x23); v.setUint8(1, 2); dir.forEach((d, k) => v.setFloat64(2 + k * 8, d, true)); window.__ws.send(buf); }, tPos);
    await V.p.waitForTimeout(700);
  }
  const tShot = await vitals(T.p);
  note(`  T after 2 pistol hits ${JSON.stringify(tShot)} (expect health 100, armour ${50 - 44})`);
  const absorbed = tShot.health === 100 && tShot.armour === 6;

  await T.p.evaluate(() => window.__gtasfCombat.openWheel());
  await T.p.waitForTimeout(400);
  const armourBtn = await T.p.evaluate(() => { const b = document.querySelector('.gt-weapon-armour'); return b && !b.hidden ? b.textContent : null; });
  note(`  T wheel armour button: ${armourBtn}`);
  await T.p.screenshot({ path: `${out}/vitals-armour-shop-${tag}.jpg`, type: 'jpeg', quality: 85 });
  pass = granted && absorbed && !!armourBtn && errors.length === 0;
  await V.ctx.close(); await T.ctx.close();
} catch (e) { note(`ABORTED: ${String(e.message).split('\n')[0]}`); }
finally {
  note(`RESULT: ${pass ? 'PASS' : 'FAIL'}  errors=${JSON.stringify(errors.slice(0, 6))}`);
  await writeFile(`${out}/vitals-pickups-log-${tag}.txt`, log.join('\n') + '\n');
  await browser.close();
}
