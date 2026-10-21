// High-aerial comparison vs docs/sf-data/teleoperator-reference.png: over Nob Hill looking toward the FiDi
// skyline (Transamerica), golden hour. Used to find and A/B the biggest aerial-height gap (building colour
// variety / far-LOD detail). Set AERIALGAP_VARIANT=before|after to toggle a flag between runs.
import { chromium } from '@playwright/test';
import { mkdir, stat } from 'node:fs/promises';
const base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
const variant = process.env.AERIALGAP_VARIANT ?? 'after';
const out = 'docs/sf-data/aerialgap';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist'] });
const errors = [];
// Nob Hill -> FiDi (Transamerica at 37.7952,-122.4028). Two heights to match the reference's shallow framing.
const SPOTS = [
  ['nobhill-fidi-mid', 'at=37.7925,-122.4150&aerial=37.7925,-122.4150,150,37.7952,-122.4028', 16000],
  ['westadd-aerial',   'at=37.7765,-122.4360&aerial=37.7765,-122.4360,105,37.7800,-122.4270', 16000], // dense painted Victorians
  ['haight-street',    'at=37.7701,-122.4469,100', 7000],  // street-level garish check (dense painted blocks)
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
    const page = await ctx.newPage(); page.setDefaultTimeout(95_000);
    page.on('pageerror', e => errors.push(`${device}/${name}: ${String(e.message)}`));
    try {
      await page.goto(`${base}/?${query}&time=golden&${extra}&bot=1`);
      try { await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 80_000 }); }
      catch { await page.waitForFunction(() => window.__gtasf?.ready, { timeout: 25_000 }); }
      await dismiss(page); await page.waitForTimeout(settleMs); await dismiss(page);
      const path = `${out}/${name}-${device}-${variant}.jpg`;
      await page.screenshot({ path, type:'jpeg', quality:92 });
      console.log(`OK ${device}/${name}: ${(await stat(path)).size}B`);
    } catch (e) { console.log(`SKIP ${device}/${name}: ${String(e.message).split('\n')[0]}`); }
    finally { await page.close(); }
  }
  await ctx.close();
}
console.log('DONE variant=' + variant + ' errors=' + JSON.stringify(errors.slice(0,5)));
await browser.close();
