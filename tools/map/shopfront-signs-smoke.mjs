/** Focused material/placement smoke through the actual chunk streamer; no Worker or game state edits. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { build } from 'vite';
import { chromium } from '@playwright/test';

const root = process.cwd(), output = resolve('tools/map/out/shopfront-signs-smoke');
const source = resolve(output, 'source'), app = resolve(output, 'app');
await mkdir(source, { recursive: true });
if (!process.argv.includes('--run-only')) {
  await writeFile(resolve(source, 'check.ts'), `
import {PerspectiveCamera} from 'three';
import {createRenderFoundation} from '/web/src/render/foundation.ts';
import {loadLombardWorld} from '/web/src/render/chunks/world.ts';
const f=createRenderFoundation({canvas:document.querySelector('canvas'),enabled:true,atmosphere:true,now:()=>Date.parse('2026-10-03T11:00:00-07:00'),tier:innerWidth<700?'low':'medium'});
f.resize(innerWidth,innerHeight);
const camera=new PerspectiveCamera(55,innerWidth/innerHeight,.08,900);
let world,position={x:1196.87,z:-1224.31},running=true;
function frame(){if(!running)return;world?.update(position);f.render(camera,true);requestAnimationFrame(frame);}frame();
window.signCheck={
 async load(place){position=place==='lombard'?{x:-1041.86,z:-1975.20}:{x:1196.87,z:-1224.31};world=await loadLombardWorld({enabled:true,position,tier:innerWidth<700?'low':'medium',mountGeometry:f.mountGeometry,baseUrl:'/map/'});await f.shopfrontSigns.ready;await f.facadeAtlas.ready;return true;},
 ready(){return world&&!world.stats.loading&&!world.stats.queuedUploads&&f.shopfrontSigns.stats.signs>0;},
 inspect(){const distance=innerWidth<700?12:9;const signs=[];f.scene.traverse(o=>{if(o.userData.gtasfShopfrontSigns)signs.push(...o.userData.gtasfShopfrontSigns);});const chosen=signs.sort((a,b)=>Math.hypot(a.centre[0]-position.x,a.centre[2]-position.z)-Math.hypot(b.centre[0]-position.x,b.centre[2]-position.z)).find(s=>!world.collides(s.centre[0]+s.normal[0]*distance,s.centre[1],s.centre[2]+s.normal[1]*distance,.3,.8));if(!chosen)throw Error('No unobstructed source-wall sign view');const [x,y,z]=chosen.centre,[nx,nz]=chosen.normal;camera.position.set(x+nx*distance+nz,y+.3,z+nz*distance-nx);camera.lookAt(x,y,z);return{stats:{...f.shopfrontSigns.stats},chosen,ids:signs.map(s=>s.id),maxBatch:Math.max(...f.scene.children.map(c=>c.children.find(o=>o.name==='Shopfront signs')?.userData.gtasfShopfrontSigns?.length??0)),map:{...world.stats}};},
 dispose(){running=false;world.dispose();const afterChunk={...f.shopfrontSigns.stats};f.dispose();return{afterChunk,afterScene:{...f.shopfrontSigns.stats}};}
};
`);
  await build({ configFile: false, root, publicDir: false, logLevel: 'warn', build: {
    outDir: app, emptyOutDir: true, reportCompressedSize: false,
    lib: { entry: resolve(source, 'check.ts'), formats: ['es'], fileName: 'check' },
  } });
}
if (process.argv.includes('--prepare-only')) { console.log('Prepared shopfront material fixture; no browser started.'); process.exit(0); }
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://local').pathname;
  if (path === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}canvas{width:100vw;height:100vh;display:block}</style><canvas></canvas><script type="module" src="/check.js"></script>'); return; }
  if (path === '/favicon.ico') { response.writeHead(204).end(); return; }
  const base = path.startsWith('/map/') ? resolve(root, 'tools/map/out/lombard') : path.startsWith('/art/') ? resolve(root, 'web/public') : app;
  const file = resolve(base, '.' + (path.startsWith('/map/') ? path.slice(4) : path));
  if (!file.startsWith(base + '/')) { response.writeHead(403).end(); return; }
  try { response.setHeader('Content-Type', ({ '.js': 'text/javascript', '.png': 'image/png', '.json': 'application/json' })[extname(file)] ?? 'application/octet-stream'); response.end(await readFile(file)); }
  catch { response.writeHead(404).end(); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser, page;
const report = { checkedAt: new Date().toISOString(), errors: [], views: [] };
try {
  browser = await chromium.launch({ headless: true, args: process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu'] : [] });
  for (const [name, place, width, height] of [['ferry-desktop','ferry',1280,800],['lombard-phone','lombard',390,844]]) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 700, hasTouch: width < 700 });
    page = await context.newPage(); let imageRequests = 0;
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    page.on('request', request => { if (new URL(request.url()).pathname === '/art/props/shopfront-signs.png') imageRequests++; });
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => window.signCheck);
    await page.evaluate(place => window.signCheck.load(place), place);
    await page.waitForFunction(() => window.signCheck.ready(), undefined, { timeout: 45_000 });
    const sample = await page.evaluate(() => window.signCheck.inspect());
    assert.equal(sample.stats.state, 'ready'); assert.equal(sample.stats.width * sample.stats.height, 262144);
    assert(sample.stats.signs > 0 && sample.maxBatch <= 18); assert.equal(new Set(sample.ids).size, sample.ids.length);
    assert.equal(imageRequests, 1); assert.deepEqual(sample.map.errors, []);
    await page.waitForTimeout(200); await page.screenshot({ path: resolve(output, `${name}.png`) });
    const teardown = await page.evaluate(() => window.signCheck.dispose());
    assert.equal(teardown.afterChunk.signs, 0); assert.equal(teardown.afterChunk.batches, 0); assert.equal(teardown.afterScene.state, 'disposed');
    report.views.push({ name, ...sample, imageRequests, teardown }); await context.close();
  }
  assert.deepEqual(report.errors, []); report.passed = true;
  console.log(JSON.stringify({ passed: true, views: report.views.length, signs: report.views.map(view => view.stats.signs) }));
} catch (error) { report.failure = String(error); await page?.screenshot({ path: resolve(output, 'failed.png') }).catch(() => {}); throw error; }
finally {
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await browser?.close(); server.closeAllConnections(); await new Promise(done => server.close(done));
}
