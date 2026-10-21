import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { resolve,extname } from 'node:path';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { build } from 'vite';
import { chromium } from '@playwright/test';
import { register } from 'tsx/esm/api';

const root=resolve('.'),out=resolve('artifacts/ferry-apron'),source=resolve(out,'source'),app=resolve(out,'app');
await mkdir(source,{recursive:true});
// Scoped source-map movement proof; the same production functions run in the game.
register();
const [{decodeHeightfield,sampleHeight,createRoadSampler,FootprintIndex},{createPlacedLandmarks,withLandmarkSurfaces,disposeLandmark},{updateOnFoot},{Raycaster,Vector3}]=await Promise.all([
  import('../web/src/render/chunks/terrain.ts'),import('../web/src/render/landmarks/landmarks.ts'),import('../web/src/movement/onFoot.ts'),import('three')]);
const map=resolve('tools/map/out/lombard'),manifest=JSON.parse(await readFile(resolve(map,'manifest.json'),'utf8'));
const graph=JSON.parse(await readFile(resolve(map,'roadgraph.json'),'utf8')),fields=new Map(),collisions=[];
for(const chunk of manifest.chunks.filter(c=>Math.abs(c.x-4)<=1&&Math.abs(c.z+5)<=1)){
  const bytes=await readFile(resolve(map,chunk.terrain.path));fields.set(chunk.id,decodeHeightfield(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)));
  collisions.push(JSON.parse(await readFile(resolve(map,chunk.collision.path),'utf8')));
}
const index=new FootprintIndex();index.rebuild(collisions);const roadAt=createRoadSampler(graph);
const terrainAt=(x,z)=>{const field=fields.get(`${Math.floor(x/256)}_${Math.floor(z/256)}`);return field?sampleHeight(field,x,z):null;};
const base={heightAt(x,z){const h=terrainAt(x,z);return h===null?null:roadAt(x,z,h)??h;},collidesCircle(x,z,radius){return index.collides(x,base.heightAt(x,z)??0,z,radius,1.8);}};
const landmarks=createPlacedLandmarks({enabled:true,ids:['ferry-building'],heightAt:base.heightAt}),ferry=landmarks.children[0],surface=withLandmarkSurfaces(base,landmarks);
const start={x:1168.4079980779159,z:-1214.8030212333265},goal={x:1158,z:-1213.5};
const startPose=()=>({...start,y:surface.heightAt(start.x,start.z),yaw:0});
function walk(pose,target){let maxStep=0,steps=0;for(;steps<240&&Math.hypot(pose.x-target.x,pose.z-target.z)>.13;steps++){
  const before=pose.y,heading=Math.atan2(target.x-pose.x,target.z-pose.z);updateOnFoot(pose,{x:0,z:-1,run:true},heading+Math.PI,1/60,surface);maxStep=Math.max(maxStep,Math.abs(pose.y-before));
}return {pose:{...pose},steps,maxStep,remaining:Math.hypot(pose.x-target.x,pose.z-target.z)};}
const original=ferry.userData.dynamicSurfaceHeightAt;delete ferry.userData.dynamicSurfaceHeightAt;
const old=walk(startPose(),goal);assert.ok(old.remaining>9,'Original authored edge reproduces the blocking seam');ferry.userData.dynamicSurfaceHeightAt=original;
const pose=startPose(),outward=walk(pose,goal),returnGoal={x:start.x+1.98,z:start.z-.248},returning=walk(pose,returnGoal);assert.ok(outward.remaining<.13);assert.ok(returning.remaining<.13);
landmarks.updateMatrixWorld(true);const apron=ferry.getObjectByName('Ferry plaza terrain transition');assert.ok(apron.visible);
assert.ok(ferry.worldToLocal(new Vector3(pose.x,pose.y,pose.z)).z<78.5,'Return crosses fully onto the flat plaza');
const local=ferry.worldToLocal(new Vector3(start.x,0,start.z)),meshErrors=[];
for(const z of [79.25,80.25,81.25,82.75]){
  const p=ferry.localToWorld(new Vector3(local.x,0,z)),height=surface.heightAt(p.x,p.z);
  const hit=new Raycaster(new Vector3(p.x,height+20,p.z),new Vector3(0,-1,0)).intersectObject(apron)[0];assert.ok(hit);meshErrors.push(Math.abs(hit.point.y-height));
}
assert.ok(Math.max(...meshErrors)<1e-5,'Visible triangles and walking surface coincide');
const movement={old,outward,returning,meshErrors};await writeFile(resolve(out,'movement.json'),JSON.stringify(movement,null,2));disposeLandmark(landmarks);

await writeFile(resolve(source,'index.html'),'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="margin:0"><canvas style="display:block;width:100vw;height:100vh"></canvas><script type="module" src="./scene.ts"></script>');
await writeFile(resolve(source,'scene.ts'),`
import {PerspectiveCamera,Vector3} from 'three';
import {createRenderFoundation} from '/web/src/render/foundation.ts';
import {loadLombardWorld} from '/web/src/render/chunks/world.ts';
import {createPlacedLandmarks,updateLandmarkTerrain,withLandmarkSurfaces,disposeLandmark} from '/web/src/render/landmarks/landmarks.ts';
const foundation=createRenderFoundation({canvas:document.querySelector('canvas'),enabled:true,atmosphere:true,now:()=>Date.parse('2026-10-03T20:00:00Z')});
const focus={x:1168.408,z:-1214.803},world=await loadLombardWorld({enabled:true,position:focus,tier:foundation.tier,mountGeometry:foundation.mountGeometry});
await world.ensureAround(focus);for(let i=0;i<50;i++){world.update(focus);await new Promise(r=>setTimeout(r,35));}
const landmarks=createPlacedLandmarks({enabled:true,heightAt:world.surfaceHeightAt}),release=foundation.mountGeometry(landmarks);updateLandmarkTerrain(landmarks,world.surfaceHeightAt);
const surface=withLandmarkSurfaces({heightAt:world.surfaceHeightAt},landmarks),ferry=landmarks.children.find(o=>o.userData.landmarkId==='ferry-building');
landmarks.updateMatrixWorld(true);const local=ferry.worldToLocal(new Vector3(focus.x,0,focus.z));
const eye=ferry.localToWorld(new Vector3(local.x-6,0,91)),target=ferry.localToWorld(new Vector3(local.x,.18,78));eye.y=(surface.heightAt(eye.x,eye.z)??3)+4;
const camera=new PerspectiveCamera(64,innerWidth/innerHeight,.1,1800);camera.position.copy(eye);camera.lookAt(target);
foundation.resize(innerWidth,innerHeight,1);foundation.render(camera,true);
window.apronSmoke={tier:foundation.tier,visible:ferry.getObjectByName('Ferry plaza terrain transition').visible,errors:world.stats.errors,
  destroy(){release();disposeLandmark(landmarks);world.dispose();foundation.dispose();}};window.apronReady=true;
`);
if(!process.argv.includes('--skip-build'))await build({configFile:false,root,publicDir:false,logLevel:'warn',build:{outDir:app,emptyOutDir:false,rollupOptions:{input:resolve(source,'index.html')}}});
if(process.argv.includes('--build-only')){console.log(JSON.stringify({built:true,movement}));process.exit(0);}
const server=createServer(async(req,res)=>{
  const path=decodeURIComponent((req.url??'/').split('?')[0]);if(path==='/favicon.ico'){res.writeHead(204).end();return;}
  const base=path.startsWith('/map/lombard/')?map:path.startsWith('/art/')?resolve('web/public'):app;
  const suffix=path.startsWith('/map/lombard/')?path.slice('/map/lombard'.length):path;
  const file=path==='/'?resolve(app,'artifacts/ferry-apron/source/index.html'):resolve(base,`.${suffix}`);
  if(!file.startsWith(base+'/')){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.json':'application/json','.png':'image/png','.webp':'image/webp','.glb':'model/gltf-binary'})[extname(file)]??'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;const errors=[],views=[];
try{
  browser=await chromium.launch({headless:true});
  for(const phone of [false,true]){
    const page=await browser.newPage({viewport:phone?{width:390,height:844}:{width:1280,height:800},hasTouch:phone,isMobile:phone});
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>window.apronReady,{},{timeout:60000});
    const info=await page.evaluate(()=>({tier:window.apronSmoke.tier,visible:window.apronSmoke.visible,errors:window.apronSmoke.errors}));assert.ok(info.visible);assert.equal(info.tier,phone?'low':'medium');assert.deepEqual(info.errors,[]);
    await page.screenshot({path:resolve(out,phone?'phone.png':'desktop.png')});await page.evaluate(()=>window.apronSmoke.destroy());await page.close();views.push(info);
  }
  assert.deepEqual(errors,[]);await writeFile(resolve(out,'smoke.json'),JSON.stringify({checkedAt:new Date().toISOString(),movement,views,errors},null,2));console.log(JSON.stringify({ok:true,out}));
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
