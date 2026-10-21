/** Physical date-tab keyboard navigation through real Events + Input; no API/GPU. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';
const stage=process.env.GTASF_EVENTS_TABS_STAGE==='before'?'before':'after';
const out=resolve('artifacts/events-date-tabs',stage);await mkdir(out,{recursive:true});
const config={configFile:false,root:out,logLevel:'warn',resolve:{alias:{'@gtasf/shared':resolve('shared'),'../input/cursor':resolve('web/src/input/cursor.ts'),'../radar/projection':resolve('web/src/radar/projection.ts'),'./schedule':resolve('web/src/events/schedule.ts')}},build:{target:'es2022',outDir:`${out}/app`,emptyOutDir:true,reportCompressedSize:false}};
if(!process.argv.includes('--run-only')){
  if(stage==='before'){
    await mkdir(`${out}/source`,{recursive:true});
    for(const name of ['upcoming.ts','upcoming.css']){
      try{await writeFile(`${out}/source/${name}`,await readFile(resolve('web/src/events',name)),{flag:'wx'});}
      catch(error){if(error.code!=='EEXIST')throw error;}
    }
  }
  await writeFile(`${out}/index.html`,'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Event date keyboard fixture</title><style>body{background:#263932;color:white;margin:20px;font:16px Arial}</style><canvas id="game" tabindex="0" aria-label="Game keyboard"></canvas><script type="module" src="/entry.js"></script>');
  await writeFile(`${out}/entry.js`,`import {createUpcomingEvents} from '${stage==='before'?`${out}/source/upcoming.ts`:resolve('web/src/events/upcoming.ts')}';
import {Input} from '${resolve('web/src/input/input.ts')}';import {createActions} from '${resolve('web/src/input/actions.ts')}';
const requests=[],looks=[],selected=[];window.fetch=async(url)=>{requests.push(String(url));throw Error('Unexpected request');};
const actions=createActions(),input=new Input(document.querySelector('#game'),{actions,touch:false});actions.on('look',value=>looks.push(value));
const view=createUpcomingEvents({enabled:true,frame:{origin:{lat:37.7955,lon:-122.3937},gridRotationDeg:0},now:()=>Date.parse('2026-10-05T17:00:00Z'),onSelect:event=>selected.push(event.id),onHail:()=>false,onOpenChange:()=>input.release()});
view.setEvents([['live','2026-10-05T16:00:00Z','2026-10-05T18:00:00Z'],['today','2026-10-05T19:00:00Z','2026-10-05T20:00:00Z'],['tomorrow','2026-10-06T19:00:00Z','2026-10-06T20:00:00Z'],['week','2026-10-09T19:00:00Z','2026-10-09T20:00:00Z']].map(([id,start,end])=>({id,start,end,title:'Founders '+id,lat:37.7955,lon:-122.3937,approx:false,url:'https://example.com/'+id})));
const timer=setInterval(()=>input.poll(1/60),16);window.fixture={view,input,looks,selected,requests,destroy(){clearInterval(timer);view.destroy();input.dispose();actions.dispose();}};
`);await build(config);
}
if(process.argv.includes('--build-only')){console.log('Built '+stage+' Events date keyboard fixture');process.exit(0);}
const server=await preview({...config,preview:{host:'127.0.0.1',port:0}});let browser;
const report={checkedAt:new Date().toISOString(),stage,scope:'Actual Events and Input DOM with four fixture dates; no game renderer or API',errors:[],views:[],passed:false};
try{
  browser=await chromium.launch({headless:true,args:['--disable-gpu','--disable-webgl']});
  for(const[name,width,height]of[['desktop',1100,720],['phone',390,844]]){
    const page=await browser.newPage({viewport:{width,height}});page.setDefaultTimeout(5000);
    page.on('pageerror',error=>report.errors.push(error.message));page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
    await page.goto(server.resolvedUrls.local[0]);await page.waitForFunction(()=>window.fixture);
    const game=page.locator('#game'),search=page.getByRole('searchbox',{name:'Search upcoming events'}),tabs=page.getByRole('tab');
    const focused=locator=>locator.evaluate(element=>element===document.activeElement);
    const rowIds=()=>page.locator('.gt-upcoming-row').evaluateAll(elements=>elements.map(element=>element.dataset.eventId));
    const active=()=>tabs.evaluateAll(elements=>elements.findIndex(element=>element.getAttribute('aria-selected')==='true'));
    await game.focus();await page.keyboard.press('v');await search.fill('Founders');await page.keyboard.press('Shift+Tab');assert.equal(await focused(tabs.nth(3)),true);
    const cases=[];
    if(stage==='before'){
      await page.keyboard.press('ArrowRight');assert.equal(await focused(tabs.nth(3)),true);assert.equal(await active(),3);
      await page.keyboard.press('Home');assert.equal(await active(),3);
      assert.deepEqual(await tabs.evaluateAll(elements=>elements.map(element=>element.tabIndex)),[0,0,0,0]);
      cases.push('ArrowRight/Home leave the selected date unchanged; all four dates consume Tab stops');
    }else{
      const expectTab=async(index,ids)=>{
        assert.equal(await active(),index);assert.equal(await focused(tabs.nth(index)),true);assert.deepEqual(await rowIds(),ids);
        assert.deepEqual(await tabs.evaluateAll(elements=>elements.map(element=>element.tabIndex)),[0,1,2,3].map(value=>value===index?0:-1));
        const id=await tabs.nth(index).getAttribute('id'),panel=page.getByRole('tabpanel');
        assert.equal(await panel.getAttribute('aria-labelledby'),id);assert.equal(await tabs.nth(index).getAttribute('aria-controls'),await panel.getAttribute('id'));
      };
      await page.keyboard.press('ArrowRight');await expectTab(0,['live']);
      await page.keyboard.press('ArrowLeft');await expectTab(3,['live','today','tomorrow','week']);
      await page.keyboard.press('Home');await expectTab(0,['live']);
      await page.keyboard.press('ArrowRight');await expectTab(1,['live','today']);
      await page.keyboard.press('ArrowRight');await expectTab(2,['tomorrow']);
      await page.keyboard.press('End');await expectTab(3,['live','today','tomorrow','week']);
      cases.push('Left/Right wrap; Home/End and intermediate dates select correct rows with one tab stop and linked panel');
      await page.keyboard.press('Shift+Tab');assert.equal(await focused(page.getByRole('button',{name:'Close upcoming events'})),true);
      await page.keyboard.press('Tab');assert.equal(await focused(tabs.nth(3)),true);await page.keyboard.press('Tab');assert.equal(await focused(search),true);
      assert.equal(await search.inputValue(),'Founders');await page.keyboard.press('Home');assert.equal(await active(),3);
      await page.keyboard.press('End');await page.keyboard.type(' tomorrow');assert.deepEqual(await rowIds(),['tomorrow']);
      cases.push('Tab enters selected date once; search keeps its draft and editing Home/End');
      await search.fill('Founders');await tabs.nth(1).click();await expectTab(1,['live','today']);
      await page.keyboard.press('Control+ArrowRight');await expectTab(1,['live','today']);
      await tabs.nth(1).hover();
      const contrast=await tabs.nth(1).evaluate(element=>{
        const style=getComputedStyle(element),luminance=color=>{
          const rgb=color.match(/[\d.]+/g).slice(0,3).map(Number).map(value=>{value/=255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4;});
          return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
        };
        const a=luminance(style.color),b=luminance(style.backgroundColor);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
      });
      assert(contrast>=4.5,`Selected hovered date text contrast ${contrast.toFixed(2)} is below 4.5`);
      await page.screenshot({path:`${out}/${name}.png`});
      await page.locator('.gt-upcoming-choose').first().focus();await page.keyboard.press('Enter');
      assert.deepEqual(await page.evaluate(()=>window.fixture.selected),['live']);assert.equal(await page.evaluate(()=>window.fixture.view.isOpen),false);
      assert.equal(await focused(game),true);assert.deepEqual(await page.evaluate(()=>window.fixture.looks),[]);
      cases.push('pointer selection and readable hovered date stay synchronized; modifier ignored; Enter chooses event without camera movement');
    }
    assert.deepEqual(await page.evaluate(()=>window.fixture.requests),[]);await page.evaluate(()=>window.fixture.destroy());await page.close();report.views.push({name,cases});
  }
  assert.deepEqual(report.errors,[]);report.passed=true;console.log(JSON.stringify({stage,passed:true,views:report.views.length,errors:report.errors}));
}catch(error){report.failure=error.message;throw error;}
finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser?.close();server.httpServer.closeAllConnections();await new Promise(done=>server.httpServer.close(done));}
