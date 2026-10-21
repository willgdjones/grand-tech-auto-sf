/** Public deep links and actual render state for whole-city desktop/phone review. */
import assert from 'node:assert/strict';
import { preview } from 'vite';
import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { worldToGeodetic } from './map/src/geo.ts';
import { SF_FRAME } from './map/src/config.ts';
const root=process.cwd(),out=resolve(process.env.GTASF_CITY_OUT??'artifacts/city-coverage');
const app=process.env.GTASF_STREAM_APP;
if(!app)throw new Error('Set GTASF_STREAM_APP to the already-built common snapshot');
process.env.GTASF_MAP_AREA='sf';await mkdir(out,{recursive:true});
const graph=JSON.parse(await readFile('tools/map/out/sf/roadgraph.json','utf8'));
function sourcePoint(osmWay,part){
  const edge=graph.edges.find(e=>e.kind==='lane'&&e.osmWay===osmWay);
  assert.ok(edge,`Source road ${osmWay} exists`);
  const lengths=edge.points.slice(1).map((b,i)=>Math.hypot(...b.map((v,k)=>v-edge.points[i][k])));
  let remaining=lengths.reduce((a,b)=>a+b,0)*part,i=0;
  while(i<lengths.length-1&&remaining>lengths[i])remaining-=lengths[i++];
  const a=edge.points[i],b=edge.points[i+1],t=remaining/lengths[i],p=a.map((v,k)=>v+(b[k]-v)*t);
  const geo=worldToGeodetic(p[0],p[2],SF_FRAME),heading=(180-Math.atan2(b[0]-a[0],b[2]-a[2])*180/Math.PI+360)%360;
  return {...geo,heading,source:{edge:edge.id,osmWay,expectedY:p[1]}};
}
const cases=[
  {name:'market-desktop',lat:37.7751,lon:-122.4181},
  {name:'dolores-desktop',lat:37.7599,lon:-122.4267},
  {name:'north-beach-desktop',...worldToGeodetic(-132.156,-1711.3605,SF_FRAME)},
  {name:'sunset-desktop',lat:37.7603,lon:-122.5040},
  {name:'broadway-desktop',...sourcePoint(8921175,.5)},
  {name:'bay-approach-desktop',...sourcePoint(202485364,.5)},
  {name:'pier-39-desktop',lat:37.8070,lon:-122.4095},
  {name:'sunset-phone',lat:37.7603,lon:-122.5040,phone:true},
  {name:'broadway-phone',...sourcePoint(8921175,.5),phone:true},
];
const requested=process.env.GTASF_CITY_CASES?.split(',').filter(Boolean);
if(requested)assert.ok(requested.every(name=>cases.some(c=>c.name===name)),'Unknown city coverage case');
const selected=requested?cases.filter(c=>requested.includes(c.name)):cases;
const server=await preview({configFile:resolve('web/vite.config.ts'),root:resolve('web'),build:{outDir:resolve(app)},preview:{host:'127.0.0.1',port:0}});
const browser=await chromium.launch({headless: true,args:['--use-angle=metal','--enable-gpu', '--ignore-gpu-blocklist']});
const results=[];
try{
  for(const c of selected){
    const context=await browser.newContext(c.phone?{viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true}:{viewport:{width:1100,height:720}}),page=await context.newPage(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    page.on('response',r=>{if(r.status()>=400)errors.push(`HTTP ${r.status()} ${r.url()}`);});
    const link=new URL(server.resolvedUrls.local[0]);link.searchParams.set('at',`${c.lat},${c.lon},${c.heading??0}`);link.searchParams.set('perf','1');if(c.phone)link.searchParams.set('preset','low');
    let failure;
    try{
      await page.goto(link.href);await page.waitForSelector('#world[data-ready="true"][data-connected="true"]',{timeout:90000});await page.waitForSelector('#loading',{state:'hidden'});
      const onboarding=page.locator('.gt-funding-onboarding[open]');
      await onboarding.waitFor();await page.getByLabel('Startup name',{exact:true}).fill(`City coverage ${Date.now().toString(36)}`);await page.getByLabel('Your nickname',{exact:true}).fill('City Survey');
      await onboarding.getByRole('button',{name:'Save startup',exact:true}).click();await onboarding.waitFor({state:'hidden'});
      await page.waitForFunction(()=>{const s=window.__gtasf.world.map.stats;return s.mounted>=9&&!s.loading&&!s.queuedUploads;},undefined,{timeout:45000});
      await page.waitForTimeout(2000);
      const state=await page.evaluate(()=>{const w=window.__gtasf.world,p=w.foot,c=w.camera.camera,subject=c.position.clone().set(p.x,p.y+1,p.z).project(c);return {pose:{...p},ground:w.map.surfaceHeightAt(p.x,p.z,p.y),cameraSafe:w.camera.safe,cameraPosition:c.position.toArray(),playerProjection:subject.toArray(),location:w.map.locationNameAt(p.x,p.z),stats:{...w.map.stats},bounds:w.map.manifest.bounds,graphEdges:w.map.graph.edges.length,routingEdges:w.map.routingGraph?.edges.length,text:document.body.innerText};});
      await page.screenshot({path:resolve(out,`${c.name}.png`)});
      results.push({name:c.name,link:link.href,source:c.source,state,errors});
      assert.ok(state.ground!==null&&state.cameraSafe,'Deep-link ground and camera remain valid');assert.equal(state.graphEdges,244460);assert.deepEqual(state.stats.errors,[]);assert.deepEqual(errors,[]);
      assert.ok(state.playerProjection.every(Number.isFinite)&&Math.abs(state.playerProjection[0])<1&&Math.abs(state.playerProjection[1])<1&&Math.abs(state.playerProjection[2])<1,'Shared heading keeps the player inside the camera view');
      if(c.source)assert.ok(Math.abs(state.pose.y-c.source.expectedY)<1,'Deep link preserves tunnel/deck source elevation');
    }catch(error){failure=String(error);await page.screenshot({path:resolve(out,`${c.name}-failure.png`)}).catch(()=>{});if(results.at(-1)?.name===c.name)results.at(-1).failure=failure;else results.push({name:c.name,link:link.href,failure,errors,text:await page.locator('body').innerText().catch(()=>null)});}
    finally{await context.close();await writeFile(resolve(out,'evidence.json'),JSON.stringify({requestedCases:selected.map(c=>c.name),completeScope:selected.length===cases.length,cases:results,visualReviewPending:true},null,2));}
    console.log(JSON.stringify({name:c.name,failure,errors}));
  }
  assert.ok(results.every(r=>!r.failure),'Every whole-city spawn/render scenario passes');
}finally{await browser.close();server.httpServer.closeAllConnections();await new Promise(r=>server.httpServer.close(r));}
