/** Actual native WebGL depth/pixel smoke, not phone performance evidence. Run via tools/heavy.sh. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { platform } from 'node:os';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const out = resolve('docs/perf/sky-depth-c8sj'), bundle = resolve('artifacts/sky-depth-c8sj');
await mkdir(out, { recursive: true }); await mkdir(bundle, { recursive: true });
const report = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  scope: 'Component smoke: compare current HD sky with Low using native GPU occlusion queries and pixel readback. No FPS/device gate claim.',
  errors: [], cases: [], passed: false };
const entry = `
import { Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Scene, WebGLRenderer } from 'three';
import { createSky } from './web/src/render/sky';
const renderer = new WebGLRenderer({antialias:false,preserveDrawingBuffer:true});
renderer.setSize(256,256);document.body.append(renderer.domElement);
const camera = new PerspectiveCamera(60,1,.1,100), gl = renderer.getContext();
const ext = gl.getExtension('WEBGL_debug_renderer_info');
window.gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
async function draw(low, kind) {
  const scene = new Scene(), sky = createSky(low), geometry = new PlaneGeometry(1,1);
  const solid = new MeshBasicMaterial({color:'#b34b23'}), glass = new MeshBasicMaterial({color:'#267acc',transparent:true,opacity:.45});
  scene.add(sky.mesh);sky.update(camera,0);
  // Keep stars present as well as clouds, so the pixel comparison covers both shader paths.
  sky.mesh.material.uniforms.night.value=.55;
  if (kind !== 'empty') {
    const plane = new Mesh(geometry,solid);plane.position.z=kind==='beyond-dome'?-95:-3;
    plane.scale.setScalar(kind==='partial'?1.8:kind==='beyond-dome'?200:20);scene.add(plane);
  }
  if (kind==='partial') {
    const transparent = new Mesh(geometry,glass);transparent.position.set(1.1,0,-2.5);scene.add(transparent);
  }
  renderer.render(scene,camera); // Compile before opening the actual occlusion query.
  const query = gl.createQuery();
  sky.mesh.onBeforeRender=()=>gl.beginQuery(gl.ANY_SAMPLES_PASSED,query);
  sky.mesh.onAfterRender=()=>gl.endQuery(gl.ANY_SAMPLES_PASSED);
  renderer.render(scene,camera);
  const pixels = new Uint8Array(256*256*4);gl.readPixels(0,0,256,256,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  const start = performance.now();
  while(!gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE)) {
    if(performance.now()-start>5000)throw new Error('Occlusion query timed out');
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  const skySamplesPassed = Boolean(gl.getQueryParameter(query,gl.QUERY_RESULT)), glError=gl.getError();
  gl.deleteQuery(query);sky.dispose();geometry.dispose();solid.dispose();glass.dispose();
  return {pixels,skySamplesPassed,glError,center:Array.from(pixels.slice((128*256+128)*4,(128*256+128)*4+4))};
}
window.runCase = async kind => {
  const control=await draw(false,kind), low=await draw(true,kind);
  let maxChannelDelta=0,changedChannels=0;
  for(let i=0;i<control.pixels.length;i++) {
    const delta=Math.abs(control.pixels[i]-low.pixels[i]);maxChannelDelta=Math.max(maxChannelDelta,delta);if(delta)changedChannels++;
  }
  return {kind,maxChannelDelta,changedChannels,control:{skySamplesPassed:control.skySamplesPassed,glError:control.glError,center:control.center},
    low:{skySamplesPassed:low.skySamplesPassed,glError:low.glError,center:low.center}};
};`;
await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'js' }, bundle: true,
  platform: 'browser', format: 'esm', outfile: `${bundle}/fixture.js`, logLevel: 'warning' });
const server = createServer(async (req, res) => {
  if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  if (req.url === '/fixture.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(await readFile(`${bundle}/fixture.js`)); return; }
  if (req.url !== '/') { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<!doctype html><body style="margin:0;background:#151c28;color:white;font:16px sans-serif"><p>Low sky · depth and pixel smoke</p><script type="module" src="/fixture.js"></script>');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
let browser;
try {
  browser = await chromium.launch({ headless: true,
    args: platform() === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : [] });
  const page = await browser.newPage({ viewport: { width: 390, height: 400 } });
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForFunction(() => window.runCase);
  report.gpu = await page.evaluate(() => window.gpu);
  for (const kind of ['empty', 'partial', 'full', 'beyond-dome']) {
    const item = await page.evaluate(kind => window.runCase(kind), kind); report.cases.push(item);
    await page.screenshot({ path: `${out}/${kind}.png` });
    assert.equal(item.control.glError, 0); assert.equal(item.low.glError, 0);
    assert.ok(item.maxChannelDelta <= 1, `${kind}: visible sky/foreground pixels changed`);
    assert.equal(item.control.skySamplesPassed, true, `${kind}: control should shade sky first`);
    assert.equal(item.low.skySamplesPassed, kind === 'empty' || kind === 'partial', `${kind}: Low sky depth rejection`);
    if (kind === 'full' || kind === 'beyond-dome') assert.deepEqual(item.low.center.slice(0, 3), [179,75,35]);
  }
  assert.deepEqual(report.errors, []); report.passed = true;
} catch (error) { report.failure = error.stack ?? String(error); process.exitCode = 1; }
finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(done => server.close(done));
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
