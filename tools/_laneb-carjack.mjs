// Lane B (gtasf-9jl2j, carEnterAnim carjack): get into a TRAFFIC car (one with a seated NPC driver) and check the driver
// is pulled out of the driver's door and runs off, instead of vanishing. Picks the nearest slow traffic car, walks the
// server pose to it (0.5 m / 110 ms passes checkMovement), presses E, then tracks loose avatar roots near the car.
//   GTASF_COMBAT_URL=http://localhost:5393 [PHONE=1] node tools/_laneb-carjack.mjs
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.GTASF_COMBAT_URL ?? 'http://localhost:5393';
const out = process.env.COMBAT_OUT ?? 'docs/sf-data/seat-anim';
const PHONE = process.env.PHONE === '1', tag = PHONE ? 'phone' : 'desktop';
const SPAWN = process.env.GTASF_CARJACK_AT ?? '37.80199520213967,-122.41963019831591,87.8'; // Hyde/Lombard: has local-stack traffic (the local worker only runs the playable road subset)
const log = []; const note = s => { log.push(s); console.log(s); };
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext(PHONE ? { viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true }
  : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
const page = await ctx.newPage(); page.setDefaultTimeout(60_000);
const errors = []; page.on('pageerror', e => errors.push(String(e.message).slice(0, 140)));
const shot = name => page.screenshot({ path: `${out}/${name}-${tag}.jpg`, type: 'jpeg', quality: 85 });
async function clearOnboarding() {
  for (let i = 0; i < 20; i++) {
    const b = await page.evaluate(() => { const v = s => { const e = document.querySelector(s); return !!(e && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })); };
      return { intro: v('.gt-sa-intro') || v('.gt-sa-intro__skip'), id: v('.gt-identity-go') }; });
    if (!b.intro && !b.id) break;
    if (b.id) { try { await page.locator('.gt-identity-go').click({ timeout: 3000 }); } catch {} }
    else await page.evaluate(() => document.querySelector('.gt-sa-intro__skip')?.click());
    await page.waitForTimeout(500);
  }
}
const press = async () => {
  if (PHONE) { const b = page.locator('button[data-action="enter-exit"]').first(); const box = await b.boundingBox().catch(() => null); if (box) { await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); return; } }
  await page.keyboard.press('KeyE');
};
// Loose avatars (not the player, parented to the scene) within 30 m of the player: [distance from the car, ...].
const runners = carId => page.evaluate(carId => {
  const w = window.__gtasf.world, me = w.player, car = w.fleet.cars.get(carId)?.model.root; let scene = me; while (scene.parent) scene = scene.parent;
  const v = new me.position.constructor(), c = new me.position.constructor(); (car ?? me).getWorldPosition(c); const found = [];
  scene.traverse(o => { if (o !== me && o.name === 'on-foot-avatar' && o.visible && o.parent === scene) { o.getWorldPosition(v); const d = v.distanceTo(c); if (d < 30) found.push(+d.toFixed(1)); } });
  return found;
}, carId);
let pass = false;
try {
  await page.goto(`${base}/?at=${SPAWN}&preset=low&bot=1`);
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 120_000 });
  await clearOnboarding(); await page.waitForTimeout(6000); await clearOnboarding();
  let jacked = null;
  // Traffic doesn't stop on the local stack, so stand by the road and press E as a traffic car passes within reach
  // (the server's reach grows with speed: ~4 m parked, ~7.5 m at 10 m/s).
  // Step into a traffic lane: walk to where the nearest traffic car is now; the next car on that lane passes right by.
  const lane = await page.evaluate(() => { const w = window.__gtasf.world, f = w.foot; let best = null;
    for (const c of w.fleet.cars.values()) { if (!(c.data.flags & 0x20) || (c.data.flags & 0x40)) continue;
      const p = c.model.root.position, d = Math.hypot(p.x - f.x, p.z - f.z); if (d < 45 && (!best || d < best.d)) best = { x: p.x, z: p.z, d }; }
    return best; });
  if (lane) await page.evaluate(async ({ x, z }) => { const f = window.__gtasf.world.foot;
    for (let i = 0; i < 120; i++) { const dx = x - f.x, dz = z - f.z, d = Math.hypot(dx, dz); if (d < .5) break; f.x += dx / d * .5; f.z += dz / d * .5; await new Promise(r => setTimeout(r, 110)); } }, lane);
  note(`  stood in a lane ${lane ? lane.d.toFixed(0) + ' m from spawn' : '(no traffic in 45 m)'}`);
  let closest = Infinity;
  const t0 = Date.now();
  while (!jacked && Date.now() - t0 < Number(process.env.WAIT_S ?? 90) * 1000) {
    const near = await page.evaluate(() => { const w = window.__gtasf.world, f = w.foot; let best = null;
      for (const c of w.fleet.cars.values()) { if (!(c.data.flags & 0x20) || (c.data.flags & 0x40) || ['robotaxi', 'bus', 'cable-car'].includes(c.data.kind)) continue;
        const p = c.model.root.position, d = Math.hypot(p.x - f.x, p.z - f.z); if (!best || d < best.d) best = { id: c.data.id, d }; }
      return best; });
    if (near) closest = Math.min(closest, near.d);
    if (!near || near.d > 7) { await page.waitForTimeout(150); continue; }
    await press(); await page.waitForTimeout(150);
    const mode = await page.evaluate(() => ({ mode: window.__gtasf.world.mode, id: window.__gtasf.world.vehicleId }));
    if (mode.mode !== 'driver') continue;
    const traffic = await page.evaluate(id => !!(window.__gtasf.world.fleet.cars.get(id)?.data.flags & 0x20), mode.id);
    const before = await runners(mode.id);
    const tr = []; { for (let k = 0; k < 10; k++) { tr.push(JSON.stringify(await page.evaluate(id => { const w = window.__gtasf.world, me = w.player; let scene = me; while (scene.parent) scene = scene.parent;
        const car = w.fleet.cars.get(id)?.model.root, c = car.position, out = []; scene.traverse(o => { if (o !== me && o.name === 'on-foot-avatar' && o.parent === scene) out.push([+(o.position.x - c.x).toFixed(1), +(o.position.z - c.z).toFixed(1), o.visible ? 'v' : 'h']); }); return out; }, mode.id))); await page.waitForTimeout(200); }
      note(`  trace (avatar xz rel. car, every 200 ms): ${tr.join(' ')}`); }
    // Farthest loose avatar during the first 2 s (sampled BEFORE any screenshot: a screenshot can take seconds on a loaded box).
    const far = Math.max(0, ...tr.flatMap(t => JSON.parse(t).filter(a => a[2] === 'v').map(a => Math.hypot(a[0], a[1]))));
    await page.waitForTimeout(250); await shot('06-carjack-door');
    await page.waitForTimeout(700); await shot('07-carjack-runs'); const after = await runners(mode.id);
    jacked = { car: mode.id, traffic, before, after, far };
    note(`  took car #${mode.id} (traffic ${traffic}) at ${near.d.toFixed(1)} m after ${Math.round((Date.now() - t0) / 1000)} s`);
  }
  if (!jacked) throw new Error(`never got into a traffic car (closest pass ${closest.toFixed(1)} m)`);
  note(`[carjack ${tag}] car #${jacked.car}: loose avatars (m from the car) at 0.15 s ${JSON.stringify(jacked.before)}, at ~1.1 s ${JSON.stringify(jacked.after)}`);
  note(`[carjack ${tag}] farthest runner in the first 2 s: ${jacked.far.toFixed(1)} m from the car`);
  const ran = jacked.far > 6; // the driver ran out along the door normal (a stumble + run covers ~8-10 m in 2 s)
  pass = ran && errors.length === 0;
} catch (e) { note(`error: ${e.message.slice(0, 200)}`); }
note(`RESULT: ${pass ? 'PASS' : 'FAIL'}  errors=${JSON.stringify(errors)}`);
await writeFile(`${out}/carjack-log-${tag}.txt`, log.join('\n') + '\n');
await browser.close();
process.exit(pass ? 0 : 1);
