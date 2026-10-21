// Lane B: in-game check for SFPD officers on foot (flag sfpdOnFoot) on a flags-ON stack. Shooter A stands where a
// building blocks the cruisers' direct line (bay side of the Ferry Building, then fallbacks) and fires on an adjacent
// opted-in victim until 2+ stars. Cruisers stall on the road and deploy officers (S2C OFFICERS) who are rendered with
// lane A's officer avatars. Passes when officers render on A's client; frames one for a screenshot.
//   GTASF_COMBAT_URL=http://localhost:5374 [PHONE=1] node tools/_sfpd-on-foot-check.mjs
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.GTASF_COMBAT_URL ?? 'http://localhost:5374';
const out = process.env.COMBAT_OUT ?? 'docs/sf-data/combat';
const PHONE = process.env.PHONE === '1', tag = PHONE ? 'phone' : 'desktop';
const SPOTS = (process.env.GTASF_FOOT_SPOTS ?? '37.795620,-122.392650;37.797420,-122.394120;37.795000,-122.393300').split(';');
const log = []; const note = s => { log.push(s); console.log(s); };
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const errors = [];
const DESK = { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 };
const PHONEV = { viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true };
async function open(label, at, view) {
  const ctx = await browser.newContext(view);
  await ctx.addInitScript(() => { const s = WebSocket.prototype.send; WebSocket.prototype.send = function (d) {
    try { const b = d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, 1) : null; if (b && b[0] === 2) window.__ws = this; } catch {}
    return s.call(this, d); }; });
  const p = await ctx.newPage(); p.setDefaultTimeout(60000); p.on('pageerror', e => errors.push(`${label}: ${e.message.slice(0, 120)}`));
  await p.goto(`${base}/?at=${at}&preset=low&bot=1`);
  await p.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', { timeout: 90000 });
  for (let i = 0; i < 15; i++) { await p.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await p.waitForTimeout(250); }
  try { const d = p.locator('.gt-funding-onboarding[open]'); if (await d.isVisible({ timeout: 800 })) { await d.getByLabel('Startup name', { exact: true }).fill('QA'); await d.getByLabel('Your nickname', { exact: true }).fill(label); await d.getByRole('button', { name: 'Save startup' }).click(); } } catch {}
  await p.evaluate(() => window.__gtasfCombat?.requestCombat?.());
  try { const b = p.locator('.gt-age-gate-enter'); await b.waitFor({ state: 'visible', timeout: 8000 }); await b.click(); } catch {}
  await p.waitForTimeout(800);
  return { p, ctx };
}
const stars = p => p.evaluate(() => document.querySelectorAll('.gt-combat-wanted-star.lit').length);
const officers = p => p.evaluate(() => { const o = window.__gtasf.world.policeOfficers; if (!o) return { count: -1 };
  const f = window.__gtasf.world.foot; let best = null;
  window.__gtasf.world.camera.camera.parent?.traverse?.(() => {});
  return { count: o.count, foot: { x: f.x, z: f.z } }; });
const nearestCruiser = p => p.evaluate(() => { const w = window.__gtasf.world, f = w.foot; let d = Infinity;
  for (const c of w.fleet?.cars?.values?.() ?? []) if (c.data.flags & 0x40) { const q = c.model.root.position; d = Math.min(d, Math.hypot(q.x - f.x, q.z - f.z)); } return d; });
let pass = false;
try {
  for (const at of SPOTS) {
    const [lat, lon] = at.split(',');
    const A = await open('A', `${at},0`, PHONE ? PHONEV : DESK), B = await open('B', `${(Number(lat) + 0.00002).toFixed(6)},${lon},180`, DESK);
    await A.p.evaluate(() => { window.__gtasfCombat.giveWeapon('smg'); window.__gtasfCombat.selectWeapon('smg'); });
    const fire = () => B.p.evaluate(() => ({ ...window.__gtasf.world.foot })).then(v => A.p.evaluate(v => {
      const f = window.__gtasf.world.foot, dir = [v.x - f.x, v.y - f.y, v.z - f.z];
      const buf = new ArrayBuffer(26), dv = new DataView(buf); dv.setUint8(0, 0x23); dv.setUint8(1, 3); dir.forEach((d, k) => dv.setFloat64(2 + k * 8, d, true)); window.__ws.send(buf); }, v));
    for (let i = 0; i < 30 && (await stars(A.p)) < 2; i++) { await fire(); await A.p.waitForTimeout(300); }
    note(`[on-foot] spot ${at}: A ${await stars(A.p)} star(s)`);
    let seen = 0;
    for (let i = 0; i < 45 && seen === 0; i++) {
      const o = await officers(A.p); seen = o.count;
      if (i % 5 === 0 || i < 5) note(`  t=${i}s officers ${o.count}, nearest cruiser ${(await nearestCruiser(A.p)).toFixed(1)} m, stars ${await stars(A.p)}, A ${JSON.stringify(await A.p.evaluate(() => { const s = window.__gtasfCombat.state(); return { hp: s.health, dead: s.dead }; }))}`);
      if (!seen) await A.p.waitForTimeout(1000);
    }
    if (seen > 0) {
      await A.p.waitForTimeout(4000); // let them run in
      // Face the camera toward the officers (they come from the cruiser side) and shoot the frame.
      await A.p.evaluate(async () => { const w = window.__gtasf.world, f = w.foot, cam = w.camera; let tx = null;
        w.camera.camera.parent; // scene
        const root = (() => { let s = w.landmarks; while (s?.parent) s = s.parent; return s; })();
        root?.traverse(o => { if (!tx && o.name === 'SFPD officer' && o.visible) tx = o.position.clone(); });
        if (!tx) return; const dx = tx.x - f.x, dz = tx.z - f.z;
        let top = { s: -2, y: 0 }; for (const y of [Math.atan2(dx, dz), Math.atan2(dx, dz) + Math.PI, -Math.atan2(dx, dz), Math.PI - Math.atan2(dx, dz)]) {
          cam.setOrbit(y, cam.pitch); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          const v = cam.camera.getWorldDirection(new cam.camera.position.constructor()); const s = (v.x * dx + v.z * dz) / (Math.hypot(v.x, v.z) * Math.hypot(dx, dz)); if (s > top.s) top = { s, y }; }
        cam.setOrbit(top.y + Math.PI, cam.pitch); /* camera behind the player, looking toward the officer */ await new Promise(r => setTimeout(r, 300)); });
      await A.p.screenshot({ path: `${out}/sfpd-on-foot-${tag}.jpg`, type: 'jpeg', quality: 85 });
      note(`  officers rendered: ${(await officers(A.p)).count}`);
      pass = true;
    }
    await A.ctx.close(); await B.ctx.close();
    if (pass) break;
  }
} catch (e) { note(`ABORTED: ${String(e.message).split('\n')[0]}`); }
finally {
  note(`RESULT: ${pass ? 'PASS' : 'FAIL'}  errors=${JSON.stringify(errors.slice(0, 6))}`);
  await writeFile(`${out}/sfpd-on-foot-log-${tag}.txt`, log.join('\n') + '\n');
  await browser.close();
}
