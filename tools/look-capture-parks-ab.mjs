// A/B for the district-park-greens registry (Washington Square, Lafayette, Alta Plaza, Panhandle).
//   PARKS_VARIANT=before node tools/look-capture-parks-ab.mjs   (flag off / not yet added)
//   PARKS_VARIANT=after  node tools/look-capture-parks-ab.mjs   (districtParkGreens:true)
import { chromium } from '@playwright/test';
import { mkdir, stat } from 'node:fs/promises';
const base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
const variant = process.env.PARKS_VARIANT ?? 'before';
// [id, centreLat, centreLon, camOffLat(south, deg), heightM]
const PARKS = [
  ['washington-square', 37.80066, -122.40990, 0.00150, 85],
  ['lafayette',         37.79154, -122.42739, 0.00165, 95],
  ['alta-plaza',        37.79125, -122.43600, 0.00150, 90],
  ['panhandle',         37.77245, -122.44805, 0.00180, 120],
];
const DEVICES = {
  desktop: [{ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.5 }, 'gfx=hd'],
  phone: [{ viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true }, 'preset=low&touch=1'],
};
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
async function dismiss(page) {
  try { const s = page.locator('.gt-sa-intro__skip'); if (await s.isVisible({ timeout: 1000 })) await s.click(); } catch {}
  try { const g = page.locator('.gt-identity-go'); await g.waitFor({ state: 'visible', timeout: 1500 }); await g.click({ timeout: 8000 }); } catch {}
  try { const d = page.locator('.gt-funding-onboarding[open]'); if (await d.isVisible({ timeout: 800 })) { await d.getByLabel('Startup name', { exact: true }).fill('Look'); await d.getByLabel('Your nickname', { exact: true }).fill('F'); await d.getByRole('button', { name: 'Save startup' }).click(); } } catch {}
}
for (const [id, lat, lon, off, h] of PARKS) {
  const out = `docs/sf-data/${id}/${variant}`;
  await mkdir(out, { recursive: true });
  const query = `at=${lat},${lon}&aerial=${(lat - off).toFixed(5)},${lon},${h},${lat},${lon}`;
  for (const device of ['desktop', 'phone']) {
    const [ctxOpts, extra] = DEVICES[device];
    const ctx = await browser.newContext(ctxOpts);
    const page = await ctx.newPage(); page.setDefaultTimeout(90_000);
    page.on('pageerror', e => errors.push(`${device}/${id}: ${String(e.message)}`));
    try {
      await page.goto(`${base}/?${query}&time=golden&${extra}&bot=1`);
      try { await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 75_000 }); }
      catch { await page.waitForFunction(() => window.__gtasf?.ready, { timeout: 25_000 }); }
      await dismiss(page); await page.waitForTimeout(7000); await dismiss(page);
      const path = `${out}/view-${device}.jpg`;
      await page.screenshot({ path, type: 'jpeg', quality: 91 });
      console.log(`OK ${id}/${device}: ${(await stat(path)).size}B`);
    } catch (e) { console.log(`SKIP ${id}/${device}: ${String(e.message).split('\n')[0]}`); }
    finally { await page.close(); await ctx.close(); }
  }
}
console.log('DONE variant=' + variant + ' errors=' + JSON.stringify(errors.slice(0, 5)));
await browser.close();
