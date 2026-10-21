// A/B for ghirardelliSign: the rooftop GHIRARDELLI letters at Ghirardelli Square. New landmark.
//   GH_VARIANT=after  node tools/look-capture-ghirardelli-ab.mjs   (ghirardelliSign:true)
//   GH_VARIANT=before node tools/look-capture-ghirardelli-ab.mjs   (ghirardelliSign:false)
import { chromium } from '@playwright/test';
import { mkdir, stat } from 'node:fs/promises';
const base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
const variant = process.env.GH_VARIANT ?? 'after';
const out = `docs/sf-data/ghirardelli/${variant}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
// Sign ~37.80576,-122.42295 (Ghirardelli Square), faces NORTH (the bay). Classic view is from the bay/Aquatic Park.
const SPOTS = [
  ['bay',     'at=37.8062,-122.4230&aerial=37.80690,-122.42300,24,37.80588,-122.42296', 7500, ['desktop', 'phone']],
  ['oblique', 'at=37.8062,-122.4230&aerial=37.80680,-122.42210,22,37.80585,-122.42292', 7500, ['desktop']],
  ['wide',    'at=37.8062,-122.4230&aerial=37.80740,-122.42360,38,37.80585,-122.42294', 7500, ['desktop']],
  ['street',  'at=37.80648,-122.42270&aerial=37.80648,-122.42270,6,37.80588,-122.42295', 7000, ['phone', 'desktop']],
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
