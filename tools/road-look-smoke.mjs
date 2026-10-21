import { build } from 'vite';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';

const root=process.cwd(),out=resolve(root,'artifacts/road-look'),source=resolve(out,'source');
await mkdir(source,{recursive:true});
await writeFile(resolve(source,'flags.ts'),"import {flags as shipped} from '/shared/flags.ts';export const flags={...shipped,groundTextures:true,roadDetails:true};");
await writeFile(resolve(source,'check.ts'),`
import {PerspectiveCamera} from 'three';
import {createRenderFoundation} from '/web/src/render/foundation.ts';
import {loadLombardWorld} from '/web/src/render/chunks/world.ts';
import {createRoadDetails} from '/web/src/render/roads.ts';
const canvas=document.querySelector('canvas'),low=innerWidth<700;
const foundation=createRenderFoundation({canvas,tier:low?'low':'medium',atmosphere:true,now:()=>Date.parse('2026-10-02T11:00:00-07:00')});
foundation.resize(innerWidth,innerHeight);const camera=new PerspectiveCamera(58,innerWidth/innerHeight,.08,1000);
const layout=await fetch('/art/road-details.json').then(r=>r.json());
const targets=['The Embarcadero','Hyde Street'].map(name=>layout.roads.filter(r=>r.name===name).sort((a,b)=>b.points.length-a.points.length)[0]);
let focus={x:targets[0].points[0][0],z:targets[0].points[0][2]},maxBuilds=0,maxBuildMs=0,maxMeshes=0;
const world=await loadLombardWorld({mountGeometry:foundation.mountGeometry,tier:low?'low':'medium',position:focus,enabled:true});
const details=await createRoadDetails({position:focus,heightAt:world.surfaceHeightAt,collides:world.collides,isLoaded:(x,z)=>world.heightAt(x,z)!==null,low,enabled:true});foundation.scene.add(details.root);
window.roadCheck={
 async view(index){const road=targets[index],mid=road.points.length/2|0,p=road.points[mid],next=road.points[Math.min(mid+5,road.points.length-1)];focus={x:p[0],z:p[2]};await world.ensureAround(focus);const dx=next[0]-p[0],dz=next[2]-p[2],n=Math.hypot(dx,dz);camera.position.set(p[0]-dx/n*13,p[1]+7,p[2]-dz/n*13);camera.lookAt(p[0]+dx/n*30,p[1]+2,p[2]+dz/n*30);
 const needed=world.manifest.chunks.filter(c=>Math.abs(c.x-Math.floor(focus.x/256))<=1&&Math.abs(c.z-Math.floor(focus.z/256))<=1);let settled=0;
 for(let i=0;i<600;i++){world.update(focus);const before=details.stats.builds,beforeSteps=details.stats.buildSteps,beforeMeshes=details.stats.meshesBuilt,started=performance.now();details.update(focus);if(details.stats.buildSteps>beforeSteps)maxBuildMs=Math.max(maxBuildMs,performance.now()-started);maxBuilds=Math.max(maxBuilds,details.stats.builds-before);maxMeshes=Math.max(maxMeshes,details.stats.meshesBuilt-beforeMeshes);foundation.render(camera,true,0);await new Promise(r=>requestAnimationFrame(r));if(needed.every(c=>world.heightAt(c.x*256+128,c.z*256+128)!==null)&&world.stats.loading===0&&world.stats.queuedUploads===0&&details.stats.pendingCells===0&&details.stats.loadedCells===details.stats.targetCells)settled++;else settled=0;if(settled>=12)break;}if(settled<12)throw new Error('Road fixture map did not finish streaming');
 await foundation.roadTextures.ready;await foundation.facadeAtlas.ready;foundation.render(camera,true,0);
 const counts={};details.root.traverse(o=>{if(o.isMesh)counts[o.name]=(counts[o.name]??0)+o.geometry.getAttribute('position').count;});
 return{street:road.name,source:road.id,map:{...world.stats},details:{...details.stats},texture:{...foundation.roadTextures.stats},counts,maxBuilds,maxBuildMs,maxMeshes,roadHeight:world.surfaceHeightAt(focus.x,focus.z),sourceHeight:p[1]};},
 dispose(){details.dispose();world.dispose();foundation.dispose();return{cells:details.stats.loadedCells,vertices:details.stats.vertices,materials:foundation.roadTextures.stats.materials};}
};
`);
await build({configFile:false,root,publicDir:false,logLevel:'warn',resolve:{alias:[{find:/^@gtasf\/shared\/flags$/,replacement:resolve(source,'flags.ts')}]},build:{outDir:resolve(out,'app'),emptyOutDir:true,target:'es2022',reportCompressedSize:false,lib:{entry:resolve(source,'check.ts'),formats:['es'],fileName:'check'}}});
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://local').pathname;
  if(path==='/'){res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}canvas{width:100vw;height:100vh;display:block}</style><canvas></canvas><script type="module" src="/check.js"></script>');return;}
  if(path==='/favicon.ico'){res.writeHead(204).end();return;}
  const map=path.startsWith('/map/lombard/'),base=map?resolve(root,'tools/map/out/lombard'):path.startsWith('/art/')?resolve(root,'web/public'):resolve(out,'app'),file=resolve(base,'.'+(map?path.slice(12):path));
  if(!file.startsWith(base+'/')){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',({'.js':'text/javascript','.json':'application/json','.png':'image/png'})[extname(file)]??'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;const evidence=[];
try{
  browser=await chromium.launch({headless:true});
  for(const[name,width,height]of[['desktop',1100,720],['phone',390,844]]){
    const page=await browser.newPage({viewport:{width,height}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.roadCheck,undefined,{timeout:60_000});
    const views=[];for(let i=0;i<2;i++){const view=await page.evaluate(i=>window.roadCheck.view(i),i);assert.equal(view.maxBuilds,1);assert.equal(view.maxMeshes,1);assert.equal(view.texture.state,'ready');assert(view.details.loadedCells>=4&&view.details.loadedCells<=9);assert(view.details.vertices>100);assert(view.counts['crossing sourced road detail']>0);await page.screenshot({path:resolve(out,name+'-'+i+'.png')});views.push(view);}
    const disposed=await page.evaluate(()=>window.roadCheck.dispose());assert.deepEqual(disposed,{cells:0,vertices:0,materials:0});assert.deepEqual(errors,[]);evidence.push({name,views,disposed,errors});await page.close();
  }
  await writeFile(resolve(out,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
