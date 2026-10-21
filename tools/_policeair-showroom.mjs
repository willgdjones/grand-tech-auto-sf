// Close-ups of lane A's SFPD police air art (web/src/combat/policeAir.ts, flag policeAirArt) on the production
// graphicsV2 foundation: the helicopter (rotors, strobes, searchlight beam onto the floor) and the SWAT van.
// Desktop (gfx=hd) + phone (gfx=low), golden + night. Out: docs/sf-data/police-air/showroom-*.png
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { nativeMediaBrowser } from './native-media-browser.mjs';

const out = resolve('docs/sf-data/police-air');
await mkdir(out, { recursive: true });
const SHOTS = { heli: { cam: [13, 7, 15], look: [0, 4, 0] }, swat: { cam: [7.5, 2.6, 8.5], look: [0, 1.2, 0] } };
const html = (unit) => `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>showroom</title>
<style>body{margin:0;background:#aeb7c0}canvas{position:fixed;inset:0;width:100%;height:100%}</style></head><body><canvas></canvas><script type="module">
import { Group, Mesh, PlaneGeometry, MeshLambertMaterial, PerspectiveCamera } from 'three';
import { createRenderFoundation } from '/src/render/foundation.ts';
import { createPoliceAirTemplates } from '/src/combat/policeAir.ts';
const foundation=createRenderFoundation({canvas:document.querySelector('canvas'),weather:false,sun:true});
const shot=${JSON.stringify(SHOTS[unit])};
const camera=new PerspectiveCamera(40,innerWidth/innerHeight,.1,1000);
camera.position.set(...shot.cam);camera.lookAt(...shot.look);
foundation.resize(innerWidth,innerHeight,devicePixelRatio);
const floor=new Group(),plane=new Mesh(new PlaneGeometry(160,160),new MeshLambertMaterial({color:'#9aa2ab'}));
plane.rotation.x=-Math.PI/2;plane.position.y=-.02;floor.add(plane);foundation.mountGeometry(floor);
const t=createPoliceAirTemplates();const unit=t['${unit}'].createInstance();
unit.root.rotation.y=1.95;if('${unit}'==='heli'){unit.root.position.y=4.5;unit.setGround(0);}foundation.scene.add(unit.root);
let frames=0,prev=performance.now();
window.show={get ready(){return frames>=20;}};
function frame(now){const dt=Math.max(0,Math.min(.1,(now-prev)/1000));prev=now;unit.update(dt,'${unit}'==='heli'?6:0);foundation.render(camera,true);frames++;requestAnimationFrame(frame);}requestAnimationFrame(frame);
</script></body></html>`;

const server = await createServer({ root: resolve('web'), configFile: resolve('web/vite.config.ts'),
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null },
  plugins: [{ name: 'policeair-showroom', configureServer(vite) {
    vite.middlewares.use(async (req, res, next) => {
      const m = req.url?.match(/^\/__show\.html\?unit=(heli|swat)/);
      if (!m || req.url.includes('html-proxy')) return next();
      try { res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml(req.url, html(m[1]))); } catch (e) { next(e); }
    });
  } }],
});
const errs = [];
try {
  await server.listen();
  const native = await nativeMediaBrowser({ gpu: true });
  for (const unit of ['heli', 'swat']) for (const time of ['golden', 'night'])
    for (const [device, w, h, dsf, gfx] of [['desktop', 1600, 900, 1.5, 'hd'], ['phone', 393, 873, 2.75, 'low']]) {
      const page = await native.context.newPage();
      const cdp = await native.context.newCDPSession(page);
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dsf, mobile: device === 'phone' });
      page.on('pageerror', e => errs.push(`${unit}/${device}: ${e.message}`));
      page.on('console', m => { if (m.type() === 'error') errs.push(`${unit}/${device}: ${m.text()}`); });
      await page.bringToFront();
      await page.goto(server.resolvedUrls.local[0] + `__show.html?unit=${unit}&gfx=${gfx}&time=${time}`);
      await page.waitForFunction(() => window.show?.ready, undefined, { timeout: 60000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: resolve(out, `showroom-${unit}-${time}-${device}.png`) });
      await page.close();
      console.log(`OK ${unit}/${time}/${device}`);
    }
  await native.close();
} catch (e) { console.log('FATAL ' + (e?.stack ?? e)); process.exitCode = 1; }
finally { await server.close(); console.log(`DONE errs=${errs.length} ${JSON.stringify(errs.slice(0, 4))}`); }
