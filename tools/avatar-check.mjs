/** C01 local acceptance: built app, one browser, real user inputs, no running dev server. */
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
const require = createRequire(new URL('./assets/package.json', import.meta.url));
const sharp = require('sharp');
const root = fileURLToPath(new URL('../', import.meta.url)), dist = resolve(root, 'web/dist');
const out = resolve(root, 'artifacts/gtasf-1h3'); await mkdir(out, { recursive: true });
const types = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.glb': 'model/gltf-binary' };
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const path = resolve(dist, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
  if (!path.startsWith(dist + '/')) { res.writeHead(403).end(); return; }
  try { const bytes = await readFile(path); res.writeHead(200, { 'Content-Type': types[extname(path)] || 'application/octet-stream' }).end(bytes); }
  catch { res.writeHead(404).end(); }
});
// This check intentionally has no backend; it does not claim multiplayer or G1 acceptance.
server.on('upgrade', (_request, socket) => socket.destroy());
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
const headed = process.argv.includes('--headed');
const report = { checkedAt: new Date().toISOString(), kind: 'local C01 browser check', headed, backend: false, errors: [] };
try {
  browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const assets = [];
  page.on('pageerror', error => report.errors.push(String(error)));
  page.on('response', response => { if (response.url().endsWith('/avatars/hoodie.glb')) assets.push(response.status()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForSelector('canvas[data-ready="true"]');
  assert.deepEqual(assets, [200], 'The real avatar GLB must load exactly once');
  assert.equal(await page.evaluate(() => document.pointerLockElement !== null), false, 'No capture before a user gesture');
  assert.equal(await page.locator('#error').isVisible(), false);
  const idle = await page.screenshot({ path: resolve(out, 'on-foot-idle.png') });
  await page.keyboard.down('KeyW'); await page.waitForTimeout(650);
  const walking = await page.screenshot({ path: resolve(out, 'on-foot-walk.png') });
  await page.keyboard.down('ShiftLeft'); await page.waitForTimeout(450);
  await page.screenshot({ path: resolve(out, 'on-foot-run.png') });
  await page.keyboard.up('ShiftLeft'); await page.keyboard.up('KeyW');
  const a = await sharp(idle).raw().toBuffer(), b = await sharp(walking).raw().toBuffer();
  let changed = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 12) changed++;
  report.walkChangedChannelFraction = changed / a.length;
  assert.ok(report.walkChangedChannelFraction > .01, 'Walking must visibly move the view through the world');
  await page.mouse.click(600, 400); await page.waitForTimeout(150);
  report.lockAfterClick = await page.evaluate(() => document.pointerLockElement?.tagName ?? null);
  if (report.lockAfterClick === 'CANVAS') {
    await page.keyboard.press('Escape'); await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => document.pointerLockElement !== null), false);
  } else assert.equal(await page.locator('[data-look-fallback]').isVisible(), true);

  // Unsupported capture is a browser capability branch, exercised only in this test page.
  await page.close();
  const fallback = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  fallback.on('pageerror', error => report.errors.push(String(error)));
  await fallback.addInitScript(() => Object.defineProperty(HTMLCanvasElement.prototype, 'requestPointerLock', { value: undefined, configurable: true }));
  await fallback.goto(`http://127.0.0.1:${server.address().port}/`);
  await fallback.waitForSelector('canvas[data-ready="true"]');
  const before = await fallback.screenshot();
  await fallback.mouse.move(610, 420); await fallback.mouse.down();
  await fallback.mouse.move(820, 435, { steps: 8 }); await fallback.mouse.up();
  await fallback.waitForTimeout(100);
  const after = await fallback.screenshot({ path: resolve(out, 'on-foot-drag.png') });
  const c = await sharp(before).raw().toBuffer(), d = await sharp(after).raw().toBuffer();
  changed = 0;
  for (let i = 0; i < c.length; i++) if (Math.abs(c[i] - d[i]) > 12) changed++;
  report.dragChangedChannelFraction = changed / c.length;
  assert.ok(report.dragChangedChannelFraction > .05, 'Fallback drag must visibly orbit the camera');
  assert.equal(await fallback.evaluate(() => document.pointerLockElement !== null), false);
  assert.equal(await fallback.locator('#error').isVisible(), false);
  assert.deepEqual(report.errors, []);
  await writeFile(resolve(out, 'browser-check.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally { await browser?.close(); await new Promise(done => server.close(done)); }
