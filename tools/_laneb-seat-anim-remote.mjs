// Lane B (gtasf-9jl2j, carEnterAnim for OTHER players): two browsers at the same kerb. B gets into a car and out again; A
// records B's avatar world position every animation frame. Pass = the move is spread over several frames (no one-frame
// jump into/out of the seat), the same spread rule as tools/_laneb-seat-anim.mjs; plus a frame from A mid-entry.
//   GTASF_COMBAT_URL=http://localhost:5393 node tools/_laneb-seat-anim-remote.mjs
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.GTASF_COMBAT_URL ?? 'http://localhost:5393';
const out = process.env.COMBAT_OUT ?? 'docs/sf-data/seat-anim';
const SPAWN = process.env.GTASF_SEAT_AT ?? '37.80199520213967,-122.41963019831591,87.8';
const JUMP_M = Number(process.env.JUMP_M ?? 0.6);
const log = []; const note = s => { log.push(s); console.log(s); };
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const open = async () => { const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 }); const page = await ctx.newPage(); page.setDefaultTimeout(60_000); return page; };
const A = await open(), B = await open();
const errors = []; for (const [n, p] of [['A', A], ['B', B]]) p.on('pageerror', e => errors.push(`${n}: ${String(e.message).slice(0, 120)}`));
async function boot(page) {
  await page.goto(`${base}/?at=${SPAWN}&preset=low&bot=1`);
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 120_000 });
  for (let i = 0; i < 20; i++) {
    const on = await page.evaluate(() => { const v = s => { const e = document.querySelector(s); return !!(e && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })); };
      if (v('.gt-identity-go')) { document.querySelector('.gt-identity-go').click(); return true; }
      if (v('.gt-sa-intro') || v('.gt-sa-intro__skip')) { document.querySelector('.gt-sa-intro__skip')?.click(); return true; } return false; });
    if (!on) break; await page.waitForTimeout(500);
  }
}
// A: record the (single) remote avatar's world position each rAF for `ms`.
const record = ms => A.evaluate(ms => new Promise(resolve => {
  const w = window.__gtasf.world, root = () => [...w.remoteAvatars.values()][0]?.root;
  const r0 = root(); if (!r0) { resolve(null); return; }
  const v = new r0.position.constructor(), last = new r0.position.constructor(); r0.getWorldPosition(last); const start = last.clone();
  let maxJump = 0, frames = 0, moving = 0; const t0 = performance.now();
  const step = () => { const r = root(); if (r) { r.getWorldPosition(v); const d = v.distanceTo(last); maxJump = Math.max(maxJump, d); if (d > .02) moving++; last.copy(v); }
    frames++; if (performance.now() - t0 < ms) requestAnimationFrame(step); else resolve({ maxJump, frames, moving, total: v.distanceTo(start) }); };
  requestAnimationFrame(step);
}), ms);
const spread = r => r && r.moving >= 3 && r.maxJump <= Math.max(JUMP_M, 0.6 * r.total);
const fmt = r => r ? `biggest step ${r.maxJump.toFixed(2)} of ${r.total.toFixed(2)} m (${Math.round(r.maxJump / Math.max(r.total, .01) * 100)}%), ${r.moving} moving frames of ${r.frames}` : 'no remote avatar';
let pass = false;
try {
  await boot(A); await boot(B);
  await A.waitForFunction(() => window.__gtasf.world.remoteAvatars.size > 0, null, { timeout: 30_000 });
  await A.waitForTimeout(3000);
  let enter = null;
  for (let i = 0; i < 6 && !enter; i++) {
    const rec = record(3500); await B.keyboard.press('KeyE'); await A.waitForTimeout(250); await A.screenshot({ path: `${out}/08-remote-enter-desktop.jpg`, type: 'jpeg', quality: 85 });
    const r = await rec; if ((await B.evaluate(() => window.__gtasf.world.mode)) !== 'on-foot') enter = r; else await B.waitForTimeout(1500);
  }
  if (!enter) throw new Error('B could not get into a car');
  note(`[seat-anim-remote] B ENTER as seen by A: ${fmt(enter)}`);
  await B.waitForTimeout(1200);
  const recOut = record(3500); await B.keyboard.press('KeyE'); const exit = await recOut;
  note(`[seat-anim-remote] B EXIT as seen by A: ${fmt(exit)}; B mode now ${await B.evaluate(() => window.__gtasf.world.mode)}`);
  pass = spread(enter) && spread(exit) && errors.length === 0;
} catch (e) { note(`error: ${e.message.slice(0, 200)}`); }
note(`RESULT: ${pass ? 'PASS' : 'FAIL'}  errors=${JSON.stringify(errors)}`);
await writeFile(`${out}/remote-log-desktop.txt`, log.join('\n') + '\n');
await browser.close();
process.exit(pass ? 0 : 1);
