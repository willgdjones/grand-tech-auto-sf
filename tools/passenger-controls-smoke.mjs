/** Physical touch on the actual controls module. This is not a native-game or device gate. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build } from 'vite';

const root = resolve(import.meta.dirname, '..');
const out = resolve(process.env.GTASF_PASSENGER_OUT ?? 'artifacts/passenger-controls/dom');
const source = resolve(out, 'source'), bundle = resolve(out, 'bundle');
await mkdir(source, { recursive: true });
await writeFile(resolve(source, 'index.html'), `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Passenger touch controls</title><style>body{margin:0;background:#263f44}canvas{width:100vw;height:100vh;display:block}</style>
<canvas></canvas><script type="module" src="./scene.ts"></script>`);
await writeFile(resolve(source, 'scene.ts'), `
import {TouchControls} from '/web/src/input/touch.ts';
const touch=new TouchControls(document.querySelector('canvas')!,true);
window.passengerSmoke={setMode:(mode,cable)=>touch.setMode(mode,cable),read:()=>touch.read(),reset:()=>touch.reset(),dispose:()=>touch.dispose()};
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
const report = { at: new Date().toISOString(), checks: [], errors: [], passed: false };
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-webgl'] });
  const page = await browser.newPage({ viewport: { width: 393, height: 852 }, hasTouch: true, isMobile: true });
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => !!window.passengerSmoke);
  const cdp = await page.context().newCDPSession(page);
  const dispatch = (type, points = []) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  const read = () => page.evaluate(() => window.passengerSmoke.read());
  const mode = (value, cable = false) => page.evaluate(([v, c]) => window.passengerSmoke.setMode(v, c), [value, cable]);
  const centre = async selector => { const b = await page.locator(selector).boundingBox(); assert.ok(b); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const labels = () => page.locator('.gtasf-touch button:visible').allTextContents();
  const neutral = state => { assert.deepEqual(state.move, { x: 0, y: 0 }); assert.deepEqual(state.actions, []); };
  const walkingLabels = ['Enter / exit', 'Hail', 'Map'];
  const drivingLabels = ['Go', 'Brake', 'H-brake', 'Enter / exit', 'Hail', 'Horn', 'Map'];
  assert.deepEqual(await labels(), walkingLabels);
  assert.equal(await page.locator('.stick-hint').isVisible(), true);
  const walkingStick = await centre('.stick');
  await dispatch('touchStart', [{ x: walkingStick.x, y: walkingStick.y - 28, id: 10 }]);
  let state = await read(); assert.equal(state.move.y, .5); assert.deepEqual(state.actions, []);
  await dispatch('touchMove', [{ x: walkingStick.x, y: walkingStick.y - 54, id: 10 }]);
  state = await read(); assert(state.move.y > .9); assert.deepEqual(state.actions, ['run']);
  await mode('on-foot'); assert((await read()).actions.includes('run'), 'Unchanged walking mode preserves the stick');
  await dispatch('touchCancel'); neutral(await read());
  for (const [name, action] of [['Enter / exit', 'enter-exit'], ['Hail', 'hail'], ['Map', 'map']]) {
    await page.getByRole('button', { name, exact: true }).tap();
    assert.deepEqual((await read()).actions, [action]); assert.deepEqual((await read()).actions, []);
  }
  await dispatch('touchStart', [{ x: 150, y: 260, id: 11 }]);
  await dispatch('touchMove', [{ x: 180, y: 280, id: 11 }]);
  state = await read(); assert(state.look.x > 0 && state.look.y > 0); neutral(state);
  await dispatch('touchEnd');
  await page.screenshot({ path: resolve(out, 'walking.png') });
  report.checks.push('fresh walking layout retains partial walk, full run, look and three once-only action taps');
  await mode('driver');
  assert.deepEqual(await labels(), drivingLabels);
  assert.equal(await page.locator('.stick-hint').isVisible(), false);
  const stick = await centre('.stick'), go = await centre('[data-action=throttle]');
  const held = [{ x: stick.x + 24, y: stick.y - 48, id: 1 }, { ...go, id: 2 }];
  await dispatch('touchStart', [held[0]]); await dispatch('touchStart', held);
  state = await read(); assert(state.move.x > 0 && state.move.y > 0 && state.actions.includes('throttle'));
  await mode('driver'); assert((await read()).actions.includes('throttle'), 'Unchanged frame preserves held driving');
  await mode('passenger', true);
  neutral(await read());
  await dispatch('touchMove', [{ ...held[0], x: stick.x + 30 }, held[1]]);
  neutral(await read()); await dispatch('touchCancel');
  assert.deepEqual(await labels(), ['Exit ride', 'Bell', 'Map']);
  assert.equal(await page.locator('.stick').isVisible(), false);
  report.checks.push('boarding releases held stick/pedals and stale pointers cannot restore them');

  await dispatch('touchStart', [{ x: 150, y: 260, id: 3 }]);
  await dispatch('touchMove', [{ x: 180, y: 280, id: 3 }]);
  state = await read(); assert(state.look.x > 0 && state.look.y > 0); assert.deepEqual(state.move, { x: 0, y: 0 });
  await dispatch('touchEnd');
  for (const [name, action] of [['Bell', 'horn'], ['Exit ride', 'enter-exit'], ['Map', 'map']]) {
    await page.getByRole('button', { name, exact: true }).tap();
    assert.deepEqual((await read()).actions, [action]);
    assert.deepEqual((await read()).actions, []);
  }
  report.checks.push('passenger camera drag and Bell, Exit ride, Map taps work once each');
  await page.screenshot({ path: resolve(out, 'cable-passenger.png') });

  const bell = await centre('[data-action=horn]');
  await dispatch('touchStart', [{ ...bell, id: 4 }]);
  await mode('on-foot'); neutral(await read());
  await dispatch('touchEnd'); neutral(await read());
  assert.equal(await page.locator('.stick').isVisible(), true);
  assert.deepEqual(await labels(), walkingLabels);
  report.checks.push('exit clears a pending bell tap and restores walking controls');

  for (const action of ['throttle', 'brake', 'handbrake']) {
    await mode('driver');
    const pedal = await centre(`[data-action=${action}]`);
    await dispatch('touchStart', [{ ...pedal, id: 12 }]);
    assert((await read()).actions.includes(action));
    await mode('on-foot'); neutral(await read());
    await dispatch('touchMove', [{ x: pedal.x + 1, y: pedal.y, id: 12 }]); neutral(await read());
    await dispatch('touchEnd'); neutral(await read());
    assert.deepEqual(await labels(), walkingLabels);
  }
  report.checks.push('exiting while Go, Brake or H-brake is held clears each control and ignores stale pointers');

  await mode('passenger');
  assert.deepEqual(await labels(), ['Exit ride', 'Map']);
  await dispatch('touchStart', [{ x: 140, y: 240, id: 5 }]);
  await dispatch('touchMove', [{ x: 110, y: 230, id: 5 }]);
  state = await read(); assert(state.look.x < 0); assert.deepEqual(state.actions, []);
  await dispatch('touchEnd');
  report.checks.push('autonomous taxi retains look, exit and map without inert pedals or bell');
  await page.screenshot({ path: resolve(out, 'taxi-passenger.png') });

  await mode('driver');
  await dispatch('touchStart', [held[0]]); await dispatch('touchStart', held);
  state = await read(); assert(state.move.x > 0 && state.actions.includes('throttle'));
  await page.evaluate(() => window.passengerSmoke.reset()); neutral(await read());
  await dispatch('touchCancel');
  await page.evaluate(() => window.passengerSmoke.dispose());
  assert.equal(await page.locator('.gtasf-touch').count(), 0);
  report.checks.push('driver controls return, modal reset releases them and disposal removes UI');
  assert.deepEqual(report.errors, []); report.passed = true;
} catch (error) { report.failure = error.stack ?? String(error); process.exitCode = 1; }
finally {
  await browser?.close(); await new Promise(done => server.close(done));
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
}
