/** Actual playable HUD clock, funding and radio DOM; no game renderer or API. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';
const stage=process.env.GTASF_HUD_CLOCK_STAGE==='before'?'before':'after';
const out=resolve('artifacts/hud-clock',stage);await mkdir(out,{recursive:true});
const config={configFile:false,root:out,logLevel:'warn',resolve:{alias:{'@gtasf/shared':resolve('shared')}},build:{target:'es2022',outDir:`${out}/app`,emptyOutDir:true,reportCompressedSize:false}};
if(!process.argv.includes('--run-only')){
  if(stage==='before'){
    await mkdir(`${out}/source`,{recursive:true});
    for(const name of ['playableHud.ts','playableHud.css']){
      try{await writeFile(`${out}/source/${name}`,await readFile(resolve('web/src/hud',name)),{flag:'wx'});}
      catch(error){if(error.code!=='EEXIST')throw error;}
    }
  }
  await writeFile(`${out}/index.html`,'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>San Francisco HUD clock fixture</title><style>body{background:#263932;color:white;margin:20px;font:16px Arial}</style><button id="game">Return to game</button><script type="module" src="/entry.js"></script>');
  await writeFile(`${out}/entry.js`,`import {createPlayableHud} from '${stage==='before'?`${out}/source/playableHud.ts`:resolve('web/src/hud/playableHud.ts')}';
import {fundingRound} from '@gtasf/shared/funding';
const requests=[];window.fetch=async url=>{requests.push(String(url));throw Error('Unexpected request');};
const hud=createPlayableHud(),state={now:Date.parse('2026-10-05T07:05:00Z'),fundingCents:12300,radioStation:'KVC Radio',radioPlaying:true,radioMuted:false,radioTicker:'Founders after midnight'};
const profile={deviceId:'fixture',startupName:'Clock Works',nickname:'Founder',totalCents:'50000000',todayCents:'50000000',round:fundingRound('50000000'),rank:7,todayRank:7,lastAwardAt:null,streak:1};
const event={id:'midnight',title:'Founders after midnight',start:'2026-10-05T07:05:00Z',end:'2026-10-05T08:00:00Z',lat:37.7955,lon:-122.3937,url:'https://example.com/event',approx:false};
window.fixture={hud,state,profile,event,requests,update(now){state.now=now;hud.update(state);},destroy(){hud.destroy();}};
`);await build(config);
}
if(process.argv.includes('--build-only')){console.log('Built '+stage+' HUD clock fixture');process.exit(0);}
const server=await preview({...config,preview:{host:'127.0.0.1',port:0}});let browser;
const report={checkedAt:new Date().toISOString(),stage,scope:'Actual playableHud DOM; injected times and local funding/radio data; no renderer or API',errors:[],views:[],passed:false};
try{
  browser=await chromium.launch({headless:true,args:['--disable-gpu','--disable-webgl']});
  for(const[name,width,height]of[['desktop',1100,720],['phone',390,844]]){
    const page=await browser.newPage({viewport:{width,height}});page.setDefaultTimeout(5000);
    page.on('pageerror',error=>report.errors.push(error.message));page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
    await page.addInitScript(()=>{
      window.clockFormatCalls=0;
      Intl.DateTimeFormat=new Proxy(Intl.DateTimeFormat,{construct(target,args){
        const formatter=Reflect.construct(target,args),options=args[1];
        if(options?.hour!=='2-digit'||options?.minute!=='2-digit'||options?.weekday)return formatter;
        window.clockHourCycle=formatter.resolvedOptions().hourCycle;
        const format=formatter.format;
        return new Proxy(formatter,{get(object,key){
          if(key==='format')return value=>{window.clockFormatCalls++;return format(value);};
          const value=Reflect.get(object,key,object);return typeof value==='function'?value.bind(object):value;
        }});
      }});
    });
    await page.goto(server.resolvedUrls.local[0]);await page.waitForFunction(()=>window.fixture);
    const clock=page.locator('.gt-hud-clock'),money=page.locator('.gt-hud-money-value'),cases=[];
    const update=iso=>page.evaluate(value=>window.fixture.update(Date.parse(value)),iso);
    const checkTime=async(iso,label)=>{
      await update(iso);assert.equal(await clock.textContent(),label);
      assert.equal(await clock.getAttribute('aria-label'),`${label} San Francisco time`);
      if(stage==='after')assert.equal(await clock.getAttribute('datetime'),new Date(iso).toISOString());
    };
    await update('2026-10-05T07:05:00Z');
    const midnight=await clock.textContent(),hourCycle=await page.evaluate(()=>window.clockHourCycle);
    if(stage==='before')assert(['00:05','24:05'].includes(midnight));
    else await checkTime('2026-10-05T07:05:00Z','00:05');
    await page.screenshot({path:`${out}/${name}-midnight.png`});
    const repeated=await page.evaluate(()=>{
      const f=window.fixture,start=Date.parse('2026-10-05T19:34:00Z');f.update(start);
      const before=window.clockFormatCalls;
      for(let i=1;i<=600;i++)f.update(start+i*10);
      return {updates:600,formatCalls:window.clockFormatCalls-before,clock:document.querySelector('.gt-hud-clock').textContent};
    });
    assert.equal(repeated.formatCalls,stage==='before'?600:0);assert.equal(repeated.clock,'12:34');
    if(stage==='before')cases.push(`SF midnight renders ${midnight} (${hourCycle}); 600 unchanged-minute updates make 600 Intl clock calls`);
    else{
      cases.push('SF midnight renders 00:05; 600 unchanged-minute updates make zero extra Intl clock calls');
      for(const[iso,label]of[
        ['2026-10-05T19:35:00Z','12:35'],['2026-10-05T19:33:00Z','12:33'],
        ['2026-10-06T06:59:59Z','23:59'],['2026-10-06T07:00:00Z','00:00'],
        ['2026-03-08T09:59:59Z','01:59'],['2026-03-08T10:00:00Z','03:00'],
        ['2026-11-01T08:59:59Z','01:59'],['2026-11-01T09:00:00Z','01:00'],
        ['2026-11-01T08:30:00Z','01:30'],['2026-11-01T09:30:00Z','01:30'],
        ['2026-11-02T09:30:00Z','01:30'],
      ])await checkTime(iso,label);
      cases.push('minute changes, backwards jumps, SF date rollover, both DST transitions and repeated labels keep visible/semantic time correct');
      const countUp=await page.evaluate(()=>{
        const f=window.fixture,calls=window.clockFormatCalls,amounts=[];
        for(const cents of ['0','12300','49999900','50000000']){f.hud.setFundingProfile(f.profile,cents);amounts.push(document.querySelector('.gt-hud-money-value').textContent);}
        f.state.radioMuted=true;f.hud.update(f.state);
        const muted=document.querySelector('.gt-hud-radio').textContent;
        f.state.radioStation='BART Delays FM';f.state.radioTicker='Next train: eventually';f.hud.update(f.state);
        return {amounts,muted,station:document.querySelector('.gt-hud-radio').textContent,ticker:document.querySelector('.gt-hud-radio-ticker').textContent,extraClockCalls:window.clockFormatCalls-calls};
      });
      assert.deepEqual(countUp.amounts,['$00000000','$00000123','$00499999','$00500000']);
      assert.equal(countUp.muted,'KVC Radio · MUTED');assert.equal(countUp.station,'BART Delays FM · MUTED');assert.equal(countUp.ticker,'Next train: eventually');assert.equal(countUp.extraClockCalls,0);
      assert.equal(await page.locator('.gt-hud-tier').textContent(),'PRE-SEED');assert.equal(await page.locator('.gt-hud-rank').textContent(),'#7 THIS WEEK');
      assert.equal(await page.locator('.gt-hud-stars').getAttribute('aria-label'),'1 of 5 Funded stars');
      await page.evaluate(()=>{const f=window.fixture;f.state.radioPlaying=false;f.hud.update(f.state);});
      assert.equal(await page.locator('.gt-hud-radio').textContent(),'Radio off');assert.equal(await page.locator('.gt-hud-radio-ticker').isHidden(),true);
      cases.push('funding count-up, stars/rank and mutations of the same radio state object update within a cached minute');
      await page.locator('#game').focus();await page.evaluate(()=>window.fixture.hud.showEvent(window.fixture.event,2));
      assert.equal(await page.getByRole('button',{name:'Close event details'}).evaluate(el=>el===document.activeElement),true);
      assert.match(await page.locator('.gt-event-when').textContent(),/12:05 AM PT$/);
      await page.keyboard.press('Escape');assert.equal(await page.locator('#game').evaluate(el=>el===document.activeElement),true);
      assert.equal(await page.evaluate(()=>window.fixture.hud.cardOpen),false);
      cases.push('event-card date formatting, opening focus and Escape return remain working');
    }
    assert.deepEqual(await page.evaluate(()=>window.fixture.requests),[]);
    await page.evaluate(()=>window.fixture.destroy());assert.equal(await page.locator('.gt-hud').count(),0);
    report.views.push({name,cases,midnight,hourCycle,repeated});await page.close();
  }
  assert.deepEqual(report.errors,[]);report.passed=true;console.log(JSON.stringify({stage,passed:true,views:report.views.length,errors:report.errors}));
}catch(error){report.failure=error.message;throw error;}
finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser?.close();server.httpServer.closeAllConnections();await new Promise(done=>server.httpServer.close(done));}
