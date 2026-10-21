/** Real event-view DOM with isolated public-location fixtures; no API or game writes. */
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build,preview } from 'vite';
import { chromium } from '@playwright/test';

const out=resolve('artifacts/event-search');await mkdir(out,{recursive:true});
await writeFile(`${out}/index.html`,'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#264236"><script type="module" src="/entry.js"></script></body></html>');
await writeFile(`${out}/entry.js`, `
import {createUpcomingEvents} from '${resolve('web/src/events/upcoming.ts')}';
let event={id:'local',title:'Founder Breakfast',host:'Fog Builders',venue:'Community Cafe',address:'1 Market Street',start:'2026-10-05T16:00:00Z',end:'2026-10-05T18:00:00Z',lat:37.79,lon:-122.4,approx:true,url:'https://www.tech-week.com/calendar/sf'};
const online={...event,id:'online',title:'Virtual startup salon',host:'Online hosts',venue:null,address:null,lat:null,lon:null,start:'2026-10-06T16:00:00Z',end:'2026-10-06T18:00:00Z'};
let selected=null,lookups=0;
const view=createUpcomingEvents({enabled:true,frame:{origin:{lat:37.79,lon:-122.4},gridRotationDeg:0},now:()=>Date.parse('2026-10-05T17:00:00Z'),neighbourhoodAt:point=>{lookups++;return point.x>50?'North Beach':'Financial District/South Beach';},onSelect:event=>{selected=event;return false;},onHail:()=>false});
view.setEvents([event,online]);view.toggle(true);
window.fixture={view,inspect:()=>({selected,lookups}),refresh:()=>{event={...event,title:'Founder Breakfast Updated',lon:-122.398};view.setEvents([event,online]);},destroy:()=>view.destroy()};
`);
const config={configFile:false,root:out,logLevel:'warn',resolve:{alias:{'@gtasf/shared':resolve('shared')}},build:{target:'es2022',outDir:`${out}/app`,emptyOutDir:true,reportCompressedSize:false}};
await build(config);const server=await preview({...config,preview:{host:'127.0.0.1',port:0}});
const browser=await chromium.launch({headless:true,args:['--disable-gpu']});const report={checkedAt:new Date().toISOString(),errors:[],checks:[]};
try{
  const page=await browser.newPage({viewport:{width:390,height:844}});page.on('pageerror',error=>report.errors.push(error.message));page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
  await page.goto(server.resolvedUrls.local[0]);await page.waitForFunction(()=>!!window.fixture);
  const search=page.getByRole('searchbox',{name:'Search upcoming events'}),rows=page.locator('.gt-upcoming-row');
  for(const query of ['financial district','FOUNDER breakfast','fog builders','community cafe','market street']){
    await search.fill(query);assert.equal(await rows.count(),1);assert.match(await rows.first().innerText(),/Financial District\/South Beach/);
  }
  assert.equal((await page.evaluate(()=>window.fixture.inspect())).lookups,1);
  await search.fill('financial district');await page.getByRole('tab',{name:/^Tomorrow/}).click();assert.equal(await rows.count(),0);
  await page.getByRole('tab',{name:/^Today/}).click();assert.equal(await rows.count(),1);
  await page.getByRole('tab',{name:/^Tech Week/}).click();assert.equal(await rows.count(),1);
  report.checks.push('Displayed neighbourhood, title, host, source venue and public address all match without changing SF date filtering');
  await search.fill('online');assert.equal(await rows.count(),1);
  assert.equal(await rows.first().getByRole('button',{name:/^Set destination:/}).isDisabled(),true);
  assert.equal(await rows.first().getByRole('button',{name:'Hail robotaxi to this event'}).isDisabled(),true);
  report.checks.push('Online rows are searchable while both driving actions stay disabled');
  await search.fill('financial district');await page.mouse.move(0,0);await page.evaluate(()=>window.fixture.refresh());
  assert.equal(await rows.count(),0);assert.equal(await search.inputValue(),'financial district');
  await search.fill('north beach');assert.equal(await rows.count(),1);assert.match(await rows.first().innerText(),/Founder Breakfast Updated/);
  assert.equal((await page.evaluate(()=>window.fixture.inspect())).lookups,2);
  await rows.first().getByRole('button',{name:/^Set destination:/}).click();
  const chosen=(await page.evaluate(()=>window.fixture.inspect())).selected;assert.equal(chosen.title,'Founder Breakfast Updated');assert.equal(chosen.lon,-122.398);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:`${out}/neighbourhood-search-phone.png`});
  report.checks.push('Feed refresh invalidates location labels, preserves query, and selection uses latest public coordinates');
  await page.evaluate(()=>window.fixture.destroy());assert.deepEqual(report.errors,[]);report.passed=true;console.log('TEST_PASSED:EventNeighbourhoodSearch');
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2)+'\n');await browser.close();server.httpServer.closeAllConnections();await new Promise(done=>server.httpServer.close(done));}
