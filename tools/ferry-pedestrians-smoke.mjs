import { build } from 'vite';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// Explicit local renderer specimen: real map, landmark, rig and production lighting.
export async function checkFerryPedestrians({ buildOnly = false, skipBuild = false } = {}) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const source = resolve(root, 'artifacts/ferry-pedestrians/source'), out = resolve(root, 'artifacts/ferry-pedestrians/preview');
  await mkdir(source, { recursive: true });
  await writeFile(resolve(source, 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ferry plaza pedestrians</title></head><body style="margin:0;overflow:hidden"><canvas style="display:block;width:100vw;height:100vh"></canvas><script type="module" src="./scene.ts"></script></body></html>');
  await writeFile(resolve(source, 'scene.ts'), `
import { PerspectiveCamera, Vector3 } from 'three';
import { createRenderFoundation } from '/web/src/render/foundation.ts';
import { loadLombardWorld } from '/web/src/render/chunks/world.ts';
import { createPlacedLandmarks, updateLandmarkTerrain, ferrySpawn, disposeLandmark } from '/web/src/render/landmarks/landmarks.ts';
import { withLandmarkSurfaces } from '/web/src/render/landmarks/surfaces.ts';
import { loadAvatarTemplate } from '/web/src/avatar/riggedAvatar.ts';
import { createFerryPedestrians } from '/web/src/render/ferryPedestrians.ts';
const low = new URLSearchParams(location.search).has('low');
const foundation = createRenderFoundation({ canvas: document.querySelector('canvas'), enabled: true, atmosphere: true,
  tier: low ? 'low' : 'medium', weather: false, now: () => Date.parse('2026-10-03T20:00:00Z') });
const camera = new PerspectiveCamera(58, innerWidth / innerHeight, .2, 1500);
const world = await loadLombardWorld({ enabled: true, position: { x: 1205, z: -1215 }, mountGeometry: foundation.mountGeometry });
const landmarks = createPlacedLandmarks({ enabled: true, heightAt: world.surfaceHeightAt });
const releaseLandmarks = foundation.mountGeometry(landmarks);
const ground = withLandmarkSurfaces({ heightAt: world.surfaceHeightAt, collidesCircle: world.collidesCircle }, landmarks);
const template = await loadAvatarTemplate();
const crowd = createFerryPedestrians({ enabled: true, template, landmarks, ground, low, isLoaded: (x, z) => world.heightAt(x, z) !== null });
// Animated avatars own their materials; do not replace them with static world variants.
foundation.scene.add(crowd.root);
const ferry = landmarks.children.find(o => o.userData.landmarkId === 'ferry-building');
const player = ferrySpawn(world.surfaceHeightAt);
await world.ensureAround(player);
for (let i = 0; i < 60; i++) { world.update(player); await new Promise(r => setTimeout(r, 30)); }
updateLandmarkTerrain(landmarks, world.surfaceHeightAt);
function advance(seconds) { for (let i = 0; i < Math.ceil(seconds * 60); i++) crowd.update(player, 1 / 60); }
function draw() { foundation.resize(innerWidth, innerHeight, 1); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); foundation.render(camera, true); }
function view(close = false) {
  if (close) {
    const actor = crowd.root.children[0], offset = new Vector3(4, 3.4, 7).applyAxisAngle(new Vector3(0, 1, 0), ferry.rotation.y);
    camera.position.copy(actor.position).add(offset); camera.lookAt(actor.position.x, actor.position.y + 1, actor.position.z);
  } else {
    ferry.updateMatrixWorld(); camera.position.set(0, 4, 72).applyMatrix4(ferry.matrixWorld);
    camera.lookAt(new Vector3(0, 1, 43).applyMatrix4(ferry.matrixWorld));
  }
  draw();
}
function inspect() {
  const gl = foundation.renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
  return { renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
    stats: { ...crowd.stats }, errors: [...world.stats.errors], actors: crowd.root.children.map(o => ({
    name: o.name, visible: o.visible, position: o.position.toArray(), ground: ground.heightAt(o.position.x, o.position.z),
    yaw: o.rotation.y,
    blocked: ground.collidesCircle(o.position.x, o.position.z, .5), skinned: !!o.getObjectByProperty('isSkinnedMesh', true),
  })) };
}
advance(2); view();
window.pedestrians = { advance, view, inspect, yield() {
  const actor = crowd.root.children[0]; player.x = actor.position.x + Math.sin(actor.rotation.y); player.z = actor.position.z + Math.cos(actor.rotation.y); player.y = actor.position.y;
  advance(1); view(true);
}, dispose() { crowd.dispose(); template.dispose(); releaseLandmarks(); disposeLandmark(landmarks); world.dispose(); foundation.dispose(); } };
window.pedestriansReady = true;
`);
  if (!skipBuild) await build({ configFile: false, root, publicDir: false, logLevel: 'warn',
    build: { outDir: out, emptyOutDir: false, rollupOptions: { input: resolve(source, 'index.html') } } });
  if (buildOnly) return { built: true, out };
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0]);
    if (path === '/favicon.ico') { res.writeHead(204).end(); return; }
    const map = path.startsWith('/map/lombard/'), asset = path.startsWith('/assets/avatars/') || path.startsWith('/art/');
    const base = map ? resolve(root, 'tools/map/out/lombard') : asset ? resolve(root, 'web/public') : out;
    const file = path === '/' ? resolve(out, 'artifacts/ferry-pedestrians/source/index.html') : resolve(base, '.' + (map ? path.slice('/map/lombard'.length) : path));
    if (!file.startsWith(base + '/')) { res.writeHead(403).end(); return; }
    try { const bytes = await readFile(file); res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' })[extname(file)] ?? 'application/octet-stream'); res.end(bytes); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  const errors = [], views = [];
  try {
    browser = await chromium.launch({ headless: true });
    for (const low of [false, true]) {
      const page = await browser.newPage({ viewport: low ? { width: 390, height: 844 } : { width: 1280, height: 800 }, isMobile: low, hasTouch: low });
      page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      page.on('response', response => { if (response.status() >= 400) errors.push(response.status() + ' ' + response.url()); });
      await page.goto('http://127.0.0.1:' + server.address().port + '/' + (low ? '?low' : ''));
      await page.waitForFunction(() => window.pedestriansReady, {}, { timeout: 60000 });
      const label = low ? 'phone' : 'desktop', captures = [];
      for (const name of ['plaza', 'walking', 'turning', 'yielding']) {
        if (name === 'walking') await page.evaluate(() => { window.pedestrians.advance(9); window.pedestrians.view(true); });
        if (name === 'turning') await page.evaluate(() => { window.pedestrians.advance(4.7); window.pedestrians.view(true); });
        if (name === 'yielding') await page.evaluate(() => window.pedestrians.yield());
        const state = await page.evaluate(() => window.pedestrians.inspect());
        assert.equal(state.stats.count, low ? 4 : 8); assert.equal(state.stats.visible, low ? 4 : 8); assert.deepEqual(state.errors, []);
        for (const actor of state.actors) { assert.equal(actor.blocked, false); assert.equal(actor.skinned, true); assert.ok(Math.abs(actor.position[1] - actor.ground) < .02); }
        if (name === 'yielding') assert.ok(state.stats.yielding > 0);
        assert.deepEqual(errors, []); await page.screenshot({ path: resolve(out, name + '-' + label + '.png') }); captures.push({ name, state });
      }
      views.push({ label, captures }); await page.evaluate(() => window.pedestrians.dispose()); await page.close();
    }
    await writeFile(resolve(out, 'smoke.json'), JSON.stringify({ checkedAt: new Date().toISOString(), ok: true, errors, views }, null, 2));
    return { ok: true, out };
  } finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(await checkFerryPedestrians({ buildOnly: process.argv.includes('--build-only'), skipBuild: process.argv.includes('--skip-build') })));
