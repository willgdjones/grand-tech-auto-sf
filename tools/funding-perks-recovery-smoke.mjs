/** Actual round-perks module with isolated stalled transport; no game or ledger writes. */
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build,preview } from 'vite';
import { chromium } from '@playwright/test';

const out=resolve('artifacts/funding-perks-recovery');await mkdir(out,{recursive:true});
await writeFile(`${out}/index.html`,'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Perks recovery fixture</title></head><body style="background:#1a332c"><script type="module" src="/entry.js"></script></body></html>');
await writeFile(`${out}/entry.js`, `
import {Scene} from 'three';
import {createFundingPerks} from '${resolve('web/src/funding/perks.ts')}';
import '${resolve('web/src/funding/hud.css')}';
const profile={deviceId:'fixture',startupName:'Fog Computing',nickname:'Founder',totalCents:'1500000000',todayCents:'1500000000'};
let perks,scene;
window.fixture={
  start(stage='success'){
    perks?.destroy();this.calls=[];this.releases=[];this.stage=stage;this.connected=true;this.hosting=false;this.messages=[];scene=new Scene();
    const party=(id,name)=>({hostId:id,startupName:name,anchor:{x:0,y:0,z:0},endsAt:Date.now()+900000});
    const snapshot=(stale=false)=>({parties:stale?[party('stale','Late stale party')]:[party('other','Other founder'),...(this.hosting?[party('fixture','Fog Computing')]:[])],yours:this.hosting?party('fixture','Fog Computing'):null,serverNow:Date.now()});
    window.fetch=async(url,options)=>{
      if(url!=='/api/funding/parties')throw new Error('Unexpected fixture request '+url);
      const method=options.method??'GET';this.calls.push({method,signal:options.signal});
      if(method==='POST')this.hosting=JSON.parse(options.body).hosting;
      if(this.stage==='headers')return new Promise(done=>this.releases.push(()=>done(Response.json(snapshot(true)))));
      if(this.stage==='body')return {ok:true,json:()=>new Promise(done=>this.releases.push(()=>done(snapshot(true))))};
      return Response.json(snapshot());
    };
    perks=createFundingPerks({scene,fleet:{cars:new Map()},surfaceHeightAt:()=>0,enabled:true,notify:text=>this.messages.push(text)});
    perks.setProfile(profile);this.tick();
  },
  tick(){perks.update({x:0,y:0,z:0},'on-foot',0,.1,this.connected);},
  state(){return {calls:this.calls.map(c=>({method:c.method,aborted:c.signal.aborted})),markers:perks.root.children.map(c=>c.name),messages:this.messages};},
  disconnect(){this.connected=false;this.tick();},
  reconnect(){this.connected=true;this.tick();},
  release(){this.releases.splice(0).forEach(fn=>fn());},
  destroy(){perks.destroy();}
};
`);
const config={configFile:false,root:out,logLevel:'warn',resolve:{alias:{'@gtasf/shared':resolve('shared')}},build:{target:'es2022',outDir:`${out}/app`,emptyOutDir:true,reportCompressedSize:false}};
await build(config);const server=await preview({...config,preview:{host:'127.0.0.1',port:0}});
const browser=await chromium.launch({headless:true,args:['--disable-gpu']});
const report={checkedAt:new Date().toISOString(),scope:'Isolated actual-module network recovery; fixture browser clock only; no game server or ledger writes',errors:[],checks:[]};
try{
  const page=await browser.newPage({viewport:{width:390,height:844}});
  page.on('pageerror',error=>report.errors.push(error.message));page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
  await page.clock.install();await page.goto(server.resolvedUrls.local[0]);await page.waitForFunction(()=>!!window.fixture);
  const button=page.getByRole('button',{name:'Host party here',exact:true});
  async function open(){await page.getByRole('button',{name:'Open earned round perks'}).click();}
  for(const stage of ['headers','body']){
    await page.evaluate(()=>window.fixture.start());await open();await button.waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelectorAll('.gt-funding-perk button')[2].disabled);
    assert.deepEqual((await page.evaluate(()=>window.fixture.state())).markers,['Startup party other']);
    await page.evaluate(stage=>{window.fixture.stage=stage;},stage);await page.clock.runFor(6001);await page.evaluate(()=>{for(let i=0;i<20;i++)window.fixture.tick();});
    await page.waitForFunction(()=>window.fixture.releases.length===1);assert.equal(await button.isDisabled(),true);
    assert.equal((await page.evaluate(()=>window.fixture.state())).calls.length,2);
    await page.clock.runFor(8001);assert.equal(await button.isDisabled(),false);
    assert.equal((await page.evaluate(()=>window.fixture.state())).calls[1].aborted,true);
    assert.deepEqual((await page.evaluate(()=>window.fixture.state())).markers,['Startup party other']);
    await page.evaluate(()=>{window.fixture.stage='success';window.fixture.tick();});
    await page.waitForFunction(()=>window.fixture.calls.length===3&&!document.querySelectorAll('.gt-funding-perk button')[2].disabled);
    await page.evaluate(()=>window.fixture.release());await page.clock.runFor(1);
    assert.deepEqual((await page.evaluate(()=>window.fixture.state())).markers,['Startup party other']);
    report.checks.push(stage+' deadline releases controls; one in-flight read; last good markers retained; later read succeeds; stale result ignored');
  }
  await page.evaluate(()=>window.fixture.start('body'));await open();await page.waitForFunction(()=>window.fixture.releases.length===1);
  await page.evaluate(()=>window.fixture.disconnect());await page.clock.runFor(1);
  assert.equal((await page.evaluate(()=>window.fixture.state())).calls[0].aborted,true);assert.equal(await button.isDisabled(),true);
  await page.evaluate(()=>{window.fixture.stage='success';window.fixture.reconnect();});
  await page.waitForFunction(()=>window.fixture.calls.length===2&&!document.querySelectorAll('.gt-funding-perk button')[2].disabled);
  await page.evaluate(()=>window.fixture.release());await page.clock.runFor(1);
  assert.deepEqual((await page.evaluate(()=>window.fixture.state())).markers,['Startup party other']);
  report.checks.push('Actual disconnected update aborts; reconnect starts one read; old result cannot replace recovered state');
  await page.evaluate(()=>window.fixture.start());await open();await page.waitForFunction(()=>!document.querySelectorAll('.gt-funding-perk button')[2].disabled);
  await page.evaluate(()=>{window.fixture.stage='headers';});await button.click();
  await page.clock.runFor(8001);assert.match(await page.locator('.gt-funding-perks-status').innerText(),/could not be confirmed/);
  assert.equal((await page.evaluate(()=>window.fixture.state())).calls.filter(c=>c.method==='POST').length,1);
  await page.evaluate(()=>{window.fixture.stage='success';window.fixture.tick();});
  await page.getByRole('button',{name:'End your party',exact:true}).waitFor();
  assert.equal(await page.locator('.gt-funding-perks-status').innerText(),'Your party is active.');
  assert.equal((await page.evaluate(()=>window.fixture.state())).calls.filter(c=>c.method==='POST').length,1);
  await page.evaluate(()=>window.fixture.release());await page.clock.runFor(1);
  await page.screenshot({path:`${out}/recovered-party-phone.png`});
  report.checks.push('Unconfirmed hosting POST is never replayed; a fresh GET confirms active party and updates controls');
  await page.evaluate(()=>window.fixture.start('body'));await page.waitForFunction(()=>window.fixture.releases.length===1);
  await page.evaluate(()=>window.fixture.destroy());await page.clock.runFor(1);
  assert.equal((await page.evaluate(()=>window.fixture.state())).calls[0].aborted,true);
  await page.evaluate(()=>window.fixture.release());await page.clock.runFor(9000);
  assert.equal(await page.locator('.gt-funding-perks-open').count(),0);assert.equal((await page.evaluate(()=>window.fixture.state())).calls.length,1);
  report.checks.push('Disposal aborts immediately without later polling, DOM changes or notification');
  assert.deepEqual(report.errors,[]);report.passed=true;console.log('TEST_PASSED:FundingPerksRecovery');
}finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2)+'\n');await browser.close();server.httpServer.closeAllConnections();await new Promise(done=>server.httpServer.close(done));}
