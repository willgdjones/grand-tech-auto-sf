/** Physical Show more navigation through actual Events + Input, without API/GPU. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';
const stage=process.env.GTASF_EVENTS_MORE_STAGE==='before'?'before':'after';
const out=resolve('artifacts/events-more',stage);await mkdir(out,{recursive:true});
const config={configFile:false,root:out,logLevel:'warn',resolve:{alias:{'@gtasf/shared':resolve('shared'),'../input/cursor':resolve('web/src/input/cursor.ts'),'../radar/projection':resolve('web/src/radar/projection.ts'),'./schedule':resolve('web/src/events/schedule.ts')}},build:{target:'es2022',outDir:`${out}/app`,emptyOutDir:true,reportCompressedSize:false}};
if(!process.argv.includes('--run-only')){
  if(stage==='before'){
    await mkdir(`${out}/source`,{recursive:true});
    for(const name of ['upcoming.ts','upcoming.css']){
      try{await writeFile(`${out}/source/${name}`,await readFile(resolve('web/src/events',name)),{flag:'wx'});}
      catch(error){if(error.code!=='EEXIST')throw error;}
    }
  }
  await writeFile(`${out}/index.html`,'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Event pagination keyboard fixture</title><style>body{background:#263932;color:white;margin:20px;font:16px Arial}</style><canvas id="game" tabindex="0" aria-label="Game keyboard"></canvas><script type="module" src="/entry.js"></script>');
  await writeFile(`${out}/entry.js`,`import {createUpcomingEvents} from '${stage==='before'?`${out}/source/upcoming.ts`:resolve('web/src/events/upcoming.ts')}';
import {Input} from '${resolve('web/src/input/input.ts')}';import {createActions} from '${resolve('web/src/input/actions.ts')}';
const requests=[],looks=[],selected=[];window.fetch=async url=>{requests.push(String(url));throw Error('Unexpected request');};
const actions=createActions(),input=new Input(document.querySelector('#game'),{actions,touch:false});actions.on('look',value=>looks.push(value));
const view=createUpcomingEvents({enabled:true,frame:{origin:{lat:37.7955,lon:-122.3937},gridRotationDeg:0},now:()=>Date.parse('2026-10-05T17:00:00Z'),onSelect:event=>selected.push(event.id),onHail:()=>false,onOpenChange:()=>input.release()});
const events=Array.from({length:125},(_,index)=>{const id='e'+String(index+1).padStart(3,'0');return{id,title:'Founders '+id,start:'2026-10-05T19:00:00Z',end:'2026-10-05T20:00:00Z',lat:37.7955+index*.000001,lon:-122.3937,approx:false,url:'https://example.com/'+id};});
view.setEvents(events);const timer=setInterval(()=>input.poll(1/60),16);
window.fixture={view,events,requests,looks,selected,replace(values){view.setEvents(values);},destroy(){clearInterval(timer);view.destroy();input.dispose();actions.dispose();}};
`);await build(config);
}
if(process.argv.includes('--build-only')){console.log('Built '+stage+' Events Show more fixture');process.exit(0);}
const server=await preview({...config,preview:{host:'127.0.0.1',port:0}});let browser;
const report={checkedAt:new Date().toISOString(),stage,scope:'Actual Events + Input DOM with 125 local records; no game renderer or API',errors:[],views:[],passed:false};
try{
  browser=await chromium.launch({headless:true,args:['--disable-gpu','--disable-webgl']});
  for(const[name,width,height]of[['desktop',1100,720],['phone',390,844]]){
    const page=await browser.newPage({viewport:{width,height}});page.setDefaultTimeout(5000);
    page.on('pageerror',error=>report.errors.push(error.message));page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
    await page.goto(server.resolvedUrls.local[0]);await page.waitForFunction(()=>window.fixture);
    const game=page.locator('#game'),search=page.getByRole('searchbox',{name:'Search upcoming events'}),more=page.getByRole('button',{name:'Show more events'}),close=page.getByRole('button',{name:'Close upcoming events'}),rows=page.locator('.gt-upcoming-row');
    const focused=locator=>locator.evaluate(element=>element===document.activeElement);
    const focusedId=()=>page.evaluate(()=>document.activeElement?.closest('.gt-upcoming-row')?.getAttribute('data-event-id')??null);
    const reachMore=async()=>{await close.focus();await page.keyboard.press('Shift+Tab');assert.equal(await focused(more),true);};
    await game.focus();await page.keyboard.press('v');await search.fill('Founders');
    assert.equal(await rows.count(),50);await page.keyboard.press('Shift+Tab');await page.keyboard.press('Shift+Tab');await page.keyboard.press('Shift+Tab');assert.equal(await focused(more),true);
    await page.keyboard.press('Enter');assert.equal(await rows.count(),100);
    const cases=[];
    if(stage==='before'){
      assert.equal(await focused(more),true);await page.keyboard.press('Tab');assert.equal(await focused(close),true);
      cases.push('First Show more leaves focus after the 50 new rows; Tab wraps to Close');
      await page.keyboard.press('Shift+Tab');await page.keyboard.press('Enter');assert.equal(await rows.count(),125);assert.equal(await more.isVisible(),false);
      assert.equal(await focusedId(),null);await page.keyboard.press('Tab');assert.equal(await focused(close),true);
      cases.push('Final Show more hides the focused button; Tab restarts at Close rather than the 25 new rows');
    }else{
      assert.equal(await focusedId(),'e051');assert.equal(await focused(rows.nth(50).locator('.gt-upcoming-choose')),true);
      await page.keyboard.press('Tab');assert.equal(await focused(rows.nth(50).getByRole('button',{name:'Hail robotaxi to this event'})),true);
      await page.screenshot({path:`${out}/${name}-first-new-row.png`});
      await reachMore();await page.keyboard.press('Enter');assert.equal(await rows.count(),125);assert.equal(await more.isVisible(),false);assert.equal(await focusedId(),'e101');
      assert.equal(await search.inputValue(),'Founders');assert.equal(await page.getByRole('tab',{name:/Tech Week/}).getAttribute('aria-selected'),'true');
      await page.keyboard.press('Enter');assert.deepEqual(await page.evaluate(()=>window.fixture.selected),['e101']);assert.equal(await page.evaluate(()=>window.fixture.view.isOpen),false);assert.equal(await focused(game),true);
      cases.push('Enter reveals each batch with focus on its first new event, normal Tab continues there, final Enter selects its GPS destination');
      await page.getByRole('button',{name:/Open Tech Week events/}).click();await search.fill('Founders e');
      await page.evaluate(()=>{const f=window.fixture;f.events[50]={...f.events[50],lat:null,lon:null};f.replace(f.events);});
      await reachMore();await page.keyboard.press('Enter');assert.equal(await focusedId(),'e051');assert.equal(await focused(rows.nth(50).getByRole('link',{name:'Event page'})),true);
      cases.push('An online first new event focuses its usable event-page link instead of a disabled GPS action');
      await page.keyboard.press('Escape');await page.getByRole('button',{name:/Open Tech Week events/}).click();await search.fill('Founders');
      await page.evaluate(()=>{const f=window.fixture;f.events[50]={...f.events[50],url:'bad'};f.replace(f.events);});
      await reachMore();await page.keyboard.press('Enter');assert.equal(await focusedId(),'e051');assert.equal(await focused(rows.nth(50)),true);
      await page.keyboard.press('Tab');assert.equal(await focusedId(),'e052');
      await page.keyboard.press('Escape');await page.evaluate(()=>window.fixture.replace(window.fixture.events.slice(0,51)));
      await page.getByRole('button',{name:/Open Tech Week events/}).click();await search.fill('Founders');
      await reachMore();await page.keyboard.press('Enter');assert.equal(await rows.count(),51);assert.equal(await focusedId(),'e051');
      await page.screenshot({path:`${out}/${name}-passive-last-row.png`});
      await page.keyboard.press('Tab');assert.equal(await focused(close),true);
      cases.push('A first new row with no available action remains readable; Tab reaches the following event or wraps at the final passive row');
    }
    assert.deepEqual(await page.evaluate(()=>window.fixture.looks),[]);assert.deepEqual(await page.evaluate(()=>window.fixture.requests),[]);
    await page.evaluate(()=>window.fixture.destroy());report.views.push({name,cases});await page.close();
  }
  assert.deepEqual(report.errors,[]);report.passed=true;console.log(JSON.stringify({stage,passed:true,views:report.views.length,errors:report.errors}));
}catch(error){report.failure=error.message;throw error;}
finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser?.close();server.httpServer.closeAllConnections();await new Promise(done=>server.httpServer.close(done));}
