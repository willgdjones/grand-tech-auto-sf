/** Production DOM/CSS layout only; no WebGL, network world, or device/performance claim. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { build } from 'vite';
import { chromium } from '@playwright/test';

const root=process.cwd(),out=resolve(process.env.GTASF_STREET_HUD_OUT??'artifacts/street-hud-layout');
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

document.querySelector('#loading').hidden=true;
document.body.style.background='#40564b';
document.querySelector('#connection').textContent='DOM layout fixture';
document.querySelector('#prompt').textContent='WASD walk · Shift run · H hail a robotaxi';
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
window.streetLayout={
  set({name,radio,sponsor}) {
    document.body.classList.toggle('gt-outbid-active',sponsor);
    hud.update({now:1791000000000,radioPlaying:radio,radioStation:'BART Delays FM',radioTicker:radio?'Your next connection is delayed by a venture round.':''});
    street.update({street:name,neighbourhood:'Nob Hill'},0);
    street.update({street:name,neighbourhood:'Nob Hill'},1000);
  },
  destroy(){phone?.destroy();options.destroy();events.destroy();perks.destroy();funding.destroy();street.destroy();hud.destroy();}
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
const report={at:new Date().toISOString(),scope:'Production HUD constructors and CSS; geometry/visual layout only',errors:[],cases:[],passed:false};
let browser;
try {
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  browser=await chromium.launch({headless:true,args:['--disable-gpu']});
  const page=await browser.newPage({viewport:{width:1100,height:720},reducedMotion:'reduce'});
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
  page.on('response',response=>{if(response.status()>=400)report.errors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`);});
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.streetLayout);await page.evaluate(()=>document.fonts.ready);
  const cases=[
    {id:'compact-default',width:1100,height:720,name:'Broadway',radio:false,sponsor:true},
    {id:'compact-radio-long',width:1100,height:720,name:'Dr. Martin Luther King Jr. Drive',radio:true,sponsor:true},
    {id:'narrow-desktop',width:800,height:720,name:'Dr. Martin Luther King Jr. Drive',radio:true,sponsor:true},
    {id:'desktop-breakpoint',width:701,height:720,name:'Dr. Martin Luther King Jr. Drive',radio:true,sponsor:true},
    {id:'compact-no-sponsor',width:1100,height:720,name:'Broadway',radio:true,sponsor:false},
    {id:'tall-desktop',width:1365,height:900,name:'Dr. Martin Luther King Jr. Drive',radio:true,sponsor:true},
    {id:'phone',width:390,height:844,name:'Broadway',radio:false,sponsor:true},
    {id:'phone-long',width:320,height:844,name:'Dr. Martin Luther King Jr. Drive',radio:true,sponsor:true},
  ];
  for(const c of cases) {
    await page.setViewportSize({width:c.width,height:c.height});
    await page.waitForFunction(phone=>document.body.classList.contains('gt-phone-hud')===phone,c.width<=700);
    await page.evaluate(c=>window.streetLayout.set(c),c);
    const boxes=await page.evaluate(()=>{
      const selectors=['.gt-street-hud','.gt-hud','.gt-funding-controls','.gt-upcoming-open','#app>header','#play-controls'];
      return Object.fromEntries(selectors.map(selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect();return [selector,el.checkVisibility({visibilityProperty:true})?{left:r.left,top:r.top,right:r.right,bottom:r.bottom}:null];}));
    });
    report.cases.push({...c,boxes});
    await page.screenshot({path:resolve(out,`${c.id}.png`)});
    const street=boxes['.gt-street-hud'];assert(street,'Street remains visible');
    assert(street.left>=0&&street.right<=c.width&&street.top>=0&&street.bottom<=c.height,'Full street label stays in viewport');
    for(const [selector,other] of Object.entries(boxes))if(selector!=='.gt-street-hud'&&other)
      assert(street.right<=other.left||street.left>=other.right||street.bottom<=other.top||street.top>=other.bottom,`${c.id}: street overlaps ${selector}`);
    for(const selector of ['.gt-funding-controls button','.gt-upcoming-open'])for(const button of await page.locator(selector).all())if(await button.isVisible())
      assert(await button.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));}),`${c.id}: control remains reachable`);
    assert.equal(await page.locator('.gt-street-name').innerText(),c.name,'Full source name retained');
  }
  assert.deepEqual(report.errors,[]);await page.evaluate(()=>window.streetLayout.destroy());report.passed=true;
  console.log(`STREET_HUD_LAYOUT:PASS:${report.cases.length} cases`);
} catch(error){report.failure=String(error);throw error;}
finally {
  await browser?.close();server.closeAllConnections();if(server.listening)await new Promise(done=>server.close(done));
  await writeFile(resolve(out,'report.json'),`${JSON.stringify(report,null,2)}\n`);
}
