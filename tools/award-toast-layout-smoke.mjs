/** Actual DOM modules; no network, city, device or GPU acceptance. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';

const out = resolve('artifacts/award-toast-layout');
await mkdir(out, { recursive: true });
const html = await readFile('web/index.html', 'utf8');
const header = html.match(/<header>[\s\S]*?<\/header>/)?.[0];
const toolbar = html.match(/<nav id="play-controls"[\s\S]*?<\/nav>/)?.[0];
const footer = html.match(/<footer>[\s\S]*?<\/footer>/)?.[0];
assert(header && toolbar && footer);
await writeFile(`${out}/index.html`, `<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Award toast placement</title><canvas id="world"></canvas><div id="app">${header}<aside>Connected · 1 player</aside>${toolbar}${footer}</div><div id="options" hidden></div><script type="module" src="/entry.js"></script>`);
await writeFile(`${out}/entry.js`, `
import '${resolve('web/src/style.css')}';
import '${resolve('web/src/theme/saTheme.css')}';
import '${resolve('web/src/outbid/outbid.css')}';
import { createDropBanner } from '${resolve('web/src/drops/banner.ts')}';
import { createPhoneHud } from '${resolve('web/src/hud/phoneHud.ts')}';
import { createPlayableHud } from '${resolve('web/src/hud/playableHud.ts')}';
import { createStreetHud } from '${resolve('web/src/hud/streetHud.ts')}';
import { createToasts } from '${resolve('web/src/hud/toast.ts')}';
import { createUpcomingEvents } from '${resolve('web/src/events/upcoming.ts')}';
import { createChat } from '${resolve('web/src/chat/client.ts')}';
import { createRadar } from '${resolve('web/src/radar/radar.ts')}';
import { TouchControls } from '${resolve('web/src/input/touch.ts')}';
import { Group } from 'three';
import { createFundingRoom } from '${resolve('web/src/funding/room.ts')}';
document.body.classList.add('gt-outbid-active');
const sponsor=document.createElement('div');sponsor.className='gt-outbid-banner';sponsor.innerHTML='<div class="gt-outbid-winner"><strong class="gt-outbid-name">The crown is open</strong><div class="gt-outbid-message">Be the first to put your name over San Francisco.</div></div><div class="gt-outbid-target">First bid: $1.00</div><button class="gt-outbid-claim">Outbid them</button>';document.body.append(sponsor);
document.querySelector('#movement-mode').textContent='Game options';document.querySelector('#ride').hidden=false;
for(const [className,text] of [['gt-eventsubmit-open','+ Add event'],['gt-referral-launch','Invite friends, raise faster']]){const button=document.createElement('button');button.className=className;button.textContent=text;document.querySelector('#play-controls').append(button);}
const frame={origin:{lat:37.7955,lon:-122.3937},gridRotationDeg:0};
const banner=createDropBanner(),hud=createPlayableHud(),street=createStreetHud();
hud.update({now:1791100000000,fundingCents:1040000000,radioStation:'Radio off'});street.update({street:'The Embarcadero',neighbourhood:'Financial District / South Beach'});
const upcoming=createUpcomingEvents({frame,enabled:true,onSelect(){},onHail(){}});upcoming.setEvents([]);
const chat=createChat({send(){return true;},connected(){return true;}});
const radar=createRadar({graph:{nodes:[],edges:[]},frame,enabled:true,autoLoad:false,onSelect(){}});
const phone=createPhoneHud({parent:document.querySelector('#options'),closeOptions(){},enabled:true});
const touch=new TouchControls(document.querySelector('#world'),true);
const room=createFundingRoom({scene:new Group(),surfaceHeightAt(){return 0;}});
room.update({target:{eventId:'next',title:'FARR Summit After Party',anchor:{x:0,z:0},radiusM:8,alreadyAwarded:false,quote:{amountCents:50000000,streakMultiplier:1}},inside:true,status:null,progress:0});
const trip=document.querySelector('#trip-status');trip.textContent='ARRIVED · Lombard switchbacks';trip.dataset.notice='true';
const toasts=createToasts({durationMs:600000});
const drop={id:'layout',fundName:'Cap Table Capital',tagline:'Cap Table Capital announces a new fund — come pitch!',capacity:50,remaining:50,closesAt:1791100900000,yourClaim:null};
const client={active:[drop],nearest:{drop,compass:'NW',distance:3200},state:{upcoming:null}};
let serial=0;
function award(count=1){toasts.clear();serial++;for(let i=0;i<count;i++)toasts.show({title:i===count-1?'Physical AI Paper Club & Science Dinner '+serial:'Warm intro '+serial+' / '+(i+1),amount:'+$500k',detail:'SEED',tone:'event'});}
function show(long=false){client.active=[drop];client.nearest={drop,compass:'NW',distance:3200};client.state.upcoming=long?{fundName:'Product-Market Fit Partners',location:{label:'Washington Square, North Beach'},opensAt:1791100120000}:null;banner.update(client,1791100000000);touch.show(innerWidth<=700||innerHeight<460);}
show();award();
window.fixture={show,award,hideDrop(){client.active=[];client.nearest=null;banner.update(client);},destroy(){toasts.dispose();touch.dispose();room.destroy();radar.destroy();chat?.destroy();upcoming.destroy();street.destroy();phone.destroy();hud.destroy();banner.destroy();}};
`);
const config={configFile:false,root:out,publicDir:false,logLevel:'warn',resolve:{alias:{'@gtasf/shared':resolve('shared')}},build:{target:'es2022',outDir:`${out}/app`,emptyOutDir:true,reportCompressedSize:false}};
await build(config);
const server=await preview({...config,preview:{host:'127.0.0.1',port:0}});
const report={at:new Date().toISOString(),scope:'Actual HUD modules with synthetic drop and award data; no full game/device acceptance',errors:[],cases:[],passed:false};
let browser;
try{
 browser=await chromium.launch({headless:true,args:['--disable-gpu','--disable-webgl']});const page=await browser.newPage();
 page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 page.on('response',r=>{if(r.status()>=400)report.errors.push('HTTP '+r.status()+' '+r.url());});
 await page.goto(server.resolvedUrls.local[0]);await page.waitForFunction(()=>window.fixture);
 for(const [name,width,height,long,count] of [['desktop',1440,900,false,1],['desktop-stack',1440,900,true,4],['tablet',768,1024,true,4],['phone',390,844,false,1],['phone-stack',390,844,true,4],['small-phone',320,568,false,4],['small-phone-teaser',320,568,true,4],['landscape',844,390,false,4],['desktop-return',1440,900,false,1]]){
  await page.setViewportSize({width,height});await page.evaluate(({long,count})=>{window.fixture.show(long);window.fixture.award(count);},{long,count});
  await page.waitForTimeout(450);
  const value=await page.evaluate(()=>{
   const boxes=selector=>[...document.querySelectorAll(selector)].filter(el=>el.checkVisibility({visibilityProperty:true})).map(el=>{const r=el.getBoundingClientRect();return {selector:el.className||el.id,x:r.x,y:r.y,width:r.width,height:r.height};});
   return {toasts:boxes('.gt-toast'),obstacles:boxes('.gt-outbid-banner,.gt-drop-banner,#app>header,#app>aside,#app>footer,#play-controls,.gt-hud,.gt-upcoming-open,.gt-chat-ambient,.gt-street-hud,.gt-radar,.gt-funding-room,.gtasf-touch.on .stick,.gtasf-touch.on .buttons'),placed:document.querySelector('.gt-toasts').dataset.placed,compact:document.querySelector('.gt-toasts').dataset.compact,pointer:getComputedStyle(document.querySelector('.gt-toasts')).pointerEvents,allAwards:document.querySelectorAll('.gt-toast').length};
  });
  report.cases.push({name,width,height,...value});await page.screenshot({path:`${out}/${name}.png`});
  assert.equal(value.placed,'true',name+': latest award is painted');assert(value.toasts.length>0,name+': latest award remains visible');assert.equal(value.allAwards,count);assert.equal(value.pointer,'none');
  for(const toast of value.toasts){assert(toast.x>=0&&toast.y>=0&&toast.x+toast.width<=width+1&&toast.y+toast.height<=height+1,name+': fits viewport');for(const block of value.obstacles)assert(!(Math.min(toast.x+toast.width,block.x+block.width)>Math.max(toast.x,block.x)+1&&Math.min(toast.y+toast.height,block.y+block.height)>Math.max(toast.y,block.y)+1),name+': clears '+block.selector);}
 }
 await page.evaluate(()=>window.fixture.hideDrop());await page.waitForTimeout(100);await page.evaluate(()=>window.fixture.award());await page.waitForTimeout(350);
 const recovered=await page.evaluate(()=>{const el=document.querySelector('.gt-toasts');return {placed:el.dataset.placed,top:el.getBoundingClientRect().top};});
 assert.equal(recovered.placed,'true','Award is painted after fund notice clears');
 assert(recovered.top<report.cases.at(-1).toasts[0].y,'Award recovers the vacated notice space');report.noticeHideRecovery=recovered;
 assert.equal(await page.locator('.gt-toast').count(),1);await page.evaluate(()=>window.fixture.destroy());assert.equal(await page.locator('.gt-toasts').count(),0);
 assert.deepEqual(report.errors,[]);report.passed=true;console.log('AWARD_TOAST_LAYOUT:PASS:'+report.cases.length);
}catch(e){report.failure=String(e);throw e;}finally{await browser?.close();server.httpServer.closeAllConnections();await new Promise(done=>server.httpServer.close(done));await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
