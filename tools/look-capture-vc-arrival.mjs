// VC office arrival frame (robotaxi drop-off). VC_VARIANT=on|off, VC_TIME=golden|noon.
// Captures a few representative VC offices at their kerb, facing the building, desktop + phone (Low).
import { chromium } from '@playwright/test';
import { mkdir, stat } from 'node:fs/promises';
const base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
const variant = process.env.VC_VARIANT ?? 'on';
const time = process.env.VC_TIME ?? 'golden';
const out = `docs/sf-data/vc-arrival-${variant}-${time}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist'] });
const errors = [];
// [id, at=lat,lon,heading] — heading faces the office building from the kerb. Tune per office after first recon.
const SPOTS = (process.env.VC_SPOTS ?? 'a16z:37.779361,-122.392552,0;index:37.779726,-122.391258,0;firstround:37.799896,-122.400499,0;ivp:37.798345,-122.400121,0').split(';').map(s => {
  const [id, q] = s.split(':'); return [id, q];
});
const DEVICES = {
  desktop: [{ viewport:{width:1600,height:900}, deviceScaleFactor:1.5 }, 'gfx=hd'],
  phone:   [{ viewport:{width:393,height:873}, deviceScaleFactor:2.75, isMobile:true, hasTouch:true }, 'preset=low&touch=1'],
};
async function dismiss(page) {
  try { const s=page.locator('.gt-sa-intro__skip'); if(await s.isVisible({timeout:1000})) await s.click(); } catch {}
  try { const g=page.locator('.gt-identity-go'); await g.waitFor({state:'visible',timeout:1500}); await g.click({timeout:8000}); } catch {}
  try { const d=page.locator('.gt-funding-onboarding[open]'); if(await d.isVisible({timeout:800})){ await d.getByLabel('Startup name',{exact:true}).fill('Look'); await d.getByLabel('Your nickname',{exact:true}).fill('F'); await d.getByRole('button',{name:'Save startup'}).click(); } } catch {}
}
for (const [name, query] of SPOTS) {
  for (const device of ['desktop','phone']) {
    const [ctxOpts, extra] = DEVICES[device];
    const ctx = await browser.newContext(ctxOpts);
    const page = await ctx.newPage(); page.setDefaultTimeout(90_000);
    page.on('pageerror', e => errors.push(`${device}/${name}: ${String(e.message)}`));
    try {
      await page.goto(`${base}/?at=${query}&time=${time}&${extra}&bot=1`);
      try { await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 75_000 }); }
      catch { await page.waitForFunction(() => window.__gtasf?.ready, { timeout: 25_000 }); }
      await dismiss(page); await page.waitForTimeout(7000); await dismiss(page);
      const path = `${out}/${name}-${device}.jpg`;
      await page.screenshot({ path, type:'jpeg', quality:91 });
      console.log(`OK ${name}/${device}: ${(await stat(path)).size}B`);
    } catch (e) { console.log(`SKIP ${name}/${device}: ${String(e.message).split('\n')[0]}`); }
    finally { await page.close(); await ctx.close(); }
  }
}
console.log('DONE ' + variant + '-' + time + ' errors=' + JSON.stringify(errors.slice(0,5)));
await browser.close();
