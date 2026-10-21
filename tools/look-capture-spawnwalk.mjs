// Fresh phone spawn walk-around: the first ~60 s of play from the Ferry Building default spawn. Samples the
// full 360 the player sees plus a few steps onto the plaza and toward the Embarcadero, so the next look gap
// is found from what a new player actually sees on their phone (Low preset, golden).
//   node tools/look-capture-spawnwalk.mjs
import { chromium } from '@playwright/test';
import { mkdir, stat } from 'node:fs/promises';
const base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
const out = process.env.SPAWNWALK_OUT ?? 'docs/sf-data/spawnwalk';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist'] });
const errors = [];
// From the FERRY default spawn (37.7952,-122.3942). Headings sweep the plaza; a couple step away to the road.
const SPOTS = [
  ['01-spawn-building',  'at=37.795229772,-122.394210973,64.2977', 6000],
  ['02-turn-plaza',      'at=37.795229772,-122.394210973,244',     6000],
  ['03-south-embarc',    'at=37.795229772,-122.394210973,154',     6000],
  ['04-north-embarc',    'at=37.795229772,-122.394210973,334',     6000],
  ['05-step-plaza',      'at=37.794950,-122.394600,250',           6500],
  ['06-road-cars',       'at=37.794750,-122.394450,210',           6500],
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
