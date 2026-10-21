// LANE E (gtasf-avas visual close): find real 'Building fire-escape' instances near a walk-up district on prod HD, then
// deep-link to a spot in front of the nearest stack and shoot it straight-on and oblique.
//   OUT=docs/qa/<day>/fire-escape [AT=lat,lon] node tools/_qa-fire-escape-look.mjs
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const OUT = process.env.OUT ?? 'docs/qa/fire-escape'; mkdirSync(OUT, { recursive: true });
// APP_DIR=<built app> (lane D): serve a local build instead of prod (local pool + vite preview, /api proxied to the pool).
let BASE = process.env.GTASF_QA_URL ?? 'https://gtasf.com', server, pool;
if (process.env.APP_DIR) {
  const { preview } = await import('vite'), { resolve } = await import('node:path'), { startLocalPool } = await import('./local-pool/pool.mjs');
  pool = await startLocalPool();
  server = await preview({ root: resolve('web'), configFile: resolve('web/vite.config.ts'), build: { outDir: resolve(process.env.APP_DIR) },
    preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: pool.url.origin, ws: true } } } });
  BASE = server.resolvedUrls.local[0].replace(/\/$/, '');
}
const AT = (process.env.AT ?? '37.7838,-122.4140').split(',').map(Number);
const O = { lat: 37.7842, lon: -122.4078 }; // SF_FRAME origin (+x east, -z north), small-area tangent approximation
const toLL = (x, z) => ({ lat: O.lat - z / 111320, lon: O.lon + x / (111320 * Math.cos(O.lat * Math.PI / 180)) });
const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => { try { localStorage.setItem('gtasf.founder.v1', JSON.stringify({ founded: true, startupName: 'QA Founder', foundedAt: 1, billboardSeen: true, preSeedClosed: true, lastRoundCloseDay: '2020-01-01' })); } catch {} });
const page = await ctx.newPage(); page.setDefaultTimeout(30000);
const errs = []; page.on('pageerror', e => errs.push(e.message.slice(0, 160)));
async function boot(lat, lon, h) {
  await page.goto(`${BASE}/?at=${lat.toFixed(6)},${lon.toFixed(6)}${h != null ? ',' + Math.round(h) : ''}&bot=1&gfx=hd`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__gtasf?.ready && document.querySelector('#world')?.dataset.connected === 'true', null, { timeout: 150000 })
    .catch(async e => { await page.screenshot({ path: `${OUT}/boot-timeout.jpg`, type: 'jpeg', quality: 60 }).catch(() => {});
      console.log('boot timeout state', JSON.stringify(await page.evaluate(() => ({ ready: !!window.__gtasf?.ready, conn: document.querySelector('#world')?.dataset.connected,
        loading: document.querySelector('#loading')?.textContent?.trim().slice(0, 160), open: [...document.querySelectorAll('dialog[open]')].map(d => d.className) })).catch(() => null))); throw e; });
  for (let i = 0; i < 10; i++) { await page.evaluate(() => { document.querySelector('.gt-sa-intro__skip')?.click(); document.querySelector('.gt-identity-go')?.click(); }); await page.waitForTimeout(300); }
  await page.waitForTimeout(20000); // building detail + Meshy pieces mount after READY
}
const R = { at: AT, errs };
await boot(AT[0], AT[1]);
const found = await page.evaluate(() => {
  const w = window.__gtasf.world, f = w.foot; let top = w.camera.camera; while (top.parent) top = top.parent;
  const scenes = new Set([top]); for (const c of w.fleet?.cars?.values?.() ?? []) { let t = c.model.root; while (t.parent) t = t.parent; scenes.add(t); }
  const out = []; const M = new (w.camera.camera.matrixWorld.constructor)();
  const meshes = [];
  for (const s of scenes) s.traverse(o => { if (o.isInstancedMesh && o.name === 'Building fire-escape') { let vis = true; for (let q = o; q; q = q.parent) if (!q.visible) vis = false;
    const mats = Array.isArray(o.material) ? o.material : [o.material]; meshes.push({ count: o.count, vis, layers: o.layers.mask, parent: o.parent?.name, frustumCulled: o.frustumCulled, matVisible: mats.map(m => m.visible), opacity: mats.map(m => m.opacity), side: mats.map(m => m.side) }); } });
  window.__feMeshes = meshes;
  for (const s of scenes) s.traverse(o => { if (o.isInstancedMesh && o.name === 'Building fire-escape') {
    for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, M); M.premultiply(o.matrixWorld); const e = M.elements;
      out.push({ x: e[12], y: e[13], z: e[14], fx: e[0], fz: e[2], d: Math.hypot(e[12] - f.x, e[14] - f.z) }); } } });
  return { meshes: window.__feMeshes, foot: { x: f.x, z: f.z }, count: out.length, near: out.sort((a, b) => a.d - b.d).slice(0, 40) };
});
R.pieces = await page.evaluate(() => { const w = window.__gtasf.world; let top = w.camera.camera; while (top.parent) top = top.parent; const k = {};
  top.traverse(o => { if (/^Building /.test(o.name)) k[o.name] = (k[o.name] ?? 0) + (o.isInstancedMesh ? o.count : 1); }); return k; });
console.log('PIECES ' + JSON.stringify(R.pieces));
R.meshes = found.meshes; console.log('MESHES ' + JSON.stringify(found.meshes));
R.count = found.count; console.log(`fire-escape instances: ${found.count}, nearest ${found.near[0]?.d?.toFixed(0)} m`);
await page.screenshot({ path: `${OUT}/00-spawn.jpg`, type: 'jpeg', quality: 72 });
if (found.near.length) {
  // Group by wall (instances within 3 m in x/z = one stack); pick the stack with the most floors.
  const stacks = []; for (const p of found.near) { const s = stacks.find(s => Math.hypot(s.x - p.x, s.z - p.z) < 3); if (s) s.n++; else stacks.push({ ...p, n: 1 }); }
  stacks.sort((a, b) => b.n - a.n || a.d - b.d); const s = stacks[0]; R.stack = s; R.stacks = stacks.slice(0, 6);
  console.log(`stack: ${s.n} floors at (${s.x.toFixed(1)}, ${s.z.toFixed(1)}), ${s.d.toFixed(0)} m away`);
  // The instance X axis (after the native PI/2 yaw) runs along the wall's normal; stand 14 m out on whichever side is open.
  const len = Math.hypot(s.fx, s.fz) || 1; const nx = s.fx / len, nz = s.fz / len;
  for (const [tag, sign, side] of [['front', 1, 0], ['front-flip', -1, 0], ['oblique', 1, 8]]) {
    const px = s.x + nx * 14 * sign + nz * side, pz = s.z + nz * 14 * sign - nx * side; const ll = toLL(px, pz);
    const heading = (Math.atan2(s.x - px, -(s.z - pz)) * 180 / Math.PI + 360) % 360; // compass: 0 = north
    await boot(ll.lat, ll.lon, heading);
    // Aim a fixed street-level camera at the stack's mid-height: the chase camera looks down at the player and crops the
    // wall above the first floor, where the stack climbs. (lane D)
    await page.evaluate(t => { const w = window.__gtasf.world, f = w.foot; let scene = w.streetWalkers?.root ?? w.camera.camera; while (scene.parent) scene = scene.parent;
      const midY = t.y + 1.6 * t.n, dx = f.x - t.x, dz = f.z - t.z, d = Math.hypot(dx, dz) || 1, back = Math.max(d, 15) + 3;
      scene.onBeforeRender = (_r, _s, cam) => { cam.position.set(t.x + dx / d * back, f.y + 1.7, t.z + dz / d * back); cam.lookAt(t.x, midY, t.z); cam.updateMatrixWorld(); };
      if (t.noCull) scene.traverse(o => { if (o.isInstancedMesh && o.name === 'Building fire-escape') o.frustumCulled = false; });
      window.__feSphere = (() => { let r = null; scene.traverse(o => { if (o.isInstancedMesh && o.name === 'Building fire-escape' && o.boundingSphere) { const c = o.boundingSphere.center.clone().applyMatrix4(o.matrixWorld);
        r = { center: c.toArray().map(n => +n.toFixed(1)), radius: +o.boundingSphere.radius.toFixed(1), toStack: +Math.hypot(c.x - t.x, c.z - t.z).toFixed(1) }; } }); return r; })();
      for (const o of [w.streetWalkers?.root].filter(Boolean)) o.visible = true; }, { ...s, noCull: process.env.FE_NOCULL === '1' });
    console.log('SPHERE ' + JSON.stringify(await page.evaluate(() => window.__feSphere)));
    await page.waitForTimeout(2500);
    const foot = await page.evaluate(() => ({ x: window.__gtasf.world.foot.x, z: window.__gtasf.world.foot.z }));
    console.log(`${tag}: stood ${Math.hypot(foot.x - s.x, foot.z - s.z).toFixed(1)} m from the stack`);
    await page.screenshot({ path: `${OUT}/${tag}.jpg`, type: 'jpeg', quality: 80 });
  }
}
writeFileSync(`${OUT}/result.json`, JSON.stringify(R, null, 2)); console.log('errs', JSON.stringify(errs));
setTimeout(() => process.exit(0), 8000).unref(); await browser.close(); await server?.close(); await pool?.close?.();
