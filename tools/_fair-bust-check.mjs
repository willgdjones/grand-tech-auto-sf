// gtasf-6o8w9: in-game check that busts are fair (flags policeBust + sfpdOnFoot) on a flags-ON stack (seed prod
// collision with tools/_seed-prod-collision.mjs). A fresh opted-in player confesses two crimes (2 stars) by the
// Embarcadero Corner Market, then:
//   phase 1 — keeps firing the pistol every 1.5 s for 25 s while the SFPD close in: NO bust (resisting arrest);
//   phase 2 — stops firing and stands still: busted only once an OFFICER on foot is within 3 m, after the 4 s hold.
// Logs the nearest cruiser/officer distances, so a bust by a parked cruiser alone would show up as a failure.
//   GTASF_COMBAT_URL=http://localhost:5374 [PHONE=1] node tools/_fair-bust-check.mjs
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.GTASF_COMBAT_URL ?? 'http://localhost:5374';
const out = process.env.COMBAT_OUT ?? 'docs/sf-data/combat';
const SPAWN = process.env.GTASF_BUST_AT ?? '37.796823,-122.398323,270';
const PHONE = process.env.PHONE === '1', tag = PHONE ? 'phone' : 'desktop';
const log = []; const note = s => { log.push(s); console.log(s); };
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext(PHONE ? { viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true }
  : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (d) {
    try { const b = d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, 1) : null; if (b && b[0] === 2) window.__worldSocket = this; } catch {}
    return send.call(this, d);
  };
});
const page = await ctx.newPage(); page.setDefaultTimeout(60_000);
const errors = []; page.on('pageerror', e => errors.push(String(e.message).slice(0, 140)));
let bustedAt = 0;
page.on('websocket', ws => ws.on('framereceived', f => { if (typeof f.payload !== 'string' && f.payload[0] === 0xaa && !bustedAt) bustedAt = Date.now(); }));
async function clearOnboarding() {
  for (let i = 0; i < 20; i++) {
    const b = await page.evaluate(() => { const v = s => { const e = document.querySelector(s); return !!(e && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })); };
      return { intro: v('.gt-sa-intro') || v('.gt-sa-intro__skip'), id: v('.gt-identity-go'), fund: !!document.querySelector('.gt-funding-onboarding[open]') }; });
    if (!b.intro && !b.id && !b.fund) break;
    if (b.fund) { try { const d = page.locator('.gt-funding-onboarding[open]'); await d.getByLabel('Startup name', { exact: true }).fill('QA'); await d.getByLabel('Your nickname', { exact: true }).fill('b'); await d.getByRole('button', { name: 'Save startup' }).click({ timeout: 3000 }); } catch {} }
    else if (b.id) { try { await page.locator('.gt-identity-go').click({ timeout: 3000 }); } catch {} }
    else await page.evaluate(() => document.querySelector('.gt-sa-intro__skip')?.click());
    await page.waitForTimeout(500);
  }
}
// Nearest cruiser (fleet car with the police bit) and nearest officer on foot (lane B's officers layer), metres.
const police = () => page.evaluate(() => { const w = window.__gtasf.world, f = w.foot; let car = Infinity, officer = Infinity;
  for (const c of w.fleet.cars.values()) if (c.data.flags & 0x40) { const q = c.model.root.position; car = Math.min(car, Math.hypot(q.x - f.x, q.z - f.z)); }
  for (const o of w.policeOfficers?.positions?.() ?? []) officer = Math.min(officer, Math.hypot(o.x - f.x, o.z - f.z));
  return { car: Math.round(car * 10) / 10, officer: Math.round(officer * 10) / 10, stars: document.querySelectorAll('.gt-combat-wanted-star.lit').length }; });
let pass = false;
try {
  await page.goto(`${base}/?at=${SPAWN}&preset=low&bot=1`);
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 90_000 });
  await clearOnboarding();
  await page.evaluate(() => window.__gtasfCombat?.requestCombat?.());
  try { const b = page.locator('.gt-age-gate-enter'); await b.waitFor({ state: 'visible', timeout: 8000 }); await b.click(); } catch {}
  await page.waitForTimeout(800); await clearOnboarding();
  for (let i = 0; i < 2; i++) { await page.evaluate(() => window.__worldSocket.send(Uint8Array.of(0x25, 0))); await page.waitForTimeout(1100); }
  note(`[fair-bust] ${(await police()).stars}★ after two confessed crimes`);
  // Phase 1: resisting — fire the pistol (raw COMBAT_FIRE skyward, so nobody is hit) every 1.5 s for 25 s.
  let minCar = Infinity, minOfficer = Infinity;
  for (let t = 0; t < 25 && !bustedAt; t += 1.5) {
    await page.evaluate(() => { const buf = new ArrayBuffer(26), v = new DataView(buf); v.setUint8(0, 0x23); v.setUint8(1, 2); [0, 1, 0].forEach((d, k) => v.setFloat64(2 + k * 8, d, true)); window.__worldSocket.send(buf); });
    await page.waitForTimeout(1500);
    const p = await police(); minCar = Math.min(minCar, p.car); minOfficer = Math.min(minOfficer, p.officer);
  }
  const resisted = !bustedAt;
  note(`  phase 1 (firing every 1.5 s, 25 s): busted ${!resisted}; closest cruiser ${minCar} m, closest officer ${minOfficer} m`);
  await page.screenshot({ path: `${out}/fair-bust-resisting-${tag}.jpg`, type: 'jpeg', quality: 85 });
  // Phase 2: hands up — stand still, no shots. Note when an officer first gets within 3 m, and when the bust lands.
  let officerAt = 0; const t0 = Date.now();
  while (!bustedAt && Date.now() - t0 < 60_000) {
    const p = await police();
    if (!officerAt && p.officer <= 3) { officerAt = Date.now(); note(`  phase 2: officer within 3 m after ${((officerAt - t0) / 1000).toFixed(1)} s (cruiser ${p.car} m)`); }
    await page.waitForTimeout(250);
  }
  const hold = bustedAt && officerAt ? (bustedAt - officerAt) / 1000 : null;
  note(`  phase 2: busted ${!!bustedAt}${hold !== null ? ` ${hold.toFixed(1)} s after the officer reached 3 m` : ''}`);
  if (bustedAt) { await page.waitForTimeout(400); await page.screenshot({ path: `${out}/fair-bust-busted-${tag}.jpg`, type: 'jpeg', quality: 85 }); }
  pass = resisted && !!bustedAt && !!officerAt && hold !== null && hold >= 3.5 && errors.length === 0;
} catch (e) { note(`ABORTED: ${String(e.message).split('\n')[0]}`); }
finally {
  note(`RESULT: ${pass ? 'PASS' : 'FAIL'}  errors=${JSON.stringify(errors.slice(0, 6))}`);
  await writeFile(`${out}/fair-bust-log-${tag}.txt`, log.join('\n') + '\n');
  await browser.close();
}
