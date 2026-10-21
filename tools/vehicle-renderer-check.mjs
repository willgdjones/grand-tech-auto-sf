/** One headed, real-GPU vehicle check using the actual loader + render foundation, with no build.
 * Run through tools/heavy.sh. This is a component look check, not a city boot or performance gate.
 */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { nativeMediaBrowser } from './native-media-browser.mjs';

const out = resolve('artifacts/vehicle-renderer', new Date().toISOString().replaceAll(':', '-'));
await mkdir(out, { recursive: true });
const report = { scope: 'Headed real-GPU component check: production vehicle loader and render foundation. Isolated server enables realisticRender for this candidate; shared flags are unchanged. No city boot, phone FPS, or whole-HD-look acceptance.', cases: [], errors: [], passed: false };
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>GTASF vehicle renderer check</title>
<style>body{margin:0;background:#55606a;color:white;font:14px system-ui}canvas{position:fixed;inset:0;width:100%;height:100%}aside{position:absolute;left:12px;bottom:12px;background:#14232ddd;padding:12px;max-width:70vw}h1{font-size:17px;margin:0 0 6px}p{margin:0}</style></head><body><canvas></canvas><aside><h1>Vehicle renderer component check</h1><p id="caption"></p></aside><script type="module">
import { Group, Mesh, PlaneGeometry, MeshLambertMaterial, PerspectiveCamera } from 'three';
import { flags } from '@gtasf/shared/flags';
import { createRenderFoundation } from '/src/render/foundation.ts';
import { loadVehicleTemplate, loadRealisticExtraTemplate } from '/src/vehicles/models/vehicle.ts';
import { graphicsPreset } from '/src/render/graphicsPreset.ts';
const preset=graphicsPreset(), single=new URLSearchParams(location.search).has('single');
const ids=single?['prius']:['prius','model3','outback','robotaxi','vc-supercar','muni-bus','powell-cable-car'];
const foundation=createRenderFoundation({canvas:document.querySelector('canvas'),weather:false,sun:false});
const camera=new PerspectiveCamera(single?38:44,innerWidth/innerHeight,.1,1000);
camera.position.set(...(single?[5,3.5,6]:[23,20,29]));camera.lookAt(0,single?.65:0,0);
foundation.resize(innerWidth,innerHeight,devicePixelRatio);
const floor=new Group(), plane=new Mesh(new PlaneGeometry(70,70),new MeshLambertMaterial({color:'#747b81'}));
plane.rotation.x=-Math.PI/2;plane.position.y=-.025;floor.add(plane);foundation.mountGeometry(floor);
const templates=[],cars=[];
for(const id of ids){
 const template=await loadVehicleTemplate(id);if(!template)throw new Error('Missing vehicle '+id);
 templates.push(template);const car=template.createInstance();cars.push({id,car});foundation.scene.add(car.root);
}
// These must be absent on Low; on HD they preserve the optional realistic fleet variants.
const extras=[];
for(const id of ['cab','van']){const template=await loadRealisticExtraTemplate(id);if(template){templates.push(template);extras.push(id);if(!single){const car=template.createInstance();cars.push({id,car});foundation.scene.add(car.root);}}}
cars.forEach(({car},i)=>{if(!single){car.root.position.set((i%3-1)*7,0,(Math.floor(i/3)-1)*8);car.root.rotation.y=.35;}});
const gl=foundation.renderer.getContext(), info=gl.getExtension('WEBGL_debug_renderer_info');
let frames=0,previous=performance.now();
const check=window.vehicleCheck={ready:false,frames:0,preset,extras,flags:{ps2Render:flags.ps2Render,realisticRender:flags.realisticRender,vehiclePolish:flags.vehiclePolish},
 gpu:info?gl.getParameter(info.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),
 snapshot(){return {preset,extras,flags:this.flags,gpu:this.gpu,frames,renderer:document.getElementById('gt-render-debug')?.textContent??null,cars:cars.map(({id,car})=>{const materials=[];car.root.traverseVisible(o=>{if(o.isMesh)for(const m of Array.isArray(o.material)?o.material:[o.material])materials.push({type:m.type,map:Boolean(m.map),vertexColours:m.vertexColors,colour:m.color?.getHexString()});});return {id,materials};})};}};
document.querySelector('#caption').textContent=preset.toUpperCase()+' · '+(single?'phone close-up':'fleet')+' · golden-hour foundation · '+check.gpu;
function frame(now){const dt=Math.max(0,Math.min(.1,(now-previous)/1000));previous=now;for(const {car} of cars)car.update(dt);foundation.render(camera,true);check.frames=++frames;check.ready=frames>=8;requestAnimationFrame(frame);}requestAnimationFrame(frame);
addEventListener('pagehide',()=>{for(const template of templates)template.dispose();foundation.dispose();},{once:true});
</script></body></html>`;

const server = await createServer({ root: resolve('web'), configFile: resolve('web/vite.config.ts'),
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null },
  plugins: [{ name: 'vehicle-component-check', enforce: 'pre',
    transform(code, id) {
      // The rollback keeps this switch off in the shared checkout. Test both renderer paths on the
      // candidate without editing that file or changing any production flag/entry point.
      if (id === resolve('shared/flags.ts')) return code.replace(/\brealisticRender:\s*(?:true|false)\b/, 'realisticRender: true');
    },
    configureServer(vite) {
    vite.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/__vehicle_check.html') || req.url.includes('html-proxy')) return next();
      try { res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml(req.url, html)); }
      catch (error) { next(error); }
    });
  } }],
});
let native;
try {
  await server.listen();
  native = await nativeMediaBrowser({ gpu: true });
  for (const [name, query, width, height] of [
    ['low-fleet', 'preset=low', 1280, 800],
    ['low-phone', 'gfx=low&single', 390, 844],
    ['hd-fleet', 'gfx=hd', 1280, 800],
  ]) {
    const page = await native.context.newPage(), assets = [];
    const cdp = await native.context.newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
    page.on('pageerror', error => report.errors.push({ name, message: error.message }));
    page.on('console', message => { if (message.type() === 'error') report.errors.push({ name, message: message.text() }); });
    page.on('response', response => {
      const path = new URL(response.url()).pathname;
      if (path.startsWith('/assets/vehicles')) assets.push({ path, status: response.status() });
      if (response.status() >= 400) report.errors.push({ name, path, status: response.status() });
    });
    await page.bringToFront();
    await page.goto(server.resolvedUrls.local[0] + '__vehicle_check.html?' + query + '&time=golden&debug=render');
    await page.waitForFunction(() => window.vehicleCheck?.ready, undefined, { timeout: 90000 });
    const data = await page.evaluate(() => window.vehicleCheck.snapshot());
    assert.ok(!/swiftshader|llvmpipe|software/i.test(data.gpu), 'Real GPU required: ' + data.gpu);
    assert.equal(data.flags.realisticRender, true, 'Test the candidate with realisticRender enabled');
    if (data.preset === 'low') {
      assert.equal(assets.some(asset => asset.path.startsWith('/assets/vehicles-pbr/')), false, 'Low fetched PBR vehicles');
      assert.deepEqual(data.extras, [], 'Low must not load realistic-only extras');
      assert.ok(data.cars.every(car => car.materials.every(material => material.type !== 'MeshStandardMaterial')), 'Low contains PBR paint');
      assert.ok(data.cars.every(car => car.materials.some(material => material.type === 'MeshLambertMaterial')), 'Low must render Lambert geometry');
    } else {
      assert.ok(assets.some(asset => asset.path.startsWith('/assets/vehicles-pbr/')));
      assert.ok(data.cars.every(car => car.materials.some(material => material.type === 'MeshStandardMaterial')));
    }
    await page.screenshot({ path: resolve(out, name + '.png') });
    report.cases.push({ name, ...data, assets });
    await page.close();
    console.log('VEHICLE_RENDERER_CASE ' + name + ' ' + data.gpu);
  }
  assert.deepEqual(report.errors, []);
  report.passed = true;
} catch (error) { report.failure = String(error?.stack ?? error); process.exitCode = 1; }
finally {
  await writeFile(resolve(out, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await native?.close(); await server.close();
  console.log('VEHICLE_RENDERER_REPORT ' + out + '/report.json passed=' + report.passed);
}
