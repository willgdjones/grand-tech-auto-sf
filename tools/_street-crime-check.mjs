// Lane B: headless e2e for street-crime wanted (flag streetCrimeWanted) on a flags-ON stack.
//   1) firing a pistol at nothing in the street raises 0 → 1 star, sustained fire → 2 stars (never 3 from gunfire)
//      and the SFPD spawn;
//   2) a shot fired straight at an SFPD cruiser (raw COMBAT_FIRE aimed from the server chest point at the car) is a
//      cop-hit and pushes past the 2-star gunfire cap.
// Stack: COMBAT_FLAGS="combat gore weapons serverHits openPvp wanted gunShop carjacking storeRobberies ragdollAudio
//   economyV3 streetCrimeWanted" tools/combat-stack.sh up ; then
//   GTASF_COMBAT_URL=http://localhost:5374 node tools/_street-crime-check.mjs
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.GTASF_COMBAT_URL ?? 'http://localhost:5374';
const out = process.env.COMBAT_OUT ?? 'docs/sf-data/combat';
const SPAWN = process.env.GTASF_COMBAT_AT ?? '37.795799,-122.394805,0';
const POLICE_FLAG = 0x40, COMBAT_FIRE = 0x23, PISTOL = 2;
const log = []; const note = s => { log.push(s); console.log(s); };
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const PHONE = process.env.PHONE === '1'; // phone Low: 1080x2400 at DPR 2.75
const ctx = await browser.newContext(PHONE ? { viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true }
  : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const tag = PHONE ? 'phone' : 'desktop';
// Keep a handle on the world socket so the cop-hit step can send an exactly-aimed COMBAT_FIRE.
await ctx.addInitScript(() => {
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (d) {
    // The player's world socket is the one sending MOVE (opcode 2); zone observers never do.
    try { const b = d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, 1) : null; if (b && b[0] === 2) window.__worldSocket = this; } catch {}
    return send.call(this, d);
  };
});
const page = await ctx.newPage(); page.setDefaultTimeout(60_000);
const errors = []; page.on('pageerror', e => errors.push(String(e.message).slice(0, 140)));
const stars = () => page.evaluate(() => document.querySelectorAll('.gt-combat-wanted-star.lit').length);
const police = () => page.evaluate(FLAG => {
  const w = window.__gtasf?.world, f = w?.foot, out = [];
  for (const c of w?.fleet?.cars?.values?.() ?? []) if (c?.data?.flags & FLAG) {
    const p = c.model.root.position; out.push({ x: p.x, y: p.y, z: p.z, d: f ? Math.hypot(p.x - f.x, p.z - f.z) : 1e9, speed: c.data.speed ?? null });
  }
  return out.sort((a, b) => a.d - b.d);
}, POLICE_FLAG);
let pass = true;
// Clear the intro carousel / identity / funding onboarding (same loop as combat-prod-verify) so nothing covers the
// view or blocks aiming. The intro can appear a moment after READY, so it is re-run before each screenshot.
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
try {
  await page.goto(`${base}/?at=${SPAWN}&preset=low&bot=1`);
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 90_000 });
  await clearOnboarding();
  await page.evaluate(() => window.__gtasfCombat?.requestCombat?.());
  try { const b = page.locator('.gt-age-gate-enter'); await b.waitFor({ state: 'visible', timeout: 8000 }); await b.click(); } catch {}
  await page.waitForTimeout(800);
  if (!(await page.evaluate(() => window.__gtasfCombat?.state?.().started))) throw new Error('combat not started (stack not flag-on?)');
  await page.evaluate(() => { window.__gtasfCombat.giveWeapon('pistol'); window.__gtasfCombat.selectWeapon('pistol'); });

  note(`[street-crime] stars before: ${await stars()}`);
  // 1) public gunfire: one shot, then ~16 s of steady fire (re-trigger + reload through the magazine).
  // Retry the trigger until a round is actually spent (the client can't aim while an onboarding modal is up).
  const ammo = () => page.evaluate(() => window.__gtasfCombat.state().ammo?.pistol ?? null);
  const before = await ammo();
  for (let i = 0; i < 10 && (await ammo()) === before; i++) { await page.evaluate(() => { window.__gtasfCombat.fire(); window.__gtasfCombat.fireStop(); }); await page.waitForTimeout(300); }
  let afterOne = 0;
  for (let i = 0; i < 15 && afterOne === 0; i++) { await page.waitForTimeout(200); afterOne = await stars(); }
  note(`  after one shot (ammo ${before} -> ${await ammo()}): ${afterOne} star(s)`);
  if (afterOne !== 1) pass = false;
  let peak = afterOne;
  for (let i = 0; i < 40; i++) {
    await page.evaluate(() => { const c = window.__gtasfCombat; if (c.state().ammo?.pistol === 0) c.reload?.(); c.fire(); c.fireStop(); });
    await page.waitForTimeout(400);
    peak = Math.max(peak, await stars());
  }
  await page.waitForTimeout(800);
  const gunfireStars = await stars(); note(`  after sustained gunfire: ${gunfireStars} star(s) (peak ${peak})`);
  if (gunfireStars !== 2 || peak > 2) pass = false;
  await clearOnboarding();
  await page.screenshot({ path: `${out}/street-crime-gunfire-${tag}.jpg`, type: 'jpeg', quality: 85 });

  // 2) cop-hit: wait for a cruiser within 40 m, then fire exactly at it (server chest → car body) a few times.
  let target;
  for (let i = 0; i < 40 && !target; i++) { const p = await police(); if (p[0] && p[0].d < 40) target = p[0]; else await page.waitForTimeout(500); }
  note(`  nearest SFPD: ${target ? target.d.toFixed(1) + ' m' : 'none within 40 m'} (units visible: ${(await police()).length})`);
  if (!target) pass = false;
  let copStars = gunfireStars;
  for (let i = 0; target && i < 6 && copStars <= 2; i++) {
    await page.evaluate(({ OP, W }) => {
      const w = window.__gtasf.world, f = w.foot, FLAG = 0x40;
      let best; for (const c of w.fleet.cars.values()) if (c.data.flags & FLAG) {
        const p = c.model.root.position, d = Math.hypot(p.x - f.x, p.z - f.z); if (!best || d < best.d) best = { p, d };
      }
      if (!best) return;
      const dir = [best.p.x - f.x, best.p.y + 1 - (f.y + 1.4), best.p.z - f.z];
      const buf = new ArrayBuffer(26), v = new DataView(buf);
      v.setUint8(0, OP); v.setUint8(1, W); dir.forEach((d, k) => v.setFloat64(2 + k * 8, d, true));
      window.__worldSocket.send(buf);
    }, { OP: COMBAT_FIRE, W: PISTOL });
    await page.waitForTimeout(1100);
    copStars = await stars();
  }
  note(`  after firing at the cruiser: ${copStars} star(s)`);
  if (target && copStars <= 2) pass = false;
  await clearOnboarding();
  await page.screenshot({ path: `${out}/street-crime-cop-hit-${tag}.jpg`, type: 'jpeg', quality: 85 });
} catch (e) { pass = false; note(`ABORTED: ${String(e.message).split('\n')[0]}`); }
finally {
  note(`RESULT: ${pass ? 'PASS' : 'FAIL'}  errors=${JSON.stringify(errors.slice(0, 6))}`);
  await writeFile(`${out}/street-crime-log-${tag}.txt`, log.join('\n') + '\n');
  await browser.close();
}
