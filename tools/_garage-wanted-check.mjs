// gtasf-n1bns reviewer condition [3] in a REAL run: at >= 1 wanted star, both the garage delivery and the old
// /personal-car-deliver refuse with 409 'wanted', and the phone shows player copy. Desktop, local stack with combat:
//   COMBAT_FLAGS="<lane B's combat set: combat … streetCrimeWanted policeAir> garageSlots personalCar driving missions founderLadder pitching" SNAP=... tools/combat-stack.sh up
//   tools/heavy.sh node tools/_garage-wanted-check.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
setTimeout(() => { console.log('RESULT: CHECK FAILED (watchdog 5 min)'); process.exit(2); }, 300_000).unref();
const base = process.env.GTASF_VERIFY_URL ?? 'http://localhost:5319';
const out = process.env.OUT ?? 'docs/sf-data/garage-p1'; mkdirSync(out, { recursive: true });
const r = { notes: [] }, errs = [];
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => { try { localStorage.setItem('gtasf.opener.v1', 'skipped');
  localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'QA Wanted', foundedAt: 1, billboardSeen: true, preSeedClosed: true })); } catch {} });
const page = await ctx.newPage(); page.setDefaultTimeout(60000);
page.on('pageerror', e => errs.push(e.message.slice(0, 140)));
const walkToXZ = async (p, stop) => { for (let i = 0; i < 3000; i++) {
  const d = await page.evaluate(({ x, z, stop }) => { const f = window.__gtasf.world.foot, dx = x - f.x, dz = z - f.z, d = Math.hypot(dx, dz);
    if (d > stop) { const k = Math.min(0.6, d - stop) / d; f.x += dx * k; f.z += dz * k; } return d; }, { x: p.x, z: p.z, stop });
  if (d <= stop + 0.2) return Math.round(d); await page.waitForTimeout(110); } return -1; };
const pressE = async () => { await page.keyboard.down('KeyE'); await page.waitForTimeout(90); await page.keyboard.up('KeyE'); };

await page.goto(`${base}/?at=37.795570,-122.393900,64&bot=1`);
await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 180000 });
await page.waitForTimeout(3000);
// Make a personal car FIRST (with combat on, E next to a parked car didn't enter it in this harness): drive the nearest parked road car a little, then get out.
const car = await page.evaluate(() => { const w = window.__gtasf.world, f = w.foot; let best = null;
  for (const c of w.fleet.cars.values()) { if (c.data.driverId || !['prius', 'tesla', 'subaru', 'supercar'].includes(c.data.kind)) continue;
    const x = c.model.root.position.x, z = c.model.root.position.z, d = Math.hypot(x - f.x, z - f.z); if (d < 80 && (!best || d < best.d)) best = { d, x, z }; } return best; });
r.carDistM = car ? Math.round(car.d) : null;
if (car) { r.walkedTo = await walkToXZ(car, 1.5);
  for (let i = 0; i < 3; i++) { await pressE(); await page.waitForTimeout(1800); if (await page.evaluate(() => window.__gtasf.world.mode === 'driver')) break; await walkToXZ(car, 1); }
  r.modeAfterE = await page.evaluate(() => window.__gtasf.world.mode);
  await page.keyboard.down('KeyW'); await page.waitForTimeout(2000); await page.keyboard.up('KeyW'); await page.waitForTimeout(1500);
  await pressE(); await page.waitForTimeout(2500); }
// Combat on (the 18+ gate opens on the first combat action), then capture the world socket for raw crime messages.
await page.evaluate(() => window.__gtasfCombat?.requestCombat?.());
await page.locator('.gt-age-gate-enter').click({ timeout: 15000 }).catch(() => r.notes.push('no age gate'));
await page.locator('.gt-combat-hud').waitFor({ state: 'visible', timeout: 10000 }).catch(() => r.notes.push('no combat hud'));
await page.waitForTimeout(1500);
r.combatStarted = await page.evaluate(() => window.__gtasfCombat?.state?.().started ?? null);
await page.evaluate(() => { const s = WebSocket.prototype.send; WebSocket.prototype.send = function (d) { try { const b = d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, 1) : null; if (b && b[0] === 2) window.__ws = this; } catch {} return s.call(this, d); }; });
// Car entry was unreliable in this harness, so if no personal car exists yet, seed one straight into the LOCAL D1 for
// this device (SNAP = the combat-stack snapshot) and reload — the point here is the wanted refusal + its copy.
const hasCar = await page.evaluate(async () => { const res = await fetch('/api/funding/personal-car', { credentials: 'same-origin' }); return res.ok && Boolean((await res.json()).car); });
if (!hasCar && process.env.SNAP) {
  const device = await page.evaluate(async () => (await (await fetch('/api/funding/profile', { credentials: 'same-origin' })).json()).deviceId);
  const sql = `INSERT OR REPLACE INTO personal_cars (device_id, kind, x, y, z, yaw, saved_at) VALUES ('${String(device).replace(/'/g, '')}', 'prius', 120200, 330, -125500, 0, ${Date.now()})`;
  execFileSync('node', [new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url).pathname, 'd1', 'execute', 'gtasf-local', '--local', '--command', sql], { cwd: `${process.env.SNAP}/worker`, stdio: 'ignore' });
  r.seededCar = device;
  await page.reload(); await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 120000 });
  await page.waitForTimeout(3000);
  await page.evaluate(() => window.__gtasfCombat?.requestCombat?.());
  await page.locator('.gt-age-gate-enter').click({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const s = WebSocket.prototype.send; WebSocket.prototype.send = function (d) { try { const b = d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, 1) : null; if (b && b[0] === 2) window.__ws = this; } catch {} return s.call(this, d); }; });
  await page.evaluate(() => { const f = window.__gtasf.world.foot; f.x += 0.5; }); await page.waitForTimeout(1500); // a MOVE goes out -> socket captured
}
r.onFoot = await page.evaluate(() => window.__gtasf.world.mode === 'on-foot');
// Two raw COMBAT_CRIME confessions (18 heat each) -> 1 star (lane B's stars mode).
r.wsCaptured = await page.evaluate(() => Boolean(window.__ws));
for (let i = 0; i < 2; i++) { await page.evaluate(() => window.__ws?.send(Uint8Array.of(0x25, 0))); await page.waitForTimeout(1100); }
await page.waitForTimeout(1200);
r.stars = await page.evaluate(() => document.querySelectorAll('.gt-combat-wanted-star.lit').length);
const call = path => page.evaluate(async ({ path }) => { const res = await fetch(`/api/funding/${path}`, { method: 'POST', credentials: 'same-origin',
  headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slot: 0 }) }); return `${res.status} ${(await res.text()).slice(0, 120)}`; }, { path });
r.garageDeliver = await call('garage-deliver');
r.personalCarDeliver = await call('personal-car-deliver');
// The player-facing copy: the phone's YOUR CAR Deliver.
await page.keyboard.press('KeyN'); await page.waitForTimeout(2500);
await page.locator('.gt-mission-phone-car-deliver').first().click({ timeout: 5000 }).catch(e => r.notes.push(`deliver click: ${e.message.slice(0, 60)}`));
await page.waitForTimeout(2000);
r.phoneCopy = await page.evaluate(() => document.querySelector('.gt-mission-phone-car')?.textContent?.replace(/\s+/g, ' ').trim() ?? null);
await page.screenshot({ path: `${out}/garage-wanted-desktop.jpg`, type: 'jpeg', quality: 80 });
r.errors = errs;
const pass = r.stars >= 1 && /^409 .*wanted/.test(r.garageDeliver) && /^409 .*wanted/.test(r.personalCarDeliver) && /Lose the cops/.test(r.phoneCopy ?? '');
console.log(JSON.stringify(r, null, 1));
console.log(`RESULT: GARAGE WANTED ${pass ? 'PASS ✅' : 'CHECK FAILED'} stars=${r.stars} garage=${r.garageDeliver?.slice(0, 40)} personal=${r.personalCarDeliver?.slice(0, 40)}`);
await browser.close(); process.exit(pass ? 0 : 1);
