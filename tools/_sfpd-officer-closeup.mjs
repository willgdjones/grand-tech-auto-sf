// SFPD officer head/cap close-up (lane A #3: peaked patrol cap). Headless chromium on the production
// graphicsV2 foundation. CAP_VARIANT in {before,after}. Frames the head + cap for a cap look review.
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const variant = process.env.CAP_VARIANT ?? 'after';
// FRAME=bust frames head-to-belt (uniform shirt review) into docs/sf-data/sfpd-uniform instead.
const bust = process.env.FRAME === 'bust';
const out = resolve(bust ? 'docs/sf-data/sfpd-uniform' : 'docs/sf-data/sfpd-cap');
await mkdir(out, { recursive: true });
const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="icon" href="data:,"><title>cap</title>
<style>body{margin:0;background:#9aa3ad}canvas{position:fixed;inset:0;width:100%;height:100%}</style></head><body><canvas></canvas><script type="module">
import { Group, Mesh, PlaneGeometry, MeshLambertMaterial, PerspectiveCamera } from 'three';
import { createRenderFoundation } from '/src/render/foundation.ts';
import { loadAvatarTemplate } from '/src/avatar/riggedAvatar.ts';
import { createSfpdOfficer } from '/src/combat/sfpdOfficer.ts';
const foundation=createRenderFoundation({canvas:document.querySelector('canvas'),weather:false,sun:true});
const camera=new PerspectiveCamera(32,innerWidth/innerHeight,.05,1000);
// Frame the head + cap (officer ~1.8 m; head ~1.62 m), slightly above and from the front-left so the peak reads.
camera.position.set(${bust ? '0.95,1.55,2.3' : '0.62,1.70,1.15'});camera.lookAt(0,${bust ? 1.3 : 1.6},0);
foundation.resize(innerWidth,innerHeight,devicePixelRatio);
const ground=new Mesh(new PlaneGeometry(40,40),new MeshLambertMaterial({color:'#8c929a'}));
ground.rotation.x=-Math.PI/2;ground.position.y=-.01;const street=new Group();street.add(ground);
foundation.mountGeometry(street);
const tpl=await loadAvatarTemplate(); let officer;
if(tpl){ officer=createSfpdOfficer(tpl); officer.root.rotation.y=0.35; foundation.scene.add(officer.root); }
let frames=0,prev=performance.now(),lw=0,lh=0,ld=0;
window.show={get ready(){return frames>=14 && !!officer;}};
function frame(now){const dt=Math.max(0,Math.min(.1,(now-prev)/1000));prev=now;
  if(innerWidth!==lw||innerHeight!==lh||devicePixelRatio!==ld){lw=innerWidth;lh=innerHeight;ld=devicePixelRatio;foundation.resize(lw,lh,ld);camera.aspect=lw/lh;camera.updateProjectionMatrix();}
  officer&&officer.update(dt,'idle');foundation.render(camera,true);frames++;requestAnimationFrame(frame);}requestAnimationFrame(frame);
</script></body></html>`;

const server = await createServer({ root: resolve('web'), configFile: resolve('web/vite.config.ts'),
  server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null },
  plugins: [{ name: 'sfpd-cap', enforce: 'pre',
    // FRAME=bust + CAP_VARIANT=before: render without the uniform shirt pass (the hoodie look) for the A/B.
    transform(code, id) { if (bust && variant === 'before' && id.endsWith('/combat/sfpdOfficer.ts')) return code.replace(' uniformShirt(avatar);', ''); },
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/__cap.html') || req.url.includes('html-proxy')) return next();
        try { res.setHeader('Content-Type', 'text/html'); res.end(await vite.transformIndexHtml(req.url, html)); }
        catch (e) { next(e); }
      });
    } }],
});
const errs = [];
try {
  await server.listen();
  const browser = await chromium.launch({ headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  for (const [device, w, h, dsf, gfx] of [['desktop', 1100, 1300, 1.5, 'hd'], ['phone', 900, 1600, 1, 'low']]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dsf });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(`${device}: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errs.push(`${device}: ${m.text()}`); });
    await page.goto(server.resolvedUrls.local[0] + `__cap.html?gfx=${gfx}&time=noon`);
    await page.waitForFunction(() => window.show?.ready, undefined, { timeout: 60000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: resolve(out, `officer-${variant}-${device}.png`) });
    await page.close(); await ctx.close();
    console.log(`OK ${variant}/${device}`);
  }
  await browser.close();
} catch (e) { console.log('FATAL ' + (e?.stack ?? e)); process.exitCode = 1; }
finally { await server.close(); console.log(`DONE variant=${variant} errs=${errs.length} ${JSON.stringify(errs.slice(0, 4))}`); }
