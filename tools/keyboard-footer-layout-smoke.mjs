/** Production DOM/CSS layout only; no WebGL, network world, or device/performance claim. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { build } from 'vite';
import { chromium } from '@playwright/test';

const root=process.cwd(),out=resolve(process.env.GTASF_KEYBOARD_FOOTER_OUT??'artifacts/keyboard-footer-layout');
const source=resolve(out,'source'),app=resolve(out,'app');
await mkdir(source,{recursive:true});
const entry=resolve(source,'index.html');
const html=(await readFile('web/index.html','utf8')).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')
  .replace('</body>','<script type="module" src="./check.ts"></script></body>');
await writeFile(entry,html);
await writeFile(resolve(source,'check.ts'),`
import '/web/src/style.css';
import {Scene} from 'three';
import {flags} from '/shared/flags.ts';
import {fundingRound} from '/shared/funding.ts';
import {createPlayableHud} from '/web/src/hud/playableHud.ts';
import {createStreetHud} from '/web/src/hud/streetHud.ts';
import {createGameOptions} from '/web/src/hud/gameOptions.ts';
import {createPhoneHud} from '/web/src/hud/phoneHud.ts';
import {createFundingHud} from '/web/src/funding/hud.ts';
import {createFundingPerks} from '/web/src/funding/perks.ts';
import {createUpcomingEvents} from '/web/src/events/upcoming.ts';
import '/web/src/outbid/outbid.css';
import {Input} from '/web/src/input/input.ts';
import {createRadar} from '/web/src/radar/radar.ts';
import {createRouteGuidance} from '/web/src/navigation/guidance.ts';

document.querySelector('#loading').hidden=true;
document.body.style.background='#40564b';
document.querySelector('#connection').textContent='DOM layout fixture';
document.querySelector('#prompt').textContent='WASD walk · Shift run · H hail a robotaxi';
const canvas=document.querySelector('#world');canvas.style.visibility='visible';
const input=new Input(canvas,{touch:false});
const graph={nodes:[],edges:[]};
const radar=createRadar({graph,routeGraph:graph,frame:{origin:{lat:37.8,lon:-122.4},gridRotationDeg:0},autoLoad:false,onSelect(){}});
const guidance=createRouteGuidance({scene:new Scene(),surfaceHeightAt:()=>0,onArrive(){}});
if(!radar||!guidance)throw new Error('Current radar and navigation flags must be enabled');
guidance.setDestination({title:'Lombard switchbacks',x:100,y:0,z:0});
guidance.update({x:0,y:0,z:0},{points:[[0,0,0],[100,0,0]],distanceM:100,approach:{x:100,y:0,z:0},destinationDistanceM:0},'on-foot',false);
const hud=createPlayableHud(),street=createStreetHud();
if(!hud||!street)throw new Error('The current production hud flag must be enabled');
const profile={deviceId:'layout',startupName:'Layout',nickname:'Layout',totalCents:'0',todayCents:'0',round:fundingRound('0'),rank:null,todayRank:null,lastAwardAt:null,streak:0};
const funding=createFundingHud({statusParent:hud.element,onSaveIdentity:async()=>profile,onRefreshLeaderboard:async()=>{throw new Error('No backend in this DOM fixture');}});
if(!funding)throw new Error('The current fundingLoop flag must be enabled');
funding.setProfile(profile);hud.setFundingProfile(profile);
const perks=createFundingPerks({scene:new Scene(),fleet:{cars:new Map()},surfaceHeightAt:()=>0,parent:funding.element});
const events=createUpcomingEvents({frame:{origin:{lat:37.8,lon:-122.4},gridRotationDeg:0},onSelect:()=>{},onHail:()=>{}});
if(!perks||!events)throw new Error('Current production funding and event controls must be enabled');
const options=createGameOptions({launcher:document.querySelector('#movement-mode'),tankControls:()=>false,toggleMovement(){},onModalChange(){}});
const phone=createPhoneHud({parent:options.content,closeOptions:options.hide,enabled:flags.hud&&flags.mobile});
window.footerLayout={
  set({name,radio,sponsor,longStatus,phone}) {
    input.touch.show(Boolean(phone));
    const status=document.querySelector('#trip-status');
    status.textContent=longStatus?'Robotaxi route unavailable. Pick a nearby road from the map, return to the Ferry Building, or choose Lombard switchbacks and try again. Your current destination remains selected.':'Destination: Lombard switchbacks';
    status.dataset.notice=String(longStatus);
    status.scrollTop=0;document.querySelector('#keyboard-help').scrollTop=0;
    document.body.classList.toggle('gt-outbid-active',sponsor);
    hud.update({now:1791000000000,radioPlaying:radio,radioStation:'BART Delays FM',radioTicker:radio?'Your next connection is delayed by a venture round.':''});
    street.update({street:name,neighbourhood:'Nob Hill'},0);
    street.update({street:name,neighbourhood:'Nob Hill'},1000);
  },
  sample(){input.poll(1/60);return {move:{...input.move},look:{...input.look},throttle:input.throttle,brake:input.brake};},
  destroy(){input.dispose();guidance.destroy();radar.destroy();phone?.destroy();options.destroy();events.destroy();perks.destroy();funding.destroy();street.destroy();hud.destroy();}
};
`);
await build({configFile:false,root,publicDir:false,logLevel:'warn',resolve:{alias:{'@gtasf/shared':resolve(root,'shared')}},
  build:{outDir:app,emptyOutDir:true,reportCompressedSize:false,rollupOptions:{input:entry}}});
const builtHtml=resolve(app,entry.slice(root.length+1));
const server=createServer(async(req,res)=>{
  const path=(req.url??'/').split('?')[0];
  if(path==='/favicon.ico'){res.writeHead(204).end();return;}
  const file=path==='/'?builtHtml:resolve(app,`.${path}`);
  if(!file.startsWith(`${app}/`)){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp'})[extname(file)]??'application/octet-stream');res.end(await readFile(file));}
  catch{res.writeHead(404).end();}
});
const report={at:new Date().toISOString(),scope:'Production HUD/radar/GPS/Input constructors and CSS; physical keyboard and layout only, no WebGL/world/performance evidence',errors:[],cases:[],passed:false};
let browser;
try {
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  browser=await chromium.launch({headless:true,args:['--disable-gpu']});
  const page=await browser.newPage({viewport:{width:1100,height:720},reducedMotion:'reduce'});
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
  page.on('response',response=>{if(response.status()>=400)report.errors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`);});
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.footerLayout);await page.evaluate(()=>document.fonts.ready);
  const cases=[
    {id:'desktop',width:1100,height:720},
    {id:'desktop-long',width:1100,height:720,longStatus:true},
    {id:'narrow-desktop',width:800,height:720,longStatus:true},
    {id:'desktop-breakpoint',width:701,height:720,longStatus:true},
    {id:'tall-desktop',width:1365,height:900,longStatus:true},
    {id:'phone',width:390,height:844,phone:true},
    {id:'phone-long',width:320,height:844,longStatus:true,phone:true},
  ];
  const noIntersection=(a,b)=>a.right<=b.left||a.left>=b.right||a.bottom<=b.top||a.top>=b.bottom;
  for(const c of cases) {
    await page.setViewportSize({width:c.width,height:c.height});
    await page.waitForFunction(phone=>document.body.classList.contains('gt-phone-hud')===phone,Boolean(c.phone));
    await page.evaluate(c=>window.footerLayout.set({name:'Broadway',radio:true,sponsor:true,...c}),c);
    const boxes=await page.evaluate(()=>{
      const selectors=['#app>footer','#prompt','#trip-status','#keyboard-help','.gt-radar','.gt-gps-status','.gt-street-hud','.gt-hud','.gt-funding-controls','.gt-upcoming-open','#app>header','#play-controls','.gtasf-touch .stick','.gtasf-touch .buttons'];
      return Object.fromEntries(selectors.map(selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect();return [selector,el.checkVisibility({visibilityProperty:true})?{left:r.left,top:r.top,right:r.right,bottom:r.bottom}:null];}));
    });
    const result={...c,boxes,scroll:[]};report.cases.push(result);
    await page.screenshot({path:resolve(out,`${c.id}.png`)});
    for(const selector of ['#prompt','#trip-status','#keyboard-help']) {
      const box=boxes[selector];if(!box)continue;
      assert(box.left>=0&&box.right<=c.width&&box.top>=0&&box.bottom<=c.height,`${c.id}: ${selector} inside viewport`);
      for(const [otherSelector,other] of Object.entries(boxes))if(other&&!['#app>footer','#prompt','#trip-status','#keyboard-help'].includes(otherSelector))
        assert(noIntersection(box,other),`${c.id}: ${selector} overlaps ${otherSelector}`);
    }
    for(const selector of ['.gt-funding-controls button','.gt-upcoming-open'])for(const button of await page.locator(selector).all())if(await button.isVisible())
      assert(await button.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));}),`${c.id}: control remains reachable`);
    if(!c.phone) {
      assert.equal(await page.locator('#keyboard-help').innerText(),'WASD move / drive · Arrows look · C recenter · V events · Shift run · Space brake · Click for optional mouse look');
      for(const selector of ['#trip-status','#keyboard-help']) {
        await page.locator(selector).focus();
        assert.equal(await page.evaluate(()=>document.activeElement.id),selector.slice(1));
        await page.keyboard.down('ArrowDown');await page.keyboard.down('w');
        const sample=await page.evaluate(()=>window.footerLayout.sample());
        await page.keyboard.up('w');await page.keyboard.up('ArrowDown');
        assert.deepEqual(sample,{move:{x:0,y:0},look:{x:0,y:0},throttle:0,brake:0},`${c.id}: focus consumes gameplay keys`);
        await page.keyboard.press('End');
        await page.waitForFunction(selector=>{const el=document.querySelector(selector);return el.scrollHeight-el.clientHeight-el.scrollTop<=1;},selector);
        const scroll=await page.locator(selector).evaluate(el=>({height:el.clientHeight,full:el.scrollHeight,top:el.scrollTop,text:el.textContent}));
        result.scroll.push({selector,...scroll});
        await page.keyboard.press('Home');
        await page.waitForFunction(selector=>document.querySelector(selector).scrollTop<=1,selector);
      }
      await page.locator('#world').click({position:{x:10,y:350}});await page.keyboard.down('w');
      assert.equal((await page.evaluate(()=>window.footerLayout.sample())).move.y,1,'Movement resumes on scene');
      await page.keyboard.up('w');await page.keyboard.down('ArrowLeft');
      assert((await page.evaluate(()=>window.footerLayout.sample())).look.x<0,'Camera resumes on scene');
      await page.keyboard.up('ArrowLeft');await page.evaluate(()=>window.footerLayout.sample());
    }
  }
  assert.deepEqual(report.errors,[]);await page.evaluate(()=>window.footerLayout.destroy());report.passed=true;
  console.log(`KEYBOARD_FOOTER_LAYOUT:PASS:${report.cases.length} cases`);
} catch(error){report.failure=String(error);throw error;}
finally {
  await browser?.close();server.closeAllConnections();if(server.listening)await new Promise(done=>server.close(done));
  await writeFile(resolve(out,'report.json'),`${JSON.stringify(report,null,2)}\n`);
}
