// meleeSwing (remote): does another player's punch play on their avatar on MY screen? Two clients side by side on a
// combat stack (openPvp): A punches (fists) repeatedly; on B, find A's avatar (a root carrying userData.heldWeapon that is
// not B's own) and sample its right wrist's offset from the avatar root, at rest vs during A's punches.
//   GTASF_URL=http://localhost:5319 tools/heavy.sh node tools/_laneb-remote-melee-check.mjs
import { chromium } from '@playwright/test';

setTimeout(() => { console.log('RESULT watchdog'); process.exit(2); }, 300_000).unref();
const base = process.env.GTASF_URL ?? 'http://localhost:5319', at = process.env.AT ?? '37.79560,-122.39370,270';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const enter = async (page, where = at) => {
  await page.goto(`${base}/?at=${where}&preset=low&bot=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 180_000 });
  for (let i = 0; i < 10; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(300); }
  await page.evaluate(() => window.__gtasfCombat?.requestCombat?.()); await page.waitForTimeout(600);
  if (await page.locator('.gt-age-gate').isVisible().catch(() => false)) { await page.locator('.gt-age-gate-enter').click(); await page.waitForTimeout(1000); }
};
try {
  const A = await (await browser.newContext({ viewport: { width: 800, height: 600 } })).newPage();
  const bctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
  await bctx.addInitScript(() => { window.__hits = 0; const W = window.WebSocket; window.WebSocket = class extends W { constructor(...a) { super(...a); if (/\/api\/world/.test(String(a[0]))) this.addEventListener('message', e => { if (e.data instanceof ArrayBuffer && new Uint8Array(e.data)[0] === 0xa8) window.__hits++; }); } }; });
  const B = await bctx.newPage();
  // A ~2 m east of B: at the same ?at= both snap to the same point and A's root is indistinguishable from B's own.
  const [lat, lon, heading] = at.split(','); await enter(A, `${lat},${(+lon + 0.000023).toFixed(6)},${heading}`); await enter(B);
  await A.evaluate(() => { window.__gtasfCombat.selectWeapon('fists'); });
  await B.waitForTimeout(3000);
  // On B: A's avatar root = a scene object with userData.heldWeapon that isn't at B's own feet.
  const probe = () => B.evaluate(() => {
    const scene = window.__gtasf.world.landmarks?.parent, f = window.__gtasf.world.foot; let best = null;
    scene?.traverse(o => { if (!o.userData?.heldWeapon) return; const p = o.getWorldPosition(new o.position.constructor()); const d = Math.hypot(p.x - f.x, p.z - f.z); if (d > 0.3 && (!best || d < best.d)) best = { o, d }; });
    if (!best) return null;
    const w = best.o.getObjectByName('Wrist.R') ?? best.o.getObjectByName('WristR'); if (!w) return { d: best.d, wrist: null, probe: best.o.userData.heldWeapon };
    const wp = w.getWorldPosition(new w.position.constructor()), rp = best.o.getWorldPosition(new w.position.constructor());
    return { d: +best.d.toFixed(2), wrist: [+(wp.x - rp.x).toFixed(3), +(wp.y - rp.y).toFixed(3), +(wp.z - rp.z).toFixed(3)], probe: best.o.userData.heldWeapon };
  });
  // Arm A's entry on B first (the remote held-weapon object only exists once B has seen A attack).
  await A.evaluate(() => { window.__gtasfCombat.fire(); setTimeout(() => window.__gtasfCombat.fireStop(), 60); });
  await B.waitForTimeout(1500);
  const rest = await probe();
  const during = [];
  for (let i = 0; i < 6; i++) {
    await A.evaluate(() => { window.__gtasfCombat.fire(); setTimeout(() => window.__gtasfCombat.fireStop(), 60); });
    for (let k = 0; k < 4; k++) { await B.waitForTimeout(45); during.push(await probe()); }
    await B.waitForTimeout(500);
  }
  const move = during.filter(Boolean).map(s => s.wrist && rest?.wrist ? Math.hypot(s.wrist[0] - rest.wrist[0], s.wrist[1] - rest.wrist[1], s.wrist[2] - rest.wrist[2]) : 0);
  const maxMove = Math.max(0, ...move);
  console.log(`diag on B: COMBAT_HIT frames ${await B.evaluate(() => window.__hits)}; scene ${await B.evaluate(() => !!window.__gtasf.world.landmarks?.parent)}; heldWeapon roots ${await B.evaluate(() => { let n = 0; window.__gtasf.world.landmarks?.parent?.traverse(o => { if (o.userData?.heldWeapon) n++; }); return n; })}; A state ${JSON.stringify(await A.evaluate(() => window.__gtasfCombat.state()))}`);
  console.log(`A on B's screen: rest ${JSON.stringify(rest)}; wrist travel during punches max ${maxMove.toFixed(3)} m over ${move.length} samples`);
  console.log(`RESULT ${rest && maxMove > 0.08 ? 'PASS remote punch moves the arm on the other screen' : 'FAIL'}`);
} catch (e) { console.log('FATAL ' + (e?.stack ?? e)); process.exitCode = 1; }
finally { await browser.close(); }
