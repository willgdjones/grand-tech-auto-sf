// gtasf-d14ck: in-game check that driving into a wall/kerb at speed damages the car (flag vehicleDamage) on a combat
// flags-ON stack. Board the car at the run-over spawn, opt into combat, then repeatedly floor it straight ahead (W)
// until the car stops dead; each stop ≥4 m/s sends VEHICLE_CRASH. Pass when ≥1 crash is sent and the car's server
// damage bits go up (smoking 0x01 / burning 0x02). Screenshots the damaged car.
//   GTASF_COMBAT_URL=http://localhost:5374 [PHONE=1] node tools/_wall-crash-check.mjs
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
  window.__crashes = [];
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (d) {
    try { const b = d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : null;
      if (b && b[0] === 0x26) window.__crashes.push(b[1]); } catch {}
    return send.call(this, d);
  };
});
const page = await ctx.newPage(); page.setDefaultTimeout(60_000);
const errors = []; page.on('pageerror', e => errors.push(String(e.message).slice(0, 140)));
async function clearOnboarding() {
  for (let i = 0; i < 20; i++) {
    const b = await page.evaluate(() => { const v = s => { const e = document.querySelector(s); return !!(e && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })); };
      return { intro: v('.gt-sa-intro') || v('.gt-sa-intro__skip'), id: v('.gt-identity-go'), fund: !!document.querySelector('.gt-funding-onboarding[open]') }; });
    if (!b.intro && !b.id && !b.fund) break;
    if (b.fund) { try { const d = page.locator('.gt-funding-onboarding[open]'); await d.getByLabel('Startup name', { exact: true }).fill('QA'); await d.getByLabel('Your nickname', { exact: true }).fill('w'); await d.getByRole('button', { name: 'Save startup' }).click({ timeout: 3000 }); } catch {} }
    else if (b.id) { try { await page.locator('.gt-identity-go').click({ timeout: 3000 }); } catch {} }
    else await page.evaluate(() => document.querySelector('.gt-sa-intro__skip')?.click());
    await page.waitForTimeout(500);
  }
}
const car = () => page.evaluate(() => { const w = window.__gtasf.world, c = w.vehicleId ? w.fleet.cars.get(w.vehicleId) : null; return { mode: w.mode, flags: c?.data.flags ?? null, speed: w.driving?.speed ?? 0 }; });
let pass = false;
try {
  await page.goto(`${base}/?at=${SPAWN}&preset=low&bot=1`);
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 90_000 });
  await clearOnboarding();
  await page.evaluate(() => window.__gtasfCombat?.requestCombat?.()); // crashes count only for an opted-in driver
  try { const b = page.locator('.gt-age-gate-enter'); await b.waitFor({ state: 'visible', timeout: 8000 }); await b.click(); } catch {}
  await page.waitForTimeout(800); await clearOnboarding();
  for (let i = 0; i < 4 && (await page.evaluate(() => window.__gtasf.world.mode)) !== 'driver'; i++) {
    if (PHONE) { const b = page.locator('button[data-action="enter-exit"]').first(); try { const box = await b.boundingBox(); if (box) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); } catch {} }
    else await page.keyboard.press('KeyE');
    await page.waitForTimeout(1200);
  }
  if ((await page.evaluate(() => window.__gtasf.world.mode)) !== 'driver') throw new Error('could not board a car');
  note(`[wall-crash] driving; flags ${(await car()).flags}`);
  let peak = 0;
  for (let attempt = 0; attempt < 12 && !(((await car()).flags ?? 0) & 0x03); attempt++) {
    // Floor it for up to 4 s; if we're stuck against something, back off and turn a little first.
    await page.keyboard.down('KeyS'); await page.waitForTimeout(700); await page.keyboard.up('KeyS');
    await page.keyboard.down(attempt % 2 ? 'KeyA' : 'KeyD'); await page.keyboard.down('KeyW'); await page.waitForTimeout(250); await page.keyboard.up(attempt % 2 ? 'KeyA' : 'KeyD');
    for (let t = 0; t < 20; t++) { await page.waitForTimeout(200); peak = Math.max(peak, Math.abs((await car()).speed)); }
    await page.keyboard.up('KeyW');
    note(`  attempt ${attempt}: crashes sent ${JSON.stringify(await page.evaluate(() => window.__crashes))}, car flags ${(await car()).flags}, peak ${peak.toFixed(1)} m/s`);
  }
  await page.waitForTimeout(1000);
  const end = await car();
  const crashes = await page.evaluate(() => window.__crashes);
  await page.screenshot({ path: `${out}/wall-crash-${tag}.jpg`, type: 'jpeg', quality: 85 });
  note(`  end: ${JSON.stringify(end)}; ${crashes.length} crash report(s) ${JSON.stringify(crashes)}`);
  pass = crashes.length > 0 && ((end.flags ?? 0) & 0x07) !== 0 && errors.length === 0;
} catch (e) { note(`ABORTED: ${String(e.message).split('\n')[0]}`); }
finally {
  note(`RESULT: ${pass ? 'PASS' : 'FAIL'}  errors=${JSON.stringify(errors.slice(0, 6))}`);
  await writeFile(`${out}/wall-crash-log-${tag}.txt`, log.join('\n') + '\n');
  await browser.close();
}
