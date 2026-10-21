/** Count actual HUD funding work while checking mutable display inputs in real DOM. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';
const stage=process.env.GTASF_HUD_FUNDING_STAGE==='before'?'before':'after';
const out=resolve('artifacts/hud-funding-work',stage);await mkdir(out,{recursive:true});
const config={configFile:false,root:out,logLevel:'warn',resolve:{alias:{'@gtasf/shared':resolve('shared')}},build:{target:'es2022',outDir:`${out}/app`,emptyOutDir:true,reportCompressedSize:false}};
if(!process.argv.includes('--run-only')){
  if(stage==='before'){
    await mkdir(`${out}/source`,{recursive:true});
    for(const name of ['playableHud.ts','playableHud.css']){
      try{await writeFile(`${out}/source/${name}`,await readFile(resolve('web/src/hud',name)),{flag:'wx'});}
      catch(error){if(error.code!=='EEXIST')throw error;}
    }
  }
  await writeFile(`${out}/index.html`,'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>HUD funding work fixture</title><style>body{background:#263932;color:white;margin:20px;font:16px Arial}</style><button id="game">Return to game</button><script type="module" src="/entry.js"></script>');
  await writeFile(`${out}/entry.js`,`import {createPlayableHud} from '${stage==='before'?`${out}/source/playableHud.ts`:resolve('web/src/hud/playableHud.ts')}';
import {fundingRound} from '@gtasf/shared/funding';
const requests=[];window.fetch=async url=>{requests.push(String(url));throw Error('Unexpected request');};
let counts={visitArrays:0,roundArrays:0,moneyFormats:0};
const reverse=Array.prototype.reverse,padStart=String.prototype.padStart;
Array.prototype.reverse=function(){if(this[0]?.minValidatedVisits!==undefined)counts.visitArrays++;if(this[0]?.thresholdCents!==undefined)counts.roundArrays++;return reverse.call(this);};
String.prototype.padStart=function(length,fill){if(length===8&&fill==='0')counts.moneyFormats++;return padStart.call(this,length,fill);};
const hud=createPlayableHud(),state={now:Date.parse('2026-10-05T19:34:00Z'),fundingCents:12300,radioStation:'KVC Radio',radioPlaying:true,radioMuted:false,radioTicker:'Founders raising rounds'};
const profile={deviceId:'fixture',startupName:'Round Works',nickname:'Founder',totalCents:'50000000',todayCents:'50000000',round:fundingRound('50000000'),rank:7,todayRank:7,lastAwardAt:null,streak:1};
const event={id:'founders',title:'Founders gathering',start:'2026-10-05T19:30:00Z',end:'2026-10-05T21:00:00Z',lat:37.7955,lon:-122.3937,url:'https://example.com/event',approx:false};
window.fixture={hud,state,profile,event,requests,repeat(){hud.update(state);counts={visitArrays:0,roundArrays:0,moneyFormats:0};for(let i=0;i<600;i++)hud.update(state);return {...counts};},destroy(){hud.destroy();Array.prototype.reverse=reverse;String.prototype.padStart=padStart;}};
`);await build(config);
}
if(process.argv.includes('--build-only')){console.log('Built '+stage+' HUD funding fixture');process.exit(0);}
const server=await preview({...config,preview:{host:'127.0.0.1',port:0}});let browser;
const report={checkedAt:new Date().toISOString(),stage,scope:'Actual playableHud DOM; 600 unchanged updates with local funding/radio data; no renderer or API; call counts are not FPS evidence',errors:[],views:[],passed:false};
try{
  browser=await chromium.launch({headless:true,args:['--disable-gpu','--disable-webgl']});
  for(const[name,width,height]of[['desktop',1100,720],['phone',390,844]]){
    const page=await browser.newPage({viewport:{width,height}});page.setDefaultTimeout(5000);
    page.on('pageerror',error=>report.errors.push(error.message));page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
    await page.goto(server.resolvedUrls.local[0]);await page.waitForFunction(()=>window.fixture);
    const money=page.locator('.gt-hud-money-value'),cases=[];
    const fallback=await page.evaluate(()=>window.fixture.repeat());
    assert.deepEqual(fallback,stage==='before'?{visitArrays:600,roundArrays:0,moneyFormats:600}:{visitArrays:0,roundArrays:0,moneyFormats:0});
    assert.equal(await money.textContent(),'$00000123');
    const fallbackAmounts=await page.evaluate(()=>{
      const f=window.fixture,result=[];
      for(const cents of [0,99,100,12300,-1,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,undefined,12300]){
        f.state.fundingCents=cents;f.hud.update(f.state);result.push(document.querySelector('.gt-hud-money-value').textContent);
      }return result;
    });
    assert.deepEqual(fallbackAmounts,['$00000000','$00000000','$00000001','$00000123','$--------','$--------','$--------','$--------','$--------','$00000123']);
    cases.push('Legacy amount changes and unavailable values preserve visible funding and recover after invalid input');
    await page.evaluate(()=>{const f=window.fixture;f.hud.setFundingProfile(f.profile);});
    const canonical=await page.evaluate(()=>window.fixture.repeat());
    assert.deepEqual(canonical,stage==='before'?{visitArrays:600,roundArrays:600,moneyFormats:600}:{visitArrays:0,roundArrays:0,moneyFormats:0});
    assert.equal(await money.textContent(),'$00500000');
    const amounts=await page.evaluate(()=>{
      const f=window.fixture,result=[];
      for(const cents of ['0','12300','49999900','50000000','50000001']){
        f.hud.setFundingProfile(f.profile,cents);result.push(document.querySelector('.gt-hud-money-value').textContent);
      }return result;
    });
    assert.deepEqual(amounts,['$00000000','$00000123','$00499999','$00500000','$00500000']);
    await page.evaluate(()=>{
      const f=window.fixture;f.profile.totalCents='300000000';f.profile.rank=3;
      f.state.radioStation='BART Delays FM';f.state.radioMuted=true;f.state.radioTicker='Next train: eventually';f.hud.update(f.state);
    });
    assert.equal(await money.textContent(),'$00500000');
    assert.equal(await page.locator('.gt-hud-tier').textContent(),'SEED');
    assert.equal(await page.locator('.gt-hud-stars').getAttribute('aria-label'),'2 of 5 Funded stars');
    assert.equal(await page.locator('.gt-hud-rank').textContent(),'#3 THIS WEEK');
    assert.equal(await page.locator('.gt-hud-radio').textContent(),'BART Delays FM · MUTED');
    assert.equal(await page.locator('.gt-hud-radio-ticker').textContent(),'Next train: eventually');
    await page.screenshot({path:`${out}/${name}-mutable-funding.png`});
    cases.push('Canonical count-up and clamping, same-object total/rank mutation and radio edits stay current');
    for(const[total,label,stars]of[
      ['0','BOOTSTRAPPING',0],['49999999','BOOTSTRAPPING',0],['50000000','PRE-SEED',1],
      ['299999999','PRE-SEED',1],['300000000','SEED',2],['1499999999','SEED',2],
      ['1500000000','SERIES A',3],['4999999999','SERIES A',3],['5000000000','SERIES B',4],
      ['99999999999','SERIES B',4],['100000000000','UNICORN',5],['1000000000000000','UNICORN',5],
    ]){
      await page.evaluate(total=>{const f=window.fixture;f.profile.totalCents=total;f.hud.setFundingProfile(f.profile);},total);
      assert.equal(await page.locator('.gt-hud-tier').textContent(),label);
      assert.equal(await page.locator('.gt-hud-stars').getAttribute('aria-label'),`${stars} of 5 Funded stars`);
      assert.equal(await money.textContent(),'$'+(BigInt(total)/100n).toString().padStart(8,'0'));
    }
    assert.equal(await page.locator('.gt-hud-money').evaluate(el=>el.classList.contains('gt-hud-money-long')),true);
    await page.evaluate(()=>{
      const f=window.fixture;f.profile.totalCents='0';f.profile.rank=null;f.hud.setFundingProfile(f.profile);
      f.state.radioPlaying=false;f.state.now=Date.parse('2026-10-05T19:35:00Z');f.hud.update(f.state);
    });
    assert.equal(await page.locator('.gt-hud-rank').textContent(),'UNRANKED');
    assert.equal(await page.locator('.gt-hud-money').evaluate(el=>el.classList.contains('gt-hud-money-long')),false);
    assert.equal(await page.locator('.gt-hud-radio').textContent(),'Radio off');
    assert.equal(await page.locator('.gt-hud-radio-ticker').isHidden(),true);
    assert.equal(await page.locator('.gt-hud-clock').textContent(),'12:35');
    cases.push('Every funding round boundary, maximum and downward correction preserve stars, amount width, rank, radio and minute changes');
    await page.locator('#game').focus();await page.evaluate(()=>window.fixture.hud.showEvent(window.fixture.event,2));
    assert.equal(await page.getByRole('button',{name:'Close event details'}).evaluate(el=>el===document.activeElement),true);
    await page.keyboard.press('Escape');assert.equal(await page.locator('#game').evaluate(el=>el===document.activeElement),true);
    assert.deepEqual(await page.evaluate(()=>window.fixture.requests),[]);
    await page.evaluate(()=>window.fixture.destroy());assert.equal(await page.locator('.gt-hud').count(),0);
    cases.push('Event-card opening and Escape focus return, no requests, and disposal stay working');
    report.views.push({name,cases,updatesPerMode:600,fallback,canonical});await page.close();
  }
  assert.deepEqual(report.errors,[]);report.passed=true;console.log(JSON.stringify({stage,passed:true,views:report.views,errors:report.errors}));
}catch(error){report.failure=error.message;throw error;}
finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser?.close();server.httpServer.closeAllConnections();await new Promise(done=>server.httpServer.close(done));}
