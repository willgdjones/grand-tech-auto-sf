// Lane B: three-client check that OTHER players' server-validated shots render (tracer/impact/gunshot) for the victim
// (B) and a bystander (C). A fires raw exact-aimed COMBAT_FIRE at B. Needs a flags-on stack with combatVfx.
// Run: node tools/_remote-shots-check.mjs <outdir>
import { chromium } from '@playwright/test';
const base = 'http://localhost:5374', out = process.argv[2];
const AT = { A: '37.795799,-122.394805,0', B: '37.795850,-122.394805,180', C: '37.795740,-122.394700,320' };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
async function open(label) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  await ctx.addInitScript(() => { const s = WebSocket.prototype.send; WebSocket.prototype.send = function (d) {
    try { const b = d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, 1) : null; if (b && b[0] === 2) window.__ws = this; } catch {}
    return s.call(this, d); }; });
  const p = await ctx.newPage(); p.setDefaultTimeout(60000); p.on('pageerror', e => errors.push(`${label}: ${e.message.slice(0, 120)}`));
  let hits = 0; p.on('websocket', ws => ws.on('framereceived', f => { if (typeof f.payload !== 'string' && f.payload[0] === 0xa8) hits++; }));
  p.hits = () => hits;
  await p.goto(`${base}/?at=${AT[label]}&preset=low&bot=1`);
  await p.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 90000 });
  for (let i = 0; i < 15; i++) { await p.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await p.waitForTimeout(250); }
  try { const d = p.locator('.gt-funding-onboarding[open]'); if (await d.isVisible({ timeout: 800 })) { await d.getByLabel('Startup name', { exact: true }).fill('QA'); await d.getByLabel('Your nickname', { exact: true }).fill(label); await d.getByRole('button', { name: 'Save startup' }).click(); } } catch {}
  await p.evaluate(() => window.__gtasfCombat?.requestCombat?.());
  try { const b = p.locator('.gt-age-gate-enter'); await b.waitFor({ state: 'visible', timeout: 8000 }); await b.click(); } catch {}
  await p.waitForTimeout(800);
  return p;
}
const A = await open('A'), B = await open('B'), C = await open('C');
const fa = await A.evaluate(() => ({ ...window.__gtasf.world.foot })), fb = await B.evaluate(() => ({ ...window.__gtasf.world.foot }));
console.log('A-B distance', Math.hypot(fa.x - fb.x, fa.z - fb.z).toFixed(1), 'm');
for (const P of [B, C]) await P.evaluate(async a => { const w = window.__gtasf.world, f = w.foot, cam = w.camera, dx = a.x - f.x, dz = a.z - f.z;
  let top = { s: -2, y: 0 }; for (const y of [Math.atan2(dx, dz), Math.atan2(dx, dz) + Math.PI, -Math.atan2(dx, dz), Math.PI - Math.atan2(dx, dz)]) {
    cam.setOrbit(y, cam.pitch); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const v = cam.camera.getWorldDirection(new cam.camera.position.constructor()); const s = (v.x * dx + v.z * dz) / (Math.hypot(v.x, v.z) * Math.hypot(dx, dz)); if (s > top.s) top = { s, y }; }
  cam.setOrbit(top.y, cam.pitch); }, fa);
const fire = () => A.evaluate(b => { const f = window.__gtasf.world.foot, dir = [b.x - f.x, b.y - f.y, b.z - f.z];
  const buf = new ArrayBuffer(26), v = new DataView(buf); v.setUint8(0, 0x23); v.setUint8(1, 3); dir.forEach((d, k) => v.setFloat64(2 + k * 8, d, true)); window.__ws.send(buf); }, fb);
for (let i = 0; i < 4; i++) {
  await fire(); await B.waitForTimeout(40);
  if (i === 1) { await B.screenshot({ path: `${out}/B-sees-A.jpg`, type: 'jpeg', quality: 85 }); await C.screenshot({ path: `${out}/C-sees-A.jpg`, type: 'jpeg', quality: 85 }); }
  await A.waitForTimeout(150);
}
console.log('COMBAT_HIT frames: B', B.hits(), 'C', C.hits(), 'B health', await B.evaluate(() => window.__gtasfCombat.state().health));
console.log('errors', JSON.stringify(errors));
await browser.close();
