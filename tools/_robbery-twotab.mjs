// Validate the two-tab robbery fix: ONE browser context (shared cookies = same funding device) with TWO tabs
// (two WebSocket peers, distinct WELCOME sids), each robbing a DIFFERENT store. With the sid-keyed hold both
// succeed; with the old device-keyed hold, tab B's rob-start overwrote tab A's entry → one tab voids to
// 'no-active-robbery'. Pass = both tabs get rob-complete 'robbed'.
import { chromium } from '@playwright/test';
const base = process.env.GTASF_GATES_URL ?? 'http://localhost:5374';
const STORES = { A: '37.796823,-122.398323' /*embarcadero-market*/, B: '37.799516,-122.407372' /*columbus-boba*/ };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 }); // shared cookies
async function openTab(at, label) {
  const page = await ctx.newPage(); page.setDefaultTimeout(90000);
  const rob = [];
  page.on('pageerror', e => console.log(`[${label}] PAGEERR`, e.message.slice(0,140)));
  page.on('response', r => { const p = new URL(r.url()).pathname;
    if (p === '/api/funding/rob-start' || p === '/api/funding/rob-complete') { r.json().then(b => rob.push(`${p.split('/').pop()}:${JSON.stringify(b).slice(0,90)}`)).catch(()=>{}); } });
  await page.goto(`${base}/?at=${at}&preset=low&bot=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 90000 });
  // The 18+ ack is per-device localStorage, shared across tabs — only the FIRST tab sees the gate; the second
  // is already acknowledged and combat auto-starts.
  if (await page.locator('.gt-age-gate').isVisible().catch(() => false)) await page.locator('.gt-age-gate-enter').click();
  await page.waitForTimeout(500);
  // clear onboarding
  const dl = Date.now()+30000; let streak=0;
  while (Date.now()<dl) {
    const b = await page.evaluate(() => { const v=s=>{const e=document.querySelector(s);return !!(e&&e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}));};
      return { age:v('.gt-age-gate-enter'), intro:v('.gt-sa-intro')||v('.gt-sa-intro__skip'), id:v('.gt-identity-go'), fund:!!document.querySelector('.gt-funding-onboarding[open]') }; });
    if (!b.age && !b.intro && !b.id && !b.fund) { if(++streak>=3) break; await page.waitForTimeout(600); continue; }
    streak=0;
    if (b.age) { try { await page.locator('.gt-age-gate-enter').click({timeout:2500}); } catch {} await page.waitForTimeout(400); continue; }
    if (b.fund) { try { const d=page.locator('.gt-funding-onboarding[open]'); await d.getByLabel('Startup name',{exact:true}).fill('Cop'); await d.getByLabel('Your nickname',{exact:true}).fill('c'); await d.getByRole('button',{name:'Save startup'}).click({timeout:3000}); } catch {} await page.waitForTimeout(600); continue; }
    if (b.id) { try { await page.locator('.gt-identity-go').click({timeout:3000}); } catch {} await page.waitForTimeout(500); continue; }
    if (b.intro) { await page.evaluate(()=>{const s=document.querySelector('.gt-sa-intro__skip'); if(s)s.click();}); await page.waitForTimeout(500); continue; }
  }
  const sid = await page.evaluate(() => window.__gtasf?.status !== undefined ? null : null); // sid not exposed; inferred via distinct connections
  return { page, rob, label };
}
// open both tabs (same device, two peers)
const A = await openTab(STORES.A, 'A');
const B = await openTab(STORES.B, 'B');
// let both auto-rob (stand in store → rob-start → 2.5s hold → rob-complete)
await A.page.waitForTimeout(11000);
const read = async t => t.page.evaluate(() => ({
  money: document.querySelector('.gt-hud-money, .gt-hud-money-value')?.textContent?.trim() ?? null,
}));
const result = {
  tabA: { rob: A.rob, ...(await read(A)) },
  tabB: { rob: B.rob, ...(await read(B)) },
};
result.bothRobbed = A.rob.some(r=>r.startsWith('rob-complete') && r.includes('"status":"robbed"')) && B.rob.some(r=>r.startsWith('rob-complete') && r.includes('"status":"robbed"'));
console.log(JSON.stringify(result, null, 2));
await browser.close();
