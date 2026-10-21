// gtasf-th81j: in-game check for health regen (flag healthRegen) on a flags-ON stack (seed prod collision). Player V
// shoots player T three times with the pistol (100 → 34); after 5 s without damage T's HUD health climbs back at
// 2 HP/s and stops at 50 (half). Screenshot T's HUD before and after.
//   GTASF_COMBAT_URL=http://localhost:5374 [PHONE=1] node tools/_health-regen-check.mjs
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.GTASF_COMBAT_URL ?? 'http://localhost:5374';
const out = process.env.COMBAT_OUT ?? 'docs/sf-data/combat';
const PHONE = process.env.PHONE === '1', tag = PHONE ? 'phone' : 'desktop';
const AT = { lat: 37.795799, lon: -122.394805 };
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
  const V = await open(`${AT.lat},${AT.lon},0`, 'V', view);
  const tAt = { lat: AT.lat + 6 / 111_320, lon: AT.lon };
  const T = await open(`${tAt.lat.toFixed(6)},${tAt.lon.toFixed(6)},0`, 'T', view);
  await T.p.waitForTimeout(6000); // past spawn protection
  await V.p.evaluate(() => { window.__gtasfCombat.giveWeapon('pistol'); window.__gtasfCombat.selectWeapon('pistol'); });
  for (let i = 0; i < 3; i++) {
    const tPos = await T.p.evaluate(() => ({ ...window.__gtasf.world.foot }));
    await V.p.evaluate(t => { const f = window.__gtasf.world.foot, dir = [t.x - f.x, t.y - f.y, t.z - f.z];
      const buf = new ArrayBuffer(26), v = new DataView(buf); v.setUint8(0, 0x23); v.setUint8(1, 2); dir.forEach((d, k) => v.setFloat64(2 + k * 8, d, true)); window.__ws.send(buf); }, tPos);
    await V.p.waitForTimeout(700);
  }
  const hurt = (await vitals(T.p)).health;
  note(`[health-regen] T after 3 pistol hits: ${hurt}`);
  await T.p.screenshot({ path: `${out}/health-regen-hurt-${tag}.jpg`, type: 'jpeg', quality: 85 });
  const samples = [];
  for (let s = 0; s < 22; s++) { await T.p.waitForTimeout(1000); samples.push((await vitals(T.p)).health); }
  note(`  T health each second after: ${samples.join(' ')}`);
  await T.p.screenshot({ path: `${out}/health-regen-healed-${tag}.jpg`, type: 'jpeg', quality: 85 });
  const final = samples.at(-1);
  pass = hurt < 50 && samples.slice(0, 3).every(h => h === hurt) && final === 50 && errors.length === 0;
  await V.ctx.close(); await T.ctx.close();
} catch (e) { note(`ABORTED: ${String(e.message).split('\n')[0]}`); }
finally {
  note(`RESULT: ${pass ? 'PASS' : 'FAIL'}  errors=${JSON.stringify(errors.slice(0, 6))}`);
  await writeFile(`${out}/health-regen-log-${tag}.txt`, log.join('\n') + '\n');
  await browser.close();
}
