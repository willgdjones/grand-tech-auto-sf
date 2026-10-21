// critique #7 (flag shootingFeel): in-game check for the shooting-feel layer on a flags-ON stack (seed prod collision).
// A fires through the real client path (bloom + recoil) and lands server hits on B. On A: the crosshair blooms
// (--gt-bloom > 1) and the hit-marker shows after the server's COMBAT_HIT (DOM observer, it only lasts 170 ms). On B: the
// red hurt vignette rises with each hit. Screenshots of both mid-exchange.
//   GTASF_COMBAT_URL=http://localhost:5374 [PHONE=1] node tools/_shooting-feel-check.mjs
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
  const A = await open(`${AT.lat},${AT.lon},0`, 'A', view);
  const bAt = { lat: AT.lat + 6 / 111_320, lon: AT.lon };
  const B = await open(`${bAt.lat.toFixed(6)},${bAt.lon.toFixed(6)},0`, 'B', view);
  await B.p.waitForTimeout(6000); // past spawn protection
  // Record what the feel layer shows (both are brief, so observe instead of screenshotting on time).
  await A.p.evaluate(() => { window.__marker = 0; window.__bloom = 1; new MutationObserver(() => { const m = document.querySelector('.gt-hitmarker'); if (m && !m.hidden) window.__marker++; })
    .observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
    setInterval(() => { const c = document.querySelector('.gt-combat-crosshair'); const b = Number(c?.style.getPropertyValue('--gt-bloom') || 1); if (b > window.__bloom) window.__bloom = b; }, 16); });
  await B.p.evaluate(() => { window.__vig = 0; setInterval(() => { const v = Number(document.querySelector('.gt-hurt-vignette')?.style.opacity || 0); if (v > window.__vig) window.__vig = v; }, 16); });
  await A.p.evaluate(() => { window.__gtasfCombat.giveWeapon('pistol'); window.__gtasfCombat.selectWeapon('pistol'); });
  let shotA = false, shotB = false;
  for (let i = 0; i < 3; i++) {
    await A.p.evaluate(() => { window.__gtasfCombat.fire(); setTimeout(() => window.__gtasfCombat.fireStop(), 80); }); // client path: bloom + kick
    const tPos = await B.p.evaluate(() => ({ ...window.__gtasf.world.foot }));
    await A.p.waitForTimeout(320); // pistol fire-rate gap before the server-aimed shot
    await A.p.evaluate(t => { const f = window.__gtasf.world.foot, dir = [t.x - f.x, t.y - f.y, t.z - f.z];
      const buf = new ArrayBuffer(26), v = new DataView(buf); v.setUint8(0, 0x23); v.setUint8(1, 2); dir.forEach((d, k) => v.setFloat64(2 + k * 8, d, true)); window.__ws.send(buf); }, tPos);
    await A.p.waitForTimeout(120);
    if (!shotA) { shotA = true; await A.p.screenshot({ path: `${out}/shooting-feel-shooter-${tag}.jpg`, type: 'jpeg', quality: 85 }); }
    if (!shotB) { shotB = true; await B.p.screenshot({ path: `${out}/shooting-feel-hit-${tag}.jpg`, type: 'jpeg', quality: 85 }); }
    await A.p.waitForTimeout(500);
  }
  const a = await A.p.evaluate(() => ({ marker: window.__marker, bloom: window.__bloom }));
  const b = await B.p.evaluate(() => ({ vig: window.__vig, health: window.__gtasfCombat.state().health }));
  note(`[shooting-feel] shooter: hit-markers shown ${a.marker}, max crosshair bloom ${a.bloom.toFixed(2)}; target: max vignette ${b.vig.toFixed(2)}, health ${b.health}`);
  pass = a.marker > 0 && a.bloom > 1.2 && b.vig > 0.2 && b.health < 100 && errors.length === 0;
  await A.ctx.close(); await B.ctx.close();
} catch (e) { note(`ABORTED: ${String(e.message).split('\n')[0]}`); }
finally {
  note(`RESULT: ${pass ? 'PASS' : 'FAIL'}  errors=${JSON.stringify(errors.slice(0, 6))}`);
  await writeFile(`${out}/shooting-feel-log-${tag}.txt`, log.join('\n') + '\n');
  await browser.close();
}
