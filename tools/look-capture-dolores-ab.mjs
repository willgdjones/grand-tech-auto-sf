// A/B for doloresPark (Mission-walk gap): Dolores Park reads as a specific place, not a flat green slab.
// Geometry-free shader change in urbanSurfaces (section tone + worn sitting patches + decomposed-granite path
// network, keyed to the park's world-space rectangle). Toggle the flag and reload between runs:
//   (doloresPark:true)  DOLORES_VARIANT=after  node tools/look-capture-dolores-ab.mjs
//   (doloresPark:false) DOLORES_VARIANT=before node tools/look-capture-dolores-ab.mjs
import { chromium } from '@playwright/test';
import { mkdir, stat } from 'node:fs/promises';
const base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
const variant = process.env.DOLORES_VARIANT ?? 'after';
const out = `docs/sf-data/dolores-park/${variant}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
// Park centre ~37.7598,-122.4264; long axis N-S (~296 m), short axis E-W (~108 m).
// name, query (?...), settleMs, devices (subset of DEVICES keys)
const SPOTS = [
  // Oblique from the north, close in, looking S down the long axis: slope, section tone, path network.
  ['aerial',  'at=37.7598,-122.4264&aerial=37.7617,-122.4263,95,37.7596,-122.4265', 8000, ['desktop', 'phone']],
  // Near top-down over the centre: the full path-network plan read.
  ['topdown', 'at=37.7598,-122.4264&aerial=37.7598,-122.4264,300,37.75965,-122.42645', 8000, ['desktop']],
  // Low oblique ~32 m over the north lawn, shallow angle S: the ground treatment filling the frame (grass + path).
  ['lawn',    'at=37.7598,-122.4264&aerial=37.76055,-122.42635,32,37.7596,-122.4265', 8000, ['desktop', 'phone']],
  // Street level: spawn on the Church St (east) sidewalk and face WSW across the open lawn.
  ['street',  'at=37.76015,-122.42575,250', 7000, ['phone', 'desktop']],
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
