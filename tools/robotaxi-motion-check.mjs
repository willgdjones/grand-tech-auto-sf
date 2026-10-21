// Robotaxi motion check (founder 2026-10-14: "the robo taxi have that weird motion"). Hails a robotaxi to the Lombard
// switchbacks on a LOCAL stack with madMaxRobotaxi on (as in prod), samples every moving robotaxi's RENDERED yaw each
// frame for ~25 s, and reports the yaw wobble (mean |second difference| of yaw, deg/frame²) — the old Mad-Max flair
// adds a ~11.5° 1.7 Hz counter-steer wiggle on top of the road heading. Also the player's boarded cab during the quick
// ride: max shift from where it appeared and its yaw range (QA gtasf-jnl2j: a ~5 m snap + ±3° wobble while it sits). Desktop + phone screenshots during the ride.
//   GTASF_VERIFY_URL=http://localhost:5319 LABEL=after node tools/robotaxi-motion-check.mjs
import { chromium, devices } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const base = process.env.GTASF_VERIFY_URL ?? 'http://localhost:5319';
const label = process.env.LABEL ?? 'after';
const out = process.env.OUT ?? 'docs/sf-data/robotaxi-motion'; mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const result = { base, label, at: new Date().toISOString(), runs: {} };
for (const [tag, opts] of [['desktop', { viewport: { width: 1280, height: 800 } }], ['phone', { ...devices['Pixel 7'] }]]) {
  const page = await (await browser.newContext(opts)).newPage(); page.setDefaultTimeout(60000);
  const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 160)));
  await page.goto(`${base}/?at=37.795799,-122.394805,0&preset=low&bot=1`);
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 120000 });
  for (let i = 0; i < 4; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(600); }
  await page.waitForTimeout(3000);
  await page.evaluate(() => { const b = document.querySelector('[data-action="hail"]') ?? document.querySelector('#hail'); if (b) b.click(); });
  if (!(await page.locator('.gt-taxi-picker').isVisible().catch(() => false))) await page.keyboard.press('KeyH');
  await page.locator('.gt-taxi-picker button', { hasText: 'Lombard switchbacks' }).first().click();
  // Sample all moving robotaxis' rendered yaw per animation frame.
  await page.evaluate(() => {
    window.__taxiSamples = new Map();
    const tick = () => {
      for (const [id, car] of window.__gtasf.world.fleet.cars) {
        if (car.data?.kind !== 'robotaxi' || !car.model.root.visible) continue;
        const r = car.model.root; let list = window.__taxiSamples.get(id); if (!list) window.__taxiSamples.set(id, list = []);
        list.push([performance.now(), r.position.x, r.position.z, r.rotation.y, r.rotation.z]);
      }
      // The player's own boarded cab during the quick ride (QA gtasf-jnl2j: snap + wobble while it sits under the jump).
      const w = window.__gtasf.world, own = w.vehicleId != null ? w.fleet.cars.get(w.vehicleId) : undefined;
      if (own && w.mode === 'passenger') (window.__ownCab ??= []).push([own.model.root.position.x, own.model.root.position.z, own.model.root.rotation.y]);
      if (window.__taxiSampling) requestAnimationFrame(tick);
    };
    window.__taxiSampling = true; requestAnimationFrame(tick);
  });
  for (let s = 0; s < 25; s++) { await page.waitForTimeout(1000); if (s === 6 || s === 14) await page.screenshot({ path: `${out}/${label}-${tag}-${s}s.jpg`, type: 'jpeg', quality: 75 }); }
  const stats = await page.evaluate(() => {
    window.__taxiSampling = false;
    const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
    let n = 0, wobble = 0, roll = 0, moving = 0;
    for (const list of window.__taxiSamples.values()) for (let i = 2; i < list.length; i++) {
      const [, x0, z0, y0] = list[i - 2], [, x1, z1, y1] = list[i - 1], [, x2, z2, y2, r2] = list[i];
      if (Math.hypot(x2 - x1, z2 - z1) < 0.05) continue; // moving frames only (> ~3 m/s at 60 fps)
      moving++;
      wobble += Math.abs(wrap(wrap(y2 - y1) - wrap(y1 - y0))) * 180 / Math.PI; roll += Math.abs(r2) * 180 / Math.PI; n++;
    }
    const own = window.__ownCab ?? [];
    const o0 = own[0], ownStats = o0 ? { frames: own.length,
      maxShiftM: +Math.max(...own.map(p => Math.hypot(p[0] - o0[0], p[1] - o0[1]))).toFixed(2),
      yawRangeDeg: +((Math.max(...own.map(p => p[2])) - Math.min(...own.map(p => p[2]))) * 180 / Math.PI).toFixed(2) } : null;
    return { boardedCab: ownStats, taxis: window.__taxiSamples.size, movingFrames: moving, yawJerkDeg: n ? +(wobble / n).toFixed(3) : null, meanRollDeg: n ? +(roll / n).toFixed(2) : null,
      taxiState: document.querySelector('#world')?.dataset.taxiState };
  });
  result.runs[tag] = { ...stats, errs };
  await page.context().close();
}
console.log(JSON.stringify(result, null, 2));
await browser.close();
