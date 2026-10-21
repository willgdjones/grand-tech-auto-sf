// Lane B perf probe: which scene groups draw on a phone during a firefight? Counts visible meshes inside the camera frustum
// (~ one draw call each; multi-material meshes count per group) grouped by their top-level ancestor under the scene, plus
// real WebGL draw calls per frame (drawElements/drawArrays hooked). Idle at the Ferry first, then with SFPD present
// (3 stars confessed on the world socket after the 18+ gate).
//   GTASF_COMBAT_URL=http://localhost:5393 node tools/_laneb-drawcall-groups.mjs
import { chromium } from '@playwright/test';

const base = process.env.GTASF_COMBAT_URL ?? 'http://localhost:5393';
const FERRY = process.env.AT ?? '37.7955,-122.3937,0';
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true });
await ctx.addInitScript(() => {
  window.__draws = 0;
  for (const C of [WebGL2RenderingContext, WebGLRenderingContext]) for (const f of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) {
    const orig = C.prototype[f]; if (!orig) continue; C.prototype[f] = function (...a) { window.__draws++; return orig.apply(this, a); };
  }
  const Native = window.WebSocket;
  window.WebSocket = class extends Native { constructor(...a) { super(...a); if (String(a[0]).includes('/api/world')) window.__worldSocket = this; } };
});
const page = await ctx.newPage(); page.setDefaultTimeout(60_000);
const errors = []; page.on('pageerror', e => errors.push(String(e.message).slice(0, 140)));
const measure = label => page.evaluate(async label => {
  // Real draw calls per frame over ~3 s.
  const d0 = window.__draws; let frames = 0; const t0 = performance.now();
  await new Promise(r => { const f = () => { frames++; if (performance.now() - t0 < 3000) requestAnimationFrame(f); else r(); }; requestAnimationFrame(f); });
  const perFrame = (window.__draws - d0) / frames;
  // Visible in-frustum meshes per top-level group.
  const w = window.__gtasf.world, cam = w.camera.camera; let scene = w.landmarks; while (scene.parent) scene = scene.parent;
  cam.updateMatrixWorld(); const F = new (cam.projectionMatrix.constructor === Object ? Object : Object)();
  const THREE_Frustum = w.landmarks.constructor; // placeholder to keep the bundle's classes; frustum built below
  const m = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse);
  const e = m.elements, planes = [[e[3] - e[0], e[7] - e[4], e[11] - e[8], e[15] - e[12]], [e[3] + e[0], e[7] + e[4], e[11] + e[8], e[15] + e[12]], [e[3] + e[1], e[7] + e[5], e[11] + e[9], e[15] + e[13]], [e[3] - e[1], e[7] - e[5], e[11] - e[9], e[15] - e[13]], [e[3] - e[2], e[7] - e[6], e[11] - e[10], e[15] - e[14]], [e[3] + e[2], e[7] + e[6], e[11] + e[10], e[15] + e[14]]].map(p => { const l = Math.hypot(p[0], p[1], p[2]); return p.map(x => x / l); });
  const groups = new Map(); const c = cam.position.clone();
  const visible = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  scene.traverse(o => {
    if (!o.isMesh && !o.isInstancedMesh && !o.isPoints && !o.isLine) return; if (!visible(o)) return;
    let inside = true;
    if (o.frustumCulled !== false && o.geometry) {
      if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
      const s = o.geometry.boundingSphere; if (s) { c.copy(s.center).applyMatrix4(o.matrixWorld); const r = s.radius * o.matrixWorld.getMaxScaleOnAxis();
        for (const p of planes) if (p[0] * c.x + p[1] * c.y + p[2] * c.z + p[3] < -r) { inside = false; break; } }
    }
    if (!inside) return;
    let top = o; while (top.parent && top.parent !== scene) top = top.parent;
    const key = top.name || top.type, mats = Array.isArray(o.material) ? o.material.length : 1;
    groups.set(key, (groups.get(key) ?? 0) + mats);
  });
  const total = [...groups.values()].reduce((a, b) => a + b, 0);
  return { label, perFrame: +perFrame.toFixed(0), meshDraws: total, top: [...groups].sort((a, b) => b[1] - a[1]).slice(0, 14) };
}, label);
const print = r => { console.log(`== ${r.label}: ${r.perFrame} WebGL draws/frame; ${r.meshDraws} in-frustum mesh draws`); for (const [k, n] of r.top) console.log(`   ${String(n).padStart(4)}  ${k}`); };
await page.goto(`${base}/?at=${FERRY}&preset=low&bot=1&time=${process.env.TIME ?? 'noon'}`);
await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 120_000 });
for (let i = 0; i < 10; i++) { const on = await page.evaluate(() => { const b = document.querySelector('.gt-sa-intro__skip') ?? document.querySelector('.gt-identity-go'); if (b && b.checkVisibility()) { b.click(); return true; } return false; }); if (!on) break; await page.waitForTimeout(500); }
await page.waitForTimeout(45000); // deferred scenery + street props mount
print(await measure('idle (Ferry, phone Low, noon)'));
if (process.env.FILL) { // phone fill proxy: per group, transparent in-frustum meshes' projected bounding-sphere area (clipped) / screen
  const r = await page.evaluate(() => {
    const w = window.__gtasf.world, cam = w.camera.camera; let scene = w.landmarks; while (scene.parent) scene = scene.parent; cam.updateMatrixWorld();
    const visible = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
    const c = cam.position.clone(), q = cam.position.clone(), fill = new Map(), tanHalf = Math.tan(cam.fov * Math.PI / 360);
    scene.traverse(o => { if (!(o.isMesh || o.isPoints || o.isSprite) || !visible(o)) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material]; if (!mats.some(m => m?.transparent)) return;
      if (!o.geometry?.boundingSphere) o.geometry?.computeBoundingSphere(); const s = o.geometry?.boundingSphere; if (!s) return;
      const n = o.isInstancedMesh ? o.count : 1; if (!n) return;
      c.copy(s.center).applyMatrix4(o.matrixWorld); const r = s.radius * o.matrixWorld.getMaxScaleOnAxis();
      q.copy(c).applyMatrix4(cam.matrixWorldInverse); const depth = -q.z;
      let area;
      if (depth <= r) area = 1; // camera inside or touching the sphere: full screen
      else { q.project(cam); if (Math.abs(q.x) > 1 + 2 * r / (depth * tanHalf) || Math.abs(q.y) > 1 + 2 * r / (depth * tanHalf)) return;
        const rad = r / (depth * tanHalf); // NDC radius (vertical)
        const x0 = Math.max(-1, q.x - rad / cam.aspect), x1 = Math.min(1, q.x + rad / cam.aspect), y0 = Math.max(-1, q.y - rad), y1 = Math.min(1, q.y + rad);
        area = Math.max(0, x1 - x0) * Math.max(0, y1 - y0) / 4 * (Math.PI / 4); }
      if (o.isInstancedMesh && area < 1) area = Math.min(1, area); // instanced spheres bound all instances; count once
      let top = o; while (top.parent && top.parent !== scene) top = top.parent; const key = top.name || top.type;
      fill.set(key, (fill.get(key) ?? 0) + area * mats.filter(m => m?.transparent).length); });
    return [...fill].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => [k, +v.toFixed(2)]);
  });
  console.log(`== transparent fill (screens of blended pixels, upper bound):`); for (const [k, v] of r) console.log(`   ${String(v).padStart(6)}  ${k}`);
}
if (process.env.WASTE) { // drawn but can't contribute: transparent at opacity < 0.01, or scaled to ~0 — per group
  const r = await page.evaluate(() => {
    const w = window.__gtasf.world; let scene = w.landmarks; while (scene.parent) scene = scene.parent;
    const visible = o => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
    const waste = new Map(); const sc = new w.landmarks.scale.constructor();
    scene.traverse(o => { if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite) || !visible(o)) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const clear = mats.every(m => m && m.transparent && (m.opacity ?? 1) < 0.01);
      o.getWorldScale(sc); const flat = Math.abs(sc.x * sc.y * sc.z) < 1e-6;
      const empty = o.isInstancedMesh && o.count === 0;
      if (!clear && !flat && !empty) return;
      let top = o; while (top.parent && top.parent !== scene) top = top.parent;
      const key = `${top.name || top.type} > ${o.name || o.type} (${clear ? 'opacity~0' : flat ? 'zero-scale' : 'empty-instanced'})`;
      waste.set(key, (waste.get(key) ?? 0) + mats.length); });
    return [...waste].sort((a, b) => b[1] - a[1]).slice(0, 20);
  });
  console.log(`== wasted draws (${r.reduce((a, [, n]) => a + n, 0)}):`); for (const [k, n] of r) console.log(`   ${String(n).padStart(4)}  ${k}`);
}
if (process.env.FOGSAMPLE) {
  const r = await page.evaluate(async () => { let scene = window.__gtasf.world.landmarks; while (scene.parent) scene = scene.parent;
    const g = scene.children.find(c => c.name === 'GTASF Karl fog bank'); const out = [];
    for (let i = 0; i < 5; i++) { let mx = 0, sum = 0; g.traverse(o => { if (o.isMesh) { mx = Math.max(mx, o.material.opacity); sum += o.material.opacity; } }); out.push({ visible: g.visible, maxOpacity: +mx.toFixed(4), meanOpacity: +(sum / 38).toFixed(4) }); await new Promise(r => setTimeout(r, 1000)); }
    return out; });
  console.log(`== fog sample: ${JSON.stringify(r)}`);
}
if (process.env.OVERDRAW) { // GPU fill proxy: sum of a group's quads' projected, screen-clipped areas / screen area (= layers blended per pixel)
  const r = await page.evaluate(name => {
    const w = window.__gtasf.world, cam = w.camera.camera; let scene = w.landmarks; while (scene.parent) scene = scene.parent;
    const group = scene.children.find(c => c.name === name); if (!group || !group.visible) return { error: 'group hidden/missing' };
    cam.updateMatrixWorld(); let area = 0, quads = 0, maxOpacity = 0; const v = cam.position.clone();
    group.traverse(o => { if (!o.isMesh || !o.visible) return; quads++; maxOpacity = Math.max(maxOpacity, o.material.opacity ?? 1);
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox; const pts = [];
      for (const [x, y] of [[b.min.x, b.min.y], [b.max.x, b.min.y], [b.max.x, b.max.y], [b.min.x, b.max.y]]) { v.set(x, y, 0).applyMatrix4(o.matrixWorld).project(cam); pts.push(v.z < 1 ? [v.x, v.y] : null); }
      if (pts.some(p => !p)) { area += 1; return; } // straddles the camera plane: count as full screen
      const xs = pts.map(p => Math.max(-1, Math.min(1, p[0]))), ys = pts.map(p => Math.max(-1, Math.min(1, p[1])));
      area += (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys)) / 4; });
    return { quads, overdrawLayers: +area.toFixed(1), maxOpacity: +maxOpacity.toFixed(2) };
  }, process.env.OVERDRAW);
  console.log(`== overdraw '${process.env.OVERDRAW}': ${JSON.stringify(r)}`);
  if (process.env.TOGGLE_ONLY) { await browser.close(); process.exit(0); }
}
if (process.env.TOGGLE) { // interleaved in-page A/B: frame time with the named top-level group shown vs hidden, 3 s windows x 6 each
  const r = await page.evaluate(async name => {
    let scene = window.__gtasf.world.landmarks; while (scene.parent) scene = scene.parent;
    const group = scene.children.find(c => c.name === name); if (!group) return { error: 'no group ' + name };
    const win = async () => { const t = []; let last; const t0 = performance.now();
      await new Promise(r => { const f = now => { if (last !== undefined) t.push(now - last); last = now; if (now - t0 < 3000) requestAnimationFrame(f); else r(); }; requestAnimationFrame(f); }); return t; };
    const on = [], off = [], forced = group.onBeforeRender;
    for (let i = 0; i < 6; i++) { group.visible = true; on.push(...(await win()).slice(2)); group.layers.disableAll(); off.push(...(await win()).slice(2)); group.layers.enableAll(); }
    const stat = a => { const s = [...a].sort((x, y) => x - y); return { fps: +(1000 / (a.reduce((x, y) => x + y, 0) / a.length)).toFixed(1), p95: +s[Math.floor(s.length * .95)].toFixed(1), n: a.length }; };
    return { shown: stat(on), hidden: stat(off), visibleFlag: group.visible };
  }, process.env.TOGGLE);
  console.log(`== toggle '${process.env.TOGGLE}': ${JSON.stringify(r)}`);
  if (process.env.TOGGLE_ONLY) { await browser.close(); process.exit(0); }
}
await page.evaluate(() => window.__gtasfCombat?.requestCombat?.());
try { const b = page.locator('.gt-age-gate-enter'); await b.waitFor({ state: 'visible', timeout: 6000 }); await b.click(); } catch {}
await page.touchscreen.tap(200, 500); await page.waitForTimeout(1000);
for (let i = 0; i < 3; i++) { await page.evaluate(() => window.__worldSocket?.send(Uint8Array.of(0x25, 0))); await page.waitForTimeout(800); }
await page.waitForTimeout(40000);
const stars = await page.evaluate(() => document.querySelectorAll('.gt-combat-wanted-star.lit').length);
print(await measure(`SFPD present (${stars} stars)`));
console.log(`errors=${JSON.stringify(errors)}`);
await browser.close();
