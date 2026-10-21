// A/B for embarcaderoStreetcar: the F-line streetcar at the Ferry Building default spawn.
// SC_TAG (output subdir suffix, e.g. 'on'/'off'), SC_TIME=golden|noon. OFF baseline reuses docs/sf-data/spawnwalk/*.
// Angles look SW from the spawn across the plaza toward the Embarcadero, where the streetcar is parked (~27 m out).
import { chromium } from '@playwright/test';
import { mkdir, stat } from 'node:fs/promises';
const base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
const tag = process.env.SC_TAG ?? 'on';
const time = process.env.SC_TIME ?? 'golden';
const out = `docs/sf-data/streetcar-${tag}-${time}`;
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist'] });
const errors = [];
const SPOTS = [
  // Spawn, turned SW toward the plaza/Embarcadero (heading 244 == bearing to the parked streetcar ~16 m out).
  ['hero',      'at=37.795229772,-122.394210973,244', 6500],
  // Stand ~7 m NE of the car, OUTSIDE the collider, looking SW at the side (shows the player can't enter it, and
  // the reflective framed windows read).
  ['closehero', 'at=37.795220,-122.394330,214',        6500],
  // Alternate angle down the street.
  ['along',     'at=37.795229772,-122.394210973,232',  6500],
  // From the SW, looking NE at the lettered front end (QA the "EMBARCADERO" roll sign + "F" badge).
  ['signend',   'at=37.795100,-122.394520,64',         6500],
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
