// Post-enable combat PROD smoke. The orchestrator runs this RIGHT AFTER enabling combat, against prod, on a
// throwaway is_bot profile (bot=1 → gtasf_bot cookie → is_bot=1, excluded from the leaderboard/player counts).
// It exercises the real money + combat server paths against the live D1/R2 and reports deltas; it only ever
// writes to its own throwaway is_bot profile.
//
//   GTASF_VERIFY_URL=https://<prod-host> node tools/combat-prod-verify.mjs
//
// Defaults to http://localhost:5374 (a `tools/combat-stack.sh up` stack) for SAFE local dry-runs — it will NOT
// touch prod unless you pass GTASF_VERIFY_URL. If combat isn't enabled at the target yet, it bails cleanly
// (no 18+ gate / no __gtasfCombat) without writing anything.
//
// Steps (one isolated is_bot device): (1) rob a store → +$750 valuation (money IN). (2) gun-shop buy → either a
// debit (money OUT) or an 'unaffordable' rejection with NO debit (money-safety — the cheapest buyable, SMG, is
// base*(stage+1) so a fresh $0+$750 device can't afford it; seed valuation for a positive-debit check).
// (3) fire a burst → ammo decrements (client+COMBAT_FIRE serverHits path). (4) self-death → /api/combat/death
// debits the −2% wasted cost (money OUT). A real A→B damage-HIT needs two clients (covered by the two-client
// gate + combatScenario.test); add a second is_bot victim device here if a live PvP-HIT smoke is wanted.
import { chromium } from '@playwright/test';
const base = process.env.GTASF_VERIFY_URL ?? 'http://localhost:5374';
const STORE = process.env.GTASF_VERIFY_STORE ?? '37.796823,-122.398323'; // embarcadero-market
const isProd = !/localhost|127\.0\.0\.1|\[::1\]/.test(base);
const log = []; const note = s => { log.push(s); console.log(s); };
note(`combat-prod-verify → ${base} ${isProd ? '(PROD — writes to a throwaway is_bot profile)' : '(local dry-run)'}`);
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const page = await ctx.newPage(); page.setDefaultTimeout(90000);
const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0,160)));
// Real JS errors fail the run. "Failed to load resource" console lines are HTTP-status noise — the
// unaffordable gun-shop buy deliberately returns 402 (money-safety: no debit, no weapon), which is a PASS,
// not a fatal error — so exclude resource-load status lines (API bodies are asserted via the response hook).
page.on('console', m => { if (m.type()==='error' && !/Failed to load resource/i.test(m.text())) errs.push(m.text().slice(0,160)); });
const api = {}; page.on('response', r => { const p = new URL(r.url()).pathname;
  if (['/api/funding/rob-start','/api/funding/rob-complete','/api/combat/buy-weapon','/api/combat/death'].includes(p))
    r.json().then(b => { (api[p] ??= []).push(b); }).catch(()=>{}); });
// valuation (cents) read from the combat/funding API responses, with the HUD $ as a cross-check
const money = () => page.evaluate(() => {
  const t = document.querySelector('.gt-hud-money, .gt-hud-money-value')?.textContent ?? '';
  const n = t.replace(/[^0-9]/g,''); return { hud: t.trim(), dollars: n ? Number(n) : null };
});
const cstate = () => page.evaluate(() => window.__gtasfCombat?.state?.() ?? null);
const foot = p => p.evaluate(() => { const w = window.__gtasf?.world; return w?.foot ? { x: w.foot.x, y: w.foot.y, z: w.foot.z } : null; });
const health = p => p.evaluate(() => window.__gtasfCombat?.state?.().health ?? null);
// Clear the SA intro + identity + funding onboarding so no modal blocks combat/aim (shared by all clients).
const clearOnboarding = async (p) => {
  for (let i=0;i<20;i++){ const b=await p.evaluate(()=>{const v=s=>{const e=document.querySelector(s);return !!(e&&e.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}));};return{intro:v('.gt-sa-intro')||v('.gt-sa-intro__skip'),id:v('.gt-identity-go'),fund:!!document.querySelector('.gt-funding-onboarding[open]')};});
    if(!b.intro&&!b.id&&!b.fund)break;
    if(b.fund){try{const d=p.locator('.gt-funding-onboarding[open]');await d.getByLabel('Startup name',{exact:true}).fill('QA');await d.getByLabel('Your nickname',{exact:true}).fill('q');await d.getByRole('button',{name:'Save startup'}).click({timeout:3000});}catch{}await p.waitForTimeout(600);continue;}
    if(b.id){try{await p.locator('.gt-identity-go').click({timeout:3000});}catch{}await p.waitForTimeout(500);continue;}
    if(b.intro){await p.evaluate(()=>{const s=document.querySelector('.gt-sa-intro__skip');if(s)s.click();});await p.waitForTimeout(500);continue;} }
  await p.waitForTimeout(800);
};
// The 18+ gate is DEFERRED behind the first combat action (founder-funnel fix). Open it via the test hook and
// accept it so combat goes live (started) + the client sends COMBAT_READY (→ valid PvP target). A returning/acked
// player auto-starts and the gate never appears — that's fine, acceptCombat is a no-op then.
const acceptCombat = async (pg) => {
  if (await pg.evaluate(() => window.__gtasfCombat?.state?.().started === true)) return true;
  await pg.evaluate(() => window.__gtasfCombat?.requestCombat?.());
  try { const b = pg.locator('.gt-age-gate-enter'); await b.waitFor({ state: 'visible', timeout: 6000 }); await b.click(); } catch {}
  await pg.waitForTimeout(700);
  return pg.evaluate(() => window.__gtasfCombat?.state?.().started === true);
};
// Open an extra isolated is_bot combat client (own context = own funding device) for the A→B PvP server-HIT step.
const openClient = async (at, label) => {
  const c = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const p = await c.newPage(); p.setDefaultTimeout(60000);
  p.on('pageerror', e => errs.push(`${label}:${e.message.slice(0,120)}`));
  await p.goto(`${base}/?at=${at}&bot=1&preset=low`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 90000 });
  if (await p.locator('.gt-age-gate').isVisible().catch(()=>false)) await p.locator('.gt-age-gate-enter').click();
  await p.waitForTimeout(800);
  await clearOnboarding(p);
  await acceptCombat(p); // opt into combat so this client is a valid PvP target (COMBAT_READY)
  return { ctx: c, page: p };
};
const PVP_AT = process.env.GTASF_VERIFY_PVP_AT ?? '37.795799,-122.394805,0'; // Ferry plaza, walkable, away from the store
const result = { base, isProd, startedAt: new Date().toISOString(), steps: {} };
try {
  await page.goto(`${base}/?at=${STORE}&bot=1&preset=low`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 90000 });
  // combat enabled? (18+ gate shows OR, if already acked, __gtasfCombat exists). Bail cleanly if not.
  const gate = await page.locator('.gt-age-gate').isVisible().catch(()=>false);
  if (gate) await page.locator('.gt-age-gate-enter').click();
  await page.waitForTimeout(1500);
  if (!(await page.evaluate(() => !!window.__gtasfCombat))) {
    note('COMBAT NOT ENABLED at target (no __gtasfCombat) — nothing written. Run after the enable.');
    result.enabled = false; throw 'not-enabled';
  }
  result.enabled = true;
  // clear onboarding (shared with the PvP clients)
  await clearOnboarding(page);
  // STEP 0 — opt into combat (the 18+ gate is deferred behind the first combat action now). Without this the
  // rob/fire/buy/death steps can't run (robStart routes through requestCombat; firing needs combat started).
  const started0 = await acceptCombat(page);
  result.steps.optIn = { started: started0, pass: started0 === true };
  note(`[0] combat opt-in (deferred 18+ gate accepted): started=${started0} (pass=${started0 === true})`);

  // STEP 1 — rob a store (money IN). The two-phase hold auto-fires on arrival (too fast to read a "before"),
  // so verify via the authoritative rob-complete response: robbed + credited + the $750 payout.
  await page.waitForTimeout(9000);
  const robResp = (api['/api/funding/rob-complete'] ?? []).find(b => b?.status === 'robbed') ?? (api['/api/funding/rob-complete'] ?? []).at(-1) ?? null;
  const m1 = await money();
  const robPass = robResp?.status === 'robbed' && robResp?.outcome?.credited === true && robResp?.outcome?.amountCents === '75000';
  result.steps.rob = { resp: robResp, after: m1, pass: robPass };
  note(`[1] rob (money IN): ${robResp?.status} credited=${robResp?.outcome?.credited} $${(Number(robResp?.outcome?.amountCents ?? 0)/100)} → HUD ${m1.hud} (pass=${robPass})`);

  // STEP 2 — gun-shop buy (money OUT or safe rejection)
  const before2 = await money(); const owned0 = (await cstate())?.owned ?? [];
  await page.evaluate(() => window.__gtasfCombat.buyWeapon('smg'));
  await page.waitForTimeout(2500);
  const after2 = await money(); const owned1 = (await cstate())?.owned ?? [];
  const buyResp = (api['/api/combat/buy-weapon'] ?? []).at(-1) ?? null;
  const gotSmg = owned1.includes('smg') && !owned0.includes('smg');
  const debited = (before2.dollars ?? 0) - (after2.dollars ?? 0);
  // money-safety: owned the weapon IFF debited; never a weapon without a debit or a debit without a weapon.
  const safe = gotSmg ? debited > 0 : debited === 0;
  result.steps.buy = { resp: buyResp, gotSmg, debitedDollars: debited, before: before2, after: after2, moneySafe: safe, pass: safe };
  note(`[2] gun-shop buy smg: owned=${gotSmg} debited=$${debited} resp=${JSON.stringify(buyResp)} moneySafe=${safe}`);

  // STEP 3 — fire (combat / serverHits path): ammo decrements
  await page.evaluate(() => { window.__gtasfCombat.giveWeapon('pistol'); window.__gtasfCombat.selectWeapon('pistol'); });
  const ammo0 = (await cstate())?.ammo?.pistol ?? null;
  for (let i=0;i<3;i++){ await page.evaluate(()=>window.__gtasfCombat.fire()); await page.waitForTimeout(250); await page.evaluate(()=>window.__gtasfCombat.fireStop()); }
  await page.waitForTimeout(500);
  const ammo1 = (await cstate())?.ammo?.pistol ?? null;
  result.steps.fire = { ammoBefore: ammo0, ammoAfter: ammo1, pass: ammo0 != null && ammo1 != null && ammo1 < ammo0 };
  note(`[3] fire: pistol ammo ${ammo0}→${ammo1} (pass=${result.steps.fire.pass})`);

  // STEP 3b — A→B server HIT (serverHits/PvP path). openPvp is a SERVER flag not visible to the client, so this
  // opens two fresh is_bot clients ADJACENT, arms A via the test hook, aims at B, fires, and polls B's SERVER-owned
  // health. Mode via GTASF_VERIFY_PVP: 'auto' (default) attempts it and reports hit/no-hit WITHOUT failing the run
  // (a miss = openPvp not in the enabled set; A→B HIT is also covered by combatScenario.test + the two-client gate);
  // '1'/'require' hard-fails on a miss (assert openPvp was enabled); '0'/'skip' skips it (fast single-device run).
  const pvpMode = (process.env.GTASF_VERIFY_PVP ?? 'auto').toLowerCase();
  const pvpRequired = pvpMode === '1' || pvpMode === 'require';
  if (pvpMode !== '0' && pvpMode !== 'skip') {
    let A, B;
    try {
      A = await openClient(PVP_AT, 'pvpA'); B = await openClient(PVP_AT, 'pvpB');
      const fa = await foot(A.page), fb = await foot(B.page);
      const apart = fa && fb ? Math.hypot(fa.x - fb.x, fa.z - fb.z) : null;
      await A.page.evaluate(() => { window.__gtasfCombat.giveWeapon('smg'); window.__gtasfCombat.selectWeapon('smg'); });
      const yaw = fa && fb ? Math.atan2(fb.x - fa.x, fb.z - fa.z) : 0;
      const hb = await health(B.page); let hcur = hb, shots = 0;
      for (let i = 0; i < 20 && (hcur ?? 0) > 0; i++) {
        await A.page.evaluate(y => { const c = window.__gtasf?.world?.camera; if (c && 'yaw' in c) try { c.yaw = y; } catch {} }, yaw + (i % 5 - 2) * 0.05);
        await A.page.evaluate(() => window.__gtasfCombat.fire()); shots++;
        await A.page.waitForTimeout(260);
        await A.page.evaluate(() => window.__gtasfCombat.fireStop());
        hcur = await health(B.page);
      }
      const dead = await B.page.evaluate(() => window.__gtasfCombat?.state?.().dead === true);
      const hit = hb != null && hcur != null && hcur < hb;
      result.steps.pvpHit = { hitLanded: hit, bWasted: dead, healthBefore: hb, healthAfter: hcur, metresApart: apart, shots, required: pvpRequired, pass: hit || !pvpRequired };
      note(`[3b] A→B server HIT (${apart?.toFixed?.(1) ?? '?'}m apart): B health ${hb}→${hcur}${dead ? ' WASTED' : ''} over ${shots} bursts → hit=${hit}${hit ? '' : pvpRequired ? ' (REQUIRED — FAIL: openPvp not registering a PvP hit)' : ' (advisory: openPvp likely not in the enabled set; A→B HIT also covered by combatScenario.test + the two-client gate)'} (pass=${result.steps.pvpHit.pass})`);
    } catch (e) {
      result.steps.pvpHit = { error: String(e?.message ?? e).slice(0,160), required: pvpRequired, pass: !pvpRequired };
      note(`[3b] A→B server HIT: errored (${result.steps.pvpHit.error}) (pass=${result.steps.pvpHit.pass})`);
    } finally { await A?.ctx.close().catch(()=>{}); await B?.ctx.close().catch(()=>{}); }
  } else note('[3b] A→B server HIT: skipped (GTASF_VERIFY_PVP=0)');

  // STEP 4 — self-death cost (money OUT). WASTED = max(2% of valuation, $1,000 floor), capped at current
  // (shared/combat/economy.ts: WASTED_COST_PCT=2n, WASTED_COST_FLOOR_CENTS=100_000n). The $1,000 floor can
  // exceed 2% in the early game — e.g. a $750 player loses all $750. Verify via the authoritative death
  // response cents (reconstruct the server-side before from currentCents+costCents), not the laggy HUD.
  const before4 = await money();
  await page.evaluate(() => window.__gtasfCombat.kill());
  await page.waitForTimeout(4000); // WASTED overlay + /api/combat/death + respawn
  const after4 = await money();
  const deathResp = (api['/api/combat/death'] ?? []).at(-1) ?? null;
  const costCents = Number(deathResp?.costCents ?? NaN);
  const curCents = Number(deathResp?.currentCents ?? NaN);
  const applied = deathResp?.status === 'applied' || deathResp?.ok === true;
  const beforeCents = costCents + curCents; // server valuation just before the death debit
  const expectedCents = Number.isFinite(beforeCents) ? Math.min(beforeCents, Math.max(Math.round(beforeCents * 0.02), 100000)) : NaN;
  const pass = applied && Number.isFinite(costCents) && costCents > 0 && costCents === expectedCents;
  result.steps.death = { resp: deathResp, hudBefore: before4, hudAfter: after4, costDollars: costCents/100, expectedDollars: expectedCents/100, pass };
  note(`[4] death cost (money OUT): ${deathResp?.status ?? (deathResp?.ok?'ok':'?')} debited $${costCents/100} (expected $${expectedCents/100} = max(2%,$1k floor) capped at $${beforeCents/100}) → current $${curCents/100} (pass=${pass})`);
} catch (e) { if (e !== 'not-enabled') { result.failure = String(e?.message ?? e).slice(0,200); note(`FAILURE: ${result.failure}`); } }
result.errs = errs;
result.passed = result.enabled && Object.values(result.steps).every(s => s.pass) && !errs.length;
note(`\nRESULT: ${result.enabled ? (result.passed ? 'ALL PASS ✅' : 'SOME CHECKS FAILED ❌') : 'combat not enabled (no-op)'} | errors=${errs.length}`);
console.log(JSON.stringify(result, null, 2));
await browser.close();
