import { build } from 'vite';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

// Reuse the UI smoke's existing browser to avoid competing game/GPU sessions.
export async function checkOutbidCrown(existingBrowser,{buildOnly=false,skipBuild=false}={}) {
// Isolated visual fixture, never bundled into the game or sent to a real ledger.
const root=fileURLToPath(new URL('../',import.meta.url));
const src=resolve(root,'artifacts/outbid-crown/source'),out=resolve(root,'artifacts/outbid-crown/preview');
await mkdir(src,{recursive:true});await mkdir(out,{recursive:true});
await writeFile(resolve(src,'index.html'),`<!doctype html><html><body style="margin:0;background:#a6bdc5"><script type="module" src="./scene.js"></script></body></html>`);
await writeFile(resolve(src,'scene.js'),`
import * as THREE from '/node_modules/three/build/three.module.js';
import {createLandmark,disposeLandmark} from '/web/src/render/landmarks/landmarks.ts';
import {createOutbidCrown} from '/web/src/render/landmarks/outbidCrown.ts';
const scene=new THREE.Scene();scene.background=new THREE.Color('#a6bdc5');
const renderer=new THREE.WebGLRenderer({antialias:false});renderer.setSize(1200,800);renderer.setPixelRatio(1);
renderer.outputColorSpace=THREE.SRGBColorSpace;document.body.append(renderer.domElement);
const camera=new THREE.PerspectiveCamera(44,1.5,1,2000);
scene.add(new THREE.HemisphereLight('#f7f3df','#788476',2));
const sun=new THREE.DirectionalLight('#fff4d7',2);sun.position.set(80,320,120);scene.add(sun);
const tower=createLandmark('salesforce-tower');scene.add(tower);
const crown=createOutbidCrown(tower,{enabled:true});
const render=()=>renderer.render(scene,camera);
const view=(wide=false)=>{camera.position.set(wide?300:20,wide?72:307,wide?430:94);camera.lookAt(0,wide?160:294,0);render();};
window.crown={set:s=>{crown.setSnapshot(s);render();},view,inspect:()=>{
const mesh=tower.children.find(o=>o.userData.outbidCrown);return mesh?{visible:mesh.visible,width:mesh.material.map.image.width,height:mesh.material.map.image.height,version:mesh.material.map.version}:null;
},destroy:()=>{crown.destroy();disposeLandmark(tower);renderer.dispose();}};view();
`);
if(!skipBuild)await build({configFile:false,root,publicDir:false,logLevel:'warn',
  build:{outDir:out,emptyOutDir:false,rollupOptions:{input:resolve(src,'index.html')}}});
if(buildOnly)return {built:true,out};
const html=resolve(out,'artifacts/outbid-crown/source/index.html');
const server=createServer(async(req,res)=>{
  const path=(req.url??'/').split('?')[0];
  if(path==='/favicon.ico'){res.writeHead(204).end();return;}
  const file=path==='/'?html:resolve(out,`.${path}`);
  if(!file.startsWith(out)){res.writeHead(403);res.end();return;}
  try{const data=await readFile(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png'})[extname(file)]??'application/octet-stream');res.end(data);}
  catch{res.writeHead(404);res.end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser=existingBrowser,page;const errors=[];
try{
  browser??=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1200,height:800}});
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await page.waitForFunction(()=>!!window.crown);
  const snapshot=(revision,name='SMOKE TEST',message='Build something good in San Francisco.')=>({
    version:1,revision,currency:'usd',mode:'test',checkoutAvailable:false,minimumBidCents:100,
    entries:[{bidderId:'isolated-smoke',rank:1,name,message,url:'https://example.com',totalCents:'100'}]});
  await page.evaluate(s=>window.crown.set({...s,entries:[{...s.entries[0],logoUrl:'https://unapproved.example/logo.png'}]}),snapshot(1));
  assert.equal(await page.evaluate(()=>window.crown.inspect()),null);
  await page.evaluate(s=>window.crown.set(s),snapshot(1));
  const initial=await page.evaluate(()=>window.crown.inspect());assert.equal(initial.visible,true);assert.ok(initial.width*initial.height<=1_000_000);
  await page.screenshot({path:resolve(out,'crown-close.png')});
  await page.evaluate(()=>window.crown.view(true));await page.screenshot({path:resolve(out,'crown-tower.png')});
  await page.evaluate(s=>window.crown.set(s),snapshot(2));
  assert.equal((await page.evaluate(()=>window.crown.inspect())).version,initial.version);
  await page.evaluate(s=>window.crown.set(s),snapshot(3,'SECOND SMOKE WINNER','The shared snapshot changed. The crown changed with it.'));
  const changed=await page.evaluate(()=>window.crown.inspect());assert.ok(changed.version>initial.version);
  await page.evaluate(()=>window.crown.view());await page.screenshot({path:resolve(out,'crown-updated.png')});
  await page.evaluate(s=>window.crown.set(s),snapshot(1));
  assert.equal((await page.evaluate(()=>window.crown.inspect())).version,changed.version);
  await page.evaluate(s=>window.crown.set({...s,entries:[]}),snapshot(4));
  assert.equal((await page.evaluate(()=>window.crown.inspect())).visible,false);
  await page.evaluate(()=>window.crown.destroy());assert.deepEqual(errors,[]);
  await writeFile(resolve(out,'smoke.json'),JSON.stringify({checkedAt:new Date().toISOString(),ok:true,texturePixels:initial.width*initial.height,errors},null,2));
  return {ok:true,out,texturePixels:initial.width*initial.height};
}finally{await page?.close();if(!existingBrowser)await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await checkOutbidCrown(undefined,{buildOnly:process.argv.includes('--build-only'),skipBuild:process.argv.includes('--skip-build')})));
