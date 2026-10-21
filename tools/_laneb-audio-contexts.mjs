// Lane B (gtasf-4f9ac, flag sharedAudioContext): how many AudioContexts does a short session create, and when? Wraps the
// constructor, then walks (footsteps), opts into combat and fires (gunshot + shot feel), gets in a car (engine audio) and
// out. Reports each construction with its moment and the longest main-thread task near it.
//   GTASF_COMBAT_URL=http://localhost:5393 node tools/_laneb-audio-contexts.mjs
import { chromium } from '@playwright/test';

const base = process.env.GTASF_COMBAT_URL ?? 'http://localhost:5393';
const SPAWN = process.env.GTASF_SEAT_AT ?? '37.80199520213967,-122.41963019831591,87.8';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  window.__ac = []; window.__step = 'boot'; window.__long = [];
  const Native = window.AudioContext;
  window.AudioContext = class extends Native { constructor(...a) { const t = performance.now(); super(...a); window.__ac.push({ step: window.__step, ms: Math.round(performance.now() - t) }); } };
  new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push({ step: window.__step, ms: Math.round(e.duration) }); }).observe({ type: 'longtask', buffered: true });
});
const page = await ctx.newPage(); page.setDefaultTimeout(60_000);
const errors = []; page.on('pageerror', e => errors.push(String(e.message).slice(0, 140)));
const step = s => page.evaluate(s => { window.__step = s; }, s);
async function clearOnboarding() {
  for (let i = 0; i < 20; i++) {
    const b = await page.evaluate(() => { const v = s => { const e = document.querySelector(s); return !!(e && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })); };
      return { intro: v('.gt-sa-intro') || v('.gt-sa-intro__skip'), id: v('.gt-identity-go') }; });
    if (!b.intro && !b.id) break;
    if (b.id) { try { await page.locator('.gt-identity-go').click({ timeout: 3000 }); } catch {} }
    else await page.evaluate(() => document.querySelector('.gt-sa-intro__skip')?.click());
    await page.waitForTimeout(500);
  }
}
await page.goto(`${base}/?at=${SPAWN}&preset=low&bot=1`);
await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 120_000 });
await clearOnboarding(); await page.waitForTimeout(4000); await clearOnboarding();
// A REAL first gesture (onboarding is cleared with synthetic .click(), which fires no pointerdown): sharedAudioContext primes here.
await step('first-click'); await page.mouse.click(640, 400); await page.waitForTimeout(1500);
await step('walk'); await page.keyboard.down('KeyW'); await page.waitForTimeout(2500); await page.keyboard.up('KeyW'); await page.waitForTimeout(800);
await step('combat');
await page.evaluate(() => window.__gtasfCombat?.requestCombat?.());
try { const b = page.locator('.gt-age-gate-enter'); await b.waitFor({ state: 'visible', timeout: 6000 }); await b.click(); } catch {}
await page.waitForTimeout(600);
await page.evaluate(() => { try { window.__gtasfCombat.giveWeapon('pistol'); window.__gtasfCombat.selectWeapon('pistol'); } catch {} });
for (let i = 0; i < 3; i++) { await page.keyboard.down('KeyF'); await page.waitForTimeout(120); await page.keyboard.up('KeyF'); await page.waitForTimeout(500); }
await step('enter-car');
for (let i = 0; i < 6 && (await page.evaluate(() => window.__gtasf.world.mode)) === 'on-foot'; i++) { await page.keyboard.press('KeyE'); await page.waitForTimeout(1300); }
await page.waitForTimeout(1500);
await step('exit-car'); await page.keyboard.press('KeyE'); await page.waitForTimeout(1500);
const r = await page.evaluate(() => ({ ac: window.__ac, long: window.__long.filter(l => l.step !== 'boot' && l.ms >= 200), mode: window.__gtasf.world.mode }));
console.log(`AudioContexts created: ${r.ac.length} -> ${r.ac.map(a => `${a.step}(${a.ms} ms)`).join(', ')}`);
console.log(`long tasks >= 200 ms after boot: ${r.long.map(l => `${l.step} ${l.ms}`).join(', ') || 'none'}`);
console.log(`errors=${JSON.stringify(errors)}`);
await browser.close();
