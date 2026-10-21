import { build } from 'vite';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { resolve,extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// One short real-map renderer check. Reuses a caller's browser when available.
export async function checkStreetProps(existingBrowser,{buildOnly=false,skipBuild=false,controlsOnly=false,signalsOnly=false,metersOnly=false,wiresOnly=false}={}){
  const root=fileURLToPath(new URL('../',import.meta.url));
  const artifact=wiresOnly?'power-wires':signalsOnly?'signal-lamps':metersOnly?'parking-meters':controlsOnly?'stop-signs':'street-props';
  const src=resolve(root,`artifacts/${artifact}/source`),out=resolve(root,`artifacts/${artifact}/preview`);
  await mkdir(src,{recursive:true});
  await writeFile(resolve(src,'index.html'),'<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>SF street props</title></head><body style="margin:0;overflow:hidden"><canvas style="display:block;width:100vw;height:100vh"></canvas><script type="module" src="./scene.ts"></script></body></html>');
  await writeFile(resolve(src,'scene.ts'),`
import {PerspectiveCamera,Matrix4,Vector3,Quaternion} from 'three';
import {createRenderFoundation} from '/web/src/render/foundation.ts';
import {loadLombardWorld} from '/web/src/render/chunks/world.ts';
import {createStreetProps} from '/web/src/render/props/streetProps.ts';
import {createLandmarkWireCollision,wireClearsBuildings} from '/web/src/render/props/wires.ts';
import {createParodyBillboards} from '/web/src/render/props/billboards.ts';
import {createPlacedLandmarks,updateLandmarkTerrain,ferrySpawn} from '/web/src/render/landmarks/landmarks.ts';
import {withLandmarkSurfaces} from '/web/src/render/landmarks/surfaces.ts';
import {LOMBARD_CENTRELINE} from '/web/src/render/landmarks/lombardSource.ts';
import {geodeticToWorld} from '/tools/map/src/geo.ts';
import {SF_FRAME} from '/tools/map/src/config.ts';
// Static renderer fixture uses the real clock/solar grade without making live weather API calls.
const canvas=document.querySelector('canvas'),renderer=createRenderFoundation({canvas,enabled:true,atmosphere:true,weather:false,now:()=>Date.parse('2026-10-03T20:00:00Z')});
const camera=new PerspectiveCamera(68,innerWidth/innerHeight,.2,1500);renderer.resize(innerWidth,innerHeight,1);
const world=await loadLombardWorld({enabled:true,position:{x:1205,z:-1215},mountGeometry:renderer.mountGeometry});
const landmarks=createPlacedLandmarks({enabled:true,heightAt:world.surfaceHeightAt});renderer.mountGeometry(landmarks);
const surface=withLandmarkSurfaces({heightAt:world.surfaceHeightAt,collidesCircle:world.collidesCircle},landmarks);
const sceneryWorld={graph:world.graph,heightAt:surface.heightAt,roadHeightAt:world.roadHeightAt,collides:world.collides,get collisionRevision(){return world.collisionRevision;}};
// Explicit renderer-fixture modes exercise both sides of the traffic flag. The
// real application supplies no override and retains its shared feature switch.
const signalMode=new URLSearchParams(location.search).get('signalMode');
const props=await createStreetProps({enabled:true,low:renderer.tier==='low',world:sceneryWorld,landmarks,trafficEnabled:signalMode===null?undefined:signalMode==='enabled'});const unmountProps=renderer.mountGeometry(props.root);
const boards=await createParodyBillboards({enabled:true,low:renderer.tier==='low',world:sceneryWorld});const unmountBoards=renderer.mountGeometry(boards.root);
let focus={x:1160,z:-1260},propsUpdateMs=0,propsClock=0,propsRefresh;
async function refreshProps(){
 const samples=[];propsClock+=1100;
 do{
  const started=performance.now();props.update(focus,propsClock);samples.push(performance.now()-started);
  if(samples.length>240)throw new Error('Street props did not finish their staged refresh');
  if(props.stats.refreshPending){await new Promise(requestAnimationFrame);propsClock+=16;}
 }while(props.stats.refreshPending);
 return {slices:samples.length,totalMs:samples.reduce((a,b)=>a+b,0),maxSliceMs:Math.max(...samples),samples};
}
async function settle(p){focus=p;await world.ensureAround(p);for(let i=0;i<50;i++){world.update(p);await new Promise(r=>setTimeout(r,35));}updateLandmarkTerrain(landmarks,world.surfaceHeightAt);propsRefresh=await refreshProps();propsUpdateMs=propsRefresh.totalMs;boards.update(p,performance.now()+2000);}
function draw(){renderer.resize(innerWidth,innerHeight,1);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.render(camera,true);}
async function arrivalView(){const p=ferrySpawn(world.surfaceHeightAt);await settle(p);camera.position.set(p.x,p.y+2.5,p.z);camera.lookAt(p.lookAt.x,p.lookAt.y,p.lookAt.z);draw();}
async function view(name){
 const [lx,lz]=geodeticToWorld(...LOMBARD_CENTRELINE.at(-1),SF_FRAME);
 const p=name==='lombard'?{x:lx+9,z:lz}:{x:1150,z:-1290};await settle(p);
 const y=surface.heightAt(p.x,p.z)??3;
 if(name==='lombard'){
  const [tx,tz]=geodeticToWorld(...LOMBARD_CENTRELINE[40],SF_FRAME);
  camera.position.set(p.x,y+3.2,p.z);camera.lookAt(tx,(surface.heightAt(tx,tz)??y)+3,tz);
 }else{camera.position.set(p.x+10,y+3.2,p.z+34);camera.lookAt(p.x-10,y+6,p.z-90);}
 draw();
}
function billboardView(){
 const matrix=new Matrix4(),position=new Vector3(),quaternion=new Quaternion(),scale=new Vector3();
 for(const face of boards.root.children.filter(m=>m.userData.gtasfBillboard))for(let i=0;i<face.count;i++){
  face.getMatrixAt(i,matrix);matrix.decompose(position,quaternion,scale);
  const normal=new Vector3(0,0,1).applyQuaternion(quaternion),eye=position.clone().addScaledVector(normal,20);
  const ground=surface.heightAt(eye.x,eye.z);if(ground===null)continue;eye.y=ground+2.4;
  if(Array.from({length:20},(_,j)=>eye.clone().lerp(position,j/20)).some(p=>world.collides(p.x,p.y,p.z,.1,.1)))continue;
  camera.position.copy(eye);camera.lookAt(position);draw();return {position:position.toArray(),eye:eye.toArray(),creative:face.name};
 }
 throw new Error('No unobstructed front approach for a real billboard placement');
}
async function streetView(street,target){
 const candidates=world.graph.edges.filter(e=>e.name===street&&e.lane===0&&!e.bridge&&!e.tunnel&&e.kind!=='connector'&&e.lengthM>60);
 candidates.sort((a,b)=>{const pa=a.points[Math.floor(a.points.length/2)],pb=b.points[Math.floor(b.points.length/2)];return Math.hypot(pa[0]-target.x,pa[2]-target.z)-Math.hypot(pb[0]-target.x,pb[2]-target.z);});
 const edge=candidates[0];if(!edge)throw new Error('Missing real street '+street);
 const a=edge.points[0],b=edge.points.at(-1),p={x:a[0]*.8+b[0]*.2,z:a[2]*.8+b[2]*.2};await settle(p);
 const y=surface.heightAt(p.x,p.z);if(y===null)throw new Error('Street terrain not loaded: '+street);
 camera.position.set(p.x,y+2.4,p.z);camera.lookAt(b[0],(surface.heightAt(b[0],b[2])??b[1])+4,b[2]);draw();
 return {street,sourceEdgeId:edge.id,position:p};
}
function controlView(kind='trafficStop'){
 const signs=props.root.children.find(m=>m.name==='SF '+kind+' instances');if(!signs?.count)throw new Error('No loaded '+kind+' props');
 const matrix=new Matrix4(),position=new Vector3(),quaternion=new Quaternion(),scale=new Vector3();
 for(let i=0;i<signs.count;i++){
  signs.getMatrixAt(i,matrix);matrix.decompose(position,quaternion,scale);
  const normal=new Vector3(0,0,1).applyQuaternion(quaternion),eye=position.clone().addScaledVector(normal,kind==='parkingMeter'?3.7:7),center=position.clone();center.y+=kind==='parkingMeter'?1.48:2.45;
  const ground=surface.heightAt(eye.x,eye.z);if(ground===null)continue;eye.y=ground+1.7;
  if(Array.from({length:20},(_,j)=>eye.clone().lerp(center,j/20)).some(p=>world.collides(p.x,p.y,p.z,.1,.1)))continue;
  camera.position.copy(eye);camera.lookAt(center);draw();return {position:position.toArray(),eye:eye.toArray(),normal:normal.toArray()};
 }
 throw new Error('No clear front view of '+kind);
}
let signalTick=performance.now()+30000;
function setSignalClock(clock){props.update(focus,signalTick+=1000,clock);draw();}
function signalView(colour='green'){
 const matrix=new Matrix4(),position=new Vector3(),quaternion=new Quaternion(),scale=new Vector3();
 for(let attempt=0;attempt<28;attempt++){
  const clock=Date.parse('2026-10-03T20:00:00Z')+attempt*1000;setSignalClock(clock);
  const lenses=props.root.getObjectByName('Traffic signal '+colour+' lenses');
  for(let i=0;i<lenses.count;i++){
   lenses.getMatrixAt(i,matrix);matrix.decompose(position,quaternion,scale);
   const normal=new Vector3(0,0,1).applyQuaternion(quaternion),eye=position.clone().addScaledVector(normal,9);
   const ground=surface.heightAt(eye.x,eye.z);if(ground===null)continue;eye.y=ground+2.4;
   if(Array.from({length:20},(_,j)=>eye.clone().lerp(position,j/20)).some(p=>world.collides(p.x,p.y,p.z,.1,.1)))continue;
   camera.position.copy(eye);camera.lookAt(position);draw();return {clock,position:position.toArray(),eye:eye.toArray()};
  }
 }
 throw new Error('No clear incoming view of an active '+colour+' signal lens');
}
function hasLens(colour,point){
 const lenses=props.root.getObjectByName('Traffic signal '+colour+' lenses'),matrix=new Matrix4(),position=new Vector3();
 for(let i=0;i<lenses.count;i++){lenses.getMatrixAt(i,matrix);position.setFromMatrixPosition(matrix);if(Math.hypot(position.x-point[0],position.z-point[2])<.01)return true;}
 return false;
}
function inspectWires(){
 const mesh=props.root.getObjectByName('Sagging power and Muni wire ribbons'),geometry=mesh.geometry;
 const starts=geometry.getAttribute('instanceStart'),ends=geometry.getAttribute('instanceEnd'),authored=createLandmarkWireCollision(landmarks);
 let blockedSegments=0;
 for(let i=0;i<geometry.instanceCount;i++)if(!wireClearsBuildings([[starts.getX(i),starts.getY(i),starts.getZ(i)],[ends.getX(i),ends.getY(i),ends.getZ(i)]],(x,y,z,r,h)=>world.collides(x,y,z,r,h)||authored(x,y,z,r,h)))blockedSegments++;
 return {segments:geometry.instanceCount,blockedSegments,minPixels:mesh.material.linewidth,depthTest:mesh.material.depthTest,depthWrite:mesh.material.depthWrite,fade:mesh.material.uniforms.wireFade.value,shaderPreserved:mesh.material.isLineMaterial===true,propsUpdateMs,propsRefresh};
}
async function refreshWires(){
 await refreshProps();
 const geometry=props.root.getObjectByName('Sagging power and Muni wire ribbons').geometry;
 const data=geometry.getAttribute('instanceStart').data.array,before=Array.from(data.slice(0,geometry.instanceCount*6));
 const queries=world.collisionStats.queries,refresh=await refreshProps();
 const updateMs=refresh.totalMs,after=Array.from(data.slice(0,geometry.instanceCount*6));
 draw();
 return {unchanged:JSON.stringify(before)===JSON.stringify(after),updateMs,refresh,collisionQueries:world.collisionStats.queries-queries,hits:props.stats.wireCacheHits,misses:props.stats.wireCacheMisses,cacheSize:props.stats.wireCacheSize};
}
window.propsSmoke={view,draw,arrivalView,billboardView,streetView,controlView,signalView,setSignalClock,hasLens,inspectWires,refreshWires,inspect:()=>({tier:renderer.tier,position:focus,graph:{nodes:world.graph.nodes.length,edges:world.graph.edges.length},stats:props.stats,billboards:boards.stats,errors:world.stats.errors,counts:props.root.children.map(m=>({name:m.name,count:m.count})),textures:renderer.renderer.info.memory.textures}),destroy:()=>{unmountProps();unmountBoards();props.destroy();boards.destroy();world.dispose();renderer.dispose();}};
await view('ferry');window.propsReady=true;
`);
  if(!skipBuild)await build({configFile:false,root,publicDir:false,logLevel:'warn',build:{outDir:out,emptyOutDir:false,rollupOptions:{input:resolve(src,'index.html')}}});
  if(buildOnly)return {built:true,out};
  const server=createServer(async(req,res)=>{
    const path=decodeURIComponent((req.url??'/').split('?')[0]);if(path==='/favicon.ico'){res.writeHead(204).end();return;}
    const base=path.startsWith('/map/lombard/')?resolve(root,'tools/map/out/lombard'):path.startsWith('/art/')?resolve(root,'web/public'):out;
    const suffix=path.startsWith('/map/lombard/')?path.slice('/map/lombard'.length):path;
    const file=path==='/'?resolve(out,`artifacts/${artifact}/source/index.html`):resolve(base,`.${suffix}`);
    if(!file.startsWith(`${base}/`)){res.writeHead(403).end();return;}
    try{const data=await readFile(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.json':'application/json','.png':'image/png','.webp':'image/webp','.css':'text/css','.glb':'model/gltf-binary'})[extname(file)]??'application/octet-stream');res.end(data);}
    catch{res.writeHead(404).end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser=existingBrowser,page;const errors=[];
  try{
    browser??=await chromium.launch({headless:true});const views=[];
    for(const phone of [false,true]){
      const label=phone?'phone':'desktop';page=await browser.newPage({viewport:phone?{width:390,height:844}:{width:1280,height:800},hasTouch:phone,isMobile:phone});
      page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
      const base=`http://127.0.0.1:${server.address().port}/`;
      await page.goto(base+(signalsOnly?'?signalMode=enabled':''));await page.waitForFunction(()=>window.propsReady,{},{timeout:60000});
      if(wiresOnly){
        const captures=[];
        for(const name of ['ferry','arrival','columbus']){
          if(name==='arrival')await page.evaluate(()=>window.propsSmoke.arrivalView());
          if(name==='columbus')await page.evaluate(()=>window.propsSmoke.streetView('Columbus Avenue',{x:-170,z:-1750}));
          const refresh=await page.evaluate(()=>window.propsSmoke.refreshWires());
          const state=await page.evaluate(()=>window.propsSmoke.inspect()),wires=await page.evaluate(()=>window.propsSmoke.inspectWires());
          assert.equal(state.tier,phone?'low':'medium');assert.ok(wires.segments>0);assert.equal(wires.blockedSegments,0);
          assert.ok(wires.minPixels>=1);assert.equal(wires.depthTest,true);assert.equal(wires.depthWrite,false);assert.equal(wires.shaderPreserved,true);
          assert.deepEqual(state.errors,[]);assert.deepEqual(errors,[]);
          assert.equal(refresh.unchanged,true);assert.ok(refresh.hits>0);assert.equal(refresh.misses,0);assert.ok(refresh.cacheSize<=512);
          await page.screenshot({path:resolve(out,`${name}-${label}.png`)});captures.push({name,state,wires,refresh});
        }
        views.push({label,captures});await page.evaluate(()=>window.propsSmoke.destroy());await page.close();page=undefined;continue;
      }
      if(signalsOnly){
        await page.evaluate(()=>window.propsSmoke.streetView('Stockton Street',{x:-160,z:-2060}));
        const camera=await page.evaluate(()=>window.propsSmoke.signalView()),green=await page.evaluate(()=>window.propsSmoke.inspect());
        assert.equal(green.tier,phone?'low':'medium');assert.ok(green.stats.signalLenses.green>0);assert.equal(green.stats.signalLenses.amber,0);
        await page.screenshot({path:resolve(out,`green-${label}.png`)});
        await page.evaluate(clock=>window.propsSmoke.setSignalClock(clock),camera.clock+14000);
        assert.equal(await page.evaluate(point=>window.propsSmoke.hasLens('red',point),camera.position),true,'Same source signal changes from green to red');
        const red=await page.evaluate(()=>window.propsSmoke.inspect());await page.screenshot({path:resolve(out,`red-${label}.png`)});
        await page.evaluate(()=>window.propsSmoke.destroy());await page.goto(base+'?signalMode=disabled');await page.waitForFunction(()=>window.propsReady,{},{timeout:60000});
        await page.evaluate(()=>window.propsSmoke.streetView('Stockton Street',{x:-160,z:-2060}));
        await page.evaluate(()=>window.propsSmoke.signalView('amber'));const amber=await page.evaluate(()=>window.propsSmoke.inspect());
        assert.equal(amber.stats.signalLenses.red,0);assert.equal(amber.stats.signalLenses.green,0);assert.ok(amber.stats.signalLenses.amber>0);
        await page.screenshot({path:resolve(out,`disabled-amber-${label}.png`)});
        for(const state of [green,red,amber])assert.deepEqual(state.errors,[]);assert.deepEqual(errors,[]);
        views.push({label,scope:'Explicit renderer traffic modes; not live WorldDO acceptance',camera,green,red,amber});
        await page.evaluate(()=>window.propsSmoke.destroy());await page.close();page=undefined;continue;
      }
      if(controlsOnly||metersOnly){
        await page.evaluate(meters=>meters?window.propsSmoke.streetView('Columbus Avenue',{x:-170,z:-1750}):window.propsSmoke.streetView('Polk Street',{x:-1260,z:-1510}),metersOnly);
        const kind=metersOnly?'parkingMeter':'trafficStop',camera=await page.evaluate(kind=>window.propsSmoke.controlView(kind),kind),state=await page.evaluate(()=>window.propsSmoke.inspect());
        const count=state.counts.find(value=>value.name===`SF ${kind} instances`)?.count??0;
        assert.equal(state.tier,phone?'low':'medium');assert.ok(count>0&&count<=(phone?90:180));assert.deepEqual(state.errors,[]);assert.deepEqual(errors,[]);
        await page.screenshot({path:resolve(out,`${metersOnly?'parking-meter':'stop-sign'}-${label}.png`)});views.push({label,camera,state});
        await page.evaluate(()=>window.propsSmoke.destroy());await page.close();page=undefined;continue;
      }
      const ferry=await page.evaluate(()=>window.propsSmoke.inspect());assert.ok(ferry.stats.visible>10);assert.ok(ferry.stats.wireSegments>0);assert.ok(ferry.billboards.visible>0);
      assert.equal(ferry.tier,phone?'low':'medium');await page.screenshot({path:resolve(out,`ferry-${label}.png`)});
      const billboard=await page.evaluate(()=>window.propsSmoke.billboardView());await page.screenshot({path:resolve(out,`billboard-${label}.png`)});
      const streets=[];
      for(const [name,street,target] of [['columbus','Columbus Avenue',{x:-170,z:-1750}],['stockton','Stockton Street',{x:-160,z:-2060}],['sparse-polk','Polk Street',{x:-1260,z:-1510}]]){
        const camera=await page.evaluate(({street,target})=>window.propsSmoke.streetView(street,target),{street,target});
        const state=await page.evaluate(()=>window.propsSmoke.inspect());
        assert.ok(state.stats.visible>10);assert.ok(state.stats.cityVisible>0);assert.deepEqual(state.errors,[]);
        if(name!=='sparse-polk'){assert.ok(state.stats.signals>0);assert.ok(state.stats.muniSpans>0);}
        await page.screenshot({path:resolve(out,`${name}-${label}.png`)});streets.push({name,camera,state});
      }
      await page.evaluate(()=>window.propsSmoke.view('lombard'));const lombard=await page.evaluate(()=>window.propsSmoke.inspect());
      assert.ok(lombard.stats.visible>10);await page.screenshot({path:resolve(out,`lombard-${label}.png`)});
      assert.deepEqual(errors,[]);assert.deepEqual(ferry.errors,[]);assert.deepEqual(lombard.errors,[]);
      await page.evaluate(()=>window.propsSmoke.destroy());views.push({label,ferry,lombard,billboard,streets});await page.close();page=undefined;
    }
    const evidence={checkedAt:new Date().toISOString(),ok:true,views,errors};
    await writeFile(resolve(out,'smoke.json'),JSON.stringify(evidence,null,2));return {ok:true,out};
  }finally{await page?.close();if(!existingBrowser)await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await checkStreetProps(undefined,{buildOnly:process.argv.includes('--build-only'),skipBuild:process.argv.includes('--skip-build'),controlsOnly:process.argv.includes('--controls-only'),signalsOnly:process.argv.includes('--signals-only'),metersOnly:process.argv.includes('--meters-only'),wiresOnly:process.argv.includes('--wires-only')})));
