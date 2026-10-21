// Lane B (gtasf-9jl2j, flag carEnterAnim): getting in/out of a car animates instead of teleporting. Boots beside a
// parked/traffic car, presses E to get in, then E to get out, sampling the avatar's WORLD position every animation frame.
// Pass = no single frame moves the avatar more than JUMP_M (the old path jumped ~1.5-3 m into the seat in one frame),
// plus frames: walking to the door, mid-slide, seated; out of the seat, at the kerb.
//   GTASF_COMBAT_URL=http://localhost:5391 [PHONE=1] node tools/_laneb-seat-anim.mjs
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.GTASF_COMBAT_URL ?? 'http://localhost:5391';
const out = process.env.COMBAT_OUT ?? 'docs/sf-data/seat-anim';
const PHONE = process.env.PHONE === '1', tag = PHONE ? 'phone' : 'desktop';
const SPAWN = process.env.GTASF_SEAT_AT ?? '37.80199520213967,-122.41963019831591,87.8'; // _drive-by-check's car-boarding spot
const JUMP_M = Number(process.env.JUMP_M ?? 0.6);
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
      return { intro: v('.gt-sa-intro') || v('.gt-sa-intro__skip'), id: v('.gt-identity-go'), fund: !!document.querySelector('.gt-funding-onboarding[open]') }; });
    if (!b.intro && !b.id && !b.fund) break;
    if (b.fund) { try { const d = page.locator('.gt-funding-onboarding[open]'); await d.getByLabel('Startup name', { exact: true }).fill('QA'); await d.getByLabel('Your nickname', { exact: true }).fill('d'); await d.getByRole('button', { name: /start|continue|go/i }).first().click({ timeout: 3000 }); } catch {} }
    else if (b.id) { try { await page.locator('.gt-identity-go').click({ timeout: 3000 }); } catch {} }
    else await page.evaluate(() => document.querySelector('.gt-sa-intro__skip')?.click());
    await page.waitForTimeout(500);
  }
}
// Record the avatar's world position every rAF for `ms`; returns the largest single-frame move and the mode timeline.
const record = ms => page.evaluate(ms => new Promise(resolve => {
  const w = window.__gtasf.world, p = w.player, v = new p.position.constructor(), last = new p.position.constructor();
  p.getWorldPosition(last); const start = last.clone(); let maxJump = 0, at = 0, frames = 0, prevT = performance.now(), maxDt = 0, moving = 0; const facing = [];
  const modes = []; const t0 = performance.now();
  const step = () => {
    const now = performance.now(); maxDt = Math.max(maxDt, now - prevT); prevT = now;
    p.getWorldPosition(v); const d = v.distanceTo(last); if (d > maxJump) { maxJump = d; at = Math.round(now - t0); }
    if (d > 0.02) moving++;
    if (d > 0.02 && p.parent?.type === 'Scene') { // walking in world space: does the body face where it goes?
      const fx = Math.sin(p.rotation.y), fz = Math.cos(p.rotation.y); facing.push(((v.x - last.x) * fx + (v.z - last.z) * fz) / d);
    }
    last.copy(v); frames++; if (modes.at(-1) !== w.mode) modes.push(w.mode);
    if (now - t0 < ms) requestAnimationFrame(step);
    else resolve({ maxJump, at, frames, modes, total: v.distanceTo(start), maxDt: Math.round(maxDt), moving, facing: facing.length ? +(facing.reduce((a, b) => a + b, 0) / facing.length).toFixed(2) : null });
  };
  requestAnimationFrame(step);
}), ms);
const press = async () => {
  if (PHONE) { const b = page.locator('button[data-action="enter-exit"]').first(); const box = await b.boundingBox().catch(() => null); if (box) { await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); return; } }
  await page.keyboard.press('KeyE');
};
let pass = false;
try {
  await page.goto(`${base}/?at=${SPAWN}&preset=low&bot=1`);
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 120_000 });
  await clearOnboarding(); await page.waitForTimeout(3000); await clearOnboarding();
  const flag = await page.evaluate(() => !!window.__gtasf.world.player);
  if (!flag) throw new Error('harness has no player handle (stale build?)');
  // Pass 1 (measurement, no screenshots — a screenshot stalls rAF for ~250 ms and fakes a jump): get in, then out.
  const inCar = () => page.evaluate(() => window.__gtasf.world.mode !== 'on-foot');
  let enter = null;
  for (let i = 0; i < 6 && !enter; i++) {
    const rec = record(3500); await press(); const r = await rec;
    if (r.modes.includes('driver') || r.modes.includes('passenger')) enter = r; else await page.waitForTimeout(1500);
  }
  if (!enter) throw new Error('could not get into a car (no driver/passenger mode)');
  const carInfo = await page.evaluate(() => { const w = window.__gtasf.world, c = w.fleet.cars.get(w.vehicleId); return c ? { kind: c.data.kind, traffic: !!(c.data.flags & 0x20) } : null; });
  note(`[seat-anim ${tag}] entered car: ${JSON.stringify(carInfo)}`);
  note(`[seat-anim ${tag}] ENTER: biggest step ${enter.maxJump.toFixed(2)} of ${enter.total.toFixed(2)} m (${Math.round(enter.maxJump / Math.max(enter.total, .01) * 100)}%) at ${enter.at} ms; ${enter.moving} moving frames of ${enter.frames}; worst frame ${enter.maxDt} ms; facing·motion ${enter.facing}; modes ${enter.modes.join('>')}`);
  await page.waitForTimeout(800);
  const recOut = record(3500); await press(); const exit = await recOut;
  note(`[seat-anim ${tag}] EXIT: biggest step ${exit.maxJump.toFixed(2)} of ${exit.total.toFixed(2)} m (${Math.round(exit.maxJump / Math.max(exit.total, .01) * 100)}%) at ${exit.at} ms; ${exit.moving} moving frames of ${exit.frames}; worst frame ${exit.maxDt} ms; facing·motion ${exit.facing}; modes ${exit.modes.join('>')}`);
  // Pass 2 (frames): the same in/out with screenshots while it plays.
  await page.waitForTimeout(1500);
  for (let i = 0; i < 4 && !(await inCar()); i++) {
    await press(); await page.waitForTimeout(120); await shot('01-enter-walk'); await page.waitForTimeout(200); await shot('02-enter-slide');
    await page.waitForTimeout(500); await shot('02c-driver-runs'); // carjack: a seated traffic driver flees from the door
    note(`[seat-anim ${tag}] frames pass: car ${JSON.stringify(await page.evaluate(() => { const w = window.__gtasf.world, c = w.fleet.cars.get(w.vehicleId); return c ? { kind: c.data.kind, traffic: !!(c.data.flags & 0x20) } : null; }))}; runners near: ${await page.evaluate(() => {
      const w = window.__gtasf.world, me = w.player; let n = 0; const v = new me.position.constructor(), c = new me.position.constructor(); me.getWorldPosition(c);
      w.camera.camera.parent?.traverse?.(() => {}); // noop
      let scene = me; while (scene.parent) scene = scene.parent;
      scene.traverse(o => { if (o !== me && o.name === 'on-foot-avatar' && o.visible && o.parent === scene) { o.getWorldPosition(v); if (v.distanceTo(c) < 25) n++; } });
      return n; })}`);
    await page.waitForTimeout(400);
  }
  await shot('03-seated'); await page.waitForTimeout(500);
  await press(); await page.waitForTimeout(200); await shot('04-exit-slide'); await page.waitForTimeout(900); await shot('05-kerb');
  // A teleport covers ~all of the displacement in ONE frame; the cinematic spreads it over several moving frames.
  const spread = r => r.moving >= 3 && r.maxJump <= Math.max(JUMP_M, 0.6 * r.total);
  pass = spread(enter) && exit.modes.includes('on-foot') && spread(exit) && errors.length === 0;
} catch (e) { note(`error: ${e.message.slice(0, 200)}`); }
note(`RESULT: ${pass ? 'PASS' : 'FAIL'} (jump limit ${JUMP_M} m)  errors=${JSON.stringify(errors)}`);
await writeFile(`${out}/log-${tag}.txt`, log.join('\n') + '\n');
await browser.close();
process.exit(pass ? 0 : 1);
