/** DOM-only regression using the actual options and touch modules, with physical two-finger input. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build } from 'vite';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, process.env.GTASF_OPTIONS_TOUCH_OUT ?? 'artifacts/game-options-touch');
const source = resolve(out, 'source'), bundle = resolve(out, 'bundle');
await mkdir(source, { recursive: true });
await writeFile(resolve(source, 'index.html'), `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Game options touch regression</title><button id="options" style="width:140px;height:50px">Options</button>
<canvas></canvas><script type="module" src="./scene.ts"></script>`);
await writeFile(resolve(source, 'scene.ts'), `
import {TouchControls} from '/web/src/input/touch.ts';
import {createGameOptions} from '/web/src/hud/gameOptions.ts';
const touch=new TouchControls(document.querySelector('canvas')!,true), changes:boolean[]=[], recentered:boolean[]=[];
const withoutRecenter=new URLSearchParams(location.search).has('without-recenter');
const options=createGameOptions({launcher:document.querySelector('#options')!,tankControls:()=>false,toggleMovement(){},
  recenter:withoutRecenter?undefined:()=>recentered.push(options.modalOpen),
  onModalChange(open){changes.push(open);if(open)touch.reset();}});
window.optionsSmoke={read:()=>({open:options.modalOpen,changes:[...changes],recentered:[...recentered],touch:touch.read()}),destroy:()=>options.destroy()};
`);
await build({ configFile: false, root, publicDir: false, logLevel: 'warn', build: {
  outDir: bundle, emptyOutDir: true, rollupOptions: { input: resolve(source, 'index.html') },
} });
const relativeHtml = resolve(source, 'index.html').slice(root.length + 1);
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  if (path === '/favicon.ico') { response.writeHead(204).end(); return; }
  const file = path === '/' ? resolve(bundle, relativeHtml) : resolve(bundle, `.${path}`);
  if (!file.startsWith(`${bundle}/`)) { response.writeHead(403).end(); return; }
  try { response.setHeader('Content-Type', ({ '.js': 'application/javascript', '.css': 'text/css' })[extname(file)] ?? 'text/html'); response.end(await readFile(file)); }
  catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const report = { checkedAt: new Date().toISOString(), checks: [], errors: [], passed: false };
let browser, page;
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-webgl'] });
  page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => !!window.optionsSmoke);
  const cdp = await page.context().newCDPSession(page);
  const dispatch = (type, points = []) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  const read = () => page.evaluate(() => window.optionsSmoke.read());
  const centre = async selector => { const b = await page.locator(selector).boundingBox(); assert.ok(b); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const stick = await centre('.gtasf-touch .stick'), launcher = await centre('#options');
  const held = { x: stick.x, y: stick.y - 54, id: 1 };
  await dispatch('touchStart', [held]);
  assert.ok((await read()).touch.actions.includes('run'));
  await dispatch('touchStart', [held, { ...launcher, id: 2 }]);
  let state = await read(); report.checks.push({ name: 'second finger opens options while stick remains held', state });
  assert.equal(state.open, true); assert.deepEqual(state.changes, [true]);
  assert.deepEqual(state.touch.move, { x: 0, y: 0 }); assert.equal(state.touch.actions.includes('run'), false);
  await dispatch('touchCancel');
  await page.getByRole('button', { name: 'Close ×', exact: true }).click();
  await page.waitForFunction(() => window.optionsSmoke.read().changes.length === 2);
  await page.locator('#options').tap(); assert.equal((await read()).open, true);
  await page.getByRole('button', { name: 'Close ×', exact: true }).click();
  await page.waitForFunction(() => window.optionsSmoke.read().changes.length === 4);
  await page.locator('#options').focus(); await page.keyboard.press('Enter');
  assert.equal((await read()).open, true);
  report.checks.push({ name: 'primary tap and keyboard Enter retained', state: await read() });

  await page.getByRole('button', { name: 'Recenter view', exact: true }).tap();
  state = await read(); assert.equal(state.open, false); assert.deepEqual(state.recentered, [false]);
  assert.deepEqual(state.touch.move, { x: 0, y: 0 });
  await page.locator('#options').tap();
  await page.getByRole('button', { name: 'Recenter view', exact: true }).focus();
  await page.keyboard.press('Enter');
  state = await read(); assert.equal(state.open, false); assert.deepEqual(state.recentered, [false, false]);
  assert.deepEqual(state.changes, [true, false, true, false, true, false, true, false]);
  report.checks.push({ name: 'touch and keyboard recenter invoke once after the menu releases its modal', state });

  await page.locator('#options').tap();
  await page.evaluate(() => window.optionsSmoke.destroy());
  await dispatch('touchStart', [held]); await dispatch('touchStart', [held, { ...launcher, id: 2 }]);
  await dispatch('touchCancel'); await page.locator('#options').click();
  state = await read(); assert.equal(state.open, false); assert.equal(await page.locator('dialog').count(), 0);
  assert.deepEqual(state.changes, [true, false, true, false, true, false, true, false, true, false]);
  assert.deepEqual(state.recentered, [false, false]);
  report.checks.push({ name: 'destroy removes both launch paths', state });

  await page.goto(`http://127.0.0.1:${server.address().port}/?without-recenter`);
  await page.waitForFunction(() => !!window.optionsSmoke);
  await page.locator('#options').tap();
  assert.equal(await page.getByRole('button', { name: 'Recenter view', exact: true }).count(), 0);
  assert.equal((await read()).open, true);
  await page.getByRole('button', { name: 'Close ×', exact: true }).tap();
  assert.equal((await read()).open, false);
  report.checks.push({ name: 'omitted callback leaves the normal options usable without a recenter control', state: await read() });
  assert.deepEqual(report.errors, []); report.passed = true;
} catch (error) {
  report.failure = String(error); process.exitCode = 1;
} finally {
  await browser?.close(); await new Promise(done => server.close(done));
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
