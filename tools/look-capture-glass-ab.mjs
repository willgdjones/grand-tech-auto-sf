// A/B for glassTowerReflect (lane A #1): a cool sky-reflection sheen on tall mid-distance tower faces so the
// FiDi/SoMa curtain walls read as glass, not flat matte boxes. Flip the flag in shared/flags.ts between runs:
//   GLASS_VARIANT=before node tools/look-capture-glass-ab.mjs   # glassTowerReflect OFF
//   GLASS_VARIANT=after  node tools/look-capture-glass-ab.mjs   # ON
import { chromium } from '@playwright/test';
import { mkdir, stat } from 'node:fs/promises';
const base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
const variant = process.env.GLASS_VARIANT ?? 'after';
const out = 'docs/sf-data/glass-tower';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
// Low, eye-ish cameras aimed at the mid-distance (200-800 m) tower clusters at a grazing angle (max Fresnel).
const SPOTS = [
  ['ferry-fidi', 'at=37.7956,-122.3940&aerial=37.79560,-122.39400,55,37.79250,-122.40050', 8000],
  ['market-fidi', 'at=37.7875,-122.4030&aerial=37.78750,-122.40300,50,37.79050,-122.39850', 8000],
  ['fidi-cluster', 'at=37.7905,-122.3930&aerial=37.79050,-122.39300,68,37.79150,-122.39900', 8000],
];
const DEVICES = [
  ['desktop', { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.5 }, 'gfx=hd'],
  ['phone', { viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true }, 'preset=low&touch=1'],
];
async function dismiss(page) {
  try { const s = page.locator('.gt-sa-intro__skip'); if (await s.isVisible({ timeout: 1000 })) await s.click(); } catch {}
  try { const g = page.locator('.gt-identity-go'); await g.waitFor({ state: 'visible', timeout: 1500 }); await g.click({ timeout: 8000 }); } catch {}
  try { const d = page.locator('.gt-funding-onboarding[open]'); if (await d.isVisible({ timeout: 800 })) { await d.getByLabel('Startup name', { exact: true }).fill('Look'); await d.getByLabel('Your nickname', { exact: true }).fill('F'); await d.getByRole('button', { name: 'Save startup' }).click(); } } catch {}
}
for (const [device, ctxOpts, extra] of DEVICES) {
  const ctx = await browser.newContext(ctxOpts);
  for (const [name, query, settleMs] of SPOTS) {
    const page = await ctx.newPage(); page.setDefaultTimeout(90_000);
    page.on('pageerror', e => errors.push(`${device}/${name}: ${String(e.message)}`));
    try {
      await page.goto(`${base}/?${query}&time=noon&${extra}&bot=1`);
      try { await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 75_000 }); }
      catch { await page.waitForFunction(() => window.__gtasf?.ready, { timeout: 25_000 }); }
      await dismiss(page); await page.waitForTimeout(settleMs); await dismiss(page);
      const path = `${out}/${name}-${device}-${variant}.jpg`;
      await page.screenshot({ path, type: 'jpeg', quality: 90 });
      console.log(`OK ${device}/${name}: ${(await stat(path)).size}B`);
    } catch (e) { console.log(`SKIP ${device}/${name}: ${String(e.message).split('\n')[0]}`); }
    finally { await page.close(); }
  }
  await ctx.close();
}
console.log('DONE variant=' + variant + ' errors=' + JSON.stringify(errors.slice(0, 5)));
await browser.close();
