// SFPD look showroom: the 'subaru'(outback) cruiser with the black-and-white livery + a roof light bar,
// on the production graphicsV2 foundation. MODE=on applies applySfpdLivery; MODE=off is the stock subaru.
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { nativeMediaBrowser } from './native-media-browser.mjs';

const mode = process.env.MODE ?? 'on';
const out = resolve('docs/sf-data/sfpd');
await mkdir(out, { recursive: true });
const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>sfpd</title>
<style>body{margin:0;background:#aeb7c0}canvas{position:fixed;inset:0;width:100%;height:100%}</style></head><body><canvas></canvas><script type="module">
import { Box3, Group, Mesh, BoxGeometry, PlaneGeometry, MeshLambertMaterial, MeshBasicMaterial, PerspectiveCamera } from 'three';
import { createRenderFoundation } from '/src/render/foundation.ts';
import { loadVehicleTemplate } from '/src/vehicles/models/vehicle.ts';
import { applySfpdLivery } from '/src/combat/sfpdLivery.ts';
import { loadAvatarTemplate } from '/src/avatar/riggedAvatar.ts';
import { createSfpdOfficer } from '/src/combat/sfpdOfficer.ts';
const foundation=createRenderFoundation({canvas:document.querySelector('canvas'),weather:false,sun:true});
const camera=new PerspectiveCamera(42,innerWidth/innerHeight,.1,1000);
camera.position.set(7.6,2.2,3.4);camera.lookAt(0.2,0.85,-0.1);
foundation.resize(innerWidth,innerHeight,devicePixelRatio);
// A street scene (not an empty void): asphalt road, double-yellow centreline, a curb + sidewalk, and a
// building wall on the far side so the cruiser reads as parked on a real street.
const street=new Group();
const road=new Mesh(new PlaneGeometry(90,90),new MeshLambertMaterial({color:'#33363b'}));
road.rotation.x=-Math.PI/2;road.position.y=-.02;street.add(road);
for(const xx of [2.27,2.53]){const ln=new Mesh(new PlaneGeometry(0.1,26),new MeshLambertMaterial({color:'#c6a52c'}));ln.rotation.x=-Math.PI/2;ln.position.set(xx,0,0);street.add(ln);}
for(let z=-11;z<=11;z+=4){const d=new Mesh(new PlaneGeometry(0.14,1.6),new MeshLambertMaterial({color:'#c9cdd2'}));d.rotation.x=-Math.PI/2;d.position.set(-3.6,0,z);street.add(d);}
const walk=new Mesh(new PlaneGeometry(10,90),new MeshLambertMaterial({color:'#8c929a'}));walk.rotation.x=-Math.PI/2;walk.position.set(-10.5,.01,0);street.add(walk);
const curb=new Mesh(new BoxGeometry(0.22,0.17,90),new MeshLambertMaterial({color:'#b7bcc2'}));curb.position.set(-5.3,.06,0);street.add(curb);
const facades=['#6b6f78','#7c7366','#606b72','#73697a','#6e7a6d','#78716a'];
let bz=-24;
for(let i=0;i<7;i++){const hgt=8+((i*37)%5)*2.4,w=5+((i*53)%4);const col=facades[i%facades.length];
  const b=new Mesh(new BoxGeometry(w,hgt,7),new MeshLambertMaterial({color:col}));b.position.set(-13.5-((i*3)%3),hgt/2-0.1,bz);street.add(b);
  const win=new Mesh(new BoxGeometry(w*0.84,hgt*0.78,0.12),new MeshLambertMaterial({color:'#2a3340'}));win.position.set(b.position.x,b.position.y,bz+3.56);street.add(win);
  bz+=w+2.4;}
foundation.mountGeometry(street);
const template=await loadVehicleTemplate('outback');if(!template)throw new Error('missing outback');
const car=template.createInstance();car.root.rotation.y=0.52;
${mode === 'on' ? "applySfpdLivery(car.root);" : ""}
foundation.scene.add(car.root);
${mode === 'on' ? `
// Roof light bar (red + blue), like policeLights but static for the still. Sit it on the actual roof.
const roofY=new Box3().setFromObject(car.root).max.y;
const bar=new Group(); bar.position.set(0,roofY+0.07,0);
for(const [x,col] of [[-0.19,'#ff2a2a'],[0.19,'#2a5bff']]){
  const b=new Mesh(new BoxGeometry(0.34,0.14,0.26), new MeshBasicMaterial({color:col}));
  b.position.x=x; bar.add(b);
}
const barBase=new Mesh(new BoxGeometry(0.82,0.06,0.24), new MeshBasicMaterial({color:'#0a0c10'}));
barBase.position.y=-0.09; bar.add(barBase);
car.root.add(bar);` : ""}
${mode === 'on' ? `
// An SFPD officer standing by the cruiser (navy uniform + cap + badge).
const tpl=await loadAvatarTemplate(); let officer;
if(tpl){ officer=createSfpdOfficer(tpl); officer.root.position.set(2.5,0,1.0); officer.root.rotation.y=-0.9; foundation.scene.add(officer.root); }
` : ""}
let frames=0,prev=performance.now(),lw=0,lh=0,ld=0;
window.show={get ready(){return frames>=12;}};
function frame(now){const dt=Math.max(0,Math.min(.1,(now-prev)/1000));prev=now;
  if(innerWidth!==lw||innerHeight!==lh||devicePixelRatio!==ld){lw=innerWidth;lh=innerHeight;ld=devicePixelRatio;foundation.resize(lw,lh,ld);camera.aspect=lw/lh;camera.updateProjectionMatrix();}
  car.update(dt);${mode === 'on' ? "officer&&officer.update(dt,'idle');" : ""}foundation.render(camera,true);frames++;requestAnimationFrame(frame);}requestAnimationFrame(frame);
</script></body></html>`;

const server = await createServer({ root: resolve('web'), configFile: resolve('web/vite.config.ts'),
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null },
  plugins: [{ name: 'sfpd-showroom', enforce: 'pre',
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/__sfpd.html') || req.url.includes('html-proxy')) return next();
        try { res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml(req.url, html)); }
        catch (e) { next(e); }
      });
    } }],
});
const errs = [];
try {
  await server.listen();
  const native = await nativeMediaBrowser({ gpu: true });
  // The native browser window can't shrink to a true phone width (narrow viewports render in a corner), so the
  // phone-Low shot uses a window-friendly portrait at the Low graphics preset (gfx=low) — the Low material path
  // is what we're reviewing, not pixel-exact device metrics.
  for (const [device, w, h, dsf, gfx] of [['desktop', 1600, 900, 1.5, 'hd'], ['phone', 900, 1600, 1, 'low']]) {
    const page = await native.context.newPage();
    const cdp = await native.context.newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dsf, mobile: false });
    page.on('pageerror', e => errs.push(`${device}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errs.push(`${device}: ${m.text()}`); });
    await page.bringToFront();
    await page.goto(server.resolvedUrls.local[0] + `__sfpd.html?gfx=${gfx}&time=noon`);
    await page.waitForFunction(() => window.show?.ready, undefined, { timeout: 60000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: resolve(out, `cruiser-${mode}-${device}.png`) });
    await page.close();
    console.log(`OK ${mode}/${device}`);
  }
  await native.close();
} catch (e) { console.log('FATAL ' + (e?.stack ?? e)); process.exitCode = 1; }
finally { await server.close(); console.log(`DONE mode=${mode} errs=${errs.length} ${JSON.stringify(errs.slice(0, 4))}`); }
