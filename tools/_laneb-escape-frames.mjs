// Lane B (gtasf-66lvh, critic HUD condition): frames of the wantedEscape cue on a flags-ON combat stack — 2 stars, then
// the stars go grey and flash while the SFPD can't see you (EVADING → SEARCHING bar), the radar shows the search circle,
// and on the clear the stars vanish with the 'You lost the cops.' toast. Crimes are confessed on the world socket
// (0x25, after the 18+ gate's COMBAT_READY), the local-stack recipe. Locally policeLineClear fails closed (no building collision), so the cops never see
// you and the phases run without a chase; prod needs a real 200 m drive out of sight.
//   GTASF_COMBAT_URL=http://localhost:5391 [PHONE=1] node tools/_laneb-escape-frames.mjs
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.GTASF_COMBAT_URL ?? 'http://localhost:5391';
const out = process.env.COMBAT_OUT ?? 'docs/sf-data/wanted-escape';
const PHONE = process.env.PHONE === '1', tag = PHONE ? 'phone' : 'desktop';
const GARAGE = process.env.GTASF_ESCAPE_AT ?? '37.79530,-122.39870,0'; // Golden Gateway Garage (escape.ts HIDEOUTS)
const log = []; const note = s => { log.push(s); console.log(s); };
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext(PHONE ? { viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true }
  : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
// Capture the world socket so crimes can be confessed (C2S 0x25 = a witnessed street crime).
await ctx.addInitScript(() => {
  const Native = window.WebSocket;
  window.WebSocket = class extends Native { constructor(...a) { super(...a); if (String(a[0]).includes('/api/world')) window.__worldSocket = this; } };
});
const page = await ctx.newPage(); page.setDefaultTimeout(60_000);
const errors = []; page.on('pageerror', e => errors.push(String(e.message).slice(0, 140)));
const shot = name => page.screenshot({ path: `${out}/${name}-${tag}.jpg`, type: 'jpeg', quality: 85 });
const sample = () => page.evaluate(() => {
  const row = document.querySelector('.gt-combat-wanted'), esc = document.querySelector('.gt-combat-escape');
  const lit = [...document.querySelectorAll('.gt-combat-wanted-star.lit')];
  return { stars: row && !row.hidden ? lit.length : 0, hidden: !!document.querySelector('.gt-combat-wanted-hidden'),
    anim: lit[0] ? getComputedStyle(lit[0]).animationName : '', phase: esc && !esc.hidden ? esc.dataset.phase : null,
    label: esc && !esc.hidden ? document.querySelector('.gt-combat-escape-label')?.textContent : '',
    toast: [...document.querySelectorAll('[class*="toast"], [class*="notice"]')].map(e => e.textContent.trim()).find(t => /lost the cops|lost your description/i.test(t)) ?? '' };
});
// Intro cards / identity / funding onboarding cover the HUD (same helper as tools/_drive-by-check.mjs).
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
const seen = { evading: false, searching: false, cleared: false }; let maxStars = 0, blinkGrey = false;
try {
  await page.goto(`${base}/?at=${GARAGE}&preset=low&bot=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => [...document.querySelectorAll('canvas')].some(c => c.dataset.ready === 'true'), null, { timeout: 120_000 });
  await page.waitForTimeout(8000);
  await clearOnboarding();
  await page.keyboard.press('KeyW'); await page.waitForTimeout(1500); // a MOVE goes out → the world socket is live
  // Opt into combat (the server only takes crimes from COMBAT_READY peers): F draws, then accept the 18+ gate.
  await page.keyboard.press('KeyF'); await page.waitForTimeout(900);
  if (await page.locator('.gt-age-gate').isVisible().catch(() => false)) { await page.locator('.gt-age-gate-enter').click(); await page.waitForTimeout(800); }
  await clearOnboarding();
  note(`world socket captured: ${await page.evaluate(() => !!window.__worldSocket)}`);
  // Walk the SERVER pose (0.5 m per 110 ms passes checkMovement) 45 m out, confess there, walk back into the garage.
  const S = await page.evaluate(() => { const f = window.__gtasf.world.foot; return { x: f.x, z: f.z, yaw: f.yaw ?? 0 }; });
  const walk = (dx, dz, metres) => page.evaluate(async ({ dx, dz, metres }) => {
    const f = window.__gtasf.world.foot, n = Math.round(metres / 0.5), l = Math.hypot(dx, dz) || 1;
    for (let i = 0; i < n; i++) { f.x += dx / l * 0.5; f.z += dz / l * 0.5; await new Promise(r => setTimeout(r, 110)); }
  }, { dx, dz, metres });
  const dir = { x: -Math.sin(S.yaw), z: -Math.cos(S.yaw) };
  await walk(dir.x, dir.z, 45);
  const C = await page.evaluate(() => { const f = window.__gtasf.world.foot; return { x: f.x, z: f.z }; });
  note(`garage spawn (${S.x.toFixed(0)}, ${S.z.toFixed(0)}); crime at ${Math.hypot(C.x - S.x, C.z - S.z).toFixed(0)} m out`);
  for (let i = 0; i < 3; i++) { await page.evaluate(() => window.__worldSocket?.send(Uint8Array.of(0x25, 0))); await page.waitForTimeout(700); }
  // Sample WHILE walking back: inside the hideout the clock runs fast, so the phases can pass during the walk.
  const walking = walk(S.x - C.x, S.z - C.z, Math.hypot(S.x - C.x, S.z - C.z)).then(async () => {
    const B = await page.evaluate(() => { const f = window.__gtasf.world.foot; return { x: f.x, z: f.z }; });
    note(`back in the garage: ${Math.hypot(B.x - S.x, B.z - S.z).toFixed(1)} m from the spawn, ${Math.hypot(B.x - C.x, B.z - C.z).toFixed(0)} m from the crime scene`);
  });
  const t0 = Date.now();
  while (Date.now() - t0 < 150_000) {
    const s = await sample(); maxStars = Math.max(maxStars, s.stars);
    if (process.env.TRACE === '1' && Math.round((Date.now() - t0) / 500) % 20 === 0) note(`  t${Math.round((Date.now() - t0) / 1000)}s phase ${s.phase} '${s.label}' stars ${s.stars}`);
    if (s.hidden && s.anim === 'gt-wanted-search') blinkGrey = true;
    if (s.phase === 'evading' && !seen.evading) { seen.evading = true; await shot('01-evading'); note(`${Math.round((Date.now() - t0) / 1000)}s EVADING: ${s.label} stars ${s.stars} anim ${s.anim}`); }
    if (s.phase === 'searching' && !seen.searching) {
      seen.searching = true; await page.waitForTimeout(400); await shot('02-searching'); // mid-blink pair: both flash states
      await page.waitForTimeout(500); await shot('02b-searching-blink');
      note(`${Math.round((Date.now() - t0) / 1000)}s SEARCHING: ${s.label} stars ${s.stars} anim ${s.anim}`);
    }
    if ((seen.evading || seen.searching) && s.stars === 0) {
      seen.cleared = true; await page.waitForTimeout(300); await shot('03-cleared');
      note(`${Math.round((Date.now() - t0) / 1000)}s CLEARED: stars 0, toast '${s.toast || (await sample()).toast}'`); break;
    }
    await page.waitForTimeout(250);
  }
  await walking;
} catch (e) { note(`error: ${e.message.slice(0, 200)}`); }
const pass = maxStars >= 2 && seen.searching && seen.cleared && blinkGrey && errors.length === 0;
note(`[escape-frames ${tag}] max stars ${maxStars}, evading ${seen.evading}, searching ${seen.searching}, grey blink ${blinkGrey}, cleared ${seen.cleared}`);
note(`RESULT: ${pass ? 'PASS' : 'FAIL'}  errors=${JSON.stringify(errors)}`);
await writeFile(`${out}/log-${tag}.txt`, log.join('\n') + '\n');
await browser.close();
process.exit(pass ? 0 : 1);
