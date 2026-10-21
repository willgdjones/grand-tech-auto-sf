/** Production DOM/CSS layout only; no WebGL, network world, or device/performance claim. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { build } from 'vite';
import { chromium } from '@playwright/test';
import ts from 'typescript';
import {createHash} from 'node:crypto';

const root=process.cwd(),out=resolve(process.env.GTASF_POINTER_FALLBACK_OUT??'artifacts/pointer-fallback-layout');
const source=resolve(out,'source'),app=resolve(out,'app');
await mkdir(source,{recursive:true});
const mainText=await readFile('web/src/main.ts','utf8');
const mainAst=ts.createSourceFile('main.ts',mainText,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
let notifySource='';
function visit(node){
  if(ts.isVariableStatement(node)&&node.declarationList.declarations.some(declaration=>ts.isIdentifier(declaration.name)&&declaration.name.text==='notify'))notifySource=node.getText(mainAst);
  ts.forEachChild(node,visit);
}
visit(mainAst);assert(notifySource,'Use the actual main notify statement, not a copied fixture implementation');
const notifyHash=createHash('sha256').update(notifySource).digest('hex');
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
import {holdFreeCursor} from '/web/src/input/cursor.ts';
import {createRadar} from '/web/src/radar/radar.ts';
import {createRouteGuidance} from '/web/src/navigation/guidance.ts';

document.querySelector('#loading').hidden=true;
document.body.style.background='#40564b';
document.querySelector('#connection').textContent='DOM layout fixture';
document.querySelector('#prompt').textContent='WASD walk · Shift run · H hail a robotaxi';
const canvas=document.querySelector('#world');canvas.style.visibility='visible';
const input=new Input(canvas,{touch:false});
let recenters=0;input.actions.on('recenter',()=>{recenters++;});
const statusLine=document.querySelector('#trip-status');let noticeUntil=0;
${notifySource}
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
let releaseOptionsCursor;
const options=createGameOptions({launcher:document.querySelector('#movement-mode'),tankControls:()=>false,toggleMovement(){},onModalChange(open){input.release();if(open)releaseOptionsCursor??=holdFreeCursor();else{releaseOptionsCursor?.();releaseOptionsCursor=undefined;}}});
input.actions.on('close',()=>options.hide());
const phone=createPhoneHud({parent:options.content,closeOptions:options.hide,enabled:flags.hud&&flags.mobile});
window.footerLayout={
  notify,
  capability(){return {pointerLocked:document.pointerLockElement!==null,recenters,noticeUntil};},
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
  try{res.setHeader('Content-Security-Policy','sandbox allow-scripts allow-same-origin');res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webp':'image/webp'})[extname(file)]??'application/octet-stream');res.end(await readFile(file));}
  catch{res.writeHead(404).end();}
});
const report={at:new Date().toISOString(),scope:'Actual CSP sandbox refusal, production HUD/Input and main notify statement; negative capability fixture, not native/device/performance gate evidence',notifyHash,errors:[],denialMessages:[],cases:[],passed:false};
let browser;
try {
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  browser=await chromium.launch({headless:true,args:['--disable-gpu']});
  const page=await browser.newPage({viewport:{width:1100,height:720},reducedMotion:'reduce'});
  page.setDefaultTimeout(5000);
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'){if(message.text()==="Blocked pointer lock on an element because the element's frame is sandboxed and the 'allow-pointer-lock' permission is not set.")report.denialMessages.push(message.text());else report.errors.push(message.text());}});
  page.on('response',response=>{if(response.status()>=400)report.errors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`);});
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>window.footerLayout);await page.evaluate(()=>document.fonts.ready);
  const cases=[
    {id:'desktop',width:1100,height:720},
    {id:'narrow-desktop',width:800,height:720,longStatus:true},
    {id:'desktop-breakpoint',width:701,height:720,longStatus:true},
    {id:'tall-desktop',width:1365,height:900,longStatus:true},
    {id:'phone-mouse',width:390,height:844,phone:true,longStatus:true,name:'Dr. Martin Luther King Jr. Drive'},
    {id:'small-phone-mouse',width:320,height:844,phone:true,longStatus:true,name:'Dr. Martin Luther King Jr. Drive'},
  ];
  const noIntersection=(a,b)=>a.right<=b.left||a.left>=b.right||a.bottom<=b.top||a.top>=b.bottom;
  for(const c of cases) {
    await page.setViewportSize({width:c.width,height:c.height});
    await page.waitForFunction(phone=>document.body.classList.contains('gt-phone-hud')===phone,Boolean(c.phone));
    await page.evaluate(c=>window.footerLayout.set({name:'Broadway',radio:true,sponsor:true,...c}),c);
    await page.locator('#world').click({position:{x:10,y:350}});
    await page.locator('[data-look-fallback]').waitFor({state:'visible'});
    const boxes=await page.evaluate(()=>{
      const selectors=['[data-look-fallback]','#app>footer','#prompt','#trip-status','#keyboard-help','.gt-radar','.gt-gps-status','.gt-street-hud','.gt-hud','.gt-funding-controls','.gt-upcoming-open','#app>header','#play-controls','.gtasf-touch .stick','.gtasf-touch .buttons'];
      return Object.fromEntries(selectors.map(selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect();return [selector,el.checkVisibility({visibilityProperty:true})?{left:r.left,top:r.top,right:r.right,bottom:r.bottom}:null];}));
    });
    const result={...c,boxes,scroll:[]};report.cases.push(result);
    await page.screenshot({path:resolve(out,`${c.id}.png`)});
    const hint=boxes['[data-look-fallback]'];
    result.overlaps=Object.entries(boxes).filter(([selector,box])=>box&&selector!=='[data-look-fallback]'&&!noIntersection(hint,box)).map(([selector])=>selector);
    assert.deepEqual(result.overlaps,[],`${c.id}: fallback stays clear of HUD, radar and footer`);
    assert(hint.left>=0&&hint.right<=c.width&&hint.top>=0&&hint.bottom<=c.height,'Full hint fits viewport');
    assert.equal(await page.locator('[data-look-fallback]').innerText(),'Use arrow keys to look · C to recenter. Mouse drag is also available.');
    // Preserve the actual sandbox refusal evidence; only expected browser capability denial
    // messages are separated from unexpected application/HTTP errors.
    const before=await page.evaluate(()=>window.footerLayout.capability());assert.equal(before.pointerLocked,false);
    await page.keyboard.press('c');assert.equal((await page.evaluate(()=>window.footerLayout.capability())).recenters,before.recenters+1,'C recenters after refusal');
    await page.keyboard.down('ArrowLeft');
    assert((await page.evaluate(()=>window.footerLayout.sample())).look.x<0,'Arrow camera remains available after real denial');
    await page.keyboard.up('ArrowLeft');
    await page.mouse.move(15,350);await page.mouse.down();await page.mouse.move(55,360);
    assert((await page.evaluate(()=>window.footerLayout.sample())).look.x>0,'Mouse drag remains available after denial');
    await page.mouse.up();await page.evaluate(()=>window.footerLayout.sample());
    if(!c.phone){await page.locator('#trip-status').focus();assert.equal(await page.locator('[data-look-fallback]').isVisible(),false,'Text focus hides fallback guidance');}
    await page.locator('#movement-mode').click();
    assert.equal(await page.locator('[data-look-fallback]').isVisible(),false,'Modal hides fallback guidance');
    await page.keyboard.press('Escape');
  }
  await page.setViewportSize({width:701,height:720});
  await page.evaluate(()=>window.footerLayout.set({name:'Broadway',radio:true,sponsor:true,longStatus:true,phone:false}));
  await page.locator('#trip-status').focus();await page.keyboard.press('End');
  await page.waitForFunction(()=>{const el=document.querySelector('#trip-status');return el.scrollTop>0&&el.scrollHeight-el.clientHeight-el.scrollTop<=1;});
  const newLong='New destination unavailable. Choose a nearby road from the map, return to the Ferry Building, or choose Lombard switchbacks and try again. Your new destination remains selected.';
  const originalTop=await page.locator('#trip-status').evaluate(el=>el.scrollTop);
  await page.evaluate(text=>window.footerLayout.notify(text),newLong);
  const newLongTop=await page.locator('#trip-status').evaluate(el=>el.scrollTop);assert.equal(newLongTop,0,'New long notice starts at its opening');
  await page.keyboard.press('PageDown');
  await page.waitForFunction(()=>document.querySelector('#trip-status').scrollTop>10);
  // Let the browser finish its native key-scroll animation before replacing text again.
  await page.evaluate(()=>new Promise(resolve=>{
    const el=document.querySelector('#trip-status');let last=el.scrollTop,stable=0;
    const sample=()=>{const now=el.scrollTop;stable=now===last?stable+1:0;last=now;if(stable>=3)resolve();else requestAnimationFrame(sample);};requestAnimationFrame(sample);
  }));
  const beforeRepeat=await page.locator('#trip-status').evaluate(el=>el.scrollTop);
  await page.evaluate(text=>window.footerLayout.notify(text),newLong);
  const repeatedTop=await page.locator('#trip-status').evaluate(el=>el.scrollTop);assert.equal(repeatedTop,beforeRepeat,'Identical notice preserves reader position');
  await page.evaluate(()=>window.footerLayout.notify('Robotaxi is here.'));
  const shortTop=await page.locator('#trip-status').evaluate(el=>el.scrollTop);assert.equal(shortTop,0,'Short replacement resets too');
  report.noticeReplacement={originalTop,newLongTop,beforeRepeat,repeatedTop,shortTop};
  assert(report.denialMessages.length>=1,'The real browser must report sandbox refusal');
  assert.deepEqual(report.errors,[]);await page.evaluate(()=>window.footerLayout.destroy());report.passed=true;
  console.log(`POINTER_FALLBACK_LAYOUT:PASS:${report.cases.length} cases`);
} catch(error){report.failure=String(error);throw error;}
finally {
  await browser?.close();server.closeAllConnections();if(server.listening)await new Promise(done=>server.close(done));
  await writeFile(resolve(out,'report.json'),`${JSON.stringify(report,null,2)}\n`);
}
