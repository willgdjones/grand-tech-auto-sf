// Deep FiDi/Salesforce skyline from a far aerial pose, desktop + phone. Evidence for the aerialFarFacade skyline
// window-grid change (whether the deep towers read as windowed massing or blank tan slabs).
//   FIDIFAR_OUT=docs/sf-data/aerialgap/fidi-far-after node tools/look-capture-fidifar.mjs
import { chromium } from '@playwright/test';
import { mkdir, stat } from 'node:fs/promises';
const base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
const out = process.env.FIDIFAR_OUT ?? 'docs/sf-data/aerialgap/fidi-far';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist'] });
const errors = [];
const POSE = 'at=37.7820,-122.4120&aerial=37.7820,-122.4120,140,37.7930,-122.4010';
const DEVICES = [
  ['desktop', { viewport:{width:1600,height:900}, deviceScaleFactor:1.5 }, 'gfx=hd'],
  ['phone',   { viewport:{width:393,height:873}, deviceScaleFactor:2.75, isMobile:true, hasTouch:true }, 'preset=low&touch=1'],
];
async function dismiss(page) {
  try { const s=page.locator('.gt-sa-intro__skip'); if(await s.isVisible({timeout:1000})) await s.click(); } catch {}
  try { const g=page.locator('.gt-identity-go'); await g.waitFor({state:'visible',timeout:1500}); await g.click({timeout:8000}); } catch {}
}
for (const [dev, device, gfx] of DEVICES) {
  const ctx = await browser.newContext(device);
  const page = await ctx.newPage(); page.setDefaultTimeout(95_000);
  page.on('pageerror', e => errors.push(`${dev}: ${String(e.message)}`));
  try {
    await page.goto(`${base}/?${POSE}&time=golden&${gfx}&bot=1`);
    try { await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 75_000 }); }
    catch { await page.waitForFunction(() => window.__gtasf?.ready, { timeout: 25_000 }); }
    await dismiss(page); await page.waitForTimeout(16_000); await dismiss(page);
    const path = `${out}/fidi-far-${dev}.jpg`;
    await page.screenshot({ path, type:'jpeg', quality:92 });
    console.log(`OK ${dev}: ${(await stat(path)).size}B`);
  } catch (e) { console.log(`SKIP ${dev}: ${String(e.message).split('\n')[0]}`); }
  finally { await page.close(); await ctx.close(); }
}
console.log('DONE errors=' + JSON.stringify(errors.slice(0,4)));
await browser.close();
