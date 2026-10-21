// Lane B: headless e2e for confessed ped kills (flag streetCrimeWanted, C2S COMBAT_CRIME) on a flags-ON stack.
// (1) server: a fresh opted-in player sends 3 raw COMBAT_CRIME frames with no gunfire → exactly 3 stars ('ped-kill').
// (2) client: spraying an SMG around the street wastes a walker, and the client sends COMBAT_CRIME for it.
// Stack: COMBAT_FLAGS="... streetCrimeWanted" tools/combat-stack.sh up ; then
//   GTASF_COMBAT_URL=http://localhost:5374 [PHONE=1] node tools/_ped-crime-check.mjs
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.GTASF_COMBAT_URL ?? 'http://localhost:5374';
const out = process.env.COMBAT_OUT ?? 'docs/sf-data/combat';
const SPAWN = process.env.GTASF_PED_AT ?? '37.795799,-122.394805,0';
const PHONE = process.env.PHONE === '1', tag = PHONE ? 'phone' : 'desktop';
const log = []; const note = s => { log.push(s); console.log(s); };
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext(PHONE ? { viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true }
  : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
// Count COMBAT_CRIME (0x25) frames the client sends.
await ctx.addInitScript(() => {
  window.__crimeSent = 0;
  const send = WebSocket.prototype.send;
  WebSocket.prototype.send = function (d) {
    try { const b = d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, 1) : null;
      if (b && b[0] === 0x25) window.__crimeSent++; if (b && b[0] === 2) window.__worldSocket = this; } catch {}
    return send.call(this, d);
  };
});
const page = await ctx.newPage(); page.setDefaultTimeout(60_000);
const errors = []; page.on('pageerror', e => errors.push(String(e.message).slice(0, 140)));
const stars = () => page.evaluate(() => document.querySelectorAll('.gt-combat-wanted-star.lit').length);
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
// Aim the third-person camera at the nearest visible walker: try the yaw conventions, keep the one whose rendered
// camera forward points at the walker, and tilt down a touch so the shot lands at the walker's feet.
const aimAtWalker = () => page.evaluate(async () => {
  const w = window.__gtasf.world, f = w.foot, cam = w.camera;
  const roots = (w.streetWalkers?.root?.children ?? []).filter(c => c.visible);
  let best; for (const r of roots) { const d = Math.hypot(r.position.x - f.x, r.position.z - f.z); if (d > 3 && d < 30 && (!best || d < best.d)) best = { p: r.position, d }; }
  if (!best) return null;
  const dx = best.p.x - f.x, dz = best.p.z - f.z;
  const want = Math.atan2(dx, dz);
  let top = { score: -2, yaw: want };
  for (const yaw of [want, want + Math.PI, -want, Math.PI - want, Math.atan2(-dx, dz), Math.atan2(dx, -dz)]) {
    cam.setOrbit(yaw, cam.pitch);
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const v = cam.camera.getWorldDirection(new cam.camera.position.constructor());
    const score = (v.x * dx + v.z * dz) / (Math.hypot(v.x, v.z) * best.d || 1);
    if (score > top.score) top = { score, yaw };
  }
  cam.setOrbit(top.yaw, cam.pitch);
  return { d: best.d, score: top.score };
});
let pass = false;
try {
  await page.goto(`${base}/?at=${SPAWN}&preset=low&bot=1`);
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 90_000 });
  await clearOnboarding();
  await page.evaluate(() => window.__gtasfCombat?.requestCombat?.());
  try { const b = page.locator('.gt-age-gate-enter'); await b.waitFor({ state: 'visible', timeout: 8000 }); await b.click(); } catch {}
  await page.waitForTimeout(800);
  await clearOnboarding();
  if (!(await page.evaluate(() => window.__gtasfCombat?.state?.().started))) throw new Error('combat not started (stack not flag-on?)');
  // 1) Server path in isolation: three raw confessions (1.1 s apart, past the 1/s rate limit), NO gunfire.
  //    3 x 'ped-kill' (18 heat) = 54 → 3 stars; gunfire can't contribute here, and no police exist yet at 0 stars.
  for (let i = 0; i < 3; i++) { await page.evaluate(() => window.__worldSocket.send(Uint8Array.of(0x25, 0))); await page.waitForTimeout(1100); }
  const rawStars = await stars(); note(`  3 raw COMBAT_CRIME confessions (no shots): ${rawStars} star(s)`);
  const rawOk = rawStars === 3;
  // 2) Client path: spray the SMG around the street; a shot that wastes a walker must send COMBAT_CRIME.
  await page.evaluate(() => { window.__crimeSent = 0; window.__gtasfCombat.giveWeapon('smg'); window.__gtasfCombat.selectWeapon('smg'); });
  await page.waitForTimeout(3000); // let walkers populate
  for (let i = 0; i < 30 && (await page.evaluate(() => window.__crimeSent)) === 0; i++) {
    const aim = await aimAtWalker(); await page.evaluate(i => { const c = window.__gtasf.world.camera; c.setOrbit(c.yaw + (i % 2 ? 0.6 : -0.3), c.pitch); }, i);
    if (i % 5 === 0) note(`  aim ${i}: ${aim ? `walker ${aim.d.toFixed(1)} m, align ${aim.score.toFixed(2)}` : 'no walker in 3-30 m'}`);
    await page.evaluate(() => { const c = window.__gtasfCombat; if (c.state().ammo?.smg === 0) c.reload?.(); c.fire(); });
    await page.waitForTimeout(350);
    await page.evaluate(() => window.__gtasfCombat.fireStop());
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(800);
  const s = await stars(), sent = await page.evaluate(() => window.__crimeSent);
  note(`[ped-crime] client COMBAT_CRIME frames sent while shooting: ${sent}; stars: ${s}`);
  pass = rawOk && sent > 0;
  await clearOnboarding();
  await page.screenshot({ path: `${out}/ped-crime-${tag}.jpg`, type: 'jpeg', quality: 85 });
} catch (e) { note(`ABORTED: ${String(e.message).split('\n')[0]}`); }
finally {
  note(`RESULT: ${pass ? 'PASS' : 'FAIL'}  errors=${JSON.stringify(errors.slice(0, 6))}`);
  await writeFile(`${out}/ped-crime-log-${tag}.txt`, log.join('\n') + '\n');
  await browser.close();
}
