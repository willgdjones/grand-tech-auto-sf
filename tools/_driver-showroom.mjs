// Traffic-driver look check (Combat 6b, flag trafficDrivers): exercises the REAL createTrafficDrivers module
// to seat pooled avatars in traffic cars, so I can judge the seat offset + 'sit' pose + outfit variety before
// signing off the flag. Two cars side by side; camera close on the near driver.
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const out = resolve('docs/sf-data/traffic-drivers');
await mkdir(out, { recursive: true });
const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>drivers</title>
<style>body{margin:0;background:#aeb7c0}canvas{position:fixed;inset:0;width:100%;height:100%}</style></head><body><canvas></canvas><script type="module">
import { Group, Mesh, PlaneGeometry, MeshLambertMaterial, PerspectiveCamera } from 'three';
import { createRenderFoundation } from '/src/render/foundation.ts';
import { loadVehicleTemplate } from '/src/vehicles/models/vehicle.ts';
import { loadAvatarTemplate } from '/src/avatar/riggedAvatar.ts';
import { createTrafficDrivers } from '/src/combat/trafficDrivers.ts';
import { setCarGlassDebug, setCarGlassEnabled } from '/src/vehicles/carGlass.ts';
setCarGlassEnabled(new URLSearchParams(location.search).get('noglass')!=='1');
setCarGlassDebug(new URLSearchParams(location.search).get('glassdebug')==='1');
const TRAFFIC_FLAG = 0x20;
const foundation=createRenderFoundation({canvas:document.querySelector('canvas'),weather:false,sun:true});
const camera=new PerspectiveCamera(42,innerWidth/innerHeight,.1,1000);
const view=new URLSearchParams(location.search).get('view')??'close';
// close = beside the near driver; play = a third-person street view (~6 m) across the row of cars, as in-game.
if(view==='side'){camera.fov=14;camera.position.set(-42,1.1,9);camera.lookAt(0,0.9,9);camera.updateProjectionMatrix();}else if(view==='play'){camera.position.set(-5.2,2.6,6.4);camera.lookAt(4.5,0.9,0);}else{camera.position.set(-2.55,1.32,2.75);camera.lookAt(-0.4,0.98,0.4);}
foundation.resize(innerWidth,innerHeight,devicePixelRatio);
const floor=new Group(),plane=new Mesh(new PlaneGeometry(90,90),new MeshLambertMaterial({color:'#33363b'}));
plane.rotation.x=-Math.PI/2;plane.position.y=-.02;floor.add(plane);foundation.mountGeometry(floor);
const avatarTpl=await loadAvatarTemplate();if(!avatarTpl)throw new Error('no avatar template (onFoot off?)');
const assets=(new URLSearchParams(location.search).get('cars')??'outback,prius,model3,cab').split(',');const cars=[];
for(let i=0;i<assets.length;i++){const t=await loadVehicleTemplate(assets[i]);if(!t)throw new Error('missing '+assets[i]);
  const inst=t.createInstance();if(view==='side')inst.root.position.set(0,0,i*6);else inst.root.position.set(i*3.2,0,0);foundation.scene.add(inst.root);
  cars.push({data:{id:i+1,flags:TRAFFIC_FLAG},model:inst,_inst:inst});}
// TEST: make the near car's body semi-transparent to see whether the opaque shell is what hides the driver.
if(new URLSearchParams(location.search).get('bodytransp')==='1')cars[0]._inst.root.traverse(o=>{if(o.isMesh&&o.name==='body'){const ms=Array.isArray(o.material)?o.material:[o.material];for(const m of ms){m.transparent=true;m.opacity=0.28;m.depthWrite=false;}}});
const drivers=createTrafficDrivers({template:avatarTpl,maxDrivers:4,rangeM:200});
drivers.update(cars,{x:0,z:0},()=>false);
// Inspection only: hide the greenhouse glass so the seated driver's pose/offset is visible (set HIDE_GLASS).
const hideGlass=new URLSearchParams(location.search).get('glass')==='0';
if(hideGlass)for(const c of cars)c._inst.root.traverse(o=>{if(o.isMesh){const m=Array.isArray(o.material)?o.material[0]:o.material;if(m&&m.transparent)o.visible=false;}});
let frames=0,prev=performance.now(),lw=0,lh=0,ld=0;
window.show={get ready(){return frames>=14;}};
function frame(now){const dt=Math.max(0,Math.min(.1,(now-prev)/1000));prev=now;
  if(innerWidth!==lw||innerHeight!==lh||devicePixelRatio!==ld){lw=innerWidth;lh=innerHeight;ld=devicePixelRatio;foundation.resize(lw,lh,ld);camera.aspect=lw/lh;camera.updateProjectionMatrix();}
  for(const c of cars)c._inst.update(dt);drivers.update(cars,{x:0,z:0},()=>false);foundation.render(camera,true);frames++;requestAnimationFrame(frame);}requestAnimationFrame(frame);
</script></body></html>`;

const server = await createServer({ root: resolve('web'), configFile: resolve('web/vite.config.ts'),
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null },
  plugins: [{ name: 'driver-showroom', enforce: 'pre',
    // FLAGS_OFF=a,b serves shared/flags.ts with those flags false for this run (A/B a flag without touching the file).
    transform(code, id) {
      if (!process.env.FLAGS_OFF || !id.replace(/\\/g, '/').endsWith('shared/flags.ts')) return null;
      for (const name of process.env.FLAGS_OFF.split(',')) code = code.replace(new RegExp(`(\\n\\s*${name}:\\s*)true\\b`), '$1false');
      return code;
    },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/__drivers.html') || req.url.includes('html-proxy')) return next();
        try { res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml(req.url, html)); }
        catch (e) { next(e); }
      });
    } }],
});
const errs = [];
try {
  await server.listen();
  // Headless only (founder rule: never a visible browser), GPU via Metal.
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  for (const [device, w, h, dsf, gfx, view] of [...(process.env.VIEWS ?? 'desktop:close,desktop:play,phone:close,phone:play').split(',').map(v => { const [d, view] = v.split(':'); return d === 'desktop' ? ['desktop', 1600, 900, 1.5, 'hd', view] : ['phone', 900, 1600, 1, 'low', view]; })]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dsf });
    page.on('pageerror', e => errs.push(`${device}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errs.push(`${device}: ${m.text()}`); if (m.text().startsWith('MAT ')) console.log(m.text()); });
    await page.goto(server.resolvedUrls.local[0] + `__drivers.html?gfx=${gfx}&time=${process.env.TIME ?? 'noon'}&view=${view}${process.env.CARS ? `&cars=${process.env.CARS}` : ''}${process.env.BODYTRANSP ? '&bodytransp=1' : ''}${process.env.GLASSDEBUG ? '&glassdebug=1' : ''}${process.env.NOGLASS ? '&noglass=1' : ''}`);
    await page.waitForFunction(() => window.show?.ready, undefined, { timeout: 60000 });
    await page.waitForTimeout(Number(process.env.WAIT_MS ?? 600)); // WAIT_MS: give the CC0 body time to arrive + rebake
    console.log(`bake ${device} ${view}: ${JSON.stringify(await page.evaluate(() => window.__gtasfDriverBake ?? null))}`);
    await page.screenshot({ path: resolve(out, `driver-${device}-${view}${process.env.TAG ? `-${process.env.TAG}` : ''}.png`) });
    await page.close();
    console.log(`OK ${device} ${view}`);
  }
  await browser.close();
} catch (e) { console.log('FATAL ' + (e?.stack ?? e)); process.exitCode = 1; }
finally { await server.close(); console.log(`DONE errs=${errs.length} ${JSON.stringify(errs.slice(0, 4))}`); }
