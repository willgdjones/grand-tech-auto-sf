// A/B for peacePagoda: the Japantown Peace Pagoda in the Peace Plaza. New landmark.
//   PG_VARIANT=after  node tools/look-capture-pagoda-ab.mjs   (peacePagoda:true)
//   PG_VARIANT=before node tools/look-capture-pagoda-ab.mjs   (peacePagoda:false)
import { chromium } from '@playwright/test';
import { mkdir, stat } from 'node:fs/promises';
const base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
const variant = process.env.PG_VARIANT ?? 'after';
const out = `docs/sf-data/peace-pagoda/${variant}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
// Pagoda ~37.78506,-122.42973 (Japantown Peace Plaza). Symmetric -- frame it from the plaza at a few heights.
const SPOTS = [
  ['plaza',   'at=37.7852,-122.4297&aerial=37.78475,-122.42973,8,37.78503,-122.42973', 7500, ['desktop', 'phone']],
  ['oblique', 'at=37.7852,-122.4297&aerial=37.78460,-122.42930,16,37.78503,-122.42970', 7500, ['desktop']],
  ['wide',    'at=37.7852,-122.4297&aerial=37.78430,-122.42905,30,37.78505,-122.42970', 7500, ['desktop']],
  ['street',  'at=37.78478,-122.42955&aerial=37.78478,-122.42955,4,37.78505,-122.42972', 7000, ['phone', 'desktop']],
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
