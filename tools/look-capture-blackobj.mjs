// Identify the near-black object in lowpaint/embarc-junction-phone: the junction spot from several headings
// (phone, Low) so whatever sits by the camera is seen from different sides.
import { chromium } from '@playwright/test';
import { mkdir, stat } from 'node:fs/promises';
const base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
const out = 'docs/sf-data/blackobj';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist'] });
const errors = [];
const SPOTS = [
  ['h210', 'at=37.794750,-122.394450,210', 6500],
  ['h030', 'at=37.794750,-122.394450,30', 6500],
  ['h120', 'at=37.794750,-122.394450,120', 6500],
  ['h300', 'at=37.794750,-122.394450,300', 6500],
];
const DEVICE = { viewport:{width:393,height:873}, deviceScaleFactor:2.75, isMobile:true, hasTouch:true };
async function dismiss(page) {
  try { const s=page.locator('.gt-sa-intro__skip'); if(await s.isVisible({timeout:1000})) await s.click(); } catch {}
  try { const g=page.locator('.gt-identity-go'); await g.waitFor({state:'visible',timeout:1500}); await g.click({timeout:8000}); } catch {}
  try { const d=page.locator('.gt-funding-onboarding[open]'); if(await d.isVisible({timeout:800})){ await d.getByLabel('Startup name',{exact:true}).fill('Look'); await d.getByLabel('Your nickname',{exact:true}).fill('F'); await d.getByRole('button',{name:'Save startup'}).click(); } } catch {}
}
const ctx = await browser.newContext(DEVICE);
for (const [name, query, settleMs] of SPOTS) {
  const page = await ctx.newPage(); page.setDefaultTimeout(90_000);
  page.on('pageerror', e => errors.push(`${name}: ${String(e.message)}`));
  try {
    await page.goto(`${base}/?${query}&time=golden&preset=low&touch=1&bot=1`);
    try { await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 75_000 }); }
    catch { await page.waitForFunction(() => window.__gtasf?.ready, { timeout: 25_000 }); }
    await dismiss(page); await page.waitForTimeout(settleMs); await dismiss(page);
    const path = `${out}/${name}.jpg`;
    await page.screenshot({ path, type:'jpeg', quality:90 });
    console.log(`OK ${name}: ${(await stat(path)).size}B`);
  } catch (e) { console.log(`SKIP ${name}: ${String(e.message).split('\n')[0]}`); }
  finally { await page.close(); }
}
await ctx.close();
console.log('DONE errors=' + JSON.stringify(errors.slice(0,5)));
await browser.close();
