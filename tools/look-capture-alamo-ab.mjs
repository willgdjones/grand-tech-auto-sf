// A/B for alamoSquareGreens: Alamo Square reads as a specific place, not a flat green slab (completes the Painted
// Ladies postcard). Geometry-free shader change in urbanSurfaces. Toggle the flag and reload between runs:
//   (alamoSquareGreens:true)  ALAMO_VARIANT=after  node tools/look-capture-alamo-ab.mjs
//   (alamoSquareGreens:false) ALAMO_VARIANT=before node tools/look-capture-alamo-ab.mjs
import { chromium } from '@playwright/test';
import { mkdir, stat } from 'node:fs/promises';
const base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
const variant = process.env.ALAMO_VARIANT ?? 'after';
const out = `docs/sf-data/alamo-square/${variant}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
// Square centre ~37.7764,-122.4329; ~154 m E-W x ~170 m N-S.
const SPOTS = [
  // Low oblique over the lawn from the NW, shallow angle SE: the ground treatment filling the frame.
  ['lawn',     'at=37.7764,-122.4329&aerial=37.77690,-122.43365,30,37.77600,-122.43275', 8000, ['desktop', 'phone']],
  // The Painted Ladies postcard: the colour row above the now-varied Alamo lawn (completed scene).
  ['postcard', 'at=37.7762,-122.4330&aerial=37.77605,-122.43365,34,37.77640,-122.43205', 8000, ['desktop', 'phone']],
  // Near top-down over the square: the lawn + path-network plan read.
  ['topdown',  'at=37.7764,-122.4329&aerial=37.7764,-122.4329,230,37.77635,-122.43285', 8000, ['desktop']],
];
const DEVICES = {
  desktop: [{ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.5 }, 'gfx=hd'],
  phone: [{ viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true }, 'preset=low&touch=1'],
};
async function dismiss(page) {
  try { const s = page.locator('.gt-sa-intro__skip'); if (await s.isVisible({ timeout: 1000 })) await s.click(); } catch {}
  try { const g = page.locator('.gt-identity-go'); await g.waitFor({ state: 'visible', timeout: 1500 }); await g.click({ timeout: 8000 }); } catch {}
  try { const d = page.locator('.gt-funding-onboarding[open]'); if (await d.isVisible({ timeout: 800 })) { await d.getByLabel('Startup name', { exact: true }).fill('Look'); await d.getByLabel('Your nickname', { exact: true }).fill('F'); await d.getByRole('button', { name: 'Save startup' }).click(); } } catch {}
}
for (const [name, query, settleMs, devs] of SPOTS) {
  for (const device of devs) {
    const [ctxOpts, extra] = DEVICES[device];
    const ctx = await browser.newContext(ctxOpts);
    const page = await ctx.newPage(); page.setDefaultTimeout(90_000);
    page.on('pageerror', e => errors.push(`${device}/${name}: ${String(e.message)}`));
    try {
      await page.goto(`${base}/?${query}&time=golden&${extra}&bot=1`);
      try { await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 75_000 }); }
      catch { await page.waitForFunction(() => window.__gtasf?.ready, { timeout: 25_000 }); }
      await dismiss(page); await page.waitForTimeout(settleMs); await dismiss(page);
      const path = `${out}/${name}-${device}.jpg`;
      await page.screenshot({ path, type: 'jpeg', quality: 91 });
      console.log(`OK ${name}/${device}: ${(await stat(path)).size}B`);
    } catch (e) { console.log(`SKIP ${name}/${device}: ${String(e.message).split('\n')[0]}`); }
    finally { await page.close(); await ctx.close(); }
  }
}
console.log('DONE variant=' + variant + ' errors=' + JSON.stringify(errors.slice(0, 5)));
await browser.close();
