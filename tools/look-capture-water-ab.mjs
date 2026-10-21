// A/B for waterGrazeCap: distant/aerial water tone. WG_VARIANT=before|after, WG_TIME=noon|golden.
// Spots: aerial-bay (grazing distant Bay, the win) and street-bay (Embarcadero near+mid water, the doesn't-break check).
import { chromium } from '@playwright/test';
import { mkdir, stat } from 'node:fs/promises';
const base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
const variant = process.env.WG_VARIANT ?? 'after';
const time = process.env.WG_TIME ?? 'noon';
const out = `docs/sf-data/water-graze/${variant}-${time}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
const SPOTS = [
  // Aerial over North Beach: large grazing Bay across the frame (same camera as the teleop-match skyline).
  ['aerial-bay', 'at=37.8030,-122.4075&aerial=37.80320,-122.40520,78,37.79250,-122.40430', 8500, ['desktop', 'phone']],
  // Street: on the Embarcadero plaza looking E across the Bay (near water + mid-distance grazing water).
  ['street-bay', 'at=37.7955,-122.3935&aerial=37.79560,-122.39280,6,37.79560,-122.38600', 8000, ['desktop', 'phone']],
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
      await page.goto(`${base}/?${query}&time=${time}&${extra}&bot=1`);
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
console.log('DONE ' + variant + '-' + time + ' errors=' + JSON.stringify(errors.slice(0, 5)));
await browser.close();
