// Character bake-off showroom (lane D, gtasf-laned-cc0-characters-km1i6; the ubc-* Universal Base bodies were DISQUALIFIED —
// unclothed + unanimated — and are in no pool; web/src/avatar/peopleBodies.test.ts guards that): candidate rigged humanoids side by side on a
// sidewalk on the production graphicsV2 foundation, desktop HD + phone-Low, headless. Materials are converted the same way
// riggedAvatar's characterPolish does (Lambert, colour/map kept) so the comparison matches the game's lighting.
// Candidates are served from web/public/assets/_bakeoff/ (locally staged downloads, not committed) plus the shipped hoodie.
// Env: LINEUP=id,id,... (default all), TIME (golden|noon), LABEL, OUT, CLIP (idle|walk).
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const all = ['hoodie', 'm-business', 'm-casual2', 'w-casual', 'w-formal', 'm-beach', 'w-punk', 'm-worker', 'ubc-m', 'ubc-f'];
const lineup = process.env.LINEUP ? process.env.LINEUP.split(',') : all;
const time = process.env.TIME ?? 'golden', label = process.env.LABEL ?? 'lineup', clip = process.env.CLIP ?? 'idle';
const out = resolve(process.env.OUT ?? 'docs/sf-data/character-bakeoff');
await mkdir(out, { recursive: true });
const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>bakeoff</title>
<style>body{margin:0;background:#aeb7c0}canvas{position:fixed;inset:0;width:100%;height:100%}</style></head><body><canvas></canvas><script type="module">
import { AnimationMixer, Box3, BoxGeometry, Color, Group, Mesh, MeshLambertMaterial, PerspectiveCamera, PlaneGeometry, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createRenderFoundation } from '/src/render/foundation.ts';
import { createHeldWeapon } from '/src/avatar/heldWeapon.ts';
const ids=${JSON.stringify(lineup)}, clip=${JSON.stringify(clip)}, face=${process.env.FACE === '1'}; // FACE=1: head-height close-up
const weapon=${JSON.stringify(process.env.WEAPON ?? '')}, aim=${Number(process.env.AIM ?? 1)}, held=[]; // WEAPON=pistol|smg|rifle|bat, AIM=0..1
${process.env.WRIST_ROLL ? `globalThis.__gtasfWristRoll=${Number(process.env.WRIST_ROLL)};` : ''} // WRIST_ROLL (rad): weaponPoses grip-roll sweep
const files={hoodie:'/assets/avatars/hoodie.glb','ubc-m':'/assets/_bakeoff/ubc/Superhero_Male_FullBody.gltf','ubc-f':'/assets/_bakeoff/ubc/Superhero_Female_FullBody.gltf'};
const foundation=createRenderFoundation({canvas:document.querySelector('canvas'),weather:false,sun:true});
const camera=new PerspectiveCamera(30,innerWidth/innerHeight,.1,1000);
foundation.resize(innerWidth,innerHeight,devicePixelRatio);
const street=new Group();
const walk=new Mesh(new PlaneGeometry(60,40),new MeshLambertMaterial({color:'#9a958c'}));walk.rotation.x=-Math.PI/2;street.add(walk);
for(let x=-30;x<30;x+=1.5){const j=new Mesh(new BoxGeometry(.03,.005,40),new MeshLambertMaterial({color:'#7f7a72'}));j.position.set(x,.003,0);street.add(j);}
const cols=['#7d6e5f','#8a8f96','#6f5a4c','#9c8a6e','#5f6b74','#a1755a'];
for(let i=0;i<8;i++){const w=6+(i%3);const b=new Mesh(new BoxGeometry(w,11,3),new MeshLambertMaterial({color:cols[i%cols.length]}));b.position.set(-28+i*7.4,5.5,-5);street.add(b);
  const win=new Mesh(new BoxGeometry(w*.8,2.6,.1),new MeshLambertMaterial({color:'#2b3440'}));win.position.set(b.position.x,1.9,-3.45);street.add(win);}
foundation.mountGeometry(street);
const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const mixers=[], spacing=.95;
for(let i=0;i<ids.length;i++){
  const id=ids[i], gltf=await loader.loadAsync(files[id]??('/assets/avatars/'+id+'.glb'));
  const root=gltf.scene;
  root.traverse(o=>{ if(o instanceof Mesh){ const conv=m=>{const l=new MeshLambertMaterial({color:m.color?.clone()??new Color(1,1,1),map:m.map??null,vertexColors:m.vertexColors});l.name=m.name;return l;};
    o.material=Array.isArray(o.material)?o.material.map(conv):conv(o.material); } if(o instanceof SkinnedMesh) o.frustumCulled=false; });
  const anim=gltf.animations.find(a=>a.name===clip||a.name.endsWith('|'+(clip==='idle'?'Idle':'Walk')));
  if(anim){const mx=new AnimationMixer(root);mx.clipAction(anim).play();mx.update(i*.37);mixers.push(mx);}
  if(weapon) held.push(createHeldWeapon(root));
  root.updateMatrixWorld(true);const box=new Box3().setFromObject(root),h=box.max.y-box.min.y;
  root.scale.multiplyScalar(1.76/h); root.position.set((i-(ids.length-1)/2)*spacing,0,0); root.rotation.y=(i%2?-.25:.25);
  root.updateMatrixWorld(true); root.position.y-=new Box3().setFromObject(root).min.y;
  foundation.scene.add(root);
}
const width=Math.max(2.2,ids.length*spacing+.4), fitW=width/2/Math.tan(15*Math.PI/180)/camera.aspect, fitH=1.15/Math.tan(15*Math.PI/180);
const dist=Math.max(fitW,fitH);if(face){camera.position.set(0,1.55,ids.length*.9+.4);camera.lookAt(0,1.5,0);}else{camera.position.set(0,1.25,dist);camera.lookAt(0,1.0,0);}
let frames=0,prev=performance.now(),lw=0,lh=0,ld=0;
window.show={get ready(){return frames>=14;}};
function frame(now){const dt=Math.max(0,Math.min(.1,(now-prev)/1000));prev=now;
  if(innerWidth!==lw||innerHeight!==lh||devicePixelRatio!==ld){lw=innerWidth;lh=innerHeight;ld=devicePixelRatio;foundation.resize(lw,lh,ld);camera.aspect=lw/lh;camera.updateProjectionMatrix();}
  if(frames<14) mixers.forEach(m=>m.update(dt));
  held.forEach(h=>h.update(weapon,aim,0));
  foundation.render(camera,true);frames++;requestAnimationFrame(frame);}requestAnimationFrame(frame);
</script></body></html>`;

const server = await createServer({ root: resolve('web'), configFile: resolve('web/vite.config.ts'), logLevel: 'warn',
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null },
  plugins: [{ name: 'bakeoff', enforce: 'pre', configureServer(vite) {
    vite.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/__bakeoff.html') || req.url.includes('html-proxy')) return next();
      try { res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml(req.url, html)); } catch (e) { next(e); }
    });
  } }],
});
const errs = [];
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  for (const [device, w, h, dsf, gfx] of [['desktop', 1600, 900, 1.5, 'hd'], ['phone', 393, 873, 2.75, 'low']]) {
    if (process.env.DEVICES && !process.env.DEVICES.split(',').includes(device)) continue;
    const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dsf, isMobile: device === 'phone', hasTouch: device === 'phone' });
    const page = await context.newPage();
    page.on('pageerror', e => errs.push(`${device}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errs.push(`${device}: ${m.text()}`); });
    await page.goto(server.resolvedUrls.local[0] + `__bakeoff.html?gfx=${gfx}${gfx === 'low' ? '&preset=low' : ''}&time=${time}`);
    await page.waitForFunction(() => window.show?.ready, undefined, { timeout: 120000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: resolve(out, `${label}-${time}-${device}.png`) });
    await context.close();
    console.log(`OK ${label}/${device}`);
  }
} catch (e) { console.log('FATAL ' + (e?.stack ?? e)); process.exitCode = 1; }
finally { await browser?.close(); await server.close(); console.log(`DONE errs=${errs.length} ${JSON.stringify(errs.slice(0, 4))}`); }
