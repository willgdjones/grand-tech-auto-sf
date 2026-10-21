// Most Wanted bounty (flag mostWantedBounty) two-client smoke on a LOCAL combat stack (tools/combat-stack.sh up with the
// default combat flags; mostWantedBounty is dev-on). Hunter A (desktop) and target B (Pixel 7) opt into combat at the same
// spawn; B's local D1 valuation is set to $5M (so B is the Most Wanted, bounty capped at $50k); after the marker has been
// public 3 min, A takes B down with server-validated shots. Checks: A sees the Most Wanted toast + tag, B the banner, A is
// paid the victim's WASTED debit capped at $50k (victim-funded), B's valuation is not debited by the bounty, and the bounty clears.
//   SNAP=/tmp/gtasf-lanec-verify GTASF_VERIFY_URL=http://localhost:5319 node tools/bounty-verify.mjs
import { chromium, devices } from '@playwright/test';
import { mkdirSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const base = process.env.GTASF_VERIFY_URL ?? 'http://localhost:5319';
const snap = process.env.SNAP ?? '/tmp/gtasf-lanec-verify';
const out = process.env.OUT ?? 'docs/sf-data/bounty'; mkdirSync(out, { recursive: true });
const SPAWN = '37.795799,-122.394805,0';
const d1Dir = `${snap}/worker/.wrangler/state/v3/d1/miniflare-D1DatabaseObject`;
const d1 = new DatabaseSync(`${d1Dir}/${readdirSync(d1Dir).find(f => f.endsWith('.sqlite') && f !== 'metadata.sqlite')}`);
d1.exec('PRAGMA busy_timeout=3000'); // wrangler holds the same file
const t0 = Date.now();
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const result = { base, at: new Date().toISOString() }, errs = [];
async function client(tag, opts) {
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript(() => { try { localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'QA Bounty', foundedAt: 1, billboardSeen: true, preSeedClosed: true, lastRoundCloseDay: '2020-01-01' })); localStorage.setItem('gtasf.founder.bucket.v2', 'ladder'); } catch {} });
  const page = await ctx.newPage(); page.setDefaultTimeout(60000);
  page.on('pageerror', e => errs.push(`${tag}: ${e.message.slice(0, 160)}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) errs.push(`${tag}: ${m.text().slice(0, 160)}`); });
  await page.goto(`${base}/?at=${SPAWN}&preset=low`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 120000 });
  for (let i = 0; i < 4; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(600); }
  await page.evaluate(() => window.__gtasfCombat?.requestCombat?.());
  try { const b = page.locator('.gt-age-gate-enter'); await b.waitFor({ state: 'visible', timeout: 8000 }); await b.click(); } catch {}
  await page.waitForTimeout(800);
  if (!(await page.evaluate(() => window.__gtasfCombat?.state?.().started === true))) throw new Error(`${tag}: combat not started`);
  // Analytics were switched off at load (gtasf_bot=1); drop the cookie now so later requests don't re-mark the profile.
  await ctx.clearCookies({ name: 'gtasf_bot' });
  return { tag, page };
}
const cents = device => Number(d1.prepare('SELECT economy_v3_current_cents c FROM funding_profiles WHERE device_id=?').get(device)?.c ?? NaN);
const visibleText = (p, sel) => p.page.evaluate(s => { const e = document.querySelector(s); return e && !e.hidden ? e.textContent : null; }, sel);
const toasts = p => p.page.evaluate(() => [...document.querySelectorAll('[class*="toast"]')].map(t => t.textContent.replace(/\s+/g, ' ')).join(' | ').slice(0, 400));
try {
  const A = await client('A', { viewport: { width: 1280, height: 800 } });
  const B = await client('B', { ...devices['Pixel 7'] });
  const fresh = d1.prepare('SELECT device_id, nickname, created_at FROM funding_profiles WHERE created_at >= ? ORDER BY created_at').all(t0 - 5000);
  if (fresh.length < 2) throw new Error(`expected 2 fresh profiles, got ${fresh.length}`);
  const [devA, devB] = [fresh.at(-2).device_id, fresh.at(-1).device_id];
  d1.prepare('UPDATE funding_profiles SET startup_name=COALESCE(NULLIF(startup_name,\'\'),\'QA Bounty\'), nickname=COALESCE(NULLIF(nickname,\'\'),device_id) WHERE device_id IN (?,?)').run(devA, devB);
  // Valuation = the ledgers (SUM) clamped by the economy-v3 snapshot, so seed both (like the unit-test harness).
  const season = 'sf-tech-week-2026'; // shared/funding.ts FUNDING_SEASON
  d1.prepare("INSERT INTO funding_awards(id,device_id,season,event_id,event_title,day,entered_at,awarded_at,amount_cents,quote_json) VALUES(?,?,?,?,'QA seed',?,?,?,500000000,'{}')")
    .run(`qa-bounty-${Date.now()}`, devB, season, `qa-bounty-${Date.now()}`, new Date().toISOString().slice(0, 10), Date.now(), Date.now());
  d1.prepare('UPDATE funding_profiles SET economy_v3_current_cents=500000000, economy_v3_lifetime_cents=500000000, economy_v3_burn_updated_at=?, economy_reset_epoch=3 WHERE device_id=?').run(Date.now(), devB);
  // Headless visits were marked is_bot (gtasf_bot=1 cookie, now cleared), which the bounty excludes by design. On this
  // LOCAL D1 only, un-mark the two test profiles so they count as players.
  d1.prepare('UPDATE funding_profiles SET is_bot=0 WHERE device_id IN (?,?)').run(devA, devB);
  result.before = { A: cents(devA), B: cents(devB) };
  await A.page.waitForSelector('.gt-bounty-tag:not([hidden])', { timeout: 40000 }).catch(() => {});
  result.markedAt = Date.now();
  result.aToast = await toasts(A); result.bBanner = await visibleText(B, '.gt-bounty-banner');
  await A.page.screenshot({ path: `${out}/most-wanted-desktop.jpg`, type: 'jpeg', quality: 75 });
  await B.page.screenshot({ path: `${out}/you-are-wanted-phone.jpg`, type: 'jpeg', quality: 75 });
  for (let i = 0; i < 4; i++) { await A.page.waitForTimeout(46_000); await A.page.keyboard.press('ShiftLeft'); } // the marker must be public 3 min before a takedown pays
  await A.page.keyboard.press('ShiftLeft'); await B.page.keyboard.press('ShiftLeft').catch(() => {});
  await A.page.evaluate(() => { window.__gtasfCombat.giveWeapon('smg'); window.__gtasfCombat.selectWeapon('smg'); });
  const foot = p => p.page.evaluate(() => { const f = window.__gtasf.world.foot; return { x: f.x, z: f.z }; });
  for (let i = 0; i < 40; i++) {
    const [fa, fb] = [await foot(A), await foot(B)];
    await A.page.evaluate(({ y }) => { const c = window.__gtasf?.world?.camera; if (c && 'yaw' in c) try { c.yaw = y; } catch {} }, { y: Math.atan2(fb.x - fa.x, fb.z - fa.z) + (i % 5 - 2) * 0.04 });
    await A.page.evaluate(() => window.__gtasfCombat.fire()); await A.page.waitForTimeout(260); await A.page.evaluate(() => window.__gtasfCombat.fireStop());
    if (await B.page.evaluate(() => window.__gtasfCombat?.state?.().dead === true)) { result.killedAfterBursts = i + 1; break; }
  }
  result.collectedToast = await A.page.waitForFunction(() => [...document.querySelectorAll('[class*="toast"]')].some(t => /Bounty collected/.test(t.textContent)), null, { timeout: 15000 }).then(() => true).catch(() => false);
  await A.page.waitForTimeout(1500);
  result.aToastAfter = await toasts(A); result.bToastAfter = await toasts(B);
  result.after = { A: cents(devA), B: cents(devB) };
  result.claims = d1.prepare('SELECT target_device = ? AS onB, killer_device = ? AS byA, amount_cents, status FROM bounty_claims WHERE claimed_at >= ?').all(devB, devA, t0);
  await A.page.screenshot({ path: `${out}/bounty-collected-desktop.jpg`, type: 'jpeg', quality: 75 });
  await B.page.screenshot({ path: `${out}/taken-down-phone.jpg`, type: 'jpeg', quality: 75 });
  await A.page.waitForTimeout(12_000);
  result.tagAfterClaim = await visibleText(A, '.gt-bounty-tag');
} catch (e) { result.failure = String(e?.message ?? e).slice(0, 300); }
result.errs = errs;
const wasted = result.before && result.after ? result.before.B - result.after.B : NaN;
result.checks = {
  markerShownToHunter: /Most Wanted/.test(result.aToast ?? ''),
  bannerShownToTarget: /MOST WANTED FOUNDER/.test(result.bBanner ?? ''),
  takedown: !!result.killedAfterBursts,
  hunterPaidCap: result.after && result.before ? result.after.A - result.before.A === 5_000_000 : false,
  oneClaimPaid: result.claims?.length === 1 && result.claims[0].status === 'paid' && result.claims[0].onB === 1 && result.claims[0].byA === 1,
  victimOnlyWastedCost: wasted >= 0 && wasted <= 500000000 * 0.05, // the normal −2% WASTED, never more
  victimFunded: result.after && result.before ? result.after.A - result.before.A <= wasted : false, // the hunter gains at most what the victim lost
  hunterToldCollected: result.collectedToast === true,
  rivalsToldTakedown: /took down/.test(result.bToastAfter ?? ''),
  bountyCleared: result.tagAfterClaim === null,
  noConsoleErrors: !errs.length,
};
result.passed = Object.values(result.checks).every(Boolean);
console.log(JSON.stringify(result, null, 2));
console.log(`\nRESULT: ${result.passed ? 'BOUNTY PASS ✅' : 'CHECK FAILED ❌'} ${JSON.stringify(result.checks)}`);
await browser.close();
