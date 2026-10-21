import { build } from 'vite';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
import { weatherFromSources } from '../worker/src/weather.ts';

const root = process.cwd(), out = resolve(root, 'artifacts/weather'), source = resolve(out, 'source');
const raw = await Promise.all(['nws-point', 'nws-hourly', 'ksfo-observation'].map(name => readFile(resolve(out, name + '.json'), 'utf8').then(JSON.parse)));
const reading = weatherFromSources(Date.now(), raw[1], raw[2], raw[0].properties.forecastHourly);
assert(reading && reading.status === 'live', 'Refresh the real NWS source files first');
await mkdir(source, { recursive: true });
await writeFile(resolve(out, 'real-source-smoke.json'), JSON.stringify(reading, null, 2));
await writeFile(resolve(source, 'check.ts'), `
import {PerspectiveCamera} from 'three';
import {createRenderFoundation} from '/web/src/render/foundation.ts';
import {loadLombardWorld} from '/web/src/render/chunks/world.ts';
import {loadAvatarTemplate} from '/web/src/avatar/riggedAvatar.ts';
const low=innerWidth<700,canvas=document.querySelector('canvas');
let time=Date.parse('2026-10-03T00:36:00-07:00');
const foundation=createRenderFoundation({canvas,tier:low?'low':'medium',atmosphere:true,weather:true,sun:true,now:()=>time});
foundation.resize(innerWidth,innerHeight);
const camera=new PerspectiveCamera(58,innerWidth/innerHeight,.08,1000);
const layout=await fetch('/art/road-details.json').then(r=>r.json());
const road=layout.roads.filter(r=>r.name==='Columbus Avenue').sort((a,b)=>b.points.length-a.points.length)[0];
const mid=road.points.length/2|0,p=road.points[mid],q=road.points[Math.min(mid+5,road.points.length-1)];
const focus={x:p[0],z:p[2]},dx=q[0]-p[0],dz=q[2]-p[2],n=Math.hypot(dx,dz),tx=dx/n,tz=dz/n;
const world=await loadLombardWorld({mountGeometry:foundation.mountGeometry,tier:low?'low':'medium',position:focus,enabled:true});
await world.ensureAround(focus);
const template=await loadAvatarTemplate(),avatar=template.createInstance();foundation.scene.add(avatar.root);
avatar.root.position.set(p[0],world.surfaceHeightAt(p[0],p[2])??p[1],p[2]);avatar.root.rotation.y=Math.atan2(tx,tz);avatar.update(0,'idle');
const x=p[0]-tx*7,z=p[2]-tz*7;
camera.position.set(x,(world.surfaceHeightAt(x,z)??p[1])+3.2,z);camera.lookAt(p[0]+tx*35,p[1]+3,p[2]+tz*35);
let frame;function render(){world.update(focus);foundation.render(camera,true,0);frame=requestAnimationFrame(render);}render();
await foundation.facadeAtlas.ready;await foundation.roadTextures.ready;await foundation.shopfrontSigns.ready;
window.weatherCheck={
 view(day=false){
  time=Date.parse(day?'2026-10-03T13:00:00-07:00':'2026-10-03T00:36:00-07:00');foundation.render(camera,true,0);
  return {day,weather:{...foundation.weather.stats},reading:foundation.weather.current(),fogNear:foundation.haze.near,fogFar:foundation.haze.far,
   sunIntensity:foundation.sun.intensity,sunDirection:foundation.sun.position.toArray(),ambient:foundation.ambient.intensity,
   cloudCover:foundation.sky.mesh.material.uniforms.cloudCover.value,weatherWeight:foundation.sky.mesh.material.uniforms.weatherWeight.value,
   night:foundation.facadeAtlas.uniforms.uFacadeNight.value,map:{...world.stats},drawCalls:foundation.renderer.info.render.calls};
 },
 dispose(){cancelAnimationFrame(frame);avatar.dispose();template.dispose();world.dispose();foundation.dispose();return {...foundation.weather.stats};}
};
`);
await build({ configFile: false, root, publicDir: false, logLevel: 'warn', resolve: { alias: [{ find: /^@gtasf\/shared\/(.*)$/, replacement: resolve(root, 'shared') + '/$1' }] }, build: { outDir: resolve(out, 'app'), emptyOutDir: true, target: 'es2022', reportCompressedSize: false, lib: { entry: resolve(source, 'check.ts'), formats: ['es'], fileName: 'check' } } });
let weatherRequests = 0;
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://local').pathname;
  if (path === '/api/weather') { weatherRequests++; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(reading)); return; }
  if (path === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}canvas{width:100vw;height:100vh;display:block}</style><canvas></canvas><script type="module" src="/check.js"></script>'); return; }
  if (path === '/favicon.ico') { res.writeHead(204).end(); return; }
  const map = path.startsWith('/map/lombard/'), base = map ? resolve(root, 'tools/map/out/lombard') : path.startsWith('/art/') || path.startsWith('/assets/') ? resolve(root, 'web/public') : resolve(out, 'app');
  const file = resolve(base, '.' + (map ? path.slice(12) : path));
  if (!file.startsWith(base + '/')) { res.writeHead(403).end(); return; }
  try { res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png' })[extname(file)] ?? 'application/octet-stream'); res.end(await readFile(file)); } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
let browser; const evidence = [];
try {
  browser = await chromium.launch({ headless: true });
  for (const [name, width, height] of [['desktop', 1100, 720], ['phone', 390, 844]]) {
    const page = await browser.newPage({ viewport: { width, height } }), errors = [], httpErrors = [];
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('response', r => { if (r.status() >= 400) httpErrors.push(r.url() + ': ' + r.status()); });
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.waitForFunction(() => window.weatherCheck && window.weatherCheck.view().weatherWeight > .7 && window.weatherCheck.view().map.loading === 0, undefined, { timeout: 60_000 });
    const night = await page.evaluate(() => window.weatherCheck.view());
    assert.equal(night.weather.state, 'live'); assert.equal(night.weather.errors, 0); assert.equal(night.weather.requests, 1);
    assert.equal(night.sunIntensity, 0); assert(night.ambient >= 2.25); assert.equal(night.night, 1);
    assert(night.fogNear >= 55 && night.fogFar >= 260); assert.deepEqual(night.map.errors, []);
    await page.screenshot({ path: resolve(out, name + '-night.png') });
    let day;
    if (name === 'desktop') {
      day = await page.evaluate(() => window.weatherCheck.view(true)); assert(day.sunIntensity > 0); assert(day.sunDirection[1] > 0); assert.equal(day.night, 0);
      await page.screenshot({ path: resolve(out, name + '-day.png') });
    }
    const disposed = await page.evaluate(() => window.weatherCheck.dispose()); assert.equal(disposed.state, 'disposed');
    evidence.push({ name, scope: 'Actual source readings and local renderer; no native Worker/deployment/device acceptance', night, day, disposed, errors, httpErrors });
    await writeFile(resolve(out, 'evidence.json'), JSON.stringify(evidence, null, 2));
    assert.deepEqual(errors, []); assert.deepEqual(httpErrors, []); await page.close();
  }
  assert.equal(weatherRequests, 2);
  console.log(JSON.stringify({ evidence: 'artifacts/weather/evidence.json', weatherRequests, views: 3, errors: [] }));
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
