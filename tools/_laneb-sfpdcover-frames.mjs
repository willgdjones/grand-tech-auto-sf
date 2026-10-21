// Lane B (gtasf-ex3nf, flag sfpdCover): do SFPD officers under fire break for cover behind a stopped cruiser? Local combat
// stack (police can SEE but never fire locally: no building collision), 2-3 stars confessed on the world socket after the
// 18+ gate, wait for a cruiser to park and its officers to step out (they charge, no door cover without policePresence),
// then fire for a few seconds. Samples each officer's distance to the player and to the nearest parked cruiser.
// Pass = after firing, an officer stands within ~2.5 m of a parked cruiser with the car between them and the player.
//   GTASF_COMBAT_URL=http://localhost:5393 [PHONE=1] node tools/_laneb-sfpdcover-frames.mjs
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.GTASF_COMBAT_URL ?? 'http://localhost:5393';
const out = process.env.COMBAT_OUT ?? 'docs/sf-data/sfpd-cover';
const PHONE = process.env.PHONE === '1', tag = PHONE ? 'phone' : 'desktop';
const SPAWN = process.env.GTASF_COVER_AT ?? '37.80199520213967,-122.41963019831591,87.8'; // has local road traffic for cruisers
const log = []; const note = s => { log.push(s); console.log(s); };
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext(PHONE ? { viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true }
  : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => {
  const Native = window.WebSocket;
  window.WebSocket = class extends Native { constructor(...a) { super(...a); if (String(a[0]).includes('/api/world')) window.__worldSocket = this; } };
});
const page = await ctx.newPage(); page.setDefaultTimeout(60_000);
const errors = []; page.on('pageerror', e => errors.push(String(e.message).slice(0, 140)));
const shot = name => page.screenshot({ path: `${out}/${name}-${tag}.jpg`, type: 'jpeg', quality: 85 });
// Officers vs the player and the nearest PARKED police car (speed ~0), in metres.
const sample = () => page.evaluate(() => {
  const w = window.__gtasf.world, f = w.foot, officers = w.policeOfficers?.positions?.() ?? [];
  const cars = [...w.fleet.cars.values()].filter(c => (c.data.flags & 0x40) && Math.abs(c.data.speedCmps ?? 0) < 50).map(c => c.model.root.position);
  return officers.map(o => {
    let car = null, dc = Infinity; for (const c of cars) { const d = Math.hypot(c.x - o.x, c.z - o.z); if (d < dc) { dc = d; car = c; } }
    const dp = Math.hypot(o.x - f.x, o.z - f.z), carToPlayer = car ? Math.hypot(car.x - f.x, car.z - f.z) : Infinity;
    return { dp: +dp.toFixed(1), dc: +dc.toFixed(1), behind: car ? dp > carToPlayer : false };
  });
});
let pass = false;
try {
  await page.goto(`${base}/?at=${SPAWN}&preset=low&bot=1`);
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 120_000 });
  for (let i = 0; i < 12; i++) { const on = await page.evaluate(() => { const b = document.querySelector('.gt-sa-intro__skip') ?? document.querySelector('.gt-identity-go'); if (b && b.checkVisibility()) { b.click(); return true; } return false; }); if (!on) break; await page.waitForTimeout(500); }
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.__gtasfCombat?.requestCombat?.());
  try { const b = page.locator('.gt-age-gate-enter'); await b.waitFor({ state: 'visible', timeout: 8000 }); await b.click(); } catch {}
  await page.waitForTimeout(800);
  await page.evaluate(() => { try { window.__gtasfCombat.giveWeapon('pistol'); window.__gtasfCombat.selectWeapon('pistol'); } catch {} });
  await page.keyboard.press('KeyW'); await page.waitForTimeout(800); // a MOVE: the world socket is live
  for (let i = 0; i < 3; i++) { await page.evaluate(() => window.__worldSocket?.send(Uint8Array.of(0x25, 0))); await page.waitForTimeout(700); }
  // Wait for officers on foot (a cruiser parks at the foot standoff, its officers step out ~2 s later).
  let officers = [];
  for (let i = 0; i < 120 && officers.length === 0; i++) { await page.waitForTimeout(1000); officers = await sample(); }
  const stars = await page.evaluate(() => document.querySelectorAll('.gt-combat-wanted-star.lit').length);
  if (!officers.length) throw new Error(`no officers deployed (stars ${stars})`);
  await page.waitForTimeout(4000);
  note(`[sfpd-cover ${tag}] ${stars} stars; before firing: ${JSON.stringify(await sample())}`);
  await shot('01-charging');
  // Open fire (aim off to the side: every accepted trigger counts as firing, hit or miss).
  await page.evaluate(() => window.__gtasf.world.camera.setOrbit(window.__gtasf.world.foot.yaw + Math.PI / 2, -0.1));
  const t0 = Date.now(); let best = null;
  while (Date.now() - t0 < 9000) {
    await page.keyboard.down('KeyF'); await page.waitForTimeout(80); await page.keyboard.up('KeyF'); await page.waitForTimeout(420);
    const s = await sample(); const c = s.find(o => o.dc <= 2.5 && o.behind); if (c && !best) { best = c; await shot('02-in-cover'); }
  }
  const after = await sample();
  note(`[sfpd-cover ${tag}] after 9 s of firing: ${JSON.stringify(after)}`);
  await shot('03-holding');
  pass = after.some(o => o.dc <= 2.5 && o.behind) && errors.length === 0;
} catch (e) { note(`error: ${e.message.slice(0, 200)}`); }
note(`RESULT: ${pass ? 'PASS' : 'FAIL'}  errors=${JSON.stringify(errors)}`);
await writeFile(`${out}/log-${tag}.txt`, log.join('\n') + '\n');
await browser.close();
process.exit(pass ? 0 : 1);
