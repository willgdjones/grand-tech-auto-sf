// A/B for richParkGreens (gtasf spawn walk-around gap): mapped parks read as varied landscaping instead of a
// flat vivid lawn. Geometry-free shader change in urbanSurfaces; toggle the flag and restart dev between runs:
//   (richParkGreens:true)  PARK_VARIANT=after  node tools/look-capture-parkgreens-ab.mjs
//   (richParkGreens:false) PARK_VARIANT=before node tools/look-capture-parkgreens-ab.mjs
import { chromium } from '@playwright/test';
import { mkdir, stat } from 'node:fs/promises';
const base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
const variant = process.env.PARK_VARIANT ?? 'after';
const out = 'docs/sf-data/parkgreens';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist'] });
const errors = [];
const SPOTS = [
  ['embarcadero-median', 'at=37.794950,-122.394600,250', 6500],  // the green the player sees on the first turn
  ['dolores-park',       'at=37.759600,-122.426900,135', 7000],  // a real SF park: big grass slope
];
const DEVICES = [
  ['desktop', { viewport:{width:1600,height:900}, deviceScaleFactor:1.5 }, 'gfx=hd'],
  ['phone', { viewport:{width:393,height:873}, deviceScaleFactor:2.75, isMobile:true, hasTouch:true }, 'preset=low&touch=1'],
];
async function dismiss(page) {
  try { const s=page.locator('.gt-sa-intro__skip'); if(await s.isVisible({timeout:1000})) await s.click(); } catch {}
  try { const g=page.locator('.gt-identity-go'); await g.waitFor({state:'visible',timeout:1500}); await g.click({timeout:8000}); } catch {}
  try { const d=page.locator('.gt-funding-onboarding[open]'); if(await d.isVisible({timeout:800})){ await d.getByLabel('Startup name',{exact:true}).fill('Look'); await d.getByLabel('Your nickname',{exact:true}).fill('F'); await d.getByRole('button',{name:'Save startup'}).click(); } } catch {}
}
for (const [device, ctxOpts, extra] of DEVICES) {
  const ctx = await browser.newContext(ctxOpts);
  for (const [name, query, settleMs] of SPOTS) {
    const page = await ctx.newPage(); page.setDefaultTimeout(90_000);
    page.on('pageerror', e => errors.push(`${device}/${name}: ${String(e.message)}`));
    try {
      await page.goto(`${base}/?${query}&time=golden&${extra}&bot=1`);
      try { await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 75_000 }); }
      catch { await page.waitForFunction(() => window.__gtasf?.ready, { timeout: 25_000 }); }
      await dismiss(page); await page.waitForTimeout(settleMs); await dismiss(page);
      const path = `${out}/${name}-${device}-${variant}.jpg`;
      await page.screenshot({ path, type:'jpeg', quality:91 });
      console.log(`OK ${device}/${name}: ${(await stat(path)).size}B`);
    } catch (e) { console.log(`SKIP ${device}/${name}: ${String(e.message).split('\n')[0]}`); }
    finally { await page.close(); }
  }
  await ctx.close();
}
console.log('DONE variant=' + variant + ' errors=' + JSON.stringify(errors.slice(0,5)));
await browser.close();
