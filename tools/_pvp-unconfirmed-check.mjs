// Validate the PvP opt-in exclusion (gtasf-funnel-gate server change): an UNCONFIRMED player (hasn't accepted the
// 18+ gate → never sent COMBAT_READY) is NOT a valid PvP target, and becomes one only after opting in. Two is_bot
// clients spawn ADJACENT on a combat-flags-ON stack (openPvp on): A (shooter) opts in + arms; B (victim) does NOT
// opt in. A fires — B must be UNHARMED (health 100). Then B opts in and A fires again — now B takes damage. This
// proves unconfirmed players can't be shot and the signal flips correctly.
//   GTASF_GATES_URL=http://localhost:5374 node tools/_pvp-unconfirmed-check.mjs
import { chromium } from '@playwright/test';
const base = process.env.GTASF_GATES_URL ?? 'http://localhost:5374';
const SPAWN = process.env.GTASF_GATES_AT ?? '37.795799,-122.394805,0'; // Ferry plaza, walkable, adjacent spawn
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist'] });
const log = []; const note = s => { log.push(s); console.log(s); };
const foot = p => p.evaluate(() => { const w = window.__gtasf?.world; return w?.foot ? { x: w.foot.x, y: w.foot.y, z: w.foot.z } : null; });
const health = p => p.evaluate(() => window.__gtasfCombat?.state?.().health ?? null);
const clearOnboarding = async (p) => {
  for (let i=0;i<16;i++){ const b=await p.evaluate(()=>{const v=s=>{const e=document.querySelector(s);return !!(e&&e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}));};return{intro:v('.gt-sa-intro')||v('.gt-sa-intro__skip'),id:v('.gt-identity-go'),fund:!!document.querySelector('.gt-funding-onboarding[open]')};});
    if(!b.intro&&!b.id&&!b.fund)break;
    if(b.fund){try{const d=p.locator('.gt-funding-onboarding[open]');await d.getByLabel('Startup name',{exact:true}).fill('QA');await d.getByLabel('Your nickname',{exact:true}).fill('q');await d.getByRole('button',{name:'Save startup'}).click({timeout:3000});}catch{}await p.waitForTimeout(500);continue;}
    if(b.id){try{await p.locator('.gt-identity-go').click({timeout:3000});}catch{}await p.waitForTimeout(500);continue;}
    if(b.intro){await p.evaluate(()=>{const s=document.querySelector('.gt-sa-intro__skip');if(s)s.click();});await p.waitForTimeout(500);continue;} }
  await p.waitForTimeout(600);
};
const acceptCombat = async (p) => {
  if (await p.evaluate(() => window.__gtasfCombat?.state?.().started === true)) return true;
  await p.evaluate(() => window.__gtasfCombat?.requestCombat?.());
  try { const b = p.locator('.gt-age-gate-enter'); await b.waitFor({ state: 'visible', timeout: 6000 }); await b.click(); } catch {}
  await p.waitForTimeout(700);
  return p.evaluate(() => window.__gtasfCombat?.state?.().started === true);
};
const open = async (label) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage(); p.setDefaultTimeout(60000);
  p.on('pageerror', e => note(`[${label}] PAGEERR ${e.message.slice(0,120)}`));
  await p.goto(`${base}/?at=${SPAWN}&bot=1&preset=low`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 90000 });
  await p.waitForTimeout(800);
  await clearOnboarding(p);
  return { ctx, page: p };
};
const fireAt = async (A, fa, fb, n) => {
  const yaw = fa && fb ? Math.atan2(fb.x - fa.x, fb.z - fa.z) : 0;
  for (let i = 0; i < n; i++) {
    await A.page.evaluate(y => { const c = window.__gtasf?.world?.camera; if (c && 'yaw' in c) try { c.yaw = y; } catch {} }, yaw + (i % 5 - 2) * 0.05);
    await A.page.evaluate(() => window.__gtasfCombat.fire()); await A.page.waitForTimeout(240);
    await A.page.evaluate(() => window.__gtasfCombat.fireStop());
  }
};
let A, B; const result = {};
try {
  A = await open('A/shooter'); B = await open('B/victim');
  await acceptCombat(A.page);                                 // A opts into combat
  await A.page.evaluate(() => { window.__gtasfCombat.giveWeapon('smg'); window.__gtasfCombat.selectWeapon('smg'); });
  // B does NOT opt in — stays unconfirmed (no COMBAT_READY).
  const bStarted = await B.page.evaluate(() => window.__gtasfCombat?.state?.().started === true);
  const fa = await foot(A.page), fb = await foot(B.page);
  const hBefore = await health(B.page);
  await fireAt(A, fa, fb, 12);
  const hUnconfirmed = await health(B.page);
  result.phase1 = { bStarted, hBefore, hUnconfirmed, protected: hUnconfirmed === hBefore };
  note(`[1] B UNCONFIRMED (started=${bStarted}): A fired 12 bursts → B health ${hBefore}→${hUnconfirmed} (want UNCHANGED → protected=${result.phase1.protected})`);
  // Now B opts in → becomes a valid target. A fires again → B must take damage.
  await acceptCombat(B.page);
  const hAfterOptIn = await health(B.page);
  await fireAt(A, await foot(A.page), await foot(B.page), 12);
  const hConfirmed = await health(B.page);
  result.phase2 = { hAfterOptIn, hConfirmed, damaged: hConfirmed < hAfterOptIn };
  note(`[2] B OPTED IN: A fired 12 bursts → B health ${hAfterOptIn}→${hConfirmed} (want DROPS → damaged=${result.phase2.damaged})`);
  result.pass = result.phase1.protected && result.phase2.damaged;
  note(`\nRESULT: ${result.pass ? 'PASS ✅ unconfirmed player is NOT a PvP target; becomes one only after opting in' : 'FAIL ❌'}`);
} catch (e) { note(`ABORTED: ${String(e?.message ?? e).split('\n')[0]}`); }
finally { await A?.ctx.close().catch(()=>{}); await B?.ctx.close().catch(()=>{}); await browser.close(); }
