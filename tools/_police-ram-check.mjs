// Lane B: in-game check for police PIT / ramming (flag policeRam + vehicleDamage) on a flags-ON stack (seed prod
// collision with tools/_seed-prod-collision.mjs). The player boards the car at the run-over spawn, confesses 3 raw
// crimes (→ 3★) and sits still; cruisers arrive and must ram: S2C POLICE_RAM (0xb2) reaches the driver, and the car's
// server damage bits go smoking (≤50% HP) after a few rams. Screenshots the shove + the smoking car.
//   GTASF_COMBAT_URL=http://localhost:5374 [PHONE=1] node tools/_police-ram-check.mjs
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
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (d) {
    try { const b = d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, 1) : null; if (b && b[0] === 2) window.__worldSocket = this; } catch {}
    return send.call(this, d);
  };
});
const page = await ctx.newPage(); page.setDefaultTimeout(60_000);
const errors = []; page.on('pageerror', e => errors.push(String(e.message).slice(0, 140)));
let rams = 0;
page.on('websocket', ws => ws.on('framereceived', f => { if (typeof f.payload !== 'string' && f.payload[0] === 0xb2) rams++; }));
async function clearOnboarding() {
  for (let i = 0; i < 20; i++) {
    const b = await page.evaluate(() => { const v = s => { const e = document.querySelector(s); return !!(e && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })); };
      return { intro: v('.gt-sa-intro') || v('.gt-sa-intro__skip'), id: v('.gt-identity-go'), fund: !!document.querySelector('.gt-funding-onboarding[open]') }; });
    if (!b.intro && !b.id && !b.fund) break;
    if (b.fund) { try { const d = page.locator('.gt-funding-onboarding[open]'); await d.getByLabel('Startup name', { exact: true }).fill('QA'); await d.getByLabel('Your nickname', { exact: true }).fill('q'); await d.getByRole('button', { name: 'Save startup' }).click({ timeout: 3000 }); } catch {} }
    else if (b.id) { try { await page.locator('.gt-identity-go').click({ timeout: 3000 }); } catch {} }
    else await page.evaluate(() => document.querySelector('.gt-sa-intro__skip')?.click());
    await page.waitForTimeout(500);
  }
}
const myCar = () => page.evaluate(() => { const w = window.__gtasf.world, c = w.fleet.cars.get(w.vehicleId); return c ? { id: c.data.id, flags: c.data.flags } : null; });
let pass = false;
try {
  await page.goto(`${base}/?at=${SPAWN}&preset=low&bot=1`);
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 90_000 });
  await clearOnboarding();
  await page.evaluate(() => window.__gtasfCombat?.requestCombat?.());
  try { const b = page.locator('.gt-age-gate-enter'); await b.waitFor({ state: 'visible', timeout: 8000 }); await b.click(); } catch {}
  await page.waitForTimeout(800);
  await clearOnboarding();
  for (let i = 0; i < 4 && (await page.evaluate(() => window.__gtasf.world.mode)) !== 'driver'; i++) {
    if (PHONE) { const b = page.locator('button[data-action="enter-exit"]').first(); try { const box = await b.boundingBox(); if (box) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); } catch {} }
    else await page.keyboard.press('KeyE');
    await page.waitForTimeout(1200);
  }
  if ((await page.evaluate(() => window.__gtasf.world.mode)) !== 'driver') throw new Error('could not board a car at the spawn');
  note(`[police-ram] driving car #${(await myCar())?.id}`);
  for (let i = 0; i < 3; i++) { await page.evaluate(() => window.__worldSocket.send(Uint8Array.of(0x25, 0))); await page.waitForTimeout(1100); }
  note(`  wanted ${await page.evaluate(() => document.querySelectorAll('.gt-combat-wanted-star.lit').length)}★ — waiting for cruisers to ram`);
  let shoveShot = false, smoking = false;
  for (let t = 0; t < 90 && !(smoking && shoveShot && rams >= 3); t++) {
    const before = rams;
    await page.waitForTimeout(1000);
    if (rams > before && !shoveShot) { shoveShot = true; note(`  first ram after ~${t + 1}s`); await page.waitForTimeout(150); await page.screenshot({ path: `${out}/police-ram-hit-${tag}.jpg`, type: 'jpeg', quality: 85 }); }
    const car = await myCar();
    if (car && car.flags & 0x01 && !smoking) { smoking = true; note(`  car SMOKING after ${rams} rams`); await page.screenshot({ path: `${out}/police-ram-smoking-${tag}.jpg`, type: 'jpeg', quality: 85 }); }
  }
  note(`  rams ${rams}, smoking ${smoking}, mode ${await page.evaluate(() => window.__gtasf.world.mode)}`);
  pass = rams >= 3 && smoking && errors.length === 0;
} catch (e) { note(`ABORTED: ${String(e.message).split('\n')[0]}`); }
finally {
  note(`RESULT: ${pass ? 'PASS' : 'FAIL'}  errors=${JSON.stringify(errors.slice(0, 6))}`);
  await writeFile(`${out}/police-ram-log-${tag}.txt`, log.join('\n') + '\n');
  await browser.close();
}
