/** Real touch controls, browser hit regions and CDP multi-touch; isolated component, not an FPS gate. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

const out = resolve('docs/perf/touch-compact'), source = resolve('artifacts/touch-compact');
await mkdir(out, { recursive: true }); await mkdir(source, { recursive: true });
const baselineCommit = '9cbe403', before = execFileSync('git', ['show', `${baselineCommit}:web/src/input/touch.ts`], { encoding: 'utf8' });
const candidate = await readFile('web/src/input/touch.ts', 'utf8');
await writeFile(`${source}/before.ts`, before.replace("'./touch/joystick'", JSON.stringify(resolve('web/src/input/touch/joystick.ts'))));
await writeFile(`${source}/index.html`, '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><style>body{margin:0;background:#183448}canvas{position:fixed;inset:0;width:100%;height:100%}</style><canvas></canvas><script type="module" src="/entry.js"></script>');
await writeFile(`${source}/entry.js`, `
import {TouchControls as Before} from './before.ts';
import {TouchControls as After} from '${resolve('web/src/input/touch.ts')}';
const control=new (location.search.includes('before')?Before:After)(document.querySelector('canvas'),true);
const events=[];
for(const type of ['pointerdown','pointerup','pointercancel','lostpointercapture'])window.addEventListener(type,e=>events.push({type,id:e.pointerId,target:e.target.dataset.action??e.target.className}),true);
window.fixture={mode:m=>{events.length=0;control.setMode(m)},read:()=>control.read(),events:()=>events,dispose:()=>control.dispose()};
`);
const config = { configFile: false, root: source, publicDir: false, logLevel: 'warn',
  resolve: { alias: { '@gtasf/shared': resolve('shared') } },
  build: { target: 'es2022', outDir: `${source}/app`, emptyOutDir: true, reportCompressedSize: false } };
await build(config); const server = await preview({ ...config, preview: { host: '127.0.0.1', port: 0 } });
const report = { at: new Date().toISOString(), scope: 'Real TouchControls DOM and native pointer events, isolated component only',
  baselineCommit, baselineSha256: createHash('sha256').update(before).digest('hex'),
  candidateSha256: createHash('sha256').update(candidate).digest('hex'), cases: [], errors: [], passed: false };
let browser;
const intersects = (a, b) => a && b && Math.min(a.x+a.width,b.x+b.width)>Math.max(a.x,b.x)
  && Math.min(a.y+a.height,b.y+b.height)>Math.max(a.y,b.y);
async function geometry(page) {
  return page.evaluate(() => {
    const box = e => { const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}; };
    const stick=document.querySelector('.gtasf-touch .stick');
    return {stick:stick.hidden?null:box(stick),buttons:[...document.querySelectorAll('.gtasf-touch button')].filter(e=>!e.hidden).map(e=>({action:e.dataset.action,...box(e)}))};
  });
}
try {
  browser=await chromium.launch({headless:true,args:['--disable-gpu','--disable-webgl']});
  for(const [width,height] of [[320,568],[360,640],[390,844],[844,390],[320,390]]) {
    const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,deviceScaleFactor:1});
    const page=await context.newPage(),cdp=await context.newCDPSession(page);
    page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
    page.on('response',r=>{if(r.status()>=400)report.errors.push(`HTTP ${r.status()} ${r.url()}`);});
    const dispatch=(type,points=[])=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points.map(p=>({...p,radiusX:5,radiusY:5,force:1}))});
    const read=()=>page.evaluate(()=>window.fixture.read());
    await page.goto(`${server.resolvedUrls.local[0]}?before`);await page.waitForFunction(()=>Boolean(window.fixture));
    const baseline={};
    for(const mode of ['on-foot','driver','passenger']) {await page.evaluate(m=>window.fixture.mode(m),mode);baseline[mode]=await geometry(page);}
    await page.goto(server.resolvedUrls.local[0]);await page.waitForFunction(()=>Boolean(window.fixture));
    for(const mode of ['on-foot','driver','passenger']) {
      await page.evaluate(m=>window.fixture.mode(m),mode);const boxes=await geometry(page);
      const result={width,height,mode,baseline:baseline[mode],boxes,passed:false};report.cases.push(result);
      await page.screenshot({path:`${out}/${width}x${height}-${mode}.png`});
      for(const b of boxes.buttons) {
        assert(b.x>=0&&b.y>=0&&b.x+b.width<=width&&b.y+b.height<=height,`${b.action} fits ${width}x${height}`);
        assert(b.width>=44&&b.height>=44,'Every tap target is at least44px');
        assert(!intersects(boxes.stick,b),`${mode}: ${b.action} does not overlap stick`);
        assert(await page.locator(`[data-action="${b.action}"]`).evaluate(e=>{const r=e.getBoundingClientRect();return e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),'Action receives its own touch');
      }
      if(width===390||width===844)assert.deepEqual(boxes,baseline[mode],'Established standard/landscape geometry unchanged');
      if(width===320&&height===568&&mode==='on-foot')assert(baseline[mode].buttons.some(b=>intersects(baseline[mode].stick,b)),'Pinned baseline reproduces overlap');
      const action=mode==='driver'?'throttle':'enter-exit',b=boxes.buttons.find(b=>b.action===action);
      const finger={id:2,x:b.x+b.width/2,y:b.y+b.height/2};
      let stickFinger;
      if(boxes.stick) {
        const s=boxes.stick,centre={id:1,x:s.x+s.width/2,y:s.y+s.height/2};
        stickFinger={id:1,x:centre.x+36,y:centre.y-36};
        await dispatch('touchStart',[centre]);await dispatch('touchMove',[stickFinger]);
        const movement=await read();assert(movement.move.x>.3&&movement.move.y>.3,'First finger moves/steers');
        await dispatch('touchStart',[stickFinger,finger]);
        const both=await read();assert(both.move.x>.3&&both.move.y>.3&&both.actions.includes(action),'Second finger activates action without losing movement');result.simultaneous=both;
        // End the action finger; keep the independently captured movement finger down.
        await dispatch('touchEnd',[finger]);
        result.afterActionRelease=await read();
        result.pointerEvents=await page.evaluate(()=>window.fixture.events());
        assert(result.afterActionRelease.move.x>.3,'Releasing action preserves movement');
        assert(!result.afterActionRelease.actions.includes(action),'Released button is no longer held');
      } else {
        await dispatch('touchStart',[finger]);assert((await read()).actions.includes(action),'Passenger exit remains usable');
      }
      await dispatch('touchCancel');const stopped=await read();assert.deepEqual(stopped.move,{x:0,y:0});assert.equal(stopped.actions.length,0);
      // A separate real canvas drag still controls the view in every seat mode.
      await dispatch('touchStart',[{id:3,x:width/2,y:80}]);await dispatch('touchMove',[{id:3,x:width/2+35,y:100}]);
      const look=await read();assert(look.look.x>.1&&look.look.y>.05,'Camera drag survives compact layout');
      await dispatch('touchCancel');result.camera=look.look;result.passed=true;
    }
    await page.evaluate(()=>window.fixture.dispose());assert.equal(await page.locator('.gtasf-touch').count(),0);
    assert.equal(await page.locator('canvas').evaluate(e=>e.style.touchAction),'');await context.close();
  }
  assert.deepEqual(report.errors,[]);report.passed=true;console.log('TOUCH_COMPACT:PASS 15 mode/viewport cases; native movement+action and camera input');
}catch(error){report.failure=String(error);throw error;}
finally{await browser?.close();server.httpServer.closeAllConnections();await new Promise(done=>server.httpServer.close(done));await writeFile(`${out}/report.json`,JSON.stringify(report,null,2)+'\n');}
