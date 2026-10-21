// Console diagnostic (lane D): load a prebuilt app (APP_DIR) on phone-Low at AT, wait WAIT_MS after READY, print every
// console warning/error + page error and a few __gtasf.world stats. Env: APP_DIR (required), AT, WAIT_MS (default 30000).
import { preview } from 'vite';
import { chromium } from '@playwright/test';
import { resolve } from 'node:path';
import { startLocalPool } from './local-pool/pool.mjs';
const app = resolve(process.env.APP_DIR), at = process.env.AT ?? '37.7785,-122.3990', waitMs = Number(process.env.WAIT_MS ?? 30000);
let server, browser, pool;
try {
  pool = await startLocalPool();
  server = await preview({ root: resolve('web'), configFile: resolve('web/vite.config.ts'), build: { outDir: app },
    preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: pool.url.origin, ws: true } } } });
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: 393, height: 873 }, deviceScaleFactor: 2.75, isMobile: true, hasTouch: true });
  await context.addInitScript(v => { try { localStorage.setItem('gtasf.founder.v1', v); } catch {} }, JSON.stringify({ founded: true, startupName: 'Diag', foundedAt: Date.now(), billboardSeen: true }));
  // BODYTIME=1 (localBodyFirst): wear wardrobe outfit OUTFIT (default 4, a Meshy body) and time, from READY, when the local
  // player's body mounts. THROTTLE_KBPS throttles the network (CDP) so the post-READY people downloads compete like a phone's.
  if (process.env.BODYTIME === '1') await context.addInitScript(v => { try { localStorage.setItem('gtasf.outfit', v); } catch {} }, process.env.OUTFIT ?? '4');
  const page = await context.newPage();
  if (process.env.THROTTLE_KBPS) { const cdp = await context.newCDPSession(page); const bps = +process.env.THROTTLE_KBPS * 1024 / 8;
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: bps, uploadThroughput: bps }); }
  page.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') console.log(`CONSOLE ${m.type()}: ${m.text().slice(0, 400)}`); });
  page.on('pageerror', e => console.log(`PAGEERROR ${e.stack?.slice(0, 600)}`));
  // WEATHER=rain[:0.8]: stub /api/weather with a live, valid CityWeather reading (shared/weather.ts) so wet-road looks can
  // be captured on demand (the client has no URL override; weather comes only from the feed). Needs flags.weather on.
  if (process.env.WEATHER) { const [kind, level] = process.env.WEATHER.split(':'), rain = kind === 'rain' ? Number(level ?? 0.8) : 0;
    await page.route('**/api/weather', route => { const now = Date.now();
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: 1, status: 'live', fetchedAt: now, expiresAt: now + 3_600_000,
        observedAt: now, forecastAt: null, description: rain ? 'Rain' : 'Clear', cloudCover: rain ? 1 : 0.1, fog: rain ? 0.25 : 0, rain, visibilityM: rain ? 4000 : 16000,
        sources: { forecast: null, observation: null } }) }); }); }
  // QUERY='time=night&...': extra URL parameters (e.g. a night frame).
  await page.goto(`${base}/?at=${at}&preset=low&touch=1${process.env.QUERY ? `&${process.env.QUERY}` : ''}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__gtasf?.ready, undefined, { timeout: 180000 });
  // BODYFRAMES=<prefix>: frames at ~0.3/1.2/2.2/4 s after READY (intro skipped first), to see the local player's outfit settle.
  if (process.env.BODYFRAMES) { const t0 = Date.now(); await page.evaluate(() => document.querySelector('.gt-sa-intro__skip')?.click());
    for (const at of [300, 1200, 2200, 4000]) { const wait = at - (Date.now() - t0); if (wait > 0) await page.waitForTimeout(wait);
      await page.evaluate(() => document.querySelector('.gt-sa-intro__skip')?.click()); await page.screenshot({ path: `${process.env.BODYFRAMES}-${at}.png` }); } }
  if (process.env.BODYTIME === '1') console.log('BODYTIME ' + JSON.stringify(await page.evaluate(() => new Promise(done => {
    const t0 = performance.now(), w = window.__gtasf.world;
    const mounted = () => { let top = w.camera.camera; for (const c of w.fleet?.cars?.values?.() ?? []) { top = c.model.root; break; } while (top.parent) top = top.parent;
      let hit = false; top.traverse(o => { if (o.name === 'on-foot-avatar' && !/Street walker|Crowd/.test(o.parent?.name ?? '') && o.getObjectByName('headfront')) hit = true; }); return hit; };
    const tick = () => { const s = (performance.now() - t0) / 1000; if (mounted()) done({ mountedAfterReadyS: +s.toFixed(1) }); else if (s > 90) done({ mountedAfterReadyS: null }); else setTimeout(tick, 100); };
    tick(); }))));
  for (let i = 0; i < 10; i++) { if (!(await page.locator('.gt-sa-intro').count())) break; await page.evaluate(() => document.querySelector('.gt-sa-intro__skip')?.click()); await page.waitForTimeout(400); }
  await page.waitForTimeout(waitMs);
  // LISTTOP=1: the render scene's top-level children (name, type, children, visible) - to find a root to HIDE.
  if (process.env.LISTTOP === '1') console.log('TOP ' + JSON.stringify(await page.evaluate(() => { const w = window.__gtasf.world; let scene = w.streetWalkers?.root ?? [...(w.fleet?.cars?.values?.() ?? [])][0]?.model.root; while (scene?.parent) scene = scene.parent;
    return scene.children.map(c => `${c.name || c.type}(${c.children.length}${c.visible ? '' : ',hidden'})`); })));
  // NEARLM=1: SF landmarks children sorted by distance from the player (name/landmarkId, distance).
  if (process.env.NEARLM === '1') console.log('NEARLM ' + JSON.stringify(await page.evaluate(() => { const w = window.__gtasf.world, f = w.foot; let scene = w.streetWalkers?.root; while (scene?.parent) scene = scene.parent;
    const lm = scene.children.find(c => c.name === 'SF landmarks'); if (!lm) return null;
    return lm.children.map(c => { const p = c.getWorldPosition(c.position.clone()); return { id: c.userData?.landmarkId ?? c.name, d: +Math.hypot(p.x - f.x, p.z - f.z).toFixed(0) }; }).sort((a, b) => a.d - b.d).slice(0, 8); })));
  // HIDE=<regex>: hide every object whose name matches before the SHOT (which mesh draws a wall?).
  if (process.env.HIDE) console.log('HIDDEN ' + await page.evaluate(re => { const w = window.__gtasf.world; let scene = w.streetWalkers?.root ?? [...(w.fleet?.cars?.values?.() ?? [])][0]?.model.root; while (scene?.parent) scene = scene.parent;
    const rx = new RegExp(re); let n = 0; scene?.traverse(o => { if (rx.test(o.name ?? '')) { o.visible = false; n++; } }); return n; }, process.env.HIDE));
  if (process.env.HIDE) await page.waitForTimeout(500);
  // DEADCAM=1 (avatarPoseBounds critic check): waste the nearest walker (testingHarness hook), wait for the death clip, then pin
  // the camera 0.6 m behind its feet, 1.6 m up, looking along the body: feet below the bottom edge, torso + head on-screen.
  if (process.env.DEADCAM === '1') {
    console.log('DEADCAM ' + JSON.stringify(await page.evaluate(() => { const w = window.__gtasf.world, f = w.foot, walkers = w.streetWalkers?.root; if (!walkers) return 'no walkers';
      // Aim the hook at a RIGGED walker (a SkinnedMesh under the walkers root), not the nearest one (usually a VAT body).
      const rigs = []; walkers.traverse(o => { if (!o.isSkinnedMesh) return; let r = o; while (r.parent && r.parent !== walkers) r = r.parent; if (!r.visible) return;
        const p = r.getWorldPosition(w.camera.camera.position.clone()); rigs.push({ x: p.x, z: p.z, d: Math.hypot(p.x - f.x, p.z - f.z), name: o.name, bones: o.skeleton.bones.filter(b => /head/i.test(b.name)).map(b => b.name) }); });
      rigs.sort((a, b) => a.d - b.d); const t = rigs[0];
      return { rigs: rigs.slice(0, 4).map(r => ({ d: +r.d.toFixed(1), name: r.name, head: r.bones })), wasted: t ? w.streetWalkers.wasteNearest(t.x, t.z) : false }; })));
    await page.waitForTimeout(4500);
    console.log('DEADPOSE ' + JSON.stringify(await page.evaluate(() => { const w = window.__gtasf.world, f = w.foot, walkers = w.streetWalkers.root; let scene = walkers; while (scene.parent) scene = scene.parent;
      let best = null; const v = w.camera.camera.position.clone();
      walkers.traverse(o => { if (!o.isSkinnedMesh) return; let r = o; while (r.parent && r.parent !== walkers) r = r.parent; const p = r.getWorldPosition(v.clone());
        const head = o.skeleton.bones.find(b => /head/i.test(b.name)); if (!head) return; const h = head.getWorldPosition(v.clone());
        const lying = h.y - p.y < 0.9; const d = Math.hypot(p.x - f.x, p.z - f.z); if (lying && (!best || d < best.d)) best = { d, p, h, mesh: o }; });
      if (!best) return null; const { p, h } = best, len = Math.hypot(h.x - p.x, h.z - p.z) || 1, dx = (h.x - p.x) / len, dz = (h.z - p.z) / len;
      // Hide every other skinned body (the player stands right behind the victim and fills the frame otherwise).
      scene.traverse(o => { if (o.isSkinnedMesh && o !== best.mesh && o.parent !== best.mesh.parent) o.visible = false; });
      // 1 m behind the feet, 2 m up, near plane 0.9 m (a VAT walker or the pole right at the lens otherwise fills the frame);
      // looking 5 m past the feet: feet (~63 deg down) fall below the bottom edge, hips (~46 deg) and head stay on-screen.
      scene.onBeforeRender = (_r, _s, cam) => { cam.position.set(p.x - dx, p.y + 2, p.z - dz); cam.lookAt(p.x + dx * 5, p.y, p.z + dz * 5);
        if (cam.near !== .9) { cam.near = .9; cam.updateProjectionMatrix(); } cam.updateMatrixWorld(); };
      return { headUp: +(h.y - p.y).toFixed(2), bodyLen: +len.toFixed(2), culled: best.mesh.frustumCulled, sphere: best.mesh.boundingSphere ? +best.mesh.boundingSphere.radius.toFixed(2) : null }; })));
    await page.waitForTimeout(800);
  }
  // HOSPPROBE=1 (hospitalEntrances layout): from the snapped spawn, distance to the first collision (building) in 16
  // directions (bearing 0 = north/-z, clockwise), plus the spawn's world position and ground height.
  if (process.env.HOSPPROBE === '1') console.log('HOSPPROBE ' + JSON.stringify(await page.evaluate(() => { const w = window.__gtasf.world, f = w.foot, m = w.map, out = [];
    for (let k = 0; k < 16; k++) { const a = k * Math.PI / 8, dx = Math.sin(a), dz = -Math.cos(a); let hit = null;
      for (let d = 1; d <= 45; d += 0.5) { const x = f.x + dx * d, z = f.z + dz * d, y = m.surfaceHeightAt?.(x, z, f.y) ?? f.y; if (m.collides(x, y + 1.5, z, 0.3, 2)) { hit = d; break; } }
      out.push([k * 22.5, hit]); }
    // East (+x) road extent: first distance where roadHeightAt stops returning a road (the kerb), and where it resumes.
    let kerb = null; for (let d = 0; d <= 40; d += 0.25) { if (m.roadHeightAt?.(f.x + d, f.z) == null) { kerb = d; break; } }
    return { foot: { x: +f.x.toFixed(2), y: +f.y.toFixed(2), z: +f.z.toFixed(2) }, rays: out, eastKerb: kerb }; })));
  // HOSPGRID=1: occupancy east of the spawn, x 0..26 m (cols) by z -24..24 m (rows, north at top), 1 m cells:
  // '#' building (collides), '=' road (roadHeightAt), '.' walkable, 'P' the spawn.
  if (process.env.HOSPGRID === '1') console.log('HOSPGRID\n' + await page.evaluate(() => { const w = window.__gtasf.world, f = w.foot, m = w.map, rows = [];
    for (let dz = -24; dz <= 24; dz++) { let row = ''; for (let dx = 0; dx <= 26; dx++) { const x = f.x + dx, z = f.z + dz, y = m.surfaceHeightAt?.(x, z, f.y) ?? f.y;
      row += dx === 0 && dz === 0 ? 'P' : m.collides(x, y + 1.5, z, 0.3, 2) ? '#' : m.roadHeightAt?.(x, z) != null ? '=' : '.'; } rows.push(`${String(dz).padStart(3)} ${row}`); }
    return rows.join('\n'); }));
  // HOSPCHECK=1: every hospital-entrance cluster's world position relative to the player (dx east, dz south, dy up).
  if (process.env.HOSPCHECK === '1') console.log('HOSPCHECK ' + JSON.stringify(await page.evaluate(() => { const w = window.__gtasf.world, f = w.foot; let scene = w.streetWalkers?.root; while (scene?.parent) scene = scene.parent;
    const out = []; scene?.traverse(o => { if (!/entrance (monument|emergency pylon|canopy)$/.test(o.name ?? '')) return; const p = o.getWorldPosition(o.position.clone());
      if (Math.hypot(p.x - f.x, p.z - f.z) < 80) out.push({ n: o.name.replace(/ entrance/, ''), dx: +(p.x - f.x).toFixed(1), dz: +(p.z - f.z).toFixed(1), dy: +(p.y - f.y).toFixed(2), vis: o.visible && (o.parent?.visible ?? true) }); });
    return out; })));
  // GROUNDCHECK=1 (gtasf-2mdpz): at the snapped spawn and every 2 m across x-10..+10, the road-graph/foot height vs the DRAWN
  // surface (renderedGroundHeightAt, the surface footRenderedGround lifts the local avatar onto).
  if (process.env.GROUNDCHECK === '1') console.log('GROUNDCHECK ' + JSON.stringify(await page.evaluate(() => { const w = window.__gtasf.world, f = w.foot, m = w.map, row = [];
    for (let dx = -10; dx <= 10; dx += 2) { const x = f.x + dx, g = m.roadHeightAt?.(x, f.z) ?? m.surfaceHeightAt?.(x, f.z, f.y), d = m.renderedGroundHeightAt?.(x, f.z, g ?? f.y);
      row.push([dx, g == null ? null : +g.toFixed(2), d == null ? null : +d.toFixed(2), g == null || d == null ? null : +(d - g).toFixed(2)]); }
    // Uncapped: renderedGroundHeightAt only searches +-5 m around its reference, so retry with shifted references.
    let drawn = m.renderedGroundHeightAt?.(f.x, f.z, f.y);
    for (const off of [5, -5, 10, -10, 15, -15]) { if (drawn != null) break; drawn = m.renderedGroundHeightAt?.(f.x, f.z, f.y + off); }
    return { foot: { x: +f.x.toFixed(2), y: +f.y.toFixed(2), z: +f.z.toFixed(2) }, drawnAtFoot: drawn == null ? null : +drawn.toFixed(2), gapAtFoot: drawn == null ? null : +(drawn - f.y).toFixed(2), across: row }; })));
  // STREETSTATS=1: the street-prop system's stats (refreshes, visible, shopGlows...) or why it is missing.
  if (process.env.STREETSTATS === '1') console.log('STREETSTATS ' + JSON.stringify(await page.evaluate(() => { const sp = window.__gtasf.world.streetProps;
    return sp ? { shopGlows: sp.stats.shopGlows, visible: sp.stats.visible, updates: sp.stats.updates, sites: sp.stats.sites } : { missing: true, type: typeof sp }; })));
  // POSEBOUNDS=1 (avatarPoseBounds, gtasf-iedec): for every SkinnedMesh, skin each vertex in its CURRENT pose and report the
  // worst distance from its boundingSphere centre as a fraction of the radius (> 1 = a visible body could be culled).
  if (process.env.POSEBOUNDS === '1') console.log('POSEBOUNDS ' + JSON.stringify(await page.evaluate(() => { const w = window.__gtasf.world; let scene = w.streetWalkers?.root ?? w.camera.camera; while (scene.parent) scene = scene.parent;
    const out = { culled: 0, unculled: 0, worst: 0, checked: 0 }; const v = w.camera.camera.position.clone();
    scene.traverse(o => { if (!o.isSkinnedMesh) return; if (!o.frustumCulled) { out.unculled++; return; } out.culled++; if (!o.boundingSphere) return;
      const n = o.geometry.attributes.position.count; for (let i = 0; i < n; i += 3) { o.getVertexPosition(i, v); out.checked++; out.worst = Math.max(out.worst, v.distanceTo(o.boundingSphere.center) / o.boundingSphere.radius); } });
    out.worst = +out.worst.toFixed(3); return out; })));
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
  // CARCAM=<m>: pin the camera <m> metres from the nearest LOD car (eye height, looking at it), wait, then CARS/SHOT below.
  if (process.env.CARCAM) { await page.evaluate(m => { const w = window.__gtasf.world, cam = w.camera.camera, c = cam.getWorldPosition(cam.position.clone());
      let top = cam; for (const car of w.fleet?.cars?.values?.() ?? []) { top = car.model.root; while (top.parent) top = top.parent; break; }
      let best = null, bd = Infinity; top.traverse(o => { if (o.isLOD && o.nearLowLevel !== undefined) { const p = o.getWorldPosition(o.position.clone()), d = p.distanceTo(c); if (d < bd) { bd = d; best = o; } } });
      if (!best) return; const p = best.getWorldPosition(best.position.clone()), dir = c.clone().sub(p).setY(0).normalize();
      top.onBeforeRender = (_r, _s, k) => { const q = best.getWorldPosition(best.position.clone()); k.position.set(q.x + dir.x * m, q.y + 1.6, q.z + dir.z * m); k.lookAt(q.x, q.y + .6, q.z); k.updateMatrixWorld(); }; }, +process.env.CARCAM);
    await page.waitForTimeout(8000);
    if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT.replace(/\.png$/, '-carcam.png') }); }
  // CARPOS=1: the 3 fleet cars nearest the player - kind, world x/z, approximate lat/lon (flat, frame origin 37.7842,-122.4078).
  if (process.env.CARPOS === '1') console.log('CARPOS ' + JSON.stringify(await page.evaluate(() => { const w = window.__gtasf.world, f = w.foot, out = [];
    for (const c of w.fleet?.cars?.values?.() ?? []) { const p = c.model.root.position, d = Math.hypot(p.x - f.x, p.z - f.z);
      out.push({ kind: c.data?.kind, d: +d.toFixed(1), x: +p.x.toFixed(1), z: +p.z.toFixed(1), yawDeg: +(c.model.root.rotation.y * 180 / Math.PI).toFixed(0),
        ll: `${(37.7842 - p.z / 110996).toFixed(6)},${(-122.4078 + p.x / (111320 * Math.cos(37.79 * Math.PI / 180))).toFixed(6)}` }); }
    return out.sort((a, b) => a.d - b.d).slice(0, 3); })));
  // SKINCHECK=1 (meshyHeadMaps spikes): every SkinnedMesh's POSED bounding box (computeBoundingBox applies skinning); list the
  // ones larger than 3 m with their parent chain, so a mesh whose bones aren't driven shows up.
  if (process.env.SKINCHECK === '1') console.log('SKINCHECK ' + JSON.stringify(await page.evaluate(() => { const w = window.__gtasf.world, roots = new Set();
    for (const o of [w.camera.camera, w.streetWalkers?.root, [...(w.fleet?.cars?.values?.() ?? [])][0]?.model.root]) { let t = o; while (t?.parent) t = t.parent; if (t) roots.add(t); }
    let total = 0; const bad = [];
    for (const r of roots) r.traverse(o => { if (!o.isSkinnedMesh) return; total++; o.computeBoundingBox(); const b = o.boundingBox, size = [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z];
      if (Math.max(...size) > 3) { const chain = []; for (let q = o.parent; q && chain.length < 5; q = q.parent) chain.push(q.name || q.type);
        const bonesInScene = o.skeleton.bones.filter(bn => { let q = bn; while (q.parent) q = q.parent; return q === r; }).length;
        bad.push({ name: o.name, chain: chain.join(' < '), size: size.map(n => +n.toFixed(1)), verts: o.geometry.attributes.position.count, bones: o.skeleton.bones.length, bonesInScene, visible: o.visible }); } });
    return { total, bad: bad.slice(0, 8) }; })));
  // PICK=x,y (0..1 screen coords): which meshes does the camera ray through that point cross? World-space bounding-box hits,
  // nearest first, with name, parent chain and material - identifies e.g. an untextured wall (critic N17).
  if (process.env.PICK) console.log('PICK ' + JSON.stringify(await page.evaluate(xy => { const [x, y] = xy.split(',').map(Number), cam = window.__gtasf.world.camera.camera;
    const w0 = window.__gtasf.world; let scene = w0.streetWalkers?.root ?? [...(w0.fleet?.cars?.values?.() ?? [])][0]?.model.root ?? cam; while (scene.parent) scene = scene.parent;
    const o = cam.getWorldPosition(cam.position.clone()), d = cam.position.clone().set(x * 2 - 1, 1 - y * 2, .5).unproject(cam).sub(o).normalize(), hits = [];
    scene.traverse(m => { if (!m.isMesh || !m.visible || !m.geometry) return; let vis = true; for (let q = m; q; q = q.parent) if (!q.visible) vis = false; if (!vis) return;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox(); const b = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
      let t0 = 0, t1 = 1e9; for (const k of ['x', 'y', 'z']) { const inv = 1 / d[k], ta = (b.min[k] - o[k]) * inv, tb = (b.max[k] - o[k]) * inv; t0 = Math.max(t0, Math.min(ta, tb)); t1 = Math.min(t1, Math.max(ta, tb)); }
      if (t0 > t1 || t0 > 400) return; const chain = []; for (let q = m.parent; q && chain.length < 5; q = q.parent) chain.push(q.name || q.type);
      const mats = [m.material].flat(); hits.push({ t: +t0.toFixed(1), name: m.name || m.type, chain: chain.join(' < '), mat: mats.map(x => `${x.type}${x.map ? '+map' : ''}${x.name ? ':' + x.name : ''}`).join(','), inst: m.isInstancedMesh ? m.count : undefined, size: b.getSize(o.clone()).toArray().map(n => +n.toFixed(0)) }); });
    return hits.sort((a, b) => a.t - b.t).slice(0, 8); }, process.env.PICK)));
  // CARS=1 (carNearDetail): the 3 nearest fleet cars - camera distance, HD level present, which level shows.
  if (process.env.CARS === '1') console.log('CARS ' + JSON.stringify(await page.evaluate(() => { const w = window.__gtasf.world, c = w.camera.camera.getWorldPosition(w.camera.camera.position.clone()); const out = [];
    let top = w.camera.camera; for (const car of w.fleet?.cars?.values?.() ?? []) { top = car.model.root; while (top.parent) top = top.parent; break; }
    top.traverse(o => { if (o.isLOD && o.levels?.length) { const p = o.getWorldPosition(o.position.clone()); out.push({ d: +p.distanceTo(c).toFixed(1), levels: o.levels.length, hdArmed: !!o.nearLowLevel, showing: o.getCurrentLevel(), lowAt: o.nearLowLevel?.distance, lv: o.levels.map(l => ({ d: l.distance, vis: l.object.visible, name: (l.object.name || l.object.type).slice(0, 24), lowLevel: l === o.nearLowLevel })) }); } });
    return out.sort((a, b) => a.d - b.d).slice(0, 3); })));
  console.log('STATS ' + JSON.stringify(await page.evaluate(() => { const w = window.__gtasf?.world; let scene = w?.streetWalkers?.root ?? w?.ferryPedestrians?.root; while (scene?.parent) scene = scene.parent;
    const vat = []; scene?.traverse(o => { if (/VAT|Crowd/i.test(o.name ?? '') && o.isMesh) vat.push({ name: o.name, visible: o.visible, parentVisible: o.parent?.visible, count: o.count, inScene: true }); });
    return { walkers: w?.streetWalkers?.stats ?? null, hasWalkers: Boolean(w?.streetWalkers), ferry: w?.ferryPedestrians?.stats ?? null, hasFerry: Boolean(w?.ferryPedestrians), vat: vat.slice(0, 14) }; })));
} catch (e) { console.log('FATAL ' + (e?.stack ?? e)); process.exitCode = 1; }
finally { await browser?.close(); try { await server?.httpServer?.close(); } catch {} try { await pool?.close(); } catch {} process.exit(); }
