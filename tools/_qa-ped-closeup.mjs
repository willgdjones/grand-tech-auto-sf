// LANE E: close-up of the nearest pedestrian (VAT crowd / Meshy people face check). Phone by default.
//   AT=lat,lon,h [DESKTOP=1] OUT=dir node tools/_qa-ped-closeup.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const AT = process.env.AT ?? '37.785200,-122.407600,0'; // Powell St at the cable car turntable (busy sidewalks)
const OUT = process.env.OUT ?? 'docs/qa/ped-closeup'; mkdirSync(OUT, { recursive: true });
const desktop = process.env.DESKTOP === '1';
// TIME=22:00 forces the clock (render/timeOverride.ts) so night looks can be checked at any hour.
const STAND = Number(process.env.STAND ?? 3.5), ZOOM = Number(process.env.ZOOM ?? 6); // STAND=9 ZOOM=0: mid-range view
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext(desktop ? { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }
  : { viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => { try { localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'QA', foundedAt: 1, billboardSeen: true, preSeedClosed: true, lastRoundCloseDay: '2020-01-01' })); } catch {} });
const page = await ctx.newPage(); page.setDefaultTimeout(30000);
const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 160)));
await page.goto(`https://gtasf.com/?at=${AT}&bot=1${desktop ? '' : '&preset=low'}${process.env.TIME ? `&time=${process.env.TIME}` : ''}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 150000 });
for (let i = 0; i < 10; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(300); }
await page.waitForSelector('.gt-mission-phone', { state: 'attached', timeout: 120000 }).catch(() => {});
await page.waitForTimeout(20000); // crowds + props mount after the deferred scenery
// Every walker-ish thing near the player: skinned meshes and instanced crowds (VAT) under the street-walker root.
const peds = () => page.evaluate(() => {
  const w = window.__gtasf.world, f = w.foot, root = w.streetWalkers?.root, out = [], m = new (w.camera.camera.matrixWorld.constructor)(), types = {};
  root?.updateMatrixWorld(true);
  root?.traverse(o => { types[o.type] = (types[o.type] ?? 0) + 1;
    if (o.isInstancedMesh) { for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); m.premultiply(o.matrixWorld); const e = m.elements; const l = Math.hypot(e[8], e[10]) || 1; out.push({ x: e[12], y: e[13], z: e[14], fx: e[8] / l, fz: e[10] / l, kind: 'instanced' }); } }
    else if (o.isSkinnedMesh && o.visible) { const e = o.matrixWorld.elements; const l = Math.hypot(e[8], e[10]) || 1; out.push({ x: e[12], y: e[13], z: e[14], fx: e[8] / l, fz: e[10] / l, kind: 'skinned' }); } });
  return { foot: { x: f.x, y: f.y, z: f.z }, types, peds: out.map(p => ({ ...p, d: Math.hypot(p.x - f.x, p.z - f.z) })).filter(p => p.d > 0.5).sort((a, b) => a.d - b.d).slice(0, 5) };
});
const first = await peds(); console.log(JSON.stringify({ types: first.types, nearest: first.peds.map(p => `${p.kind} ${p.d.toFixed(1)}m`) }));
for (let attempt = 0; attempt < 4; attempt++) {
  const { peds: list } = await peds(); const p = list[0]; if (!p) break;
  // Stand ~3.5 m AHEAD of it (along its facing), then look back at it so it walks toward the camera: a face view.
  const goal = { x: p.x + p.fx * STAND, z: p.z + p.fz * STAND };
  for (let i = 0; i < 80; i++) { const d = await page.evaluate(t => { const f = window.__gtasf.world.foot; const dx = t.x - f.x, dz = t.z - f.z, d = Math.hypot(dx, dz); if (d > 0.3) { const k = Math.min(0.6, d) / d; f.x += dx * k; f.z += dz * k; } return d; }, goal); if (d <= 0.4) break; await page.waitForTimeout(110); }
  const { peds: now } = await peds(); const q = now[0];
  // Camera sits behind the player on the far side from the ped: orbit yaw points the view from the player toward q.
  await page.evaluate(t => { const w = window.__gtasf.world, f = w.foot; w.camera.setOrbit(Math.atan2(-(t.x - f.x), -(t.z - f.z)), -0.02); }, q);
  for (let z = 0; z < ZOOM; z++) await page.evaluate(() => window.__gtasf.world.camera.zoom?.(-1));
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/${desktop ? 'desktop' : 'phone'}${STAND > 5 ? '-mid' : ''}-ped-${attempt}-${q.kind}-${q.d.toFixed(1)}m.jpg`, type: 'jpeg', quality: 80 });
  console.log(`shot ${attempt}: nearest ${q.kind} ${q.d.toFixed(1)} m`);
  await page.waitForTimeout(2500);
}
console.log(JSON.stringify({ errs }));
await browser.close();
