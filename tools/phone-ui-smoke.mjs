/** Actual onboarding/radar components in isolation; no production flags changed. Use tools/heavy.sh. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const out = resolve(process.env.GTASF_PHONE_UI_OUT ?? 'docs/perf/phone-ui-d6-2026-10-04');
const bundle = resolve('artifacts/phone-ui-d6');
await mkdir(out, { recursive: true }); await mkdir(bundle, { recursive: true });
const report = { scope: 'Real UI components only. Onboarding remains disabled; this is not integrated onboarding or device acceptance.', errors: [], steps: [], passed: false };
const entry = `
import './web/src/style.css';
import './web/src/theme/saTheme.css';
import { SaIntroSlides, SaMissionBanner } from './web/src/theme/saMission';
import { introSlides } from './web/src/onboarding/slides';
import { createRadar } from './web/src/radar/radar';
const graph = { version:1, nodes:[{id:'a',x:-100,y:0,z:0},{id:'b',x:100,y:0,z:0}],
  edges:[{id:'ab',from:'a',to:'b',lengthM:200,speedMps:10,lane:1,points:[[-100,0,0],[100,0,0]]}] };
let intro, mission, radar, draws=0;
const clear = CanvasRenderingContext2D.prototype.clearRect;
CanvasRenderingContext2D.prototype.clearRect = function(...args) { draws++; return clear.apply(this,args); };
window.fixture = {
  openIntro() { intro = new SaIntroSlides(introSlides(true), { onComplete(){window.fixture.completed=true;},onSkip(){window.fixture.skipped=true;} }).mount(); },
  get index(){return intro.index;}, completed:false, skipped:false,
  openMission(){mission=new SaMissionBanner();mission.setStep({title:'GET IN THE CAR',objective:'Walk over to your car. Tap Enter / exit to get in.',reward:'+$5,000',step:{index:0,total:5}});},
  async radar(){radar=createRadar({graph,routeGraph:graph,frame:{origin:{lat:37.7955,lon:-122.3937},gridRotationDeg:0},autoLoad:false,onSelect(){},onHail(){}});await radar.ready;await radar.routingReady;},
  radarSmoke(){
    let tick=1000; const original=performance.now.bind(performance); performance.now=()=>tick;
    try {
      const draw=()=>radar.update({x:0,z:0},0); draw(); const start=draws;
      for(let i=0;i<10;i++){tick++;radar.setRumourZone(null);draw();} const unchangedNull=draws-start;
      tick+=60; draw(); const scheduled=draws-start;
      const zone={x:10,z:20,radius:30};radar.setRumourZone(zone);draw(); const changed=draws;
      radar.setRumourZone({...zone});draw(); const equal=draws-changed;
      zone.x=50;radar.setRumourZone(zone);draw(); const mutated=draws-changed;
      radar.setRumourZone(null);draw(); const cleared=draws-changed;
      return {unchangedNull,scheduled,equal,mutated,cleared};
    } finally {performance.now=original;radar.destroy();}
  }
};`;
await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'js' }, bundle: true,
  platform: 'browser', format: 'esm', outfile: `${bundle}/fixture.js`, logLevel: 'warning' });
const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><script type="module" src="/fixture.js"></script></body></html>';
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.woff2': 'font/woff2', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  try {
    if(req.url === '/favicon.ico'){res.writeHead(204);res.end();return;}
    if(req.url === '/'){res.writeHead(200,{'Content-Type':'text/html'});res.end(html);return;}
    const root = req.url.startsWith('/fixture.') ? bundle : resolve('web/public');
    const path = resolve(root, '.' + req.url);
    if (!path.startsWith(root + '/')) throw new Error('Invalid path');
    res.writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream' }); res.end(await readFile(path));
  } catch { if(!res.headersSent)res.writeHead(404);res.end(); }
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
let browser;
const overlap=(a,b)=>Math.min(a.right,b.right)>Math.max(a.left,b.left)+1&&Math.min(a.bottom,b.bottom)>Math.max(a.top,b.top)+1;
try {
  browser=await chromium.launch({headless:true});
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await context.newPage();
  page.on('pageerror',e=>report.errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
  const check=async(name, action)=>{
    const step={name,passed:false};report.steps.push(step);
    try{step.detail=await action();step.passed=true;}catch(e){step.failure=String(e);console.error(name,e.message);}
    await page.screenshot({path:`${out}/${name}.png`,animations:'disabled'});
  };
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.fixture);
  await page.evaluate(()=>window.fixture.radar());
  await check('radar-redraw-budget',async()=>{
    const r=await page.evaluate(()=>window.fixture.radarSmoke());
    assert.deepEqual(r,{unchangedNull:0,scheduled:1,equal:0,mutated:1,cleared:2});return r;
  });
  for(const width of [390,320]){
    await page.setViewportSize({width,height:844});await page.evaluate(()=>window.fixture.openIntro());
    await page.locator('.gt-sa-intro.gt-sa-show').waitFor();
    for(let index=0;index<3;index++){
      await page.waitForFunction(i=>window.fixture.index===i,index);
      await page.waitForFunction(()=>{const img=document.querySelector('.gt-sa-intro__img');return img.complete&&img.naturalWidth>0;});
      await check(`intro-${width}-${index+1}`,async()=>{
        const boxes=await page.evaluate(()=>{
          const selectors=['.gt-sa-intro__kicker','.gt-sa-intro__title','.gt-sa-intro__body','.gt-sa-intro__controls','.gt-sa-intro__dots','.gt-sa-intro__advance','.gt-sa-intro__skip'];
          return selectors.flatMap(selector=>{const e=document.querySelector(selector),r=e.getBoundingClientRect();return e.checkVisibility()?[{selector,left:r.left,right:r.right,top:r.top,bottom:r.bottom}]:[];});
        });
        for(const b of boxes)assert(b.left>=0&&b.right<=width&&b.top>=0&&b.bottom<=844,`${b.selector} fits`);
        for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++)assert(!overlap(boxes[i],boxes[j]),`${boxes[i].selector} overlaps ${boxes[j].selector}`);
        return boxes;
      });
      await page.touchscreen.tap(width/2,300);
    }
    await page.waitForFunction(()=>window.fixture.completed&&!document.querySelector('.gt-sa-intro'));
  }
  await check('intro-skip',async()=>{
    await page.evaluate(()=>window.fixture.openIntro());await page.getByRole('button',{name:'Skip',exact:true}).tap();
    await page.waitForFunction(()=>window.fixture.skipped&&!document.querySelector('.gt-sa-intro'));
  });
  await check('mission-phone-fit',async()=>{
    await page.evaluate(()=>window.fixture.openMission());await page.locator('.gt-sa-mission.gt-sa-show').waitFor();
    const b=await page.locator('.gt-sa-mission').boundingBox();assert(b.x>=0&&b.x+b.width<=320,'Mission banner fits phone');return b;
  });
  assert.deepEqual(report.errors,[]);report.passed=report.steps.every(s=>s.passed);
}catch(error){report.failure=String(error);}
finally{await browser?.close();server.closeAllConnections();await new Promise(done=>server.close(done));
  await writeFile(`${out}/report.json`,JSON.stringify(report,null,2)+'\n');console.log(`PHONE_UI:${out}/report.json passed=${report.passed}`);if(!report.passed)process.exitCode=1;}
