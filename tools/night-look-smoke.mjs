import { build } from 'vite';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';

const detailOnly=process.env.GTASF_NIGHT_DETAIL==='1';
const root=process.cwd(),out=resolve(root,detailOnly?'artifacts/night-window-detail':'artifacts/night-look'),source=resolve(out,'source');
await mkdir(source,{recursive:true});
await writeFile(resolve(source,'check.ts'),`
import {PerspectiveCamera} from 'three';
import {createRenderFoundation} from '/web/src/render/foundation.ts';
import {loadLombardWorld} from '/web/src/render/chunks/world.ts';
import {createRoadDetails} from '/web/src/render/roads.ts';
import {loadAvatarTemplate} from '/web/src/avatar/riggedAvatar.ts';
const canvas=document.querySelector('canvas'),low=innerWidth<700;
let time=Date.parse('2026-10-03T00:36:00-07:00');
const foundation=createRenderFoundation({canvas,tier:low?'low':'medium',atmosphere:true,now:()=>time});
foundation.resize(innerWidth,innerHeight);const camera=new PerspectiveCamera(58,innerWidth/innerHeight,.08,1000);
const layout=await fetch('/art/road-details.json').then(r=>r.json());
const targets=['The Embarcadero','Columbus Avenue'].map(name=>layout.roads.filter(r=>r.name===name).sort((a,b)=>b.points.length-a.points.length)[0]);
let focus={x:targets[0].points[0][0],z:targets[0].points[0][2]};
const world=await loadLombardWorld({mountGeometry:foundation.mountGeometry,tier:low?'low':'medium',position:focus,enabled:true});
const details=await createRoadDetails({position:focus,heightAt:world.surfaceHeightAt,collides:world.collides,isLoaded:(x,z)=>world.heightAt(x,z)!==null,low,enabled:true});foundation.scene.add(details.root);
const template=await loadAvatarTemplate(),avatar=template.createInstance();foundation.scene.add(avatar.root);
window.nightCheck={
 async view(index,day=false){
  time=Date.parse(day?'2026-10-03T11:00:00-07:00':'2026-10-03T00:36:00-07:00');
  avatar.root.visible=true;
  const road=targets[index],mid=road.points.length/2|0,p=road.points[mid],next=road.points[Math.min(mid+5,road.points.length-1)];
  focus={x:p[0],z:p[2]};await world.ensureAround(focus);
  const dx=next[0]-p[0],dz=next[2]-p[2],n=Math.hypot(dx,dz),tx=dx/n,tz=dz/n;
  avatar.root.position.set(p[0],world.surfaceHeightAt(p[0],p[2])??p[1],p[2]);avatar.root.rotation.y=Math.atan2(tx,tz);avatar.update(0,'idle');
  const behindX=p[0]-tx*7,behindZ=p[2]-tz*7;
  camera.position.set(behindX,(world.surfaceHeightAt(behindX,behindZ)??p[1])+3.2,behindZ);camera.lookAt(p[0]+tx*35,p[1]+3,p[2]+tz*35);
  const needed=world.manifest.chunks.filter(c=>Math.abs(c.x-Math.floor(focus.x/256))<=1&&Math.abs(c.z-Math.floor(focus.z/256))<=1);let settled=0,maxUpdateMs=0;
  for(let i=0;i<600;i++){
   const started=performance.now();world.update(focus);details.update(focus);maxUpdateMs=Math.max(maxUpdateMs,performance.now()-started);
   foundation.render(camera,true,0);await new Promise(r=>requestAnimationFrame(r));
   if(needed.every(c=>world.heightAt(c.x*256+128,c.z*256+128)!==null)&&world.stats.loading===0&&world.stats.queuedUploads===0&&(${detailOnly}||(details.stats.pendingCells===0&&details.stats.loadedCells===details.stats.targetCells)))settled++;else settled=0;
   if(settled>=8)break;
  }
  if(settled<8)throw new Error('Night fixture map did not finish streaming');
  await foundation.roadTextures.ready;await foundation.facadeAtlas.ready;await foundation.shopfrontSigns.ready;foundation.render(camera,true,0);
  let pools=0,bulbs=0;foundation.scene.traverse(o=>{if(o.visible&&o.name==='Sodium pools')pools++;if(o.visible&&o.name==='Sodium bulbs')bulbs++;});
  return {street:road.name,day,clock:new Date(time).toISOString(),map:{...world.stats},lights:{...foundation.nightLights.stats},facade:{...foundation.facadeAtlas.stats},signs:{...foundation.shopfrontSigns.stats},nightUniform:foundation.facadeAtlas.uniforms.uFacadeNight.value,visiblePools:pools,visibleBulbs:bulbs,maxUpdateMs,drawCalls:foundation.renderer.info.render.calls};
 },
 shop(){
  time=Date.parse('2026-10-03T00:36:00-07:00');const signs=[];let emissive=0;
  foundation.scene.traverse(o=>{if(o.userData.gtasfShopfrontSigns){signs.push(...o.userData.gtasfShopfrontSigns);emissive=o.material.emissiveIntensity;}});
  signs.sort((a,b)=>Math.hypot(a.centre[0]-focus.x,a.centre[2]-focus.z)-Math.hypot(b.centre[0]-focus.x,b.centre[2]-focus.z));
  const sign=signs[0];if(!sign)throw new Error('No real shopfront sign in loaded cells');
  camera.position.set(sign.centre[0]+sign.normal[0]*10,sign.centre[1]+.3,sign.centre[2]+sign.normal[1]*10);
  camera.lookAt(...sign.centre);avatar.root.visible=false;foundation.render(camera,true,0);
  return{sign,emissive};
 },
 dispose(){avatar.dispose();template.dispose();details.dispose();world.dispose();foundation.dispose();return {...foundation.nightLights.stats};}
};
`);
await build({configFile:false,root,publicDir:false,logLevel:'warn',resolve:{alias:[{find:/^@gtasf\/shared\/(.*)$/,replacement:resolve(root,'shared')+'/$1'}]},build:{outDir:resolve(out,'app'),emptyOutDir:true,target:'es2022',reportCompressedSize:false,lib:{entry:resolve(source,'check.ts'),formats:['es'],fileName:'check'}}});
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://local').pathname;
  if(path==='/'){res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}canvas{width:100vw;height:100vh;display:block}</style><canvas></canvas><script type="module" src="/check.js"></script>');return;}
  if(path==='/favicon.ico'){res.writeHead(204).end();return;}
  const map=path.startsWith('/map/lombard/'),base=map?resolve(root,'tools/map/out/lombard'):path.startsWith('/art/')||path.startsWith('/assets/')?resolve(root,'web/public'):resolve(out,'app'),file=resolve(base,'.'+(map?path.slice(12):path));
  if(!file.startsWith(base+'/')){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',({'.js':'text/javascript','.json':'application/json','.png':'image/png'})[extname(file)]??'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;const evidence=[];
try{
  browser=await chromium.launch({headless:true});
  for(const[name,width,height]of[['desktop',1100,720],['phone',390,844]]){
    const page=await browser.newPage({viewport:{width,height}}),errors=[],httpErrors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)httpErrors.push(r.url()+': '+r.status());});
    await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.nightCheck,undefined,{timeout:60_000});
    const views=[];
    for(const i of detailOnly?[1]:[0,1]){
      const view=await page.evaluate(i=>window.nightCheck.view(i),i);
      assert.equal(view.facade.state,'ready');assert.equal(view.nightUniform,1);assert(view.lights.lamps>0);assert(view.lights.lamps<=view.lights.cells*8);assert(view.visiblePools>0);assert.deepEqual(view.map.errors,[]);
      await page.screenshot({path:resolve(out,name+'-night-'+i+'.png')});views.push(view);
    }
    const shop=await page.evaluate(()=>window.nightCheck.shop());assert(shop.emissive>0);await page.screenshot({path:resolve(out,name+'-neon.png')});
    if(name==='desktop'&&!detailOnly){
      const day=await page.evaluate(()=>window.nightCheck.view(1,true));assert.equal(day.nightUniform,0);assert.equal(day.visiblePools,0);assert.equal(day.visibleBulbs,0);
      await page.screenshot({path:resolve(out,'desktop-day.png')});views.push(day);
    }
    const disposed=await page.evaluate(()=>window.nightCheck.dispose());assert.equal(disposed.lamps,0);assert.equal(disposed.cells,0);assert.equal(disposed.poolTriangles,0);
    evidence.push({name,views,shop,disposed,errors,httpErrors});await writeFile(resolve(out,'evidence.json'),JSON.stringify(evidence,null,2));
    assert.deepEqual(errors,[]);assert.deepEqual(httpErrors,[]);await page.close();
  }
  console.log(JSON.stringify(evidence));
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
