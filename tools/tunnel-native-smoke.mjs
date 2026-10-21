/** Native game tunnel review: physical input and read-only state, no pose/time overrides. */
import assert from 'node:assert/strict';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { preview } from 'vite';
import { chromium } from '@playwright/test';
import { worldToGeodetic } from './map/src/geo.ts';
import { SF_FRAME } from './map/src/config.ts';
import { createHash } from 'node:crypto';

const out=resolve(process.env.GTASF_TUNNEL_OUT??'artifacts/tunnel-native'),app=process.env.GTASF_TUNNEL_APP;
assert(app,'GTASF_TUNNEL_APP must name a fresh immutable native-game build');
process.env.GTASF_MAP_AREA='sf';await mkdir(out,{recursive:true});
const graph=JSON.parse(await readFile('artifacts/district-art/district-graph.json','utf8'));
const edge=graph.edges.find(e=>e.id==='lane:1k8m');assert(edge);
const a=edge.points[0],b=edge.points.at(-1),p=a.map((n,i)=>(n+b[i])/2),geo=worldToGeodetic(p[0],p[2],SF_FRAME);
const yaw=Math.atan2(b[0]-a[0],b[2]-a[2]),heading=(180-yaw*180/Math.PI+360)%360;
const manifestBytes=await readFile('tools/map/out/sf/manifest.json');
const report={startedAt:new Date().toISOString(),app,manifestSha256:createHash('sha256').update(manifestBytes).digest('hex'),graph:JSON.parse(manifestBytes.toString()).roadGraph,scope:'Native desktop keyboard orbit/recenter and phone tunnel view; no performance gate',cases:[],passed:false};
const server=await preview({configFile:resolve('web/vite.config.ts'),root:resolve('web'),build:{outDir:resolve(app)},preview:{host:'127.0.0.1',port:0}});
let browser;
try {
  browser=await chromium.launch({headless: true,args:['--use-angle=metal','--enable-gpu', '--ignore-gpu-blocklist','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
  for(const c of [{name:'east-desktop',heading},{name:'west-desktop',heading:(heading+180)%360},{name:'east-phone',heading,phone:true}]) {
    const context=await browser.newContext(c.phone?{viewport:{width:390,height:844},deviceScaleFactor:1,hasTouch:true,isMobile:true}:{viewport:{width:1100,height:720}});
    const page=await context.newPage(),row={name:c.name,errors:[],steps:[],passed:false};report.cases.push(row);page.setDefaultTimeout(30000);
    page.on('pageerror',e=>row.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')row.errors.push(m.text());});
    page.on('response',r=>{if(r.status()>=400)row.errors.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`);});
    const state=()=>page.evaluate(()=>{
      const w=window.__gtasf.world,p=w.foot,c=w.camera.camera,project=c.position.clone().set(p.x,p.y+1,p.z).project(c);
      return {foot:{...p},camera:c.position.toArray(),yaw:w.camera.yaw,pitch:w.camera.pitch,safe:w.camera.safe,opacity:w.camera.avatarOpacity,projection:project.toArray(),
        cameraRoadY:w.map.roadHeightAt(c.position.x,c.position.z,p.y),ground:w.map.surfaceHeightAt(p.x,p.z,p.y),
        shellStats:{...w.map.structureCollisionStats},mapStats:{...w.map.stats},capture:window.__gtasf.capture,connected:document.querySelector('#world').dataset.connected};
    });
    const record=async(name,visible=true)=>{
      const s=await state();row.steps.push({name,at:new Date().toISOString(),...s});
      assert(s.safe,`${name}: safe camera`);assert.equal(s.capture,false);assert.equal(s.connected,'true');
      assert(s.shellStats.triangles>0,'Streamed structure index mounted');assert.deepEqual(s.mapStats.errors,[]);
      assert(Math.abs(s.foot.y-p[1])<2,'Walking stays on the source tunnel grade');
      assert(s.cameraRoadY!==null&&s.camera[1]<s.cameraRoadY+4.5,'Camera remains below sourced ceiling');
      if(visible){assert(s.opacity>.2,'Avatar remains readable');assert(s.projection.every(Number.isFinite)&&Math.abs(s.projection[0])<1&&Math.abs(s.projection[1])<1&&Math.abs(s.projection[2])<1,'Avatar inside view');}
      await page.screenshot({path:resolve(out,`${c.name}-${name}.png`)});return s;
    };
    try {
      const link=new URL(server.resolvedUrls.local[0]);link.searchParams.set('at',`${geo.lat},${geo.lon},${c.heading}`);if(c.phone){link.searchParams.set('preset','low');link.searchParams.set('touch','1');}
      row.link=link.href;await page.goto(link.href);await page.waitForSelector('#world[data-ready="true"][data-connected="true"]',{timeout:90000});await page.locator('#loading').waitFor({state:'hidden'});
      const identity=page.locator('.gt-funding-onboarding[open]');await identity.waitFor();await page.getByLabel('Startup name',{exact:true}).fill(`Tunnel ${Date.now().toString(36)}`);await page.getByLabel('Your nickname',{exact:true}).fill('Tunnel Survey');
      await identity.getByRole('button',{name:'Save startup',exact:true}).click();await identity.waitFor({state:'hidden'});
      await page.waitForFunction(()=>{const s=window.__gtasf.world.map.stats;return s.mounted>=9&&!s.loading&&!s.queuedUploads;},undefined,{timeout:45000});await page.waitForTimeout(1200);
      const start=await record('default');
      if(!c.phone) {
        await page.keyboard.down('ArrowLeft');await page.waitForTimeout(180);await page.keyboard.up('ArrowLeft');await page.waitForTimeout(500);await record('keyboard-orbit');
        await page.keyboard.down('ArrowDown');await page.waitForTimeout(850);await page.keyboard.up('ArrowDown');await page.waitForTimeout(350);await record('ceiling-pull-in');
        await page.keyboard.press('KeyC');await page.waitForTimeout(1500);await record('recenter');
        await page.keyboard.down('KeyW');await page.waitForTimeout(750);await page.keyboard.up('KeyW');await page.waitForTimeout(200);const walked=await record('walking');
        assert(Math.hypot(walked.foot.x-start.foot.x,walked.foot.z-start.foot.z)>1,'Physical walking advances through bore');
      }
      assert.deepEqual(row.errors,[]);row.passed=true;
    } catch(error) {row.failure=String(error);row.failedState=await state().catch(()=>null);await page.screenshot({path:resolve(out,`${c.name}-failed.png`)}).catch(()=>{});throw error;}
    finally {await context.close();await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));}
    console.log(`TUNNEL_CASE:${c.name}:passed`);
  }
  report.passed=true;
} finally {
  report.finishedAt=new Date().toISOString();await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));
  await browser?.close();server.httpServer.closeAllConnections();await new Promise(r=>server.httpServer.close(r));
  console.log(`TUNNEL_REPORT:${out}/report.json`);
}
