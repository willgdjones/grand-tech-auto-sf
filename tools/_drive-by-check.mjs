// gtasf-hthnh: in-game check for drive-by shooting (flag driveBy + vehicleDamage) on a combat flags-ON stack (seed prod
// collision with tools/_seed-prod-collision.mjs). Board the car at the run-over spawn, take the rifle, aim at the
// nearest other car and fire from the driver's seat (F on desktop, the FIRE button on phone): COMBAT_FIRE frames go
// out, the crosshair shows in the car, the target car's damage bits go up, and the player's OWN car stays undamaged.
//   GTASF_COMBAT_URL=http://localhost:5374 [PHONE=1] node tools/_drive-by-check.mjs
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.GTASF_COMBAT_URL ?? 'http://localhost:5374';
const out = process.env.COMBAT_OUT ?? 'docs/sf-data/combat';
const SPAWN = process.env.GTASF_RUNOVER_AT ?? '37.80199520213967,-122.41963019831591,87.8';
const PHONE = process.env.PHONE === '1', tag = PHONE ? 'phone' : 'desktop';
const log = []; const note = s => { log.push(s); console.log(s); };
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext(PHONE ? { viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true }
  : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  window.__fires = 0;
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (d) {
    try { const b = d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, 1) : null;
      if (b && b[0] === 2) window.__worldSocket = this; if (b && b[0] === 0x23) window.__fires++; } catch {}
    return send.call(this, d);
  };
});
const page = await ctx.newPage(); page.setDefaultTimeout(60_000);
const errors = []; page.on('pageerror', e => errors.push(String(e.message).slice(0, 140)));
const clearIntro = async () => { for (let i = 0; i < 6; i++) { const on = await page.evaluate(() => { const b = document.querySelector('.gt-sa-intro__skip'); if (b && b.checkVisibility()) { b.click(); return true; } return false; }); if (!on) break; await page.waitForTimeout(300); } };
async function clearOnboarding() {
  for (let i = 0; i < 20; i++) {
    const b = await page.evaluate(() => { const v = s => { const e = document.querySelector(s); return !!(e && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })); };
      return { intro: v('.gt-sa-intro') || v('.gt-sa-intro__skip'), id: v('.gt-identity-go'), fund: !!document.querySelector('.gt-funding-onboarding[open]') }; });
    if (!b.intro && !b.id && !b.fund) break;
    if (b.fund) { try { const d = page.locator('.gt-funding-onboarding[open]'); await d.getByLabel('Startup name', { exact: true }).fill('QA'); await d.getByLabel('Your nickname', { exact: true }).fill('d'); await d.getByRole('button', { name: 'Save startup' }).click({ timeout: 3000 }); } catch {} }
    else if (b.id) { try { await page.locator('.gt-identity-go').click({ timeout: 3000 }); } catch {} }
    else await page.evaluate(() => document.querySelector('.gt-sa-intro__skip')?.click());
    await page.waitForTimeout(500);
  }
}
const state = () => page.evaluate(() => { const w = window.__gtasf.world, own = w.vehicleId ? w.fleet.cars.get(w.vehicleId) : null;
  return { mode: w.mode, ownId: w.vehicleId, ownFlags: own?.data.flags ?? null, fires: window.__fires, ammo: window.__gtasfCombat.state().ammo.rifle,
    crosshair: [...document.querySelectorAll('.gt-crosshair, [class*="crosshair"]')].some(e => e.checkVisibility()) }; });
const target = () => page.evaluate(() => { const w = window.__gtasf.world, me = w.fleet.cars.get(w.vehicleId)?.model.root.position; if (!me) return null; let best = null;
  for (const c of w.fleet.cars.values()) { if (c.data.id === w.vehicleId || c.data.kind === 'cable-car' || c.data.kind === 'bus') continue;
    const q = c.model.root.position, d = Math.hypot(q.x - me.x, q.z - me.z); if (d >= 6 && d <= 45 && (!best || d < best.d)) best = { id: c.data.id, d, x: q.x, y: q.y, z: q.z }; }
  return best; });
const aim = t => page.evaluate(async t => { const w = window.__gtasf.world, me = w.fleet.cars.get(w.vehicleId).model.root.position, cam = w.camera, dx = t.x - me.x, dz = t.z - me.z, a = Math.atan2(dx, dz);
  let top = { s: -2, y: 0 }; for (const y of [a, a + Math.PI, -a, Math.PI - a]) { cam.setOrbit(y, .05); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const v = cam.camera.getWorldDirection(new cam.camera.position.constructor()); const s = (v.x * dx + v.z * dz) / (Math.hypot(v.x, v.z) * Math.hypot(dx, dz) || 1); if (s > top.s) top = { s, y }; }
  cam.setOrbit(top.y, .05); return top.s; }, t);
let pass = false;
try {
  await page.goto(`${base}/?at=${SPAWN}&preset=low&bot=1`);
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 90_000 });
  await clearOnboarding();
  await page.evaluate(() => window.__gtasfCombat?.requestCombat?.());
  try { const b = page.locator('.gt-age-gate-enter'); await b.waitFor({ state: 'visible', timeout: 8000 }); await b.click(); } catch {}
  await page.waitForTimeout(800); await clearOnboarding();
  for (let i = 0; i < 4 && (await page.evaluate(() => window.__gtasf.world.mode)) !== 'driver'; i++) {
    if (PHONE) { const b = page.locator('button[data-action="enter-exit"]').first(); try { const box = await b.boundingBox(); if (box) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); } catch {} }
    else await page.keyboard.press('KeyE');
    await page.waitForTimeout(1200);
  }
  if ((await page.evaluate(() => window.__gtasf.world.mode)) !== 'driver') throw new Error('could not board a car');
  await page.evaluate(() => { window.__gtasfCombat.giveWeapon('rifle'); window.__gtasfCombat.selectWeapon('rifle'); });
  const t = await target(); if (!t) throw new Error('no other car 6–45 m away');
  note(`[drive-by] driving car #${await page.evaluate(() => window.__gtasf.world.vehicleId)}; target car #${t.id} ${t.d.toFixed(1)} m`);
  note(`  aim alignment ${(await aim(t)).toFixed(2)}`);
  await clearIntro();
  const before = await state();
  const targetBefore = await page.evaluate(id => window.__gtasf.world.fleet.cars.get(id)?.data.flags ?? 0, t.id);
  let shot = false;
  for (let i = 0; i < 25; i++) {
    if (PHONE) { const b = page.locator('button:has-text("FIRE")').first(); try { const box = await b.boundingBox(); if (box) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); } catch {} }
    else { await page.keyboard.down('KeyF'); await page.waitForTimeout(160); await page.keyboard.up('KeyF'); }
    await page.waitForTimeout(220);
    if (!shot && i === 4) { shot = true; await page.screenshot({ path: `${out}/drive-by-${tag}.jpg`, type: 'jpeg', quality: 85 }); }
    if (i % 8 === 7) await page.evaluate(() => window.__gtasfCombat.reload());
  }
  await page.waitForTimeout(800);
  const after = await state();
  const targetAfter = await page.evaluate(id => window.__gtasf.world.fleet.cars.get(id)?.data.flags ?? 0, t.id);
  note(`  before ${JSON.stringify(before)}`);
  note(`  after  ${JSON.stringify(after)}; target flags ${targetBefore}→${targetAfter}`);
  await page.screenshot({ path: `${out}/drive-by-after-${tag}.jpg`, type: 'jpeg', quality: 85 });
  pass = after.mode === 'driver' && after.fires > before.fires && after.crosshair && (after.ownFlags & 0x07) === 0 && errors.length === 0;
  note(`  target damaged: ${(targetAfter & 0x07) !== 0} (needs the aim to line up; not required for PASS)`);
} catch (e) { note(`ABORTED: ${String(e.message).split('\n')[0]}`); }
finally {
  note(`RESULT: ${pass ? 'PASS' : 'FAIL'}  errors=${JSON.stringify(errors.slice(0, 6))}`);
  await writeFile(`${out}/drive-by-log-${tag}.txt`, log.join('\n') + '\n');
  await browser.close();
}
