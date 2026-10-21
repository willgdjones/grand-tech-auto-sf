import { build } from 'vite';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { geodeticToWorld } from './map/src/geo.ts';

const root=process.cwd(),out=resolve(root,'artifacts/district-art'),source=resolve(out,'source');
// Fail before bundling if the real city export is not ready.
const manifest=JSON.parse(await readFile(resolve(root,'tools/map/out/sf/manifest.json'),'utf8'));
assert(manifest.chunks.some(c=>c.detail==='low'));
await readFile(resolve(root,'web/public/art/district-roads/manifest.json'));
await mkdir(source,{recursive:true});
const places=[
 {name:'North Beach',lat:37.7991,lon:-122.4099,street:'Columbus Avenue'},
 {name:'FiDi',lat:37.7915,lon:-122.4023,street:'Montgomery Street'},
 {name:'SoMa',lat:37.7798,lon:-122.4021,street:'Folsom Street'},
 {name:'Mission',lat:37.7596,lon:-122.4214,street:'Valencia Street'},
];
const centres=places.map(p=>geodeticToWorld(p.lat,p.lon,manifest.frame));
// A pure source subset for isolated art inspection. Never serve the 96MB raw city graph.
// It is not routing/whole-city/playable-build acceptance, and does not change default map files.
let sourceGraphBytes=await readFile(resolve(root,'tools/map/out/sf/roadgraph.json'));
const sourceGraphSha256=createHash('sha256').update(sourceGraphBytes).digest('hex');
let sourceGraph=JSON.parse(sourceGraphBytes.toString('utf8'));sourceGraphBytes=null;
const edges=sourceGraph.edges.filter(e=>e.points.some(([x,,z])=>centres.some(([cx,cz])=>Math.abs(x-cx)<700&&Math.abs(z-cz)<700)));
const nodeIds=new Set(edges.flatMap(e=>[e.from,e.to]));
const graph={version:1,nodes:sourceGraph.nodes.filter(n=>nodeIds.has(n.id)),edges};sourceGraph=null;
const graphBytes=Buffer.from(JSON.stringify(graph));assert(graphBytes.length<15_000_000,'Bounded art graph budget');
await writeFile(resolve(out,'district-graph.json'),graphBytes);
const subsetManifest={...manifest,chunks:manifest.chunks.filter(c=>centres.some(([x,z])=>Math.abs(c.x-Math.floor(x/256))<=2&&Math.abs(c.z-Math.floor(z/256))<=2)),roadGraph:{path:'district-graph.json',bytes:graphBytes.length,sha256:createHash('sha256').update(graphBytes).digest('hex')}};
await writeFile(resolve(out,'district-manifest.json'),JSON.stringify(subsetManifest));
await writeFile(resolve(out,'source-proof.json'),JSON.stringify({scope:'Actual SF district art subset; no city routing or deployment acceptance',sourceGraphSha256,subsetGraphSha256:subsetManifest.roadGraph.sha256,graphBytes:graphBytes.length,sourceChunks:manifest.chunks.length,subsetChunks:subsetManifest.chunks.length,edges:edges.length,nodes:graph.nodes.length,places},null,2));
await writeFile(resolve(source,'check.ts'),`
import {PerspectiveCamera} from 'three';
import {createRenderFoundation} from '/web/src/render/foundation.ts';
import {loadLombardWorld} from '/web/src/render/chunks/world.ts';
import {createRoadDetails} from '/web/src/render/roads.ts';
import {loadAvatarTemplate} from '/web/src/avatar/riggedAvatar.ts';
import {geodeticToWorld} from '/tools/map/src/geo.ts';
const low=innerWidth<700,canvas=document.querySelector('canvas');
performance.setResourceTimingBufferSize(2000);
const foundation=createRenderFoundation({canvas,tier:low?'low':'medium',atmosphere:true,now:()=>Date.parse('2026-10-03T11:00:00-07:00')});
foundation.resize(innerWidth,innerHeight);const camera=new PerspectiveCamera(58,innerWidth/innerHeight,.08,1000);
const places=${JSON.stringify(places)};
let focus={x:0,z:-1700};const visited=[];
const world=await loadLombardWorld({mountGeometry:foundation.mountGeometry,baseUrl:'/map/sf/',tier:low?'low':'medium',position:focus,enabled:true});
const details=await createRoadDetails({position:focus,heightAt:world.surfaceHeightAt,collides:world.collides,isLoaded:(x,z)=>world.heightAt(x,z)!==null,low,enabled:true});foundation.scene.add(details.root);
const template=await loadAvatarTemplate(),avatar=template.createInstance();foundation.scene.add(avatar.root);
window.districtCheck={
 async view(index){
  const place=places[index],[x,z]=geodeticToWorld(place.lat,place.lon,world.manifest.frame);
  let best,score=Infinity;
  for(const edge of world.graph.edges){
   if(edge.kind!=='lane'||edge.name!==place.street)continue;
   for(let i=1;i<edge.points.length;i++){
    const a=edge.points[i-1],b=edge.points[i],d=Math.hypot((a[0]+b[0])/2-x,(a[2]+b[2])/2-z);
    if(d<score){score=d;best={a,b,edge:edge.id};}
   }
  }
  if(!best||score>300)throw new Error('Missing source street '+place.street);
  const p=best.a,q=best.b,dx=q[0]-p[0],dz=q[2]-p[2],length=Math.hypot(dx,dz),tx=dx/length,tz=dz/length;
  focus={x:(p[0]+q[0])/2,z:(p[2]+q[2])/2};visited[index]={...focus};await world.ensureAround(focus);
  const y=world.surfaceHeightAt(focus.x,focus.z)??p[1];
  avatar.root.position.set(focus.x,y,focus.z);avatar.root.rotation.y=Math.atan2(tx,tz);avatar.update(0,'idle');
  const cx=focus.x-tx*7,cz=focus.z-tz*7;
  camera.position.set(cx,(world.surfaceHeightAt(cx,cz)??y)+3.2,cz);camera.lookAt(focus.x+tx*35,y+3,focus.z+tz*35);
  const needed=world.manifest.chunks.filter(c=>Math.abs(c.x-Math.floor(focus.x/256))<=1&&Math.abs(c.z-Math.floor(focus.z/256))<=1);
  let settled=0,maxPending=0,maxCached=0;
  for(let i=0;i<1800;i++){
   world.update(focus);details.update(focus);foundation.render(camera,true,0);
   maxPending=Math.max(maxPending,details.stats.districtPending);maxCached=Math.max(maxCached,details.stats.districtCachedCells);
   await new Promise(r=>requestAnimationFrame(r));
   if(needed.every(c=>world.heightAt(c.x*256+128,c.z*256+128)!==null)&&world.stats.loading===0&&world.stats.queuedUploads===0&&details.stats.pendingCells===0&&details.stats.loadedCells===details.stats.targetCells&&details.stats.districtPending===0)settled++;else settled=0;
   if(settled>=8)break;
  }
  if(settled<8)throw new Error('District fixture did not finish streaming: '+JSON.stringify(details.stats));
  await foundation.facadeAtlas.ready;await foundation.roadTextures.ready;await foundation.shopfrontSigns.ready;foundation.render(camera,true,0);
  const resource=performance.getEntriesByType('resource');
  const network={requests:resource.length,transferBytes:resource.reduce((n,r)=>n+r.transferSize,0),encodedBytes:resource.reduce((n,r)=>n+r.encodedBodySize,0),decodedBytes:resource.reduce((n,r)=>n+r.decodedBodySize,0)};
  return {place,focus,streetDistance:score,edge:best.edge,coarseChunks:needed.filter(c=>c.detail==='low').length,facades:{...foundation.facadeAtlas.stats},roads:{...foundation.roadTextures.stats},details:{...details.stats},map:{...world.stats},maxPending,maxCached,network};
 },
 async dispose(){
  // Return to an evicted district and cancel a real in-flight cell request.
  await world.ensureAround(visited[1]);details.update(visited[1]);const pendingAtDispose=details.stats.districtPending;
  avatar.dispose();template.dispose();details.dispose();world.dispose();foundation.dispose();
  for(let i=0;i<100&&details.stats.districtPending;i++)await new Promise(r=>setTimeout(r,10));
  return{pendingAtDispose,details:{...details.stats},facades:{...foundation.facadeAtlas.stats},roads:{...foundation.roadTextures.stats}};
 }
};
`);
await build({configFile:false,root,publicDir:false,logLevel:'warn',resolve:{alias:[{find:/^@gtasf\/shared\/(.*)$/,replacement:resolve(root,'shared')+'/$1'}]},build:{outDir:resolve(out,'app'),emptyOutDir:true,target:'es2022',reportCompressedSize:false,lib:{entry:resolve(source,'check.ts'),formats:['es'],fileName:'check'}}});
const server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://local').pathname;
 if(path==='/'){res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}canvas{width:100vw;height:100vh;display:block}</style><canvas></canvas><script type="module" src="/check.js"></script>');return;}
 if(path==='/favicon.ico'){res.writeHead(204).end();return;}
 if(path==='/map/sf/manifest.json'||path==='/map/sf/district-graph.json'){
  const bytes=await readFile(resolve(out,path.endsWith('manifest.json')?'district-manifest.json':'district-graph.json'));res.setHeader('Content-Type','application/json');res.setHeader('Content-Length',bytes.length);res.end(bytes);return;
 }
 const map=path.startsWith('/map/sf/'),base=map?resolve(root,'tools/map/out/sf'):path.startsWith('/art/')||path.startsWith('/assets/')?resolve(root,'web/public'):resolve(out,'app');
 const file=resolve(base,'.'+(map?path.slice(7):path));
 if(!file.startsWith(base+'/')){res.writeHead(403).end();return;}
 try{const bytes=await readFile(file);res.setHeader('Content-Type',({'.js':'text/javascript','.json':'application/json','.png':'image/png'})[extname(file)]??'application/octet-stream');res.setHeader('Content-Length',bytes.length);res.end(bytes);}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;const evidence=[];
try{
 browser=await chromium.launch({headless:true});
 for(const[name,width,height]of[['desktop',1100,720],['phone',390,844]]){
  const page=await browser.newPage({viewport:{width,height}}),errors=[],httpErrors=[];page.setDefaultTimeout(120_000);
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)httpErrors.push(r.url()+': '+r.status());});
  await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.districtCheck);
  const entry={name,views:[],errors,httpErrors};evidence.push(entry);
  for(let i=0;i<4;i++){
   const view=await page.evaluate(i=>window.districtCheck.view(i),i);entry.views.push(view);
   await page.screenshot({path:resolve(out,name+'-'+i+'.png')});await writeFile(resolve(out,'evidence.json'),JSON.stringify(evidence,null,2));
   assert.equal(view.facades.state,'ready');assert.equal(view.roads.state,'ready');assert.equal(view.facades.lowWidth,512);assert.equal(view.facades.lowHeight,256);assert.equal(view.roads.lowTileSize,128);
   assert.equal(view.details.districtErrors,0);assert(view.details.loadedCells>0);assert(view.maxPending<=2);assert(view.maxCached<=9);assert.deepEqual(view.map.errors,[]);
   if(i>0){assert(view.coarseChunks>0);assert(view.facades.lowMaterials>0);assert(view.roads.lowMaterials>0);assert(view.details.districtCachedCells>0);}
  }
  entry.disposed=await page.evaluate(()=>window.districtCheck.dispose());
  assert(entry.disposed.pendingAtDispose>0);assert.equal(entry.disposed.details.vertices,0);assert.equal(entry.disposed.details.districtCachedCells,0);assert.equal(entry.disposed.details.districtPending,0);assert.equal(entry.disposed.facades.materials,0);assert.equal(entry.disposed.roads.materials,0);
  assert.deepEqual(errors,[]);assert.deepEqual(httpErrors,[]);await page.close();
 }
 await writeFile(resolve(out,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
