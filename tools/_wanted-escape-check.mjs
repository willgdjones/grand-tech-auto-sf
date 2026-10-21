// Lane B: headless check for the wanted escape cue (flag wantedEscapeFlash) on a flags-ON stack. Rob a store (2 stars)
// and sample, every 0.5 s, whether the lit stars blink vs. the nearest SFPD unit's distance. Units spawn 75–140 m out
// (beyond the 70 m sight), so the stars must blink first, then stop once a cruiser closes inside 70 m.
//   GTASF_COMBAT_URL=http://localhost:5374 [PHONE=1] node tools/_wanted-escape-check.mjs
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.GTASF_COMBAT_URL ?? 'http://localhost:5374';
const out = process.env.COMBAT_OUT ?? 'docs/sf-data/combat';
const STORE = process.env.GTASF_ESCAPE_AT ?? '37.796823,-122.398323';
const PHONE = process.env.PHONE === '1', tag = PHONE ? 'phone' : 'desktop';
const log = []; const note = s => { log.push(s); console.log(s); };
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext(PHONE ? { viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true }
  : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const page = await ctx.newPage(); page.setDefaultTimeout(60_000);
const errors = []; page.on('pageerror', e => errors.push(String(e.message).slice(0, 140)));
const sample = () => page.evaluate(() => {
  const w = window.__gtasf.world, f = w.foot; let d = Infinity;
  for (const c of w.fleet?.cars?.values?.() ?? []) if (c.data.flags & 0x40) { const p = c.model.root.position; d = Math.min(d, Math.hypot(p.x - f.x, p.z - f.z)); }
  return { stars: document.querySelectorAll('.gt-combat-wanted-star.lit').length, blinking: !!document.querySelector('.gt-combat-wanted-escaping'), d };
});
let pass = false;
try {
  await page.goto(`${base}/?at=${STORE}&preset=low&bot=1`);
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 90_000 });
  for (let i = 0; i < 15; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(250); }
  try { const d = page.locator('.gt-funding-onboarding[open]'); if (await d.isVisible({ timeout: 800 })) { await d.getByLabel('Startup name', { exact: true }).fill('QA'); await d.getByLabel('Your nickname', { exact: true }).fill('q'); await d.getByRole('button', { name: 'Save startup' }).click(); } } catch {}
  await page.evaluate(() => window.__gtasfCombat?.requestCombat?.());
  try { const b = page.locator('.gt-age-gate-enter'); await b.waitFor({ state: 'visible', timeout: 8000 }); await b.click(); } catch {}
  await page.waitForTimeout(800);
  let sawBlinkFar = false, sawSteadyNear = false, wrong = 0, shotFar = false, shotNear = false;
  for (let i = 0; i < 150; i++) {
    const s = await sample();
    if (s.stars > 0) {
      if (s.d > 72 && s.blinking) { sawBlinkFar = true; if (!shotFar) { await page.screenshot({ path: `${out}/wanted-escape-blink-${tag}.jpg`, type: 'jpeg', quality: 85 }); shotFar = true; } }
      if (s.d < 68 && !s.blinking) { sawSteadyNear = true; if (!shotNear) { await page.screenshot({ path: `${out}/wanted-escape-seen-${tag}.jpg`, type: 'jpeg', quality: 85 }); shotNear = true; } }
      if ((s.d < 60 && s.blinking) || (s.d > 80 && s.d < Infinity && !s.blinking)) wrong++; // clear mismatches (ignore the 250 ms sampling edge)
    }
    if (i % 10 === 0) note(`  #${i} stars ${s.stars} blinking ${s.blinking} nearest unit ${Number.isFinite(s.d) ? s.d.toFixed(1) + ' m' : 'none'}`);
    if (sawBlinkFar && sawSteadyNear && i > 20) break;
    await page.waitForTimeout(sawBlinkFar ? 500 : 100); // the far phase can last ~1 s now that cruisers close fast
  }
  note(`[escape] blink while far: ${sawBlinkFar}, steady while seen: ${sawSteadyNear}, mismatches: ${wrong}`);
  pass = sawBlinkFar && sawSteadyNear && wrong <= 1;
} catch (e) { note(`ABORTED: ${String(e.message).split('\n')[0]}`); }
finally {
  note(`RESULT: ${pass ? 'PASS' : 'FAIL'}  errors=${JSON.stringify(errors.slice(0, 6))}`);
  await writeFile(`${out}/wanted-escape-log-${tag}.txt`, log.join('\n') + '\n');
  await browser.close();
}
