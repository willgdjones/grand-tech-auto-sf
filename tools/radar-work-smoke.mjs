/** Real Radar canvas/DOM operation counts and frozen pixel comparison, not FPS. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build, preview } from 'vite';
const stage=process.env.GTASF_RADAR_WORK_STAGE==='before'?'before':'after';
const baselineCommit='817d2f0';
const out=resolve('artifacts/radar-work',stage);await mkdir(out,{recursive:true});
const config={configFile:false,root:out,logLevel:'warn',resolve:{alias:{'@gtasf/shared':resolve('shared'),'../input/cursor':resolve('web/src/input/cursor.ts'),'./projection':resolve('web/src/radar/projection.ts'),'./routing':resolve('web/src/radar/routing.ts')}},build:{target:'es2022',outDir:`${out}/app`,emptyOutDir:true,reportCompressedSize:false}};
if(!process.argv.includes('--run-only')){
  if(stage==='before'){
    await mkdir(`${out}/source`,{recursive:true});
    for(const name of ['radar.ts','radar.css']){
      try{await writeFile(`${out}/source/${name}`,execFileSync('git',['show',`${baselineCommit}:web/src/radar/${name}`]),{flag:'wx'});}
      catch(error){if(error.code!=='EEXIST')throw error;}
    }
  }
  await writeFile(`${out}/index.html`,'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>Radar draw fixture</title><style>body{background:#293b34;color:white;margin:0;font:16px Arial}</style><button id="game">Return to game</button><script type="module" src="/entry.js"></script>');
  await writeFile(`${out}/entry.js`,`import {createRadar} from '${stage==='before'?`${out}/source/radar.ts`:resolve('web/src/radar/radar.ts')}';
const realNow=Date.now,realPerformanceNow=performance.now.bind(performance),OriginalMap=Map,mapSet=Map.prototype.set,arrayPush=Array.prototype.push;
const requests=[],chosen=[];window.fetch=async url=>{requests.push(String(url));throw Error('Unexpected request');};
let tick=1000,measuring=false,mapCreations=0,clusterIds=new Set(),hitIds=new Set(),observedHits=[];
Date.now=()=>Date.parse('2026-10-05T19:00:00Z');Object.defineProperty(performance,'now',{configurable:true,value:()=>tick});
globalThis.Map=new Proxy(OriginalMap,{construct(target,args){if(measuring)mapCreations++;return Reflect.construct(target,args);}});
OriginalMap.prototype.set=function(key,value){if(measuring&&value&&typeof value.count==='number'&&value.event?.event)clusterIds.add(value);return mapSet.call(this,key,value);};
Array.prototype.push=function(...values){for(const value of values)if(value&&typeof value.x==='number'&&typeof value.y==='number'&&value.event?.event&&!('count'in value)){if(measuring)hitIds.add(value);arrayPush.call(observedHits,value);}return arrayPush.apply(this,values);};
const graph={version:1,nodes:[{id:'a',x:-1000,y:0,z:0},{id:'b',x:1000,y:0,z:0}],edges:[{id:'lane:fixture',from:'a',to:'b',lengthM:2000,speedMps:10,lane:1,points:[[-1000,0,0],[0,0,0],[1000,0,0]]}]};
graph.edges.push({id:'lane:fixture-reverse',from:'b',to:'a',lengthM:2000,speedMps:10,lane:1,points:[[1000,0,0],[0,0,0],[-1000,0,0]]});
const events=Array.from({length:240},(_,index)=>({id:'e'+String(index+1).padStart(3,'0'),title:'Founders '+String(index+1).padStart(3,'0'),host:index%3?'Community hosts':'Investor hosts',start:index%3?'2026-10-06T19:00:00Z':'2026-10-05T18:00:00Z',end:index%3?'2026-10-06T21:00:00Z':'2026-10-05T21:00:00Z',lat:37.7955+Math.sin(index*2.4)*(.0001+(index%40)*.00015),lon:-122.3937+Math.cos(index*2.4)*(.0001+(index%40)*.00019),approx:index%7===0,url:'https://example.com/event/'+index}));
const radar=createRadar({graph,routeGraph:graph,frame:{origin:{lat:37.7955,lon:-122.3937},gridRotationDeg:0},autoLoad:false,enabled:true,landmarks:[{id:'plaza',title:'Fixture plaza',x:300,y:0,z:0}],onSelect:destination=>{chosen.push(destination.title);return true;},onHail:()=>true});
await radar.routingReady;radar.setEvents(events);
let position={x:0,y:0,z:0},heading=0;
const peers=[{id:'peer',x:60,z:-40}],taxis=[{id:'taxi',x:-80,z:30}];
function frame(){observedHits=[];tick+=65;radar.update(position,heading,peers,taxis);}
window.fixture={radar,events,requests,chosen,frame,move(next,yaw){position=next;heading=yaw;frame();},
measure(){frame();mapCreations=0;clusterIds=new Set();hitIds=new Set();measuring=true;for(let i=0;i<120;i++)frame();measuring=false;return{draws:120,clustersPerDraw:observedHits.length,mapCreations,uniqueClusters:clusterIds.size,uniqueHits:hitIds.size};},
firstHit(){const h=observedHits[0];return{x:h.x,y:h.y,title:h.event.title};},
refresh(){radar.setEvents(events.slice(30,150));frame();},
destroy(){radar.destroy();globalThis.Map=OriginalMap;OriginalMap.prototype.set=mapSet;Array.prototype.push=arrayPush;Date.now=realNow;Object.defineProperty(performance,'now',{configurable:true,value:realPerformanceNow});}};
frame();window.fixture.ready=true;
`);await build(config);
}
if(process.argv.includes('--build-only')){console.log('Built '+stage+' Radar fixture');process.exit(0);}
const baseline=stage==='after'?JSON.parse(await readFile(resolve('artifacts/radar-work/before/report.json'),'utf8')):null;
const server=await preview({...config,preview:{host:'127.0.0.1',port:0}});let browser;
const report={checkedAt:new Date().toISOString(),stage,baselineCommit,sourceSha256:createHash('sha256').update(await readFile(stage==='before'?`${out}/source/radar.ts`:resolve('web/src/radar/radar.ts'))).digest('hex'),scope:'Actual Radar canvas/DOM; 240 fixture events, local roads and deterministic draw clock; allocation counts and pixel comparison, not native/FPS evidence',errors:[],views:[],passed:false};
try{
  browser=await chromium.launch({headless:true,args:['--disable-gpu','--disable-webgl']});
  for(const[name,width,height]of[['desktop',1100,720],['phone',390,844]]){
    const page=await browser.newPage({viewport:{width,height}});page.setDefaultTimeout(5000);
    page.on('pageerror',error=>report.errors.push(error.message));page.on('console',message=>{if(message.type()==='error')report.errors.push(message.text());});
    await page.goto(server.resolvedUrls.local[0]);await page.waitForFunction(()=>window.fixture?.ready);
    const canvas=page.locator('.gt-radar canvas'),pixels=[],cases=[];
    const capture=async label=>{
      await page.evaluate(()=>window.fixture.frame());
      const data=await canvas.evaluate(el=>el.toDataURL());
      const hash=createHash('sha256').update(data).digest('hex');pixels.push({label,hash});
      if(baseline)assert.equal(hash,baseline.views.find(v=>v.name===name).pixels.find(p=>p.label===label).hash,label+' canvas must match original');
    };
    await capture('minimap');
    const counts=await page.evaluate(()=>window.fixture.measure());assert(counts.clustersPerDraw>5);
    if(stage==='before'){
      assert.equal(counts.mapCreations,counts.draws);assert.equal(counts.uniqueClusters,counts.draws*counts.clustersPerDraw);assert.equal(counts.uniqueHits,counts.uniqueClusters);
    }else{
      assert.equal(counts.mapCreations,0);assert.equal(counts.uniqueClusters,counts.clustersPerDraw);assert.equal(counts.uniqueHits,counts.clustersPerDraw);
    }
    cases.push('120 stationary redraws retain the same cluster population while recording Map creation and distinct cluster/hit identities');
    await page.evaluate(()=>window.fixture.move({x:150,y:0,z:-70},1.2));await capture('rotated');
    await page.getByRole('button',{name:'Open event map',exact:true}).click();await capture('expanded');
    await page.getByRole('searchbox',{name:'Find a Tech Week event'}).fill('Founders 001');
    const first=page.locator('.gt-radar-list button').first();assert.equal(await first.count(),1);await first.click();
    assert.equal(await page.locator('.gt-radar-card h3').textContent(),'Founders 001');await capture('selected');
    await page.screenshot({path:`${out}/${name}-selected.png`});
    await page.getByRole('button',{name:'Set destination',exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window.fixture.chosen),['Founders 001']);
    assert.equal(await page.evaluate(()=>window.fixture.radar.isExpanded),false);await capture('route');
    cases.push('Rotated and expanded maps, live/approximate clusters, selected highlight and accepted GPS route preserve exact canvas output');
    await page.evaluate(()=>window.fixture.radar.setNavigationComplete(true));await capture('arrived');
    await page.evaluate(()=>window.fixture.radar.setNavigationComplete(false));await capture('resumed');
    const hit=await page.evaluate(()=>window.fixture.firstHit()),box=await canvas.boundingBox();
    await page.mouse.click(box.x+hit.x,box.y+hit.y);
    assert.equal(await page.locator('.gt-radar-card h3').textContent(),hit.title);
    assert.equal(await page.getByRole('button',{name:'Set destination',exact:true}).evaluate(el=>el===document.activeElement),true);
    await page.evaluate(()=>window.fixture.refresh());await capture('refreshed');
    await page.screenshot({path:`${out}/${name}-refreshed.png`});
    cases.push('Arrival/resume route painting, physical cluster selection and smaller refreshed calendar preserve behavior and pixels');
    assert.deepEqual(await page.evaluate(()=>window.fixture.requests),[]);
    await page.evaluate(()=>window.fixture.destroy());assert.equal(await page.locator('.gt-radar').count(),0);
    report.views.push({name,cases,counts,pixels});await page.close();
  }
  assert.deepEqual(report.errors,[]);report.passed=true;console.log(JSON.stringify({stage,passed:true,views:report.views.map(({name,counts})=>({name,counts})),errors:report.errors}));
}catch(error){report.failure=error.message;throw error;}
finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser?.close();server.httpServer.closeAllConnections();await new Promise(done=>server.httpServer.close(done));}
