/** One real-map material smoke. Uses a frozen Vite build when --app=... is supplied. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { preview } from 'vite';

const app = process.argv.find(value => value.startsWith('--app='))?.slice(6);
const output = resolve('tools/map/out/facade-atlas-smoke');
await mkdir(output, { recursive: true });
let server, browser, page;
const report = { checkedAt: new Date().toISOString(), app: app ? resolve(app) : null, errors: [], views: [] };
try {
  let base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173';
  if (app) {
    server = await preview({ root: resolve('web'), build: { outDir: resolve(app) },
      preview: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } } });
    base = server.resolvedUrls.local[0];
  }
  browser = await chromium.launch({ headless: true, args: process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu'] : [] });
  for (const view of [
    { name: 'ferry-desktop', path: '/?preset=medium', width: 1280, height: 800, yaw: Math.PI / 2 },
    { name: 'lombard-desktop', path: '/go/lombard?preset=low', width: 1280, height: 800, yaw: Math.PI * 1.5 },
    { name: 'lombard-phone', path: '/go/lombard?preset=low', width: 390, height: 844, yaw: Math.PI * 1.5, phone: true },
  ]) {
    const context = await browser.newContext({ viewport: { width: view.width, height: view.height }, isMobile: Boolean(view.phone), hasTouch: Boolean(view.phone) });
    page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    const artRequests = [];
    page.on('request', request => { const path = new URL(request.url()).pathname; if (path === '/art/manifest.json' || path === '/art/facades/sf-facades.png') artRequests.push(path); });
    await page.goto(new URL(view.path, base).href);
    await page.waitForSelector('#world[data-ready="true"]', { timeout: 60_000 });
    // Newer snapshots may show the real startup dialog; use its normal Close control.
    const onboarding = page.getByRole('dialog', { name: /startup/i });
    if (await onboarding.isVisible().catch(() => false)) await onboarding.getByRole('button', { name: /close/i }).click();
    await page.waitForFunction(() => {
      const world = window.__gtasf?.world;
      const scene = world?.landmarks?.parent;
      let ready = false;
      scene?.traverse(object => {
        for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) {
          if (material.userData.gtasfFacadeAtlas?.state === 'ready') ready = true;
        }
      });
      return ready && !world.map.stats.loading && !world.map.stats.queuedUploads;
    }, undefined, { timeout: 30_000 });
    await page.keyboard.press('KeyC'); await page.waitForTimeout(100);
    await page.evaluate(yaw => { const camera = window.__gtasf.world.camera; camera.setOrbit(yaw, -.12); camera.look(.001, 0); }, view.yaw);
    await page.waitForTimeout(500);
    const sample = await page.evaluate(() => {
      const world = window.__gtasf.world, scene = world.landmarks.parent;
      let atlas;
      scene.traverse(object => { for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) atlas ??= material.userData.gtasfFacadeAtlas; });
      const gl = document.querySelector('#world').getContext('webgl2'), debug = gl.getExtension('WEBGL_debug_renderer_info');
      return { atlas: { ...atlas }, groundFields: scene.children.filter(child => child.userData.gtasfFacadeGround).length,
        world: { ...document.querySelector('#world').dataset }, chunkErrors: [...world.map.stats.errors],
        gpu: gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER) };
    });
    assert.equal(sample.atlas.state, 'ready'); assert.equal(sample.atlas.width * sample.atlas.height, 524288);
    assert(sample.atlas.materials > 0 && sample.groundFields > 0);
    assert.deepEqual(sample.chunkErrors, []);
    assert.equal(artRequests.filter(path => path.endsWith('sf-facades.png')).length, 1, 'One atlas request per scene');
    await page.screenshot({ path: `${output}/${view.name}.png` });
    // Exercise the actual chunk teardown after the visual check, without moving a player or changing terrain.
    const teardown = await page.evaluate(() => {
      const world = window.__gtasf.world, scene = world.landmarks.parent;
      let atlas;
      scene.traverse(object => { for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) atlas ??= material.userData.gtasfFacadeAtlas; });
      world.map.dispose();
      return { materials: atlas.materials, groundFields: scene.children.filter(child => child.userData.gtasfFacadeGround).length };
    });
    assert.deepEqual(teardown, { materials: 0, groundFields: 0 });
    report.views.push({ name: view.name, ...sample, artRequests, teardown });
    await context.close();
  }
  assert.deepEqual(report.errors, [], 'Shader/runtime errors fail the atlas smoke');
  report.passed = true;
  console.log(JSON.stringify({ passed: true, views: report.views.length, errors: report.errors.length }));
} catch (error) {
  report.failure = String(error);
  await page?.screenshot({ path: `${output}/failed.png` }).catch(() => {});
  throw error;
} finally {
  await writeFile(`${output}/report.json`, JSON.stringify(report, null, 2) + '\n');
  await browser?.close();
  if (server) { server.httpServer.closeAllConnections(); await new Promise(done => server.httpServer.close(done)); }
}
