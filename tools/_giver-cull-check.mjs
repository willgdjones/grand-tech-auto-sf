// giverFrustumCull acceptance (critic 05:2x): a mission giver in view is unchanged, and turning the camera onto one shows it on
// the first frame with no animation snap. LOCAL stack with missions on:
//   SNAP=/tmp/gtasf-lanec-gfc WEB_PORT=5319 WORKER_PORT=8988 COMBAT_FLAGS="missions founderLadder pitching" tools/combat-stack.sh up
//   tools/heavy.sh node tools/_giver-cull-check.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
setTimeout(() => { console.log('RESULT: CHECK FAILED (watchdog 4 min)'); process.exit(2); }, 240_000).unref();
const base = process.env.GTASF_VERIFY_URL ?? 'http://localhost:5319';
const out = process.env.OUT ?? 'docs/sf-data/missions/giver-cull'; mkdirSync(out, { recursive: true });
const START = { lat: 37.795000, lon: -122.394200 }; // 'taxi-fare' start (the stand giver)
const NAME = 'Mission giver: taxi-fare';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => { try { localStorage.setItem('gtasf.opener.v1', 'skipped');
  localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'QA Givers', foundedAt: 1, billboardSeen: true, preSeedClosed: true, lastRoundCloseDay: '2020-01-01' }));
  localStorage.setItem('gtasf.founder.bucket.v2', 'ladder'); } catch {} });
const page = await ctx.newPage(); page.setDefaultTimeout(90000);
const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 160)));
page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) errs.push(m.text().slice(0, 160)); });
async function clearOnboarding(p) {
  for (let i = 0; i < 20; i++) { const b = await p.evaluate(() => { const v = s => { const e = document.querySelector(s); return !!(e && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })); }; return { intro: v('.gt-sa-intro') || v('.gt-sa-intro__skip'), id: v('.gt-identity-go'), fund: !!document.querySelector('.gt-funding-onboarding[open]') }; });
    if (!b.intro && !b.id && !b.fund) break;
    if (b.fund) { try { const d = p.locator('.gt-funding-onboarding[open]'); await d.getByLabel('Startup name', { exact: true }).fill('QA Fares'); await d.getByLabel('Your nickname', { exact: true }).fill('q'); await d.getByRole('button', { name: 'Save startup' }).click({ timeout: 3000 }); } catch {} await p.waitForTimeout(600); continue; }
    if (b.id) { try { await p.locator('.gt-identity-go').click({ timeout: 3000 }); } catch {} await p.waitForTimeout(500); continue; }
    if (b.intro) { await p.evaluate(() => document.querySelector('.gt-sa-intro__skip')?.click()); await p.waitForTimeout(500); continue; } }
  await p.waitForTimeout(800);
}
// Walk the server pose: 0.7 m nudges ~every 110 ms (under the 8 m/s on-foot cap); stops within `stop` m.
await page.goto(`${base}/?at=${(START.lat + 0.00012).toFixed(6)},${(START.lon + 0.00012).toFixed(6)},180&bot=1&preset=low`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__gtasf?.ready, null, { timeout: 180000 });
await clearOnboarding(page);
await page.waitForFunction(n => !!window.__gtasf.world.landmarks?.getObjectByName(n), NAME, { timeout: 60000 });
const frame = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
// Giver state: visible + a pose signature (sum of every bone's quaternion) to catch a snap.
const giver = () => page.evaluate(n => { const g = window.__gtasf.world.landmarks.getObjectByName(n); const bones = [];
  g.traverse(o => { if (o.isBone) bones.push(o.quaternion.toArray()); });
  const cam = window.__gtasf.world.camera; return { visible: g.visible, bones, yaw: cam.yaw }; }, NAME);
const turn = async yaw => { await page.evaluate(y => window.__gtasf.world.camera.setOrbit?.(y, -0.12), yaw); };
// Find a yaw that has the giver in view (with the flag on, visible === inside the camera frustum).
let inYaw = null;
for (let k = 0; k < 12 && inYaw === null; k++) { const y = k * Math.PI / 6; await turn(y); await page.waitForTimeout(400); if ((await giver()).visible) inYaw = y; }
const r = { inViewFound: inYaw !== null };
if (inYaw !== null) {
  await turn(inYaw); await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/1-in-view.jpg`, quality: 80 });
  const seen = await giver();
  await turn(inYaw + Math.PI); await page.waitForTimeout(1200);
  const away = await giver(); r.culledWhenAway = away.visible === false;
  await turn(inYaw); await frame();
  const back = await giver(); r.shownFirstFrame = back.visible === true;
  await page.screenshot({ path: `${out}/2-turned-back-first-frame.jpg`, quality: 80 });
  await page.waitForTimeout(200); const after = await giver();
  await page.screenshot({ path: `${out}/3-turned-back-200ms.jpg`, quality: 80 });
  // Snap check: the largest bone-quaternion change across the un-cull vs one idle step a moment later (same order of size).
  const delta = (a, b) => Math.max(...a.bones.map((q, i) => Math.acos(Math.min(1, Math.abs(q.reduce((s, v, j) => s + v * b.bones[i][j], 0)))) * 2));
  r.unCullJumpRad = +delta(away, back).toFixed(3); r.idleStepRad = +delta(back, after).toFixed(3); r.inViewToAwayRad = +delta(seen, away).toFixed(3);
  r.noSnap = r.unCullJumpRad <= Math.max(0.25, r.idleStepRad * 3);
}
r.noConsoleErrors = errs.length === 0; r.errs = errs.slice(0, 4);
const pass = r.inViewFound && r.culledWhenAway && r.shownFirstFrame && r.noSnap && r.noConsoleErrors;
console.log(JSON.stringify(r, null, 1));
console.log(`RESULT: GIVER CULL ${pass ? 'PASS ✅' : 'CHECK FAILED'} ${JSON.stringify({ inViewFound: r.inViewFound, culledWhenAway: r.culledWhenAway, shownFirstFrame: r.shownFirstFrame, noSnap: r.noSnap, noConsoleErrors: r.noConsoleErrors })}`);
await browser.close(); process.exit(pass ? 0 : 1);
