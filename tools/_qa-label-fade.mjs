// LANE E (scratch check for gtasf-plaza label fade): inject the plazaInvestor label fade on prod and shoot it at 3/6/12 m.
import { chromium } from '@playwright/test';
const OUT = process.env.OUT; const INJECT = process.env.INJECT !== '0';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage(); page.setDefaultTimeout(30000);
const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 160)));
await page.goto('https://gtasf.com/?bot=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 150000 });
for (let i = 0; i < 10; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(300); }
await page.waitForFunction(() => { const w = window.__gtasf.world; let top = [...w.fleet.cars.values()][0]?.model.root; while (top?.parent) top = top.parent; let hit = false; top?.traverse(o => { if (o.name === 'Founder-ladder plaza investor') hit = true; }); return hit; }, null, { timeout: 60000 }).catch(() => console.log('investor not mounted'));
const info = await page.evaluate(inject => {
  const w = window.__gtasf.world; let top = w.streetWalkers?.root ?? [...w.fleet.cars.values()][0]?.model.root; while (top?.parent) top = top.parent;
  let label = null; top?.traverse(o => { if (o.name === 'Founder-ladder plaza investor') o.traverse(c => { if (c.isSprite) label = c; }); });
  if (!label) return null;
  window.__qaLabel = label; const at = new label.position.constructor(), eye = new label.position.constructor();
  if (inject) label.onBeforeRender = (_r, _s, camera) => { const d = eye.setFromMatrixPosition(camera.matrixWorld).distanceTo(label.getWorldPosition(at)); label.material.opacity = Math.min(1, Math.max(0, (d - 4) / 5)); };
  const p = label.getWorldPosition(at); return { x: p.x, y: p.y, z: p.z, foot: { x: w.foot.x, z: w.foot.z } };
}, INJECT);
console.log('label', JSON.stringify(info));
if (info) for (const dist of [5, 7]) {
  // Stand `dist` m from the investor on the spawn side, camera looking at it (camera ~4 m behind the player).
  const dx = info.foot.x - info.x, dz = info.foot.z - info.z, l = Math.hypot(dx, dz) || 1, goal = { x: info.x + dx / l * dist, z: info.z + dz / l * dist };
  for (let i = 0; i < 120; i++) { const d = await page.evaluate(t => { const f = window.__gtasf.world.foot; const dx = t.x - f.x, dz = t.z - f.z, d = Math.hypot(dx, dz); if (d > 0.3) { const k = Math.min(0.6, d) / d; f.x += dx * k; f.z += dz * k; } return d; }, goal); if (d <= 0.4) break; await page.waitForTimeout(100); }
  await page.evaluate(t => { const w = window.__gtasf.world, f = w.foot; w.camera.setOrbit(Math.atan2(-(t.x - f.x), -(t.z - f.z)), -0.05); }, info);
  for (let z = 0; z < 8; z++) await page.evaluate(() => window.__gtasf.world.camera.zoom?.(-1));
  await page.waitForTimeout(1200);
  const st = await page.evaluate(() => { const l = window.__qaLabel, c = window.__gtasf.world.camera.camera; const p = l.getWorldPosition(l.position.clone()); return { opacity: +l.material.opacity.toFixed(2), camDist: +c.getWorldPosition(p.clone()).distanceTo(p).toFixed(1) }; });
  console.log(`player ${dist} m: ${JSON.stringify(st)}`);
  await page.screenshot({ path: `${OUT}/${INJECT ? 'fade' : 'base'}-${dist}m.jpg`, type: 'jpeg', quality: 75 });
}
console.log(JSON.stringify({ errs })); await browser.close();
