// Verify the founder-review fixes on phone (Low): (2) the drop banner sits below the HUD, (3) the parked car
// by the camera is no longer a pure-black blob. Forces the drop banner visible so its position is checkable
// without waiting for a live fund drop.
import { chromium } from '@playwright/test';
import { mkdir, stat } from 'node:fs/promises';
const base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
const out = 'docs/sf-data/review-fix';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist'] });
const errors = [];
const SPOTS = [
  ['junction-car', 'at=37.794750,-122.394450,210', 6500],
  ['spawn-banner', 'at=37.795229772,-122.394210973,64.2977', 6000],
];
const DEVICE = { viewport:{width:393,height:873}, deviceScaleFactor:2.75, isMobile:true, hasTouch:true };
async function dismiss(page) {
  try { const s=page.locator('.gt-sa-intro__skip'); if(await s.isVisible({timeout:1000})) await s.click(); } catch {}
  try { const g=page.locator('.gt-identity-go'); await g.waitFor({state:'visible',timeout:1500}); await g.click({timeout:8000}); } catch {}
  try { const d=page.locator('.gt-funding-onboarding[open]'); if(await d.isVisible({timeout:800})){ await d.getByLabel('Startup name',{exact:true}).fill('Look'); await d.getByLabel('Your nickname',{exact:true}).fill('F'); await d.getByRole('button',{name:'Save startup'}).click(); } } catch {}
}
async function forceBanner(page) {
  // The real .gt-drop-banner only mounts while a live fund drop is open and the drops client re-hides its own
  // element each tick. Inject a SEPARATE element with the same class so the (now below-the-HUD) layout is
  // verifiable without a live drop and without being reverted.
  await page.evaluate(() => {
    const b = document.createElement('div'); b.className = 'gt-drop-banner'; b.id = 'verify-banner';
    const t = document.createElement('div'); t.className = 'gt-drop-title';
    t.textContent = 'CAP TABLE CAPITAL ANNOUNCES A NEW FUND — COME PITCH!'; b.appendChild(t);
    const s = document.createElement('div'); s.className = 'gt-drop-sub';
    s.textContent = '50/50 cheques left · closes 13:57 · NW 250 m'; b.appendChild(s);
    document.body.appendChild(b);
  }).catch(() => {});
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
    await forceBanner(page); await page.waitForTimeout(300);
    const path = `${out}/${name}.jpg`;
    await page.screenshot({ path, type:'jpeg', quality:91 });
    console.log(`OK ${name}: ${(await stat(path)).size}B`);
  } catch (e) { console.log(`SKIP ${name}: ${String(e.message).split('\n')[0]}`); }
  finally { await page.close(); }
}
await ctx.close();
console.log('DONE errors=' + JSON.stringify(errors.slice(0,5)));
await browser.close();
