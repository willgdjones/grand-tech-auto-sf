// A/B for fishermansWharfSign: the round FISHERMANS WHARF crab sign at Taylor & Jefferson. New landmark.
//   FW_VARIANT=after  node tools/look-capture-wharf-ab.mjs   (fishermansWharfSign:true)
//   FW_VARIANT=before node tools/look-capture-wharf-ab.mjs   (fishermansWharfSign:false)
import { chromium } from '@playwright/test';
import { mkdir, stat } from 'node:fs/promises';
const base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
const variant = process.env.FW_VARIANT ?? 'after';
const out = `docs/sf-data/fishermans-wharf/${variant}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
// Sign ~37.80849,-122.4157 (Taylor & Jefferson), faces SOUTH. View from the south (land side), bay behind it.
const SPOTS = [
  ['front',   'at=37.8083,-122.4157&aerial=37.80816,-122.41588,15,37.80847,-122.41574', 7500, ['desktop', 'phone']],
  ['oblique', 'at=37.8083,-122.4157&aerial=37.80808,-122.41535,10,37.80847,-122.41567', 7500, ['desktop']],
  ['wide',    'at=37.8083,-122.4157&aerial=37.80770,-122.41520,20,37.80848,-122.41565', 7500, ['desktop']],
  ['street',  'at=37.80818,-122.41585&aerial=37.80818,-122.41585,4,37.80847,-122.41568', 7000, ['phone', 'desktop']],
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
