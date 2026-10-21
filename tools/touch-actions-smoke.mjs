/** Actual touch events against Input, with explicit polling to expose between-frame taps. */
import { build } from 'vite';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..'), out = resolve(root, 'artifacts/touch-actions');
const source = resolve(out, 'source'), bundle = resolve(out, 'bundle');
await mkdir(source, { recursive: true });
await writeFile(resolve(source, 'index.html'), '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Touch input smoke</title><canvas></canvas><script type="module" src="./scene.ts"></script>');
await writeFile(resolve(source, 'scene.ts'), `
import {Input} from '/web/src/input/input.ts';
const input = new Input(document.querySelector('canvas')!, {touch:true});
input.touch.setMode('driver');
const actions = ['enter-exit','hail','map','horn','throttle','brake','handbrake'] as const;
window.touchSmoke = {input, poll: () => { input.poll(1/60); return {
  source:input.source, held:actions.filter(a=>input.held(a)), pressed:actions.filter(a=>input.pressed(a)), throttle:input.throttle,
}; }};
`);
await build({ configFile: false, root, publicDir: false, logLevel: 'warn', build: {
  outDir: bundle, emptyOutDir: true, rollupOptions: { input: resolve(source, 'index.html') },
} });
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/favicon.ico') { res.writeHead(204).end(); return; }
  const file = path === '/' ? resolve(bundle, 'artifacts/touch-actions/source/index.html') : resolve(bundle, `.${path}`);
  if (!file.startsWith(`${bundle}/`)) { res.writeHead(403).end(); return; }
  try { res.setHeader('Content-Type', extname(file) === '.js' ? 'application/javascript' : 'text/html'); res.end(await readFile(file)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
const report = { checkedAt: new Date().toISOString(), errors: [], checks: [], passed: false };
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => !!window.touchSmoke);
  const poll = () => page.evaluate(() => window.touchSmoke.poll());
  const button = action => page.locator(`button[data-action="${action}"]`);
  for (const action of ['hail', 'map', 'enter-exit', 'horn']) {
    await button(action).tap(); // Both pointer edges finish before the next Input.poll.
    const first = await poll();
    assert.deepEqual(first.pressed, [action]); assert.equal(first.source, 'touch');
    assert.deepEqual((await poll()).held, []);
  }
  report.checks.push('Every discrete quick tap survives exactly one poll');
  await button('hail').tap(); await button('map').tap();
  assert.deepEqual((await poll()).pressed.sort(), ['hail', 'map']); await poll();
  report.checks.push('Distinct taps between polls are both retained');
  const cdp = await page.context().newCDPSession(page);
  const start = async action => {
    const box = await button(action).boundingBox(); assert.ok(box);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }] });
  };
  const end = type => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: [] });
  await start('hail'); assert.deepEqual((await poll()).pressed, ['hail']);
  assert.deepEqual((await poll()).pressed, []); await end('touchEnd'); assert.deepEqual((await poll()).held, []);
  report.checks.push('Held Hail fires once and releases without a duplicate');
  await start('hail'); await end('touchCancel'); assert.deepEqual((await poll()).held, []);
  report.checks.push('Cancelled pointer cannot produce a queued action');
  for (const action of ['throttle', 'brake', 'handbrake']) {
    await button(action).tap(); assert.deepEqual((await poll()).held, []);
  }
  await start('throttle'); assert.equal((await poll()).throttle, 1);
  await end('touchEnd'); assert.equal((await poll()).throttle, 0);
  report.checks.push('Driving pedals require a held touch and do not latch');
  await button('hail').tap(); await page.evaluate(() => window.touchSmoke.input.release());
  assert.deepEqual((await poll()).held, []);
  await button('hail').tap(); await page.evaluate(() => window.touchSmoke.input.touch.show(false));
  assert.deepEqual((await poll()).held, []);
  report.checks.push('Input release and hiding controls discard pending taps');
  await cdp.detach(); assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) { report.failure = String(error); throw error; }
finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
  await writeFile(resolve(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
}
