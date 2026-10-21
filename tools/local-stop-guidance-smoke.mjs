/** Actual guidance module with explicit route/ground fixtures; no game or performance claim. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

const stage = process.env.GTASF_LOCAL_STOP_STAGE === 'before' ? 'before' : 'after';
const out = resolve('artifacts/local-stop-guidance', stage);
await mkdir(out, { recursive: true });
const config = { configFile: false, root: out, logLevel: 'warn',
  resolve: { alias: { '@gtasf/shared': resolve('shared') } },
  build: { target: 'es2022', outDir: `${out}/app`, emptyOutDir: true, reportCompressedSize: false } };
await writeFile(`${out}/index.html`, '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Local stop guidance fixture</title><script type="module" src="/entry.js"></script>');
await writeFile(`${out}/entry.js`, `import {Group} from 'three';
import {createRouteGuidance} from '${resolve('web/src/navigation/guidance.ts')}';
const scene=new Group();let guidance,arrivals=[],groundMode='loaded',now=1000;
const stop={id:'local-stop',title:'Local plaza stop',x:0,y:3,z:0};
const route={points:[[-100,3,0],[99,3,0],[99,3,100]],distanceM:299,approach:{x:99,y:3,z:100},destinationDistanceM:141};
window.fixture={reset({event=false,ground='loaded'}={}){
  guidance?.destroy();arrivals=[];groundMode=ground;now=1000;
  guidance=createRouteGuidance({scene,enabled:true,surfaceHeightAt(x,z){
    if(x===0&&z===0){if(groundMode==='unloaded')return null;if(groundMode==='other-floor')return 20;}return 3;
  },onArrive:value=>arrivals.push(value.id)});
  guidance.setDestination({...stop,...(event?{event:{id:'source-event',title:'Source event'}}:{})});
},step(position,canArrive=true){now+=250;guidance.update(position,route,'on-foot',canArrive,now);return this.state();},
state(){return {hidden:guidance.element.hidden,text:guidance.element.textContent,arrivals:[...arrivals],
  marker:guidance.root.getObjectByName('GPS destination').visible,ribbon:guidance.root.getObjectByName('GPS route ribbon').visible,
  progress:guidance.progress};},replace(){guidance.setDestination({...stop,id:'next-stop',x:-200});},
destroy(){guidance.destroy();return {children:scene.children.length,status:document.querySelectorAll('.gt-gps-status').length};}};
window.fixture.reset();
`);
await build(config);
const server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } });
let browser;
const report = { stage, scope: 'Actual guidance module; supplied route and ground fixtures, GPU disabled', cases: [], errors: [], passed: false };
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-webgl'] });
  const page = await browser.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  await page.goto(server.resolvedUrls.local[0]); await page.waitForFunction(() => window.fixture);
  async function check(name, position, options = {}, expectedHidden = false, canArrive = true) {
    const result = await page.evaluate(({ position, options, canArrive }) => {
      window.fixture.reset(options); return window.fixture.step(position, canArrive);
    }, { position, options, canArrive });
    assert.equal(result.hidden, expectedHidden, name);
    if (expectedHidden) { assert.equal(result.marker, false); assert.equal(result.ribbon, false); }
    report.cases.push({ name, result }); return result;
  }
  const nearby = { x: 0, y: 3, z: 5 };
  const result = await check('Exact local stop despite road detour', nearby, {}, stage === 'after');
  assert.ok(result.progress.remainingM > 100, 'Fixture retains a real remaining lane detour');
  await check('Distant local stop still needs directions', { x: 20, y: 3, z: 0 });
  await check('Different elevation is not arrival', { x: 0, y: 12, z: 0 });
  await check('Unloaded local ground is not arrival', nearby, { ground: 'unloaded' });
  await check('Other floor under exact point is not arrival', nearby, { ground: 'other-floor' });
  await check('Active modal defers arrival', nearby, {}, false, false);
  const resumed = await page.evaluate(position => window.fixture.step(position), nearby);
  assert.equal(resumed.hidden, stage === 'after');
  report.cases.push({ name: 'Arrival resumes after modal closes', result: resumed });
  const sourceEvent = await check('Event coordinates retain road approach rule', nearby, { event: true });
  assert.deepEqual(sourceEvent.arrivals, []);
  const approach = { x: 99, y: 3, z: 100 };
  await check('Original non-event road approach still completes', approach, {}, true);
  const eventArrival = await check('Original event road approach still completes', approach, { event: true }, true);
  assert.deepEqual(eventArrival.arrivals, ['source-event']);
  const repeated = await page.evaluate(position => window.fixture.step(position), approach);
  assert.deepEqual(repeated.arrivals, ['source-event'], 'Arrival callback fires once');
  await page.evaluate(() => window.fixture.replace());
  assert.equal((await page.evaluate(position => window.fixture.step(position), nearby)).hidden, false, 'New destination restores directions');
  assert.deepEqual(await page.evaluate(() => window.fixture.destroy()), { children: 0, status: 0 });
  assert.deepEqual(report.errors, []); report.passed = true;
  console.log(JSON.stringify({ stage, passed: true, cases: report.cases.length, errors: report.errors }));
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
  await browser?.close(); server.httpServer.closeAllConnections(); await new Promise(done => server.httpServer.close(done));
}
