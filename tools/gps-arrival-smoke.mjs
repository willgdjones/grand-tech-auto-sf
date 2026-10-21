/** Arrival state through the real guidance module and browser DOM; no WebGL or Worker. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build } from 'vite';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, process.env.GTASF_GPS_ARRIVAL_OUT ?? 'artifacts/gps-arrival');
await mkdir(out, { recursive: true });
await writeFile(resolve(out, 'check.ts'), `
import {Group} from 'three';
import {createRouteGuidance} from '/web/src/navigation/guidance.ts';
const scene=new Group(), arrivals:string[]=[];
let ground:number|null=0, time=0;
const guidance=createRouteGuidance({scene,enabled:true,surfaceHeightAt:()=>ground,onArrive:event=>arrivals.push(event.id)})!;
const route={points:[[0,0,0],[100,0,0]] as [number,number,number][],distanceM:100,approach:{x:100,y:0,z:0},destinationDistanceM:0};
const landmark={id:'landmark',title:'Lombard downhill',...route.approach};
const states:any[]=[];
function step(name:string,x:number,y=0,canArrive=true,currentRoute=route){
  guidance.update({x,y,z:0},currentRoute,'on-foot',canArrive,time+=250);
  states.push({name,status:!guidance.element.hidden,marker:guidance.root.getObjectByName('GPS destination')!.visible,
    ribbon:guidance.root.getObjectByName('GPS route ribbon')!.visible,arrivals:[...arrivals]});
}
guidance.setDestination(landmark); step('approaching landmark',0);
step('modal holds arrival',100,0,false);
ground=null; step('unloaded ground holds arrival',100); ground=0;
step('different elevation holds arrival',100,10);
step('landmark reached',100);
step('leaving reached landmark',0);
const event={id:'event',title:'Event destination',lat:37.8,lon:-122.4,approx:false,start:'2026-10-05T18:00:00Z',url:'https://example.com/event'};
guidance.setDestination({...landmark,id:'event',title:event.title,event}); step('new event selection',0);
step('event reached',100); step('event reroute stays complete',100,0,true,{...route});
guidance.destroy();
window.gpsArrival={states,teardown:{sceneChildren:scene.children.length,statusRemoved:!document.querySelector('.gt-gps-status')}};
`);
const app = resolve(out, 'app');
await build({ configFile: false, root, publicDir: false, logLevel: 'warn', build: {
  outDir: app, emptyOutDir: true, reportCompressedSize: false,
  lib: { entry: resolve(out, 'check.ts'), formats: ['es'], fileName: 'check' },
} });
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://local').pathname;
  if (path === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<title>GPS arrival check</title><script type="module" src="/check.js"></script>'); return; }
  if (path === '/favicon.ico') { response.writeHead(204).end(); return; }
  if (path !== '/check.js') { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', 'text/javascript'); response.end(await readFile(resolve(app, 'check.js')));
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const report = { checkedAt: new Date().toISOString(), errors: [], passed: false };
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] });
  const page = await browser.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.gpsArrival);
  Object.assign(report, await page.evaluate(() => window.gpsArrival));
  const state = name => report.states.find(value => value.name === name);
  for (const name of ['approaching landmark', 'modal holds arrival', 'different elevation holds arrival']) {
    assert.equal(state(name).status, true, name); assert.equal(state(name).marker, true, name);
    assert.equal(state(name).ribbon, true, name); assert.deepEqual(state(name).arrivals, []);
  }
  assert.equal(state('unloaded ground holds arrival').status, true);
  assert.equal(state('unloaded ground holds arrival').marker, false);
  for (const name of ['landmark reached', 'leaving reached landmark']) {
    assert.equal(state(name).status, false, name); assert.equal(state(name).marker, false, name);
    assert.equal(state(name).ribbon, false, name); assert.deepEqual(state(name).arrivals, []);
  }
  assert.equal(state('new event selection').status, true); assert.equal(state('new event selection').marker, true);
  for (const name of ['event reached', 'event reroute stays complete']) {
    assert.equal(state(name).status, false, name); assert.equal(state(name).marker, false, name);
    assert.equal(state(name).ribbon, false, name); assert.deepEqual(state(name).arrivals, ['event']);
  }
  assert.deepEqual(report.teardown, { sceneChildren: 0, statusRemoved: true });
  assert.deepEqual(report.errors, []); report.passed = true;
} catch (error) { report.failure = String(error); throw error; }
finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(done => server.close(done));
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: report.passed, failure: report.failure, checks: report.states?.length, errors: report.errors }));
}
