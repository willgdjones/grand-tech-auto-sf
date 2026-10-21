// A/B for vaillancourtFountain: the fountain filling the plaza the founder-ladder billboard onboarding frames.
// FTN_TAG (on/off), FTN_TIME=golden|noon. Spawn-looking-SW approximates the onboarding backdrop; plus a close QA.
import { chromium } from '@playwright/test';
import { mkdir, stat } from 'node:fs/promises';
const base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
const tag = process.env.FTN_TAG ?? 'on';
const time = process.env.FTN_TIME ?? 'golden';
const out = `docs/sf-data/fountain-${tag}-${time}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist'] });
const errors = [];
const SPOTS = [
  // The REAL onboarding backdrop: Ferry Building spawn (37.7955,-122.3937) looking along the board azimuth (228),
  // where the billboard stands center. The fountain sits ~40 m out at ~218 (10 deg left) so it reads clearly to the
  // LEFT of the billboard (center open for the board), with the F-line streetcar to the right.
  ['backdrop', 'at=37.7955,-122.3937,228',       6500],
  // Close QA of the fountain model / concrete read.
  ['hero',     'at=37.795310,-122.393900,218',   6500],
];
const DEVICES = {
  desktop: [{ viewport:{width:1600,height:900}, deviceScaleFactor:1.5 }, 'gfx=hd'],
  phone:   [{ viewport:{width:393,height:873}, deviceScaleFactor:2.75, isMobile:true, hasTouch:true }, 'preset=low&touch=1'],
};
async function dismiss(page) {
  try { const s=page.locator('.gt-sa-intro__skip'); if(await s.isVisible({timeout:1000})) await s.click(); } catch {}
  try { const g=page.locator('.gt-identity-go'); await g.waitFor({state:'visible',timeout:1500}); await g.click({timeout:8000}); } catch {}
  try { const d=page.locator('.gt-funding-onboarding[open]'); if(await d.isVisible({timeout:800})){ await d.getByLabel('Startup name',{exact:true}).fill('Look'); await d.getByLabel('Your nickname',{exact:true}).fill('F'); await d.getByRole('button',{name:'Save startup'}).click(); } } catch {}
}
for (const [name, query, settleMs] of SPOTS) {
  for (const device of ['desktop','phone']) {
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
      await page.screenshot({ path, type:'jpeg', quality:91 });
      console.log(`OK ${name}/${device}: ${(await stat(path)).size}B`);
    } catch (e) { console.log(`SKIP ${name}/${device}: ${String(e.message).split('\n')[0]}`); }
    finally { await page.close(); await ctx.close(); }
  }
}
console.log('DONE ' + tag + '-' + time + ' errors=' + JSON.stringify(errors.slice(0,5)));
await browser.close();
