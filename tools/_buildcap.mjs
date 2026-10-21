// Clean-build desktop capture: vite build (embeds current flags.ts) + preview (/api -> local miniflare pool) +
// one HD screenshot. For verifying render changes the dev server's core-module HMR serves stale (e.g.
// foundation.ts). Env: AT, LABEL, SPOT, OUTDIR.
import { build, preview } from 'vite';
import { chromium } from '@playwright/test';
import { mkdir, stat, rename, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { startLocalPool } from './local-pool/pool.mjs';
const label=process.env.LABEL??'on', spot=process.env.SPOT??'fidi', out=process.env.OUTDIR??'docs/sf-data/realistic-lighting';
const at=process.env.AT??'37.7908,-122.4024,5';
const app=process.env.APP_DIR?resolve(process.env.APP_DIR):resolve(process.env.SCRATCH??'/tmp', `buildcap-${label}`);
const phone=process.env.DEVICE==='phone';
const founded=JSON.stringify({founded:true,startupName:'Look',foundedAt:Date.now(),billboardSeen:true});
let server,b,pool,pageErrors=[];
try{
  let base;
  if(process.env.USE_DEV){ base = process.env.GTASF_SMOKE_URL ?? 'http://127.0.0.1:5173'; console.log(`DEV ${base}`); }
  else{
  if(process.env.SKIP_BUILD){console.log(`REUSE ${app}`);}
  else{console.log(`BUILD ${label}`);
  // Force flags true at build time via a transform (NOT a flags.ts flip) to dodge the staging hazard.
  // FORCE_RLV2=1 ⇒ realisticLightingV2; FORCE_FLAGS=a,b ⇒ those flags.
  const forceFlags = [...(process.env.FORCE_RLV2 ? ['realisticLightingV2'] : []), ...(process.env.FORCE_FLAGS ? process.env.FORCE_FLAGS.split(',') : [])];
  // UNFORCE_FLAGS=a,b ⇒ those flags false (flag-off "before" builds of dev-on flags).
  const unforceFlags = process.env.UNFORCE_FLAGS ? process.env.UNFORCE_FLAGS.split(',') : [];
  // PROD_FLAGS=1 ⇒ every flag = membership in prepare.ts's reviewed set (exactly what production ships), then
  // FORCE_FLAGS / UNFORCE_FLAGS on top — for "what players see today" vs one candidate flag.
  let prodReviewed;
  if (process.env.PROD_FLAGS) {
    const src = readFileSync(resolve('tools/deploy/production/prepare.ts'), 'utf8');
    const block = src.slice(src.indexOf('const reviewed = new Set(['), src.indexOf(']);', src.indexOf('const reviewed = new Set([')));
    prodReviewed = new Set([...block.replace(/\/\/[^\n]*/g, '').matchAll(/'([A-Za-z0-9]+)'/g)].map(m => m[1]));
  }
  // PROBE_XY="fx,fy;fx,fy" (viewport fractions): capture-only build transform exposes scene+camera+Raycaster, and the
  // run prints which mesh/material is under each point (find what renders a look-gap surface). Never in shipped code.
  const probe = process.env.PROBE_XY ? [{ name:'probe', enforce:'pre', transform(code,id){ if(id!==resolve('web/src/render/foundation.ts'))return;
    return `import { Raycaster as __ProbeRaycaster } from 'three';\n` + code.replace('    render(camera: PerspectiveCamera, bloom = true, seconds?: number, groundY?: number): void {',
      '    render(camera: PerspectiveCamera, bloom = true, seconds?: number, groundY?: number): void {\n(globalThis as any).__probe={scene:city.scene,camera,R:__ProbeRaycaster};'); } }] : [];
  const force = forceFlags.length || unforceFlags.length || prodReviewed ? [{ name:'force-flags', enforce:'pre', transform(code,id){ if(id!==resolve('shared/flags.ts'))return; let out=code;
    if(prodReviewed) out=out.split('\n').map(line=>/^\s*\/\//.test(line)?line:line.replace(/\b([A-Za-z0-9]+):\s*(?:true|false)\b/g,(m,k)=>`${k}: ${prodReviewed.has(k)}`)).join('\n');
    for(const [list,v] of [[forceFlags,'true'],[unforceFlags,'false']]) for(const f of list) out=out.replace(new RegExp(`\\b${f}:\\s*(?:true|false)\\b`), `${f}: ${v}`); return out; } }] : [];
  // TRANSFORM='[{"file":"web/src/...ts","from":"exact text","to":"replacement"}]': capture-only source edits for experiments
  // (never a working-tree edit, so nothing can be swept into a peer's commit). Fails loudly if `from` isn't found.
  const edits = process.env.TRANSFORM ? JSON.parse(process.env.TRANSFORM) : [];
  const transform = edits.length ? [{ name:'capture-transform', enforce:'pre', transform(code,id){ let out=code, hit=false;
    for(const e of edits) if(id===resolve(e.file)){ if(!out.includes(e.from)) throw new Error(`TRANSFORM: '${e.from}' not in ${e.file}`); out=out.split(e.from).join(e.to); hit=true; }
    return hit?out:undefined; } }] : [];
  await build({ root: resolve('web'), configFile: resolve('web/vite.config.ts'), logLevel:'warn', plugins: [...force, ...probe, ...transform], build:{ outDir: app, emptyOutDir:true, reportCompressedSize:false, ...(process.env.NOMINIFY ? { minify:false } : {}) } });} // NOMINIFY=1: names survive for tools/_ready-profile.mjs
  pool = await startLocalPool();
  // BUILD_ONLY=1: stop after the build (e.g. a flag-subset dist for phone-perf's GTASF_PHONE_LOCAL_DIST).
  if (process.env.BUILD_ONLY) { console.log(`BUILT ${app}`); try { await pool?.close(); } catch {} process.exit(0); }
  server = await preview({ root: resolve('web'), configFile: resolve('web/vite.config.ts'), build:{ outDir: app }, preview:{ host:'127.0.0.1', port:0, proxy:{ '/api': { target: pool.url.origin, ws:true } } } });
  base = server.resolvedUrls.local[0].replace(/\/$/,'');
  console.log(`PREVIEW ${base}`);
  }
  b=await chromium.launch({headless:true,args:['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  const c=await b.newContext(phone?{viewport:{width:393,height:873},deviceScaleFactor:2.75,isMobile:true,hasTouch:true}:{viewport:{width:1600,height:900},deviceScaleFactor:1.5});
  await c.addInitScript(v=>{try{localStorage.setItem('gtasf.founder.v1',v);}catch{}},founded);
  // OUTFIT=n: seed the saved player outfit (gtasf.outfit), e.g. a cc0People body index.
  if(process.env.OUTFIT) await c.addInitScript(v=>{try{localStorage.setItem('gtasf.outfit',v);}catch{}},process.env.OUTFIT);
  const p=await c.newPage();const er=pageErrors;p.on('pageerror',e=>er.push(e.message));p.on('console',m=>{if(m.type()==='error')er.push(m.text());});
  const gfxq=phone?'preset=low&touch=1':`gfx=${process.env.GFX??'hd'}`;
  // CLOCK_ISO=<ISO time>: start the page clock there and let it run (live-clock repros at night, e.g. gtasf-vwvkl).
  if(process.env.CLOCK_ISO){ await p.clock.install({time:new Date(process.env.CLOCK_ISO)}); await p.clock.resume(); }
  // WEATHER_COVER=0..1: serve /api/weather as live overcast at that cloud cover (sky/weather repros, e.g. gtasf-yzssn).
  if(process.env.WEATHER_COVER) await p.route('**/api/weather',route=>{const now=Date.now();route.fulfill({contentType:'application/json',body:JSON.stringify({version:1,status:'live',fetchedAt:now,expiresAt:now+3600e3,observedAt:now,forecastAt:now,description:'Overcast',cloudCover:Number(process.env.WEATHER_COVER),fog:.1,rain:0,visibilityM:16000,sources:{forecast:null,observation:null}})});});
  await p.goto(`${base}/?at=${at}&time=${process.env.TIME??'golden'}&${gfxq}${process.env.EXTRAQ?'&'+process.env.EXTRAQ:''}`,{waitUntil:'domcontentloaded',timeout:45_000});
  for(let i=0;i<8;i++){if(!(await p.locator('.gt-sa-intro').count()))break;await p.evaluate(()=>document.querySelector('.gt-sa-intro__skip')?.click()).catch(()=>{});await p.waitForTimeout(500);}
  try{const g=p.locator('.gt-identity-go');await g.waitFor({state:'visible',timeout:1500});await g.click({timeout:8000});}catch{}
  const gate=()=>{const w=window.__gtasf;if(!w?.ready)return false;const wo=document.querySelector('#world');if(!wo||wo.dataset.connected!=='true')return false;const l=document.querySelector('#loading');const lg=!l||l.hasAttribute('hidden')||getComputedStyle(l).display==='none';if(!lg)return false;return /arial/i.test(getComputedStyle(document.body).fontFamily);};
  await p.waitForFunction(gate,undefined,{timeout:90_000});
  await p.waitForTimeout(5_000);
  // The SA intro overlay mounts during load and stays on top; dismiss it after the gate (Escape = skip whole intro).
  for(let i=0;i<10;i++){if(!(await p.locator('.gt-sa-intro').count()))break;await p.evaluate(()=>document.querySelector('.gt-sa-intro__skip')?.click());await p.waitForTimeout(400);}
  await p.evaluate(()=>{const d=document.querySelector('dialog[open]');if(d&&/RESUME|GAME OPTIONS/i.test(d.textContent||''))d.querySelector('button')?.click();}).catch(()=>{});
  // PRE_EVAL=<js>: run in the page before the settle (e.g. "__gtasfCombat.kill('wasted')" with testingHarness), then PRE_WAIT_MS.
  // A PRE_EVAL that evaluates to a promise is awaited (e.g. poll until walkers mount, act, wait), then PRE_WAIT_MS.
  if(process.env.PRE_EVAL){ await p.evaluate(src=>{const r=(0,eval)(src); return r&&typeof r.then==='function'?r.then(()=>null):null;},process.env.PRE_EVAL); await p.waitForTimeout(Number(process.env.PRE_WAIT_MS??10_000)); }
  await p.waitForTimeout(2_500 + Number(process.env.SETTLE_MS ?? 0)); // SETTLE_MS: extra wait (aerial far ring streams after READY)
  // FPS_MS=n: sample rAF frame times for n ms at this pose (phone: CDP 4x CPU throttle, like phone-perf), print mean/p95.
  if(process.env.FPS_MS){ const cdp=await c.newCDPSession(p); if(phone) await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
    const ft=await p.evaluate(ms=>new Promise(res=>{const out=[];let last=performance.now();const end=last+ms;const f=t=>{out.push(t-last);last=t;if(t<end)requestAnimationFrame(f);else res(out);};requestAnimationFrame(f);}),Number(process.env.FPS_MS));
    if(phone) await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
    const sorted=[...ft].sort((a,b)=>a-b), mean=ft.reduce((a,b)=>a+b,0)/ft.length;
    console.log(`FPS n=${ft.length} mean=${(1000/mean).toFixed(1)}fps p95=${sorted[Math.floor(sorted.length*.95)].toFixed(1)}ms max=${sorted.at(-1).toFixed(0)}ms`); }
  await mkdir(out,{recursive:true});const path=`${out}/${label}-${phone?'phone':'desktop'}-${spot}.png`,tmp=`${path}.tmp.png`;
  await p.screenshot({path:tmp,animations:'disabled',timeout:45_000});const {size}=await stat(tmp);
  if(size<300_000){await rm(tmp,{force:true});console.log(`TOOSMALL ${label} ${size}B err=${er.slice(0,3)}`);}
  else{await rename(tmp,path);console.log(`OK ${label}/${spot} ${size}B err=${er.length} ${er.slice(0,2)}`);}
  // PRINT_POS=1: the snapped player pose (world metres) for placing props relative to a ?at= spawn.
  if(process.env.PRINT_POS) console.log(`POS ${JSON.stringify(await p.evaluate(()=>{const f=window.__gtasf?.world?.foot;return f&&{x:+f.x.toFixed(2),y:+f.y.toFixed(2),z:+f.z.toFixed(2),yaw:f.yaw};}))}`);
  // PRINT_EVAL=<js expr>: print a JSON page value after the shot (e.g. a trace a PRE_EVAL recorded).
  if(process.env.PRINT_EVAL) console.log(`EVAL ${JSON.stringify(await p.evaluate(src=>(0,eval)(src),process.env.PRINT_EVAL))}`);
  if(process.env.PROBE_XY) for(const pt of process.env.PROBE_XY.split(';')){ const [fx,fy]=pt.split(',').map(Number);
    const hits=await p.evaluate(([fx,fy])=>{const P=globalThis.__probe;if(!P)return 'no probe';const r=new P.R();r.setFromCamera({x:fx*2-1,y:1-fy*2},P.camera);
      return r.intersectObject(P.scene,true).slice(0,4).map(h=>{const m=Array.isArray(h.object.material)?h.object.material[0]:h.object.material;const chain=[];let o=h.object;while(o&&chain.length<4){chain.push(o.name||o.type);o=o.parent;}
        let c=h.object;while(c&&c.name!=='GTASF_chunk')c=c.parent;const ud=c?Object.entries(c.userData).filter(([k,v])=>typeof v!=='object'&&typeof v!=='function').map(([k,v])=>k+'='+v).join(','):'';
        const col=h.object.geometry?.attributes?.color, vc=col&&h.face?[col.getX(h.face.a),col.getY(h.face.a),col.getZ(h.face.a)].map(v=>Math.round(v*255)).join('/'):'';
        return `${h.distance.toFixed(2)}m y=${h.point.y.toFixed(2)}${vc?' rgb='+vc:''} ${chain.join(' < ')} | ${m?.type} key=${(m?.customProgramCacheKey?.()??'').slice(0,40)} chunk[${c?.uuid?.slice(0,6)} ${ud}]`;});},[fx,fy]);
    console.log(`PROBE ${pt}: ${JSON.stringify(hits,null,1)}`); }
  // PROBE_HIDE=name[,name]: hide every scene object with that name, then save <path>-hide.png (layer attribution).
  if(process.env.PROBE_HIDE){ const n=await p.evaluate(names=>{let c=0;globalThis.__probe?.scene.traverse(o=>{if(names.includes(o.name)){o.visible=false;c++;}});return c;},process.env.PROBE_HIDE.split(','));
    await p.waitForTimeout(800); await p.screenshot({path:path.replace('.png','-hide.png'),animations:'disabled'}); console.log(`HID ${n} objects`); }
  await b.close();try{await server?.httpServer?.close();}catch{}try{await pool?.close();}catch{}process.exit(0);
}catch(e){console.log(`FATAL ${e?.message??e}`);if(pageErrors.length)console.log(`PAGE ERRORS ${pageErrors.slice(0,5).join(' | ')}`);try{await b?.close();}catch{}try{server?.httpServer?.close();}catch{}try{await pool?.close();}catch{}process.exit(5);}
