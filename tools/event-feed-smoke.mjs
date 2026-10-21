/** Isolated DOM/route fixture. No game state, real calendar or ledger is modified. */
import { build } from 'vite';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { resolve,extname } from 'node:path';
import assert from 'node:assert/strict';

const root=process.cwd(),src=resolve('artifacts/event-feed/source'),out=resolve('artifacts/event-feed/preview');
await mkdir(src,{recursive:true});
const graph={version:1,nodes:[{id:'a',x:-100,y:0,z:0},{id:'b',x:100,y:0,z:0}],edges:[{id:'lane:fixture',from:'a',to:'b',lengthM:200,speedMps:10,lane:0,points:[[-100,0,0],[100,0,0]]}]};
await writeFile(resolve(src,'flags.ts'),'export const flags={hud:true,radar:true,eventsApi:true,eventsView:true,eventsRefresh:true,fullMap:true,waypoints:true,fundingLoop:true};');
await writeFile(resolve(src,'index.html'),'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#243b39"><script type="module" src="./scene.ts"></script></body></html>');
await writeFile(resolve(src,'scene.ts'),`
import {Group} from 'three';
import {createRadar} from '/web/src/radar/radar.ts';
import {createUpcomingEvents} from '/web/src/events/upcoming.ts';
import {createEventMarkers} from '/web/src/events/markers.ts';
import {createEventFeed} from '/web/src/events/feed.ts';
const graph=${JSON.stringify(graph)},frame={origin:{lat:37.79,lon:-122.4},gridRotationDeg:0};
let version=1,fail=false,requests=0,chosen=null,fanouts=0;
const scene=new Group(),radar=createRadar({graph,frame,autoLoad:false,routeGraph:graph,routeGraphUrl:'/must-not-fetch',onSelect:()=>true,onHail:()=>false});
radar.update({x:-50,z:0},0);
const upcoming=createUpcomingEvents({frame,now:()=>Date.parse('2026-10-05T17:00:00Z'),onSelect:event=>{chosen=event;return false;},onHail:()=>false});
const markers=createEventMarkers({scene,frame,surfaceHeightAt:()=>0,onEnter:()=>{}});
const fixture=()=>({id:'first',title:'Founder gathering v'+version,start:'2026-10-05T16:00:00Z',end:'2026-10-05T18:00:00Z',lat:37.79,lon:-122.4,approx:true,url:'https://www.tech-week.com/calendar/sf'});
const feed=createEventFeed({fetcher:async()=>{requests++;if(fail)return new Response('',{status:503});const events=[fixture()];if(version>1)events.push({...fixture(),id:'second',title:'Founder second gathering',lon:-122.399});return Response.json({events});},onEvents:events=>{fanouts++;radar.setEvents(events);upcoming.setEvents(events);markers.setEvents(events);markers.update({x:0,y:0,z:0},.1,false);},onError:message=>upcoming.setError(message)});
window.feedSmoke={radar,upcoming,feed,ready:false,inspect:()=>({requests,fanouts,version,radar:radar.eventCount,markers:markers.root.children.length,chosen}),next:async()=>{version++;await feed.refresh();},fail:async()=>{fail=true;await feed.refresh();},destroy:()=>{feed.destroy();upcoming.destroy();markers.destroy();radar.destroy();}};
await Promise.all([feed.ready,radar.routingReady]);window.feedSmoke.ready=true;
`);
await build({configFile:false,root,publicDir:false,logLevel:'warn',resolve:{alias:[{find:/^@gtasf\/shared\/flags$/,replacement:resolve(src,'flags.ts')}]},build:{outDir:out,emptyOutDir:false,rollupOptions:{input:resolve(src,'index.html')}}});
const server=createServer(async(req,res)=>{
  const path=(req.url??'/').split('?')[0];if(path==='/favicon.ico'){res.writeHead(204).end();return;}
  if(path==='/graph'){res.setHeader('content-type','application/json');res.end(JSON.stringify(graph));return;}
  const file=path==='/'?resolve(out,'artifacts/event-feed/source/index.html'):resolve(out,`.${path}`);
  if(!file.startsWith(`${out}/`)){res.writeHead(403).end();return;}
  try{const bytes=await readFile(file);res.setHeader('content-type',({'.html':'text/html','.js':'application/javascript','.css':'text/css'})[extname(file)]??'application/octet-stream');res.end(bytes);}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;const errors=[];
try{
  browser=await chromium.launch({headless:true,args:['--disable-gpu']});
  const page=await browser.newPage({viewport:{width:1200,height:800}});
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.feedSmoke?.ready);
  assert.deepEqual(await page.evaluate(()=>{const s=window.feedSmoke.inspect();return [s.requests,s.fanouts,s.radar,s.markers];}),[1,1,1,1]);
  await page.locator('.gt-radar-head button').first().click();
  await page.getByRole('searchbox',{name:'Find a Tech Week event'}).fill('Founder');
  await page.locator('.gt-radar-list button').first().click();
  await page.locator('.gt-radar-card').getByRole('button',{name:'Set destination',exact:true}).click();
  await page.evaluate(()=>{window.fixtureRoute=window.feedSmoke.radar.route;window.feedSmoke.radar.toggleMap(true);});
  assert.ok(await page.evaluate(()=>!!window.fixtureRoute));
  await page.locator('.gt-radar-card').getByRole('button',{name:'Hail robotaxi',exact:true}).focus();
  await page.evaluate(()=>{window.fixtureFocus=document.activeElement;return window.feedSmoke.next();});
  assert.equal(await page.evaluate(()=>document.activeElement===window.fixtureFocus&&window.feedSmoke.radar.route===window.fixtureRoute),true);
  assert.equal(await page.locator('.gt-radar-card h3').innerText(),'Founder gathering v2');
  assert.equal(await page.getByRole('searchbox',{name:'Find a Tech Week event'}).inputValue(),'Founder');
  assert.deepEqual(await page.evaluate(()=>{const s=window.feedSmoke.inspect();return [s.requests,s.fanouts,s.radar,s.markers];}),[2,2,2,2]);
  await page.screenshot({path:resolve(out,'radar-refresh.png')});
  await page.evaluate(()=>{window.feedSmoke.radar.toggleMap(false);window.feedSmoke.upcoming.toggle(true);});
  await page.getByRole('searchbox',{name:'Search upcoming events'}).fill('Founder');
  const row=page.locator('[data-event-id="first"] .gt-upcoming-choose');await row.focus();
  await page.evaluate(()=>{window.fixtureFocus=document.activeElement;return window.feedSmoke.next();});
  assert.equal(await page.evaluate(()=>document.activeElement===window.fixtureFocus),true);
  await page.keyboard.press('Enter');
  assert.equal((await page.evaluate(()=>window.feedSmoke.inspect())).chosen.title,'Founder gathering v3');
  await page.evaluate(()=>window.feedSmoke.fail());
  assert.match(await page.locator('.gt-upcoming-status').innerText(),/Showing the last loaded events/);
  assert.equal((await page.evaluate(()=>window.feedSmoke.inspect())).radar,2);
  assert.equal(await page.evaluate(()=>window.feedSmoke.radar.route===window.fixtureRoute),true);
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve(out,'calendar-refresh-phone.png')});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.evaluate(()=>window.feedSmoke.destroy());assert.deepEqual(errors,[]);
  const report={checkedAt:new Date().toISOString(),ok:true,singleInitialRequest:true,allViewsRefreshed:true,selectedDetailsUpdated:true,focusPreserved:true,latestSelection:true,gpsRoutePreserved:true,lastGoodCalendarRetained:true,errors};
  await writeFile(resolve(out,'smoke.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
