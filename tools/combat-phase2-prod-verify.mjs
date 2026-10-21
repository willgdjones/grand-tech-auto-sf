// Lane B: post-deploy verification of combat phase 2 on prod (or any URL) — is_bot devices only (leaderboard-excluded,
// analytics opted out). Steps:
//   [1] streetCrimeWanted   one pistol shot in the street → ≥1 star
//   [2] wantedEscapeFlash   stars blink while no cruiser is within sight
//   [3] combatRadarBlips    green $ / red crosshair pins on the radar (Embarcadero store + Ferry bat pickup)
//   [4] policeAir           shots through cruisers (cop-hit) escalate to ≥4 stars → a police helicopter spawns
//   [5] combatCostToast     rob a store (+$750), get killed by a second bot client → "Hospital bill: −$…" note
//   combatAnalytics can't be observed from bot devices (opted out by design) — not checked here.
//   GTASF_VERIFY_URL=https://gtasf.com node tools/combat-phase2-prod-verify.mjs
import { chromium } from '@playwright/test';

const base = process.env.GTASF_VERIFY_URL ?? 'https://gtasf.com';
const STORE = '37.796823,-122.398323'; // embarcadero-market
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [], results = {};
async function open(at, label) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { const s = WebSocket.prototype.send; WebSocket.prototype.send = function (d) {
    try { const b = d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, 1) : null; if (b && b[0] === 2) window.__ws = this; } catch {}
    return s.call(this, d); }; });
  const p = await ctx.newPage(); p.setDefaultTimeout(60000);
  p.on('pageerror', e => errors.push(`${label}: ${e.message.slice(0, 120)}`));
  await p.goto(`${base}/?at=${at}&preset=low&bot=1`);
  await p.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 90000 });
  for (let i = 0; i < 15; i++) { await p.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await p.waitForTimeout(250); }
  try { const d = p.locator('.gt-funding-onboarding[open]'); if (await d.isVisible({ timeout: 800 })) { await d.getByLabel('Startup name', { exact: true }).fill('QA'); await d.getByLabel('Your nickname', { exact: true }).fill(label); await d.getByRole('button', { name: 'Save startup' }).click(); } } catch {}
  await p.evaluate(() => window.__gtasfCombat?.requestCombat?.());
  try { const b = p.locator('.gt-age-gate-enter'); await b.waitFor({ state: 'visible', timeout: 8000 }); await b.click(); } catch {}
  await p.waitForTimeout(1000);
  return { p, ctx };
}
const stars = p => p.evaluate(() => document.querySelectorAll('.gt-combat-wanted-star.lit').length);
const rawFire = (p, target, weapon = 2) => p.evaluate(({ t, w }) => { const f = window.__gtasf.world.foot, dir = [t.x - f.x, t.y - f.y, t.z - f.z];
  const buf = new ArrayBuffer(26), v = new DataView(buf); v.setUint8(0, 0x23); v.setUint8(1, w); dir.forEach((d, k) => v.setFloat64(2 + k * 8, d, true)); window.__ws.send(buf); }, { t: target, w: weapon });
const note = (k, pass, detail) => { results[k] = { pass, detail }; console.log(`[${k}] ${pass ? 'PASS' : 'FAIL'} ${detail}`); };
try {
  // A: at the store (robbery auto-holds on arrival → +$750 and 2 stars; we read stars before that settles too).
  const A = await open(STORE, 'A');
  await A.p.evaluate(() => { window.__gtasfCombat.giveWeapon('pistol'); window.__gtasfCombat.selectWeapon('pistol'); });
  const s0 = await stars(A.p);
  await A.p.evaluate(() => { window.__gtasfCombat.fire(); window.__gtasfCombat.fireStop(); });
  let s1 = 0; for (let i = 0; i < 15 && s1 <= s0; i++) { await A.p.waitForTimeout(200); s1 = await stars(A.p); }
  note('1 streetCrimeWanted', s1 >= 1, `stars ${s0} → ${s1} after one shot`);
  let blink = false; for (let i = 0; i < 20 && !blink; i++) { blink = await A.p.evaluate(() => !!document.querySelector('.gt-combat-wanted-escaping')); if (!blink) await A.p.waitForTimeout(150); }
  note('2 wantedEscapeFlash', blink, blink ? 'stars blinking while police out of sight' : 'no blink class seen');
  const px = await A.p.evaluate(() => { let green = 0, red = 0; for (const c of document.querySelectorAll('canvas')) { if (c.width > 900 || c.height > 900) continue; const g = c.getContext('2d'); if (!g) continue;
    const d = g.getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 4) { if (Math.abs(d[i] - 0x3d) < 20 && Math.abs(d[i + 1] - 0xdc) < 20 && Math.abs(d[i + 2] - 0x84) < 20) green++; if (Math.abs(d[i] - 0xff) < 20 && Math.abs(d[i + 1] - 0x4d) < 25 && Math.abs(d[i + 2] - 0x4d) < 25) red++; } } return { green, red }; });
  note('3 combatRadarBlips', px.green > 0, `radar pin pixels green=${px.green} red=${px.red}`);
  // [4] escalate with cop-hits: fire at the nearest cruiser repeatedly.
  let heli = false, maxStars = await stars(A.p);
  for (let i = 0; i < 60 && !heli; i++) {
    const cop = await A.p.evaluate(() => { const w = window.__gtasf.world, f = w.foot; let best;
      for (const c of w.fleet?.cars?.values?.() ?? []) if ((c.data.flags & 0x40) && c.data.kind !== 'supercar') { const q = c.model.root.position, d = Math.hypot(q.x - f.x, q.z - f.z); if (!best || d < best.d) best = { x: q.x, y: q.y + 1, z: q.z, d }; }
      return best ?? null; });
    if (cop && cop.d < 50) await rawFire(A.p, cop);
    await A.p.waitForTimeout(1100);
    maxStars = Math.max(maxStars, await stars(A.p));
    heli = await A.p.evaluate(() => [...(window.__gtasf.world.fleet?.cars?.values?.() ?? [])].some(c => (c.data.flags & 0x40) && c.data.kind === 'supercar'));
  }
  note('4 policeAir', heli && maxStars >= 4, `max stars ${maxStars}, helicopter ${heli ? 'present' : 'absent'}`);
  // [5] cost note: wait for the robbery credit, then a second bot client kills A (PvP) → "Hospital bill: −$…".
  const money = () => A.p.evaluate(() => Number((document.querySelector('.gt-hud-money, .gt-hud-money-value')?.textContent ?? '').replace(/[^0-9]/g, '')) || 0);
  for (let i = 0; i < 20 && (await money()) === 0; i++) await A.p.waitForTimeout(500);
  const fa = await A.p.evaluate(() => ({ ...window.__gtasf.world.foot }));
  const B = await open(`${(37.796823 + 0.00004).toFixed(6)},-122.398323,180`, 'B');
  await B.p.evaluate(() => { window.__gtasfCombat.giveWeapon('rifle'); window.__gtasfCombat.selectWeapon('rifle'); });
  for (let i = 0; i < 12 && !(await A.p.evaluate(() => window.__gtasfCombat.state().dead)); i++) {
    const t = await A.p.evaluate(() => ({ ...window.__gtasf.world.foot })); await rawFire(B.p, { x: t.x, y: t.y, z: t.z }, 4); await B.p.waitForTimeout(700);
  }
  let bill = null; for (let i = 0; i < 20 && !bill; i++) { await A.p.waitForTimeout(500); bill = await A.p.evaluate(() => (document.body.innerText.match(/Hospital bill: [^\n]*/) ?? [null])[0]); }
  note('5 combatCostToast', Boolean(bill), bill ?? `no note (A was at ${fa.x.toFixed(0)},${fa.z.toFixed(0)}; money before $${await money()})`);
  await A.ctx.close(); await B.ctx.close();
} catch (e) { console.log(`ABORTED: ${String(e.message).split('\n')[0]}`); }
finally {
  const all = Object.values(results);
  console.log(`RESULT: ${all.length && all.every(r => r.pass) ? 'ALL PASS' : 'SEE FAILS'} | errors=${JSON.stringify(errors.slice(0, 5))}`);
  await browser.close();
}
