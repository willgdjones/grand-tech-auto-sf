// Low aerial over Mission/Haight residential rooftops, for the rooftopWaterTowers look gap (the Teleoperator
// reference's rooftops are studded with timber water towers). Real GPU, fresh page, modal dismissal. Flip the
// flag in shared/flags.ts between runs (the wrapper does it):
//   ROOF_VARIANT=after  node tools/look-capture-rooftops-ab.mjs   # rooftopWaterTowers ON
//   ROOF_VARIANT=before node tools/look-capture-rooftops-ab.mjs   # OFF
import { chromium } from '@playwright/test';
import { mkdir, stat } from 'node:fs/promises';

const base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
const variant = process.env.ROOF_VARIANT ?? 'after';
const out = 'docs/sf-data/rooftops';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
// Low aerial (~55 m) across dense residential rooftops toward the skyline — the reference's foreground framing.
const SPOTS = [
  ['mission', 'at=37.7599,-122.4190&aerial=37.7599,-122.4190,55,37.7625,-122.4155', 7000],
  ['haight', 'at=37.7701,-122.4469&aerial=37.7701,-122.4469,55,37.7725,-122.4435', 7000],
];
const DEVICES = [
  ['desktop', { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.5 }, 'gfx=hd'],
  ['phone', { viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true }, 'preset=low&touch=1'],
];
async function dismissModals(page) {
  try { const s = page.locator('.gt-sa-intro__skip'); if (await s.isVisible({ timeout: 1000 })) { await s.click(); } } catch {}
  try { const g = page.locator('.gt-identity-go'); await g.waitFor({ state: 'visible', timeout: 1500 }); await g.click({ timeout: 8000 }); } catch {}
  try { const d = page.locator('.gt-funding-onboarding[open]'); if (await d.isVisible({ timeout: 800 })) { await d.getByLabel('Startup name', { exact: true }).fill('Look'); await d.getByLabel('Your nickname', { exact: true }).fill('F'); await d.getByRole('button', { name: 'Save startup' }).click(); } } catch {}
  try { const g = page.getByRole('button', { name: /LET'S GO/i }); if (await g.isVisible({ timeout: 800 })) await g.click(); } catch {}
}
for (const [device, ctxOpts, extra] of DEVICES) {
  const ctx = await browser.newContext(ctxOpts);
  for (const [name, query, settleMs] of SPOTS) {
    const page = await ctx.newPage();
    page.setDefaultTimeout(90_000);
    page.on('pageerror', e => errors.push(`${device}/${name}: ${String(e.message)}`));
    try {
      await page.goto(`${base}/?${query}&time=golden&${extra}&bot=1`);
      try { await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 75_000 }); }
      catch { await page.waitForFunction(() => window.__gtasf?.ready, { timeout: 25_000 }); }
      await dismissModals(page); await page.waitForTimeout(settleMs); await dismissModals(page);
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
