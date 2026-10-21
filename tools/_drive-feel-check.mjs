// critique #10 (flag drivingFeel): in-game check on a flags-ON stack. Board the car at the run-over spawn, then:
//  1. floor it — the chase-cam FOV must widen with speed (drive profile, up to +8°);
//  2. handbrake slide (Space + steer) — screenshot the skid marks + tyre smoke;
//  3. drive on until a wall — the car must BOUNCE (speed flips sign, ~30% back) instead of stopping dead.
//   GTASF_COMBAT_URL=http://localhost:5374 [PHONE=1] node tools/_drive-feel-check.mjs
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
const page = await ctx.newPage(); page.setDefaultTimeout(60_000);
const errors = []; page.on('pageerror', e => errors.push(String(e.message).slice(0, 140)));
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
const state = () => page.evaluate(() => { const w = window.__gtasf.world; return { mode: w.mode, speed: w.driving?.speed ?? 0, fov: w.camera.camera.fov }; });
let pass = false;
try {
  await page.goto(`${base}/?at=${SPAWN}&preset=low&bot=1`);
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 90_000 });
  await clearOnboarding();
  const footFov = (await state()).fov;
  for (let i = 0; i < 4 && (await state()).mode !== 'driver'; i++) { await page.keyboard.press('KeyE'); await page.waitForTimeout(1200); }
  if ((await state()).mode !== 'driver') throw new Error('could not board a car');
  // Per-frame watcher for the bounce (the reverse speed decays in ~0.15 s with the throttle held, too quick to poll).
  await page.evaluate(() => { let prev = 0; window.__bounce = null; const tick = () => { const s = window.__gtasf.world.driving?.speed ?? 0;
    if (!window.__bounce && prev > 4 && s < -0.5) window.__bounce = { before: prev, after: s }; prev = s; requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  // 1. Speed FOV: a short run (the run-over spawn faces a building ~3 s away at full throttle).
  await page.keyboard.down('KeyW');
  let maxFov = 0, peak = 0;
  for (let t = 0; t < 8; t++) { await page.waitForTimeout(200); const s = await state(); maxFov = Math.max(maxFov, s.fov); peak = Math.max(peak, s.speed); }
  note(`[drive-feel] on-foot fov ${footFov.toFixed(2)}, max driving fov ${maxFov.toFixed(2)} at peak ${peak.toFixed(1)} m/s`);
  await page.screenshot({ path: `${out}/drive-feel-speed-${tag}.jpg`, type: 'jpeg', quality: 85 });
  // 2. Handbrake slide at speed (Space + steer), throttle released.
  await page.keyboard.up('KeyW'); await page.keyboard.down('Space'); await page.keyboard.down('KeyA');
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${out}/drive-feel-skid-${tag}.jpg`, type: 'jpeg', quality: 85 });
  await page.waitForTimeout(350);
  await page.keyboard.up('KeyA'); await page.keyboard.up('Space');
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${out}/drive-feel-skidmarks-${tag}.jpg`, type: 'jpeg', quality: 85 });
  const skid = await page.evaluate(() => ({ ...(window.__gtasfSkids ?? { marks: 0, puffs: 0 }) }));
  note(`  handbrake slide: ${skid.marks} skid marks, ${skid.puffs} smoke puffs`);
  await page.keyboard.down('KeyW');
  // 3. Wall bounce: keep the throttle down, steering a little each attempt, until the speed flips sign at speed.
  let bounce = null;
  for (let attempt = 0; attempt < 10 && !bounce; attempt++) {
    for (let t = 0; t < 40 && !bounce; t++) { await page.waitForTimeout(100); bounce = await page.evaluate(() => window.__bounce); }
    if (!bounce) { await page.keyboard.up('KeyW'); await page.keyboard.down('KeyS'); await page.waitForTimeout(600); await page.keyboard.up('KeyS');
      await page.keyboard.down(attempt % 2 ? 'KeyA' : 'KeyD'); await page.keyboard.down('KeyW'); await page.waitForTimeout(250); await page.keyboard.up(attempt % 2 ? 'KeyA' : 'KeyD'); }
  }
  await page.keyboard.up('KeyW');
  await page.screenshot({ path: `${out}/drive-feel-bounce-${tag}.jpg`, type: 'jpeg', quality: 85 });
  note(`  wall bounce: ${bounce ? `${bounce.before.toFixed(1)} → ${bounce.after.toFixed(1)} m/s` : 'none seen'}`);
  pass = maxFov > footFov + 2 && skid.marks > 0 && skid.puffs > 0 && bounce !== null && errors.length === 0;
} catch (e) { note(`ABORTED: ${String(e.message).split('\n')[0]}`); }
finally {
  note(`RESULT: ${pass ? 'PASS' : 'FAIL'}  errors=${JSON.stringify(errors.slice(0, 6))}`);
  await writeFile(`${out}/drive-feel-log-${tag}.txt`, log.join('\n') + '\n');
  await browser.close();
}
