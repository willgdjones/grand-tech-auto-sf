// Street-level walk around Union Square + SoMa, phone (Low, the player gate) and desktop (detail), golden hour.
// Finds the worst street-level look gap vs real SF (dense storefronts, signage, street furniture, facades).
//   node tools/look-capture-ussoma-walk.mjs
import { chromium } from '@playwright/test';
import { mkdir, stat } from 'node:fs/promises';
const base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
const out = process.env.USSOMA_OUT ?? 'docs/sf-data/ussoma';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist'] });
const errors = [];
// Walkable ground spots. Union Square retail core + SoMa. Headings aim at the densest facade wall at each spot.
const ALL_SPOTS = [
  ['us-plaza',    'at=37.78802,-122.40750,200'],  // Union Square plaza, toward Powell/Market
  ['us-powell',   'at=37.78680,-122.40800,20'],    // Powell St (cable car + shops), up toward the square
  ['us-geary',    'at=37.78720,-122.40680,250'],   // Geary St, theatre/retail frontage
  ['market-powell','at=37.78450,-122.40680,240'],  // Market St main drag at Powell
  ['soma-yerba',  'at=37.78450,-122.40250,220'],   // Yerba Buena / Moscone
  ['soma-folsom', 'at=37.78050,-122.39950,300'],   // SoMa mid-rise / warehouse blocks
];
const only = (process.env.USSOMA_SPOTS ?? '').split(',').filter(Boolean);
const SPOTS = only.length ? ALL_SPOTS.filter(([n]) => only.includes(n)) : ALL_SPOTS;
const SETTLE_MS = Number(process.env.USSOMA_SETTLE_MS ?? 6500);
const DEVICES = [
  ['phone',   { viewport:{width:393,height:873}, deviceScaleFactor:2.75, isMobile:true, hasTouch:true }, 'preset=low&touch=1'],
  ['desktop', { viewport:{width:1600,height:900}, deviceScaleFactor:1.5 }, 'gfx=hd'],
];
async function dismiss(page) {
  try { const s=page.locator('.gt-sa-intro__skip'); if(await s.isVisible({timeout:1000})) await s.click(); } catch {}
  try { const g=page.locator('.gt-identity-go'); await g.waitFor({state:'visible',timeout:1500}); await g.click({timeout:8000}); } catch {}
  try { const d=page.locator('.gt-funding-onboarding[open]'); if(await d.isVisible({timeout:800})){ await d.getByLabel('Startup name',{exact:true}).fill('Look'); await d.getByLabel('Your nickname',{exact:true}).fill('F'); await d.getByRole('button',{name:'Save startup'}).click(); } } catch {}
}
for (const [dev, device, gfx] of DEVICES) {
  const ctx = await browser.newContext(device);
  for (const [name, query] of SPOTS) {
    const page = await ctx.newPage(); page.setDefaultTimeout(90_000);
    page.on('pageerror', e => errors.push(`${dev}/${name}: ${String(e.message)}`));
    try {
      await page.goto(`${base}/?${query}&time=golden&${gfx}&bot=1`);
      try { await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 75_000 }); }
      catch { await page.waitForFunction(() => window.__gtasf?.ready, { timeout: 25_000 }); }
      await dismiss(page); await page.waitForTimeout(SETTLE_MS); await dismiss(page);
      const path = `${out}/${name}-${dev}.jpg`;
      await page.screenshot({ path, type:'jpeg', quality:90 });
      console.log(`OK ${name}-${dev}: ${(await stat(path)).size}B`);
    } catch (e) { console.log(`SKIP ${name}-${dev}: ${String(e.message).split('\n')[0]}`); }
    finally { await page.close(); }
  }
  await ctx.close();
}
console.log('DONE errors=' + JSON.stringify(errors.slice(0,6)));
await browser.close();
