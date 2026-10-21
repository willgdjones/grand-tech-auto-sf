// Faithful close-up of the shipping PBR fleet: production graphicsV2 path (NO realisticRender force),
// sun + golden grade, one car centred filling ~1/3 frame. MODE=on uses live flags (pbrCarsV2 true);
// MODE=off forces pbrCarsV2:false via a transform (loads the old CC0 car) — flags.ts untouched.
// Captures desktop (gfx=hd) + phone (gfx=low) for cars: model3 (sedan), robotaxi, muni-bus.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { nativeMediaBrowser } from './native-media-browser.mjs';

const mode = process.env.MODE ?? 'on';
const cars = (process.env.CARS ?? 'model3,robotaxi,muni-bus').split(',');
const out = process.env.OUT ? resolve(process.env.OUT) : resolve('docs/sf-data/pbr-cars', `showroom-${mode}`);
await mkdir(out, { recursive: true });
const DIST = { 'muni-bus': 15, 'powell-cable-car': 12, default: 6.6 };
const html = (id, dist) => `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>showroom</title>
<style>body{margin:0;background:#aeb7c0}canvas{position:fixed;inset:0;width:100%;height:100%}</style></head><body><canvas></canvas><script type="module">
import { Group, Mesh, PlaneGeometry, MeshLambertMaterial, PerspectiveCamera } from 'three';
import { createRenderFoundation } from '/src/render/foundation.ts';
import { loadVehicleTemplate } from '/src/vehicles/models/vehicle.ts';
const foundation=createRenderFoundation({canvas:document.querySelector('canvas'),weather:false,sun:true});
const d=${dist};
const camera=new PerspectiveCamera(40,innerWidth/innerHeight,.1,1000);
camera.position.set(d*0.78,1.85,d*0.92);camera.lookAt(0,0.72,0);
foundation.resize(innerWidth,innerHeight,devicePixelRatio);
const floor=new Group(),plane=new Mesh(new PlaneGeometry(120,120),new MeshLambertMaterial({color:'#9aa2ab'}));
plane.rotation.x=-Math.PI/2;plane.position.y=-.02;floor.add(plane);foundation.mountGeometry(floor);
const template=await loadVehicleTemplate('${id}');if(!template)throw new Error('missing ${id}');
const car=template.createInstance();car.root.rotation.y=0.52;foundation.scene.add(car.root);
let frames=0,prev=performance.now();
window.show={get ready(){return frames>=12;}};
function frame(now){const dt=Math.max(0,Math.min(.1,(now-prev)/1000));prev=now;car.update(dt);foundation.render(camera,true);frames++;requestAnimationFrame(frame);}requestAnimationFrame(frame);
</script></body></html>`;

const server = await createServer({ root: resolve('web'), configFile: resolve('web/vite.config.ts'),
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null },
  plugins: [{ name: 'pbrcar-showroom', enforce: 'pre',
    transform(code, id) {
      if (mode === 'off' && id === resolve('shared/flags.ts')) return code.replace(/\bpbrCarsV2:\s*(?:true|false)\b/, 'pbrCarsV2: false');
    },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        const m = req.url?.match(/^\/__show\.html\?car=([^&]+)/);
        if (!m || req.url.includes('html-proxy')) return next();
        const carId = decodeURIComponent(m[1]); const dist = Number(process.env.DIST) || (DIST[carId] ?? DIST.default); // DIST: close-up distance override (m)
        try { res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml(req.url, html(carId, dist))); }
        catch (e) { next(e); }
      });
    } }],
});
const errs = [];
try {
  await server.listen();
  const native = await nativeMediaBrowser({ gpu: true });
  for (const id of cars) {
    for (const [device, w, h, dsf, gfx] of [['desktop', 1600, 900, 1.5, 'hd'], ['phone', 393, 873, 2.75, 'low']]) {
      const page = await native.context.newPage();
      const cdp = await native.context.newCDPSession(page);
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dsf, mobile: device === 'phone' });
      page.on('pageerror', e => errs.push(`${id}/${device}: ${e.message}`));
      page.on('console', m => { if (m.type() === 'error') errs.push(`${id}/${device}: ${m.text()}`); });
      await page.bringToFront();
      await page.goto(server.resolvedUrls.local[0] + `__show.html?car=${encodeURIComponent(id)}&gfx=${gfx}&time=golden`);
      await page.waitForFunction(() => window.show?.ready, undefined, { timeout: 60000 });
      await page.waitForTimeout(600);
      await page.screenshot({ path: resolve(out, `${id}-${device}.png`) });
      await page.close();
      console.log(`OK ${id}/${device}`);
    }
  }
  await native.close();
} catch (e) { console.log('FATAL ' + (e?.stack ?? e)); process.exitCode = 1; }
finally { await server.close(); console.log(`DONE mode=${mode} errs=${errs.length} ${JSON.stringify(errs.slice(0, 4))}`); }
