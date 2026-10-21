// Co-op heist (flag coopHeist) two-client smoke on a LOCAL stack (tools/combat-stack.sh up with COMBAT_FLAGS="missions
// economyV3": no wanted system, so no heat to lose). Leader A (desktop) starts "Steal the Pitch Deck" with E at the H;
// crew B (Pixel 7) standing at the office gets the invite and joins as the getaway driver; B passes the office, both run
// to First Round (B first → "waiting for the leader"), A delivers → both paid the heist credit under their own devices.
// (A's delivery is POSTed from the page: the solo runner's wanted-off escape stub needs a car and this harness walks.)
//   SNAP=/tmp/gtasf-lanec-verify GTASF_VERIFY_URL=http://localhost:5319 node tools/coop-heist-verify.mjs
//   PROD=1 GTASF_VERIFY_URL=https://gtasf.com OUT=docs/qa/<day>/coop-heist node tools/coop-heist-verify.mjs
import { chromium, devices } from '@playwright/test';
import { mkdirSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
const base = process.env.GTASF_VERIFY_URL ?? 'http://localhost:5319';
const snap = process.env.SNAP ?? '/tmp/gtasf-lanec-verify';
const out = process.env.OUT ?? 'docs/sf-data/coop-heist'; mkdirSync(out, { recursive: true });
const H = { lat: 37.782190, lon: -122.402980 }, DROP = { lat: 37.799653, lon: -122.400453 }; // shared/founder/missions.ts steal-pitch-deck
// PROD=1: verify on the live site (is_bot devices; the wanted system is live there, so both must lose the heat before
// the drop pays) — payouts are read from each player's GET /api/funding/missions 'done' list instead of local D1.
const PROD = process.env.PROD === '1';
let d1 = null;
if (!PROD) {
  const d1Dir = `${snap}/worker/.wrangler/state/v3/d1/miniflare-D1DatabaseObject`;
  d1 = new DatabaseSync(`${d1Dir}/${readdirSync(d1Dir).find(f => f.endsWith('.sqlite') && f !== 'metadata.sqlite')}`);
  d1.exec('PRAGMA busy_timeout=3000');
}
const t0 = Date.now();
const project = (lat, lon) => { const rad = Math.PI / 180, f = 1 / 298.257223563, e2 = f * (2 - f);
  const ecef = (la, lo) => { const phi = la * rad, lam = lo * rad, n = 6378137 / Math.sqrt(1 - e2 * Math.sin(phi) ** 2); return [n * Math.cos(phi) * Math.cos(lam), n * Math.cos(phi) * Math.sin(lam), n * (1 - e2) * Math.sin(phi)]; };
  const o = { lat: 37.7842, lon: -122.4078 }, a = ecef(o.lat, o.lon), b = ecef(lat, lon), d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], phi = o.lat * rad, lam = o.lon * rad;
  return { x: -Math.sin(lam) * d[0] + Math.cos(lam) * d[1], z: -(-Math.sin(phi) * Math.cos(lam) * d[0] - Math.sin(phi) * Math.sin(lam) * d[1] + Math.cos(phi) * d[2]) }; };
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const result = { base, at: new Date().toISOString() }, errs = [];
async function client(tag, opts, at) {
  const ctx = await browser.newContext(opts);
  await ctx.addInitScript(() => { try { localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'QA Heist', foundedAt: 1, billboardSeen: true, preSeedClosed: true, lastRoundCloseDay: '2020-01-01' })); localStorage.setItem('gtasf.founder.bucket.v2', 'ladder'); } catch {} });
  const page = await ctx.newPage(); page.setDefaultTimeout(60000);
  page.on('pageerror', e => errs.push(`${tag}: ${e.message.slice(0, 160)}`));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/i.test(m.text())) errs.push(`${tag}: ${m.text().slice(0, 160)}`); });
  const posts = [];
  page.on('response', async r => { if (/\/api\/funding\/(mission-start|mission-complete|heist-join)/.test(r.url())) { try { posts.push({ path: new URL(r.url()).pathname, body: await r.json() }); } catch {} } });
  await page.goto(`${base}/?at=${at}&bot=1&preset=low`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 120000 });
  await page.waitForSelector('.gt-mission-phone', { state: 'attached', timeout: 180000 }).catch(() => {});
  for (let i = 0; i < 4; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(600); }
  return { tag, page, posts };
}
async function walkTo(p, t, stop, step, onStep) {
  const target = project(t.lat, t.lon);
  for (let i = 0; i < 6000; i++) {
    const d = await p.page.evaluate(({ tx, tz, stop, step }) => { const f = window.__gtasf.world.foot; const dx = tx - f.x, dz = tz - f.z, d = Math.hypot(dx, dz);
      if (d > stop) { const k = Math.min(step, d - stop + 0.1) / d; f.x += dx * k; f.z += dz * k; } return d; }, { tx: target.x, tz: target.z, stop, step });
    if (d <= stop + 0.2) return Math.round(d);
    if (i % 150 === 0) await p.page.keyboard.press('ShiftLeft');
    if (onStep) await onStep(i);
    await p.page.waitForTimeout(110);
  }
  return -1;
}
const text = (p, sel) => p.page.evaluate(s => [...document.querySelectorAll(s)].filter(e => !e.hidden).map(e => e.textContent.replace(/\s+/g, ' ')).join(' | ').slice(0, 300) || null, sel);
const toasts = p => p.page.evaluate(() => [...document.querySelectorAll('[class*="toast"]')].map(t => t.textContent.replace(/\s+/g, ' ')).filter(Boolean).join(' | ').slice(0, 500));
const pressE = async p => { await p.page.keyboard.down('KeyE'); await p.page.waitForTimeout(90); await p.page.keyboard.up('KeyE'); };
try {
  const A = await client('leader', { viewport: { width: 1280, height: 800 } }, `${H.lat.toFixed(6)},${H.lon.toFixed(6)},0`);
  const B = await client('crew', { ...devices['Pixel 7'] }, `${(H.lat + 0.0002).toFixed(6)},${H.lon.toFixed(6)},180`);
  result.A = A; result.B = B;
  await walkTo(A, H, 3, 0.5); await walkTo(B, H, 25, 0.5);
  for (let i = 0; i < 8 && !A.posts.some(x => x.path.endsWith('mission-start') && x.body.status === 'started'); i++) { await pressE(A); await A.page.waitForTimeout(1200); }
  result.leaderStart = A.posts.find(x => x.path.endsWith('mission-start'))?.body;
  await B.page.waitForFunction(() => [...document.querySelectorAll('.gt-race-card')].some(c => !c.hidden && /stealing the pitch deck/.test(c.textContent)), null, { timeout: 15000 });
  result.invite = await text(B, '.gt-race-card');
  await B.page.screenshot({ path: `${out}/invite-phone.jpg`, type: 'jpeg', quality: 75 });
  await B.page.locator('.gt-race-card-btn', { hasText: 'Join' }).click();
  await B.page.waitForTimeout(1500);
  result.join = B.posts.find(x => x.path.endsWith('heist-join'))?.body;
  result.leaderToast = await toasts(A);
  await A.page.screenshot({ path: `${out}/crew-joined-desktop.jpg`, type: 'jpeg', quality: 75 });
  await walkTo(B, H, 3, 0.5); // the crew passes the office
  // Both head for First Round; the crew is faster, so it waits for the leader at the drop.
  let shotB = false;
  await Promise.all([
    walkTo(A, DROP, 3, 0.55),
    walkTo(B, DROP, 3, 0.7, async i => { if (!shotB && i === 400) { shotB = true; await B.page.screenshot({ path: `${out}/getaway-hud-phone.jpg`, type: 'jpeg', quality: 75 }); } }),
  ].map((p, k) => k === 1 ? p.then(async () => { await B.page.waitForTimeout(4000); result.crewWaiting = await text(B, '.gt-race-hud'); await B.page.screenshot({ path: `${out}/waiting-phone.jpg`, type: 'jpeg', quality: 75 }); }) : p));
  // The leader delivers. (With the wanted system off, the solo runner's escape stub wants a car; this harness walks, so
  // the leader POSTs the same server delivery the runner would — the server checks are identical.)
  // Deliver (retrying while the heat is still on: a heist pays only once its stars are gone).
  for (let i = 0; i < 60; i++) {
    result.leaderDelivery = await A.page.evaluate(() => fetch('/api/funding/mission-complete', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: '{}' }).then(r => r.json()).then(b => b.status));
    if (result.leaderDelivery !== 'incomplete') break;
    await A.page.keyboard.press('ShiftLeft'); await A.page.waitForTimeout(5000);
  }
  // The crew is paid in the same moment (they're at the drop): watch for its notice.
  result.crewNotice = await B.page.waitForFunction(() => [...document.querySelectorAll('[class*="toast"]')].map(t => t.textContent).join(' | ').match(/Getaway pays off[^|]*/)?.[0] ?? null, null, { timeout: 10000 })
    .then(h => h.jsonValue()).catch(() => null);
  await B.page.waitForTimeout(3000);
  result.crewToast = await toasts(B);
  if (d1) result.credits = d1.prepare("SELECT device_id, amount_cents FROM funding_credits WHERE source_ref LIKE 'mission:steal-pitch-deck:%' AND awarded_at >= ?").all(t0);
  else { // prod: each player's own done-list (the heist's daily credit ref) proves each was paid exactly under their device
    const done = p => p.page.evaluate(() => fetch('/api/funding/missions', { credentials: 'same-origin' }).then(r => r.json()).then(b => b.done ?? []));
    result.done = { leader: await done(A), crew: await done(B) };
  }
  await A.page.screenshot({ path: `${out}/delivered-desktop.jpg`, type: 'jpeg', quality: 75 });
  await B.page.screenshot({ path: `${out}/crew-paid-phone.jpg`, type: 'jpeg', quality: 75 });
} catch (e) { result.failure = String(e?.message ?? e).slice(0, 300); }
delete result.A; delete result.B; result.errs = errs;
const devicesPaid = new Set((result.credits ?? []).map(c => c.device_id));
result.checks = {
  leaderStarted: result.leaderStart?.status === 'started',
  inviteReceived: /stealing the pitch deck/.test(result.invite ?? ''),
  crewJoined: result.join?.status === 'joined',
  leaderTold: /is your getaway driver/.test(result.leaderToast ?? ''),
  crewWaitedForLeader: (PROD ? /Waiting for|lose the heat/ : /Waiting for/).test(result.crewWaiting ?? ''), // prod: the crew may still be wanted
  leaderDelivered: result.leaderDelivery === 'completed' || (PROD && (result.done?.leader ?? []).includes('steal-pitch-deck')), // prod: the leader's own job runner may deliver first
  crewPaidNotice: /Getaway pays off/.test(result.crewNotice ?? ''),
  bothPaidOnce: PROD ? ['leader', 'crew'].every(k => (result.done?.[k] ?? []).includes('steal-pitch-deck'))
    : (result.credits ?? []).length === 2 && devicesPaid.size === 2,
  noConsoleErrors: !errs.length,
};
result.passed = Object.values(result.checks).every(Boolean);
console.log(JSON.stringify(result, null, 2));
console.log(`\nRESULT: ${result.passed ? 'COOP HEIST PASS ✅' : 'CHECK FAILED ❌'} ${JSON.stringify(result.checks)}`);
await browser.close();
