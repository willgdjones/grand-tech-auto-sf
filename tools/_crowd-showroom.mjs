// Crowd look showroom (lane D): a dozen instanced crowd people (createCrowdPopulation, the phone-Low / far-HD crowd)
// standing and walking on a sidewalk, on the production graphicsV2 foundation. Headless Playwright.
// MODE=on forces flags.crowdVariety (build-time transform, NOT a flags.ts flip); MODE=off forces it false.
// Env: OUT (dir), TIME (golden|noon|night), FLAG (default crowdVariety), EXTRA_FLAGS=a,b (also forced on).
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const mode = process.env.MODE ?? 'on', flag = process.env.FLAG ?? 'crowdVariety', time = process.env.TIME ?? 'golden';
const extra = process.env.EXTRA_FLAGS ? process.env.EXTRA_FLAGS.split(',') : [];
const out = resolve(process.env.OUT ?? 'docs/sf-data/crowd-looks');
const count = Number(process.env.COUNT ?? 14); // RIGGED=n: the first n are rigged avatars (the HD near crowd)
await mkdir(out, { recursive: true });
const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>crowd</title>
<style>body{margin:0;background:#aeb7c0}canvas{position:fixed;inset:0;width:100%;height:100%}</style></head><body><canvas></canvas><script type="module">
import { Group, Mesh, BoxGeometry, PlaneGeometry, MeshLambertMaterial, PerspectiveCamera } from 'three';
import { createRenderFoundation } from '/src/render/foundation.ts';
import { createCrowdPopulation } from '/src/render/instancedCrowd.ts';
import { loadAvatarTemplate } from '/src/avatar/riggedAvatar.ts';
import { loadCrowdVat } from '/src/render/crowdVat.ts';
const phone = innerWidth < innerHeight;
const foundation=createRenderFoundation({canvas:document.querySelector('canvas'),weather:false,sun:true});
const camera=new PerspectiveCamera(phone?50:38,innerWidth/innerHeight,.1,1000);
${process.env.CLOSE ? 'camera.position.set(0,1.55,phone?3.6:2.6);camera.lookAt(0,1.15,0);' : 'camera.position.set(0,2.3,phone?10.5:8.4);camera.lookAt(0,1.0,0);'}
foundation.resize(innerWidth,innerHeight,devicePixelRatio);
const street=new Group();
const walk=new Mesh(new PlaneGeometry(60,40),new MeshLambertMaterial({color:'#9a958c'}));walk.rotation.x=-Math.PI/2;street.add(walk);
for(let x=-30;x<30;x+=1.5){const j=new Mesh(new BoxGeometry(.03,.005,40),new MeshLambertMaterial({color:'#7f7a72'}));j.position.set(x,.003,0);street.add(j);}
const road=new Mesh(new PlaneGeometry(60,12),new MeshLambertMaterial({color:'#34363a'}));road.rotation.x=-Math.PI/2;road.position.set(0,-.14,9.5);street.add(road);
const curb=new Mesh(new BoxGeometry(60,.15,.25),new MeshLambertMaterial({color:'#b9b6ae'}));curb.position.set(0,-.07,3.4);street.add(curb);
const cols=['#7d6e5f','#8a8f96','#6f5a4c','#9c8a6e','#5f6b74','#a1755a'];
for(let i=0;i<8;i++){const w=6+(i%3);const b=new Mesh(new BoxGeometry(w,11,3),new MeshLambertMaterial({color:cols[i%cols.length]}));b.position.set(-28+i*7.4,5.5,-7);street.add(b);
  const win=new Mesh(new BoxGeometry(w*.8,2.6,.1),new MeshLambertMaterial({color:'#2b3440'}));win.position.set(b.position.x,1.9,-5.45);street.add(win);}
foundation.mountGeometry(street);
const rigged=${Number(process.env.RIGGED ?? 0)};const tpl=rigged?await loadAvatarTemplate():null;
const vat=await loadCrowdVat();
const crowd=createCrowdPopulation(${count},tpl,rigged,[],vat);foundation.scene.add(crowd.root);
const n=${count}, spots=[];
for(let i=0;i<n;i++){const row=i%2, k=Math.floor(i/2), across=Math.ceil(n/2);
  const x=(k-(across-1)/2)*(phone?.95:1.25)+(row?.45:0), z=row?-1.4:.6;
  const a=crowd.actors[i]; a.root.position.set(x,0,z); a.root.rotation.y=i%3===0?.5:i%3===1?-.35:Math.PI*.15+(row?Math.PI:0)*.0;
  spots.push(i%4===1?'walk':'idle');}
let frames=0,prev=performance.now(),lw=0,lh=0,ld=0;
window.show={get ready(){return frames>=14;}};
function frame(now){const dt=Math.max(0,Math.min(.1,(now-prev)/1000));prev=now;
  if(innerWidth!==lw||innerHeight!==lh||devicePixelRatio!==ld){lw=innerWidth;lh=innerHeight;ld=devicePixelRatio;foundation.resize(lw,lh,ld);camera.aspect=lw/lh;camera.updateProjectionMatrix();}
  crowd.actors.forEach((a,i)=>a.update(frames<14?dt:0,spots[i]));crowd.flush();
  foundation.render(camera,true);frames++;requestAnimationFrame(frame);}requestAnimationFrame(frame);
</script></body></html>`;

const forced = [[flag, mode === 'on'], ...extra.map(f => [f, true])];
const server = await createServer({ root: resolve('web'), configFile: resolve('web/vite.config.ts'), logLevel: 'warn',
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null },
  plugins: [{ name: 'crowd-showroom', enforce: 'pre',
    transform(code, id) { if (id !== resolve('shared/flags.ts')) return;
      let s = code; for (const [f, v] of forced) s = s.replace(new RegExp(`\\b${f}:\\s*(?:true|false)\\b`), `${f}: ${v}`); return s; },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/__crowd.html') || req.url.includes('html-proxy')) return next();
        try { res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml(req.url, html)); }
        catch (e) { next(e); }
      });
    } }],
});
const errs = [];
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  for (const [device, w, h, dsf, gfx] of [['desktop', 1600, 900, 1.5, 'hd'], ['phone', 393, 873, 2.75, 'low']]) {
    const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dsf, isMobile: device === 'phone', hasTouch: device === 'phone' });
    const page = await context.newPage();
    page.on('pageerror', e => errs.push(`${device}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errs.push(`${device}: ${m.text()}`); });
    await page.goto(server.resolvedUrls.local[0] + `__crowd.html?gfx=${gfx}${gfx === 'low' ? '&preset=low' : ''}&time=${time}`);
    await page.waitForFunction(() => window.show?.ready, undefined, { timeout: 90000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: resolve(out, `showroom-${mode}-${time}${process.env.CLOSE ? '-close' : ''}${process.env.RIGGED ? '-rigged' : ''}-${device}.png`) });
    await context.close();
    console.log(`OK ${mode}/${device}`);
  }
} catch (e) { console.log('FATAL ' + (e?.stack ?? e)); process.exitCode = 1; }
finally { await browser?.close(); await server.close(); console.log(`DONE mode=${mode} errs=${errs.length} ${JSON.stringify(errs.slice(0, 4))}`); }
