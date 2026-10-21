/** Two independent browser identities, physical keys/clicks and real Worker dwell time. */
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { preview } from 'vite';
import { checkFundingHud } from './funding-hud-smoke.mjs';

let base=process.env.GTASF_SMOKE_URL??'http://127.0.0.1:5173',server;
if(process.env.GTASF_FUNDING_APP){
  server=await preview({configFile:resolve('web/vite.config.ts'),root:resolve('web'),build:{outDir:resolve(process.env.GTASF_FUNDING_APP)},
    preview:{host:'127.0.0.1',port:0,proxy:{'/api':{target:'http://127.0.0.1:8787',ws:true}}}});
  base=server.resolvedUrls.local[0];
}
const out=resolve(process.env.GTASF_FUNDING_DEPTH_OUT??`artifacts/funding-depth/${new Date().toISOString().replaceAll(':','-')}`);
const eventId='tech-week:f9c5d885-7f83-4a7d-b9cb-9df83f93e262';
const report={startedAt:new Date().toISOString(),base,errors:[],httpErrors:[],checks:[],passed:false};
await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:process.env.GTASF_HEADLESS==='1',args:['--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows']});
const sessions=[];
const state=page=>page.evaluate(()=>{
  const w=window.__gtasf.world,f=w.funding;
  return {foot:{...w.foot},yaw:w.camera.yaw,mode:w.mode,connected:document.querySelector('#world').dataset.connected,
    players:Number(document.querySelector('#world').dataset.players),capture:window.__gtasf.capture,
    funding:{profile:f.profile,state:f.status?.state,inside:f.inside,room:f.status?.room,award:f.status?.award,target:f.target},
    toast:document.querySelector('.gt-funding-toast')?.innerText};
});
const distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const angle=a=>Math.atan2(Math.sin(a),Math.cos(a));
async function face(page,point){
  for(let i=0;i<28;i++){
    const s=await state(page),delta=angle(Math.atan2(point.x-s.foot.x,point.z-s.foot.z)+Math.PI-s.yaw);
    if(Math.abs(delta)<.055)return;
    const key=delta>0?'ArrowLeft':'ArrowRight';await page.keyboard.down(key);
    await page.waitForTimeout(Math.max(35,Math.min(450,Math.abs(delta)/1.68*850)));await page.keyboard.up(key);await page.waitForTimeout(75);
  }
  throw new Error('Physical camera keys did not face the marker');
}
async function walk(page,point,radius=3.8){
  await page.bringToFront();const deadline=Date.now()+35_000;
  while(Date.now()<deadline){
    const before=await state(page);if(distance(before.foot,point)<=radius)return;
    await face(page,point);await page.keyboard.down('Shift');await page.keyboard.down('KeyW');
    try{
      const end=Date.now()+Math.min(1300,distance(before.foot,point)/6*700);
      while(Date.now()<end){await page.waitForTimeout(75);if(distance((await state(page)).foot,point)<=radius)return;}
    }finally{await page.keyboard.up('KeyW');await page.keyboard.up('Shift');}
  }
  throw new Error('Physical walking did not reach the marker');
}
async function select(page){
  await page.bringToFront();await page.keyboard.press('KeyV');
  await page.getByRole('tab',{name:/^Tech Week/}).click();
  await page.getByRole('searchbox',{name:'Search upcoming events'}).fill('Investor Happy Hour');
  await page.locator(`[data-event-id="${eventId}"]`).getByRole('button',{name:/^Set destination:/}).click();
  await page.waitForSelector('.gt-upcoming',{state:'hidden'});
  await page.waitForFunction(id=>window.__gtasf.world.funding.target?.eventId===id,eventId);
  return (await state(page)).funding.target.anchor;
}
try{
  for(let i=0;i<2;i++){
    const context=await browser.newContext({viewport:{width:1280,height:900},deviceScaleFactor:1});
    const page=await context.newPage();sessions.push({context,page});page.setDefaultTimeout(50_000);
    page.on('pageerror',error=>report.errors.push({tab:i,message:error.message}));
    page.on('console',message=>{if(message.type()==='error')report.errors.push({tab:i,message:message.text()});});
    page.on('response',response=>{if(response.status()>=400)report.httpErrors.push({tab:i,path:new URL(response.url()).pathname,status:response.status()});});
    await page.goto(base);await page.waitForSelector('#world[data-ready="true"][data-connected="true"]');await page.waitForSelector('#loading',{state:'hidden'});
    const dialog=page.locator('.gt-funding-onboarding[open]');await dialog.waitFor();
    await page.getByLabel('Startup name',{exact:true}).fill(`Crowd ${i?'Beta':'Alpha'} ${Date.now().toString(36)}`);
    await page.getByLabel('Your nickname',{exact:true}).fill(`Crowd Founder ${i+1}`);
    await dialog.getByRole('button',{name:'Save startup',exact:true}).click();await dialog.waitFor({state:'hidden'});
    const s=await state(page);assert.equal(s.capture,false);assert.equal(s.funding.profile.totalCents,'0');
  }
  const [a,b]=sessions.map(s=>s.page),initial=await Promise.all([state(a),state(b)]);
  assert.notEqual(initial[0].funding.profile.deviceId,initial[1].funding.profile.deviceId);
  const payload=await sessions[0].context.request.get(new URL('/api/events',base).href).then(r=>r.json());
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'});
  const days={};for(const event of payload.events){const key=day.format(Date.parse(event.start));days[key]=(days[key]??0)+1;}
  for(let i=5;i<=11;i++)assert.ok(days[`2026-10-${String(i).padStart(2,'0')}`]>0,'Every Tech Week date is present');
  report.calendar={count:payload.events.length,days,live:payload.events.filter(e=>Date.parse(e.start)<=Date.now()&&Date.parse(e.end)>Date.now()).length};
  for(const {page} of sessions){
    const anchor=await select(page),s=await state(page),length=distance(s.foot,anchor);
    const outside={x:anchor.x+(s.foot.x-anchor.x)/length*11,z:anchor.z+(s.foot.z-anchor.z)/length*11};
    await walk(page,outside,.7);assert.ok(distance((await state(page)).foot,anchor)>8,'Stage both founders outside the room before entry');
  }
  for(let i=0;i<sessions.length;i++){
    const {page}=sessions[i],s=await state(page),anchor=s.funding.target.anchor,length=distance(s.foot,anchor),side=i?2:-2;
    const inside={x:anchor.x+(s.foot.z-anchor.z)/length*side,z:anchor.z-(s.foot.x-anchor.x)/length*side};
    await walk(page,inside,1);await page.waitForFunction(()=>window.__gtasf.world.funding.status?.state==='working');
  }
  const working=await Promise.all([state(a),state(b)]);report.working=working;
  assert.ok(working.every(s=>s.players>=2),'Both browser tabs see multiplayer presence');
  assert.ok(working.every(s=>s.funding.profile.totalCents==='0'),'Neither tab receives money before its dwell completes');
  await a.screenshot({path:`${out}/two-founders-working.png`});
  // Alternate real tab focus so browser rAF throttling cannot suspend one client's status polling.
  const awardDeadline=Date.now()+40_000;
  while(Date.now()<awardDeadline){
    for(const {page} of sessions){await page.bringToFront();await page.waitForTimeout(350);}
    if((await Promise.all([state(a),state(b)])).every(s=>s.funding.state==='awarded'))break;
  }
  const awards=await Promise.all([state(a),state(b)]);report.awards=awards;
  for(let i=0;i<awards.length;i++){
    const s=awards[i],award=s.funding.award;
    assert.equal(s.funding.state,'awarded','Both tabs receive the actual server award');
    assert.equal(award.eventId,eventId);assert.equal(award.crowdCount,1);assert.equal(award.crowdMultiplier,1.1);
    assert.equal(award.amountCents,'55000000');assert.equal(s.funding.profile.totalCents,award.amountCents);
    assert.ok(award.awardedAt-working[i].funding.room.startedAt>=20_000,'Server observes twenty actual seconds');
    assert.equal(working[i].funding.room.finishesAt-working[i].funding.room.startedAt,20_000);
    assert.equal(award.profile.round.id,'pre-seed');assert.match(s.toast,/PRE-SEED CLOSED/);assert.match(s.toast,/\+10% crowd/);
  }
  report.checks.push('Two native 20-second awards: each $500k base/off-window ×1.1 crowd = $550k');
  await a.bringToFront();await a.screenshot({path:`${out}/crowd-award-desktop.png`});
  await a.getByRole('button',{name:'Open earned funding leaderboard'}).click();await a.getByRole('button',{name:'Top raisers today',exact:true}).click();
  await a.locator('tbody tr').first().waitFor();
  for(const s of awards)assert.ok((await a.locator('tbody').innerText()).includes(s.funding.profile.startupName));
  assert.match(await a.locator('.gt-funding-reset').innerText(),/midnight SF/);
  assert.match(await a.locator('.gt-funding-next-round').innerText(),/to Seed/);
  await a.screenshot({path:`${out}/funding-board-desktop.png`});
  await a.setViewportSize({width:390,height:844});await a.screenshot({path:`${out}/funding-board-phone.png`});
  assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await a.keyboard.press('Escape');
  await a.locator('.gt-upcoming-open').click();await a.screenshot({path:`${out}/events-phone.png`});
  assert.match(await a.locator('.gt-upcoming-note').innerText(),/Oct 5–11/);
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.httpErrors,[]);report.nativePassed=true;
  for(const {context} of sessions)await context.close();
  report.ui=await checkFundingHud(browser);
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.httpErrors,[]);report.passed=true;
  console.log(`FUNDING_DEPTH_PASSED:${out}`);
}catch(error){report.failure=error.stack??String(error);for(let i=0;i<sessions.length;i++){try{report[`failureState${i}`]=await state(sessions[i].page);await sessions[i].page.screenshot({path:`${out}/failure-${i}.png`});}catch{}}throw error;}
finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2)+'\n');await browser.close();if(server)await new Promise(resolve=>server.httpServer.close(resolve));}
