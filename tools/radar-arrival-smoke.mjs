/** Actual radar/guidance modules with fixture roads; no native game or performance claim. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

const stage = process.env.GTASF_RADAR_ARRIVAL_STAGE === 'before' ? 'before' : 'after';
const out = resolve('artifacts/radar-arrival', stage);
await mkdir(out, { recursive: true });
const config = { configFile: false, root: out, logLevel: 'warn',
  resolve: { alias: { '@gtasf/shared': resolve('shared') } },
  build: { target: 'es2022', outDir: `${out}/app`, emptyOutDir: true, reportCompressedSize: false } };
await writeFile(`${out}/index.html`, '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Radar arrival fixture</title><script type="module" src="/entry.js"></script>');
await writeFile(`${out}/entry.js`, `import {Group} from 'three';
import {createRouteGuidance} from '${resolve('web/src/navigation/guidance.ts')}';
import {createRadar} from '${resolve('web/src/radar/radar.ts')}';
const scene=new Group(),graph={version:1,nodes:[{id:'a',x:0,y:0,z:0},{id:'b',x:500,y:0,z:0}],edges:[{id:'lane:fixture',from:'a',to:'b',lengthM:500,speedMps:10,lane:1,points:[[0,0,0],[500,0,0]]}]};
const stop={id:'local-stop',title:'Local plaza stop',x:200,y:0,z:30};
let radar,guidance,arrivals=[],groundMode='loaded',now=1000,goldPaths=0;
const stroke=CanvasRenderingContext2D.prototype.stroke;
CanvasRenderingContext2D.prototype.stroke=function(...args){if(args[0] instanceof Path2D&&this.strokeStyle==='#f7d55b')goldPaths++;return stroke.apply(this,args);};
window.fixture={async reset({event=false,ground='loaded'}={}){
  radar?.destroy();guidance?.destroy();arrivals=[];groundMode=ground;now=1000;
  radar=createRadar({graph,routeGraph:graph,frame:{origin:{lat:37.7955,lon:-122.3937},gridRotationDeg:0},autoLoad:false,enabled:true,landmarks:[stop],onSelect:value=>guidance.setDestination(value)});
  await radar.routingReady;radar.update({x:0,y:0,z:0},0);
  guidance=createRouteGuidance({scene,enabled:true,surfaceHeightAt(x,z){if(x===200&&z===30){if(groundMode==='unloaded')return null;if(groundMode==='other-floor')return 20;}return 0;},onArrive:value=>arrivals.push(value.id)});
  this.select({...stop,...(event?{event:{id:'source-event',title:'Source event'}}:{})});
},select(target){const route=radar.setDestination(target);if(route||target===null)guidance.setDestination(target);return !!route;},
step(position,canArrive=true){now+=250;goldPaths=0;radar.update(position,0);guidance.update(position,radar.route,'on-foot',canArrive,now);radar.setNavigationComplete?.(guidance.arrived??false);return this.state();},
state(){return {gpsHidden:guidance.element.hidden,radarHidden:radar.element.querySelector('.gt-radar-navigation').hidden,radarText:radar.element.querySelector('.gt-radar-navigation').textContent,routePoints:radar.route?.points.length??0,arrivals:[...arrivals],goldPaths};},
reject(){return radar.setDestination({...stop,x:10000})===null;},
destroy(){radar.destroy();guidance.destroy();return {sceneChildren:scene.children.length,radars:document.querySelectorAll('.gt-radar').length,guidance:document.querySelectorAll('.gt-gps-status').length};}};
await window.fixture.reset();window.fixture.ready=true;
`);
await build(config);
const server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } });
let browser;
const report = { stage, scope: 'Actual radar and guidance modules; supplied road and ground fixtures, GPU disabled', cases: [], errors: [], passed: false };
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu', '--disable-webgl'] });
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  await page.goto(server.resolvedUrls.local[0]); await page.waitForFunction(() => window.fixture?.ready);
  const nearby = { x: 200, y: 0, z: 30 }, far = { x: 0, y: 0, z: 0 };
  async function check(name, position, options = {}, completed = false, canArrive = true) {
    const result = await page.evaluate(async ({ position, options, canArrive }) => {
      await window.fixture.reset(options); return window.fixture.step(position, canArrive);
    }, { position, options, canArrive });
    assert.equal(result.gpsHidden, completed, name);
    assert.equal(result.radarHidden, completed && stage === 'after', name);
    assert.ok(result.routePoints > 1, 'Retain the selected route data');
    report.cases.push({ name, result }); return result;
  }
  await check('Distant stop retains directions', far);
  await page.waitForTimeout(80);
  assert.ok((await page.evaluate(p => window.fixture.step(p), far)).goldPaths > 0, 'Active route is painted');
  await check('Exact local arrival completes both displays', nearby, {}, true);
  await page.waitForTimeout(80);
  const settled = await page.evaluate(p => window.fixture.step(p), nearby);
  assert.equal(settled.goldPaths > 0, stage === 'before', 'Completed road route is no longer painted');
  assert.equal(await page.evaluate(() => window.fixture.reject()), true);
  assert.equal((await page.evaluate(() => window.fixture.state())).radarHidden, stage === 'after', 'Rejected choice preserves arrival state');
  await page.evaluate(() => window.fixture.select({id:'next',title:'Next stop',x:400,y:0,z:0}));
  const next = await page.evaluate(p => window.fixture.step(p), nearby);
  assert.equal(next.gpsHidden, false); assert.equal(next.radarHidden, false, 'New accepted choice restores directions');
  report.cases.push({ name: 'New destination restores directions', result: next });
  await check('Wrong elevation retains directions', { ...nearby, y: 12 });
  await check('Unloaded local stop retains directions', nearby, { ground: 'unloaded' });
  await check('Other floor retains directions', nearby, { ground: 'other-floor' });
  await check('Open panel defers completion', nearby, {}, false, false);
  const resumed = await page.evaluate(p => window.fixture.step(p), nearby);
  assert.equal(resumed.gpsHidden, true); assert.equal(resumed.radarHidden, stage === 'after');
  await page.evaluate(() => window.fixture.select({id:'local-stop',title:'Local plaza stop',x:200,y:0,z:30}));
  assert.equal((await page.evaluate(p => window.fixture.step(p), nearby)).radarHidden, stage === 'after', 'Repeated destination can complete again');
  await check('Event exact point cannot bypass road approach', nearby, { event: true });
  const event = await check('Event road approach completes once', { x: 200, y: 0, z: 0 }, { event: true }, true);
  assert.deepEqual(event.arrivals, ['source-event']);
  assert.deepEqual((await page.evaluate(() => window.fixture.step({x:200,y:0,z:0}))).arrivals, ['source-event']);
  await page.evaluate(() => window.fixture.select(null));
  assert.equal((await page.evaluate(p => window.fixture.step(p), far)).radarHidden, true);
  assert.deepEqual(await page.evaluate(() => window.fixture.destroy()), { sceneChildren: 0, radars: 0, guidance: 0 });
  assert.deepEqual(report.errors, []); report.passed = true;
  console.log(JSON.stringify({ stage, passed: true, cases: report.cases.length, errors: report.errors }));
} finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
  await browser?.close(); server.httpServer.closeAllConnections(); await new Promise(done => server.httpServer.close(done));
}
