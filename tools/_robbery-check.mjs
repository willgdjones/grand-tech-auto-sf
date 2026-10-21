// Throwaway: in-game verification of the store-robbery MONEY path (the one combat money flow without an
// in-game capture) before enable. Spawn at a store, accept 18+, stand inside the marker → the two-phase
// hold auto-fires → verify rob-complete pays ($750 valuation credit) + raises wanted to 2 stars.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.GTASF_GATES_URL ?? 'http://localhost:5374';
const STORE = '37.796823,-122.398323'; // embarcadero-market (shared/combat/storeRobbery.ts)
const out = 'docs/sf-data/combat';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const page = await ctx.newPage(); page.setDefaultTimeout(90000);
const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0,160)));
page.on('console', m => { if (m.type()==='error') errs.push(m.text().slice(0,160)); });
const robResp = [];
page.on('response', async r => { const p = new URL(r.url()).pathname;
  if (p === '/api/funding/rob-start' || p === '/api/funding/rob-complete') {
    let body = ''; try { body = JSON.stringify(await r.json()); } catch {}
    robResp.push({ path: p, status: r.status(), body: body.slice(0,200) });
  }
});
const vis = s => page.evaluate(x => { const e = document.querySelector(x); return !!(e && e.checkVisibility({ checkOpacity:true, checkVisibilityCSS:true })); }, s);
async function clearModals() {
  const dl = Date.now()+30000; let streak=0;
  while (Date.now()<dl) {
    const b = await page.evaluate(() => { const v=s=>{const e=document.querySelector(s);return !!(e&&e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}));};
      return { age:v('.gt-age-gate-enter'), intro:v('.gt-sa-intro')||v('.gt-sa-intro__skip'), id:v('.gt-identity-go'), fund:!!document.querySelector('.gt-funding-onboarding[open]') }; });
    if (!b.age && !b.intro && !b.id && !b.fund) { if(++streak>=3) return; await page.waitForTimeout(600); continue; }
    streak=0;
    if (b.age) { try { await page.locator('.gt-age-gate-enter').click({timeout:2500}); } catch {} await page.waitForTimeout(400); continue; }
    if (b.fund) { try { const d=page.locator('.gt-funding-onboarding[open]'); await d.getByLabel('Startup name',{exact:true}).fill('Cop'); await d.getByLabel('Your nickname',{exact:true}).fill('c'); await d.getByRole('button',{name:'Save startup'}).click({timeout:3000}); } catch {} await page.waitForTimeout(600); continue; }
    if (b.id) { try { await page.locator('.gt-identity-go').click({timeout:3000}); } catch {} await page.waitForTimeout(500); continue; }
    if (b.intro) { await page.evaluate(()=>{const s=document.querySelector('.gt-sa-intro__skip'); if(s)s.click();}); await page.waitForTimeout(500); continue; }
  }
}
const readState = () => page.evaluate(() => {
  const money = document.querySelector('.gt-hud-money, .gt-hud-money-value')?.textContent?.trim() ?? null;
  const litStars = document.querySelectorAll('.gt-combat-wanted-star.lit').length;
  const foot = window.__gtasf?.world?.foot; const wanted = window.__gtasfCombat?.state?.();
  return { money, litWantedStars: litStars, foot: foot ? { x:+foot.x.toFixed(1), z:+foot.z.toFixed(1) } : null };
});
const result = { store: STORE };
await page.goto(`${base}/?at=${STORE}&preset=low&bot=1`, { waitUntil: 'domcontentloaded' });
await page.locator('.gt-age-gate').waitFor({ state: 'visible', timeout: 90000 });
await page.locator('.gt-age-gate-enter').click();
await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 90000 });
await clearModals();
await page.evaluate(() => { try { window.__gtasfCombat.giveWeapon('pistol'); window.__gtasfCombat.selectWeapon('pistol'); } catch {} });
await page.waitForTimeout(1500);
result.before = await readState();
// stand still inside the marker; the robbery update loop auto-fires robStart → 2.5s hold → robComplete
await page.waitForTimeout(9000);
result.after = await readState();
result.robResponses = robResp;
result.errs = errs;
await page.screenshot({ path: `${out}/enable-robbery.png` });
console.log(JSON.stringify(result, null, 2));
await writeFile('docs/perf/combat-enable-robbery.json', JSON.stringify(result, null, 2) + '\n');
await browser.close();
