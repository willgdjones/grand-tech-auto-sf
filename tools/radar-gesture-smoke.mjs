/** Real radar DOM + native mouse/touch input; fixture roads, no game/API/WebGL. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const stage = process.env.GTASF_GESTURE_STAGE ?? 'after';
assert.ok(['before', 'after'].includes(stage));
const out = resolve(process.env.GTASF_GESTURE_OUT ?? `artifacts/radar-gestures/${stage}`);
const report = { stage, at: new Date().toISOString(), checks: [], errors: [], requests: [], passed: false };
await mkdir(out, { recursive: true });
if (!process.argv.includes('--run-only')) {
  const radarPath = resolve('web/src/radar/radar.ts');
  // A captured source file lets a queued baseline run after the source fix lands.
  const radarSource = await readFile(`${out}/radar-source.ts`, 'utf8').catch(() => readFile(radarPath, 'utf8'));
  await writeFile(`${out}/radar-source.ts`, radarSource);
  report.radarSourceSha256 = createHash('sha256').update(radarSource).digest('hex');
  const entry = `
import './web/src/theme/saTheme.css';
import { flags } from './shared/flags';
import { createRadar } from './web/src/radar/radar';
if (!flags.radar || !flags.fullMap || !flags.saMapStyle || !flags.waypoints) throw Error('Existing local map flags required');
const selected = [], graph = {version:1,nodes:[{id:'a',x:-500,y:0,z:0},{id:'b',x:500,y:0,z:0}],
 edges:[{id:'lane:fixture',from:'a',to:'b',lengthM:1000,speedMps:10,lane:1,points:[[-500,0,0],[500,0,0]]}]};
const radar = createRadar({graph,routeGraph:graph,frame:{origin:{lat:37.7955,lon:-122.3937},gridRotationDeg:0},
 autoLoad:false,onSelect:value=>{selected.push(value);}});
await radar.routingReady;
radar.setEvents([]); radar.toggleMap(true);
const timer = setInterval(()=>radar.update({x:-400,y:0,z:0},0),16);
const canvas = radar.element.querySelector('canvas'); let lastPointer; const pointerEvents=[];
canvas.addEventListener('pointerdown',event=>{lastPointer=event.pointerId;});
for (const type of ['gotpointercapture','lostpointercapture']) canvas.addEventListener(type,event=>pointerEvents.push({type,id:event.pointerId}));
window.fixture = {radar,selected,pointerEvents,get lastPointer(){return lastPointer;},dispose(){clearInterval(timer);radar.destroy();}};
`;
  const bundle = await build({ stdin: { contents: entry, resolveDir: resolve('.'), loader: 'ts' }, bundle: true,
    plugins: [{ name: 'frozen-radar', setup(builder) { builder.onLoad({ filter: /\/radar\/radar\.ts$/ }, args =>
      args.path === radarPath ? { contents: radarSource, loader: 'ts', resolveDir: resolve('web/src/radar') } : undefined); } }],
    alias: { '@gtasf/shared': resolve('shared') }, outfile: `${out}/app.js`, write: false,
    format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'error' });
  for (const file of bundle.outputFiles) await writeFile(file.path, file.contents);
  await writeFile(`${out}/index.html`, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><link rel="stylesheet" href="/app.css"><title>Map gesture smoke</title><style>body{margin:0;background:#304b44;color:white;font:16px Arial}</style></head><body><p>Fixture roads · isolated map gestures · no World connection</p><script type="module" src="/app.js"></script></body></html>`);
}
if (process.argv.includes('--build-only')) process.exit(0);
const server = createServer(async (req, res) => {
  const name = ({ '/': 'index.html', '/app.js': 'app.js', '/app.css': 'app.css' })[(req.url ?? '/').split('?')[0]];
  if (!name) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[extname(name)]);
  res.end(await readFile(`${out}/${name}`));
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  for (const phone of [false, true]) {
    const label = phone ? 'phone' : 'desktop';
    const page = await browser.newPage({ viewport: phone ? { width: 390, height: 844 } : { width: 1100, height: 760 },
      isMobile: phone, hasTouch: phone });
    page.on('pageerror', error => report.errors.push(`${label}: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(`${label}: ${message.text()}`); });
    page.on('request', request => report.requests.push(new URL(request.url()).pathname));
    page.on('websocket', socket => report.errors.push(`Unexpected socket: ${socket.url()}`));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.waitForFunction(() => Boolean(window.fixture));
    const canvas = page.locator('.gt-radar canvas'), session = await page.context().newCDPSession(page);
    const settle = () => page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
    const count = () => page.evaluate(() => window.fixture.selected.length);
    const xy = async (fraction = .57) => { await settle(); const b = await canvas.boundingBox(); return { x: b.x + b.width * fraction, y: b.y + b.height / 2 }; };
    const tap = async point => phone ? page.touchscreen.tap(point.x, point.y) : page.mouse.click(point.x, point.y);
    const check = async (name, action, delta) => {
      const before = await count(); await action(); await settle(); const actual = await count() - before;
      report.checks.push({ viewport: label, name, expected: delta, actual, passed: actual === delta });
    };
    const touches = (type, points = []) => session.send('Input.dispatchTouchEvent', { type,
      touchPoints: points.map((point, id) => ({ ...point, id, radiusX: 2, radiusY: 2, force: 1 })) });
    await check('An ordinary tap accepts one road waypoint', async () => tap(await xy()), 1);
    await check('A drag at fit zoom preserves the accepted waypoint', async () => {
      const a = await xy(.38), b = await xy(.65);
      if (phone) { await touches('touchStart', [a]); await touches('touchMove', [b]); await touches('touchEnd'); }
      else { await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up(); }
    }, 0);
    await check('A fresh tap after dragging is accepted', async () => tap(await xy(.52)), 1);
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click(); await settle();
    await check('A zoomed pan never accepts a waypoint', async () => {
      const a = await xy(.45), b = await xy(.58);
      if (phone) { await touches('touchStart', [a]); await touches('touchMove', [b]); await touches('touchEnd'); }
      else { await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up(); }
    }, 0);
    await page.getByRole('button', { name: 'Zoom out', exact: true }).click(); await settle();
    if (phone) {
      await check('A pinch and its release never accept a waypoint', async () => {
        const a = await xy(.43), b = await xy(.57);
        await touches('touchStart', [a, b]);
        await touches('touchMove', [{ x: a.x - 15, y: a.y }, { x: b.x + 15, y: b.y }]);
        await touches('touchEnd');
      }, 0);
      await check('A cancelled touch never accepts a waypoint', async () => {
        await touches('touchStart', [await xy()]); await touches('touchCancel');
      }, 0);
      await check('A new tap after touch cancellation is accepted', async () => tap(await xy()), 1);
    } else {
      await check('Lost pointer capture cancels the pending click', async () => {
        const p = await xy(); await page.mouse.move(p.x, p.y); await page.mouse.down();
        // Pointerdown sets *pending* capture. Activate it before releasing so Chrome
        // actually emits lostpointercapture rather than cancelling a pending request.
        await page.mouse.move(p.x + 1, p.y);
        const eventsBefore = await page.evaluate(() => window.fixture.pointerEvents.length);
        assert.equal(await page.evaluate(() => window.fixture.pointerEvents.at(-1)?.type), 'gotpointercapture');
        await canvas.evaluate(element => element.releasePointerCapture(window.fixture.lastPointer));
        await page.mouse.move(p.x + 2, p.y); await page.mouse.up();
        assert.ok(await page.evaluate(before => window.fixture.pointerEvents.slice(before).some(event => event.type === 'lostpointercapture'), eventsBefore));
      }, 0);
      await check('A new click after lost capture is accepted', async () => tap(await xy()), 1);
    }
    await check('Closing during a press releases capture and suppresses its trailing click', async () => {
      const p = await xy();
      if (phone) await touches('touchStart', [p]);
      else { await page.mouse.move(p.x, p.y); await page.mouse.down(); }
      await page.keyboard.press('Escape');
      const captured = await canvas.evaluate(element => element.hasPointerCapture(window.fixture.lastPointer));
      report.checks.push({ viewport: label, name: 'Close releases pending pointer capture', passed: captured === false, actual: captured });
      await page.evaluate(() => window.fixture.radar.toggleMap(true)); await settle();
      if (phone) await touches('touchEnd'); else await page.mouse.up();
    }, 0);
    await check('A fresh tap after reopening is accepted', async () => tap(await xy()), 1);
    await page.screenshot({ path: `${out}/${label}.png` });
    await page.evaluate(() => window.fixture.dispose());
    assert.equal(await page.locator('.gt-radar').count(), 0);
    await session.detach(); await page.close();
  }
  assert.deepEqual(report.errors, []);
  assert.equal(report.requests.some(path => path.startsWith('/api/') || path.startsWith('/map/')), false);
  report.passed = report.checks.every(check => check.passed);
  assert.ok(report.passed, JSON.stringify(report.checks.filter(check => !check.passed)));
  console.log('PASS: map gestures preserve intentional waypoint selection');
} catch (error) { report.failure = error.message; process.exitCode = 1; }
finally {
  await writeFile(`${out}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.checks));
  await browser?.close(); server.closeAllConnections(); await new Promise(done => server.close(done));
}
