import { build } from 'vite';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';

// Isolated real renderer probe: three clock palettes, authored source map, alpha bloom mask.
// No running app/Worker modifications, fixed seconds only for repeatable visual evidence.
const root = process.cwd(), out = resolve(root,'artifacts/sa-look'), source = resolve(out,'source');
await mkdir(source,{recursive:true});
await writeFile(resolve(source,'check.ts'), `
import {Color,Group,Mesh,PerspectiveCamera,PlaneGeometry,ShaderMaterial,Vector3} from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {MeshoptDecoder} from 'three/addons/libs/meshopt_decoder.module.js';
import {createRenderFoundation} from '/web/src/render/foundation.ts';
import {decodeHeightfield} from '/web/src/render/chunks/terrain.ts';
const canvas=document.querySelector('canvas'); let now=Date.parse('2026-10-02T11:00:00-07:00');
const f=createRenderFoundation({canvas,enabled:true,atmosphere:true,now:()=>now,tier:innerWidth<700?'low':'medium'});
f.resize(innerWidth,innerHeight); const camera=new PerspectiveCamera(55,innerWidth/innerHeight,.08,1000);
camera.position.set(0,0,15); camera.lookAt(0,0,0);
const flat=new ShaderMaterial({uniforms:{alpha:{value:1}},vertexShader:'void main(){gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:'uniform float alpha; void main(){gl_FragColor=vec4(vec3(0.88),alpha);}',toneMapped:false});
const board=new Mesh(new PlaneGeometry(12,8),flat); f.scene.add(board);
function pixels(bloom){f.render(camera,bloom,0);const gl=f.renderer.getContext(),p=new Uint8Array(4);gl.readPixels(canvas.width/2|0,canvas.height/2|0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,p);return [...p];}
const world=new Group();
window.saCheck={
 proof(){ const opaquePlain=pixels(false),opaqueBloom=pixels(true);flat.uniforms.alpha.value=0;const skyPlain=pixels(false),skyBloom=pixels(true);flat.uniforms.alpha.value=1;return{opaquePlain,opaqueBloom,skyPlain,skyBloom}; },
 async mount(){board.visible=false;const manifest=await fetch('/map/manifest.json').then(r=>r.json());const graph=await fetch('/map/roadgraph.json').then(r=>r.json());const edge=graph.edges.filter(e=>e.name==='Lombard Street').sort((a,b)=>b.points.length-a.points.length)[0];const p=edge.points[edge.points.length/2|0];const selected=manifest.chunks.filter(c=>Math.abs(c.x-Math.floor(p[0]/256))<=1&&Math.abs(c.z-Math.floor(p[2]/256))<=1);const loader=new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);for(const c of selected){const gltf=await loader.loadAsync('/map/'+c.lods[1].path);gltf.scene.position.set(c.x*256,0,c.z*256);gltf.scene.userData.gtasfFacadeGround=decodeHeightfield(await fetch('/map/'+c.terrain.path).then(r=>r.arrayBuffer()));f.mountGeometry(gltf.scene);}await f.facadeAtlas?.ready;camera.position.set(p[0]+52,p[1]+29,p[2]+64);camera.lookAt(p[0],p[1]+15,p[2]);return{chunks:selected.length,atlas:f.facadeAtlas?.stats};},
 render(date){now=Date.parse(date);f.render(camera,true,0);return{fogNear:f.haze.near,fogFar:f.haze.far,fog:f.haze.color.toArray(),horizon:f.sky.horizon.toArray(),width:canvas.width,height:canvas.height,postBytes:f.postBytes()};},
 dispose(){f.dispose();flat.dispose();board.geometry.dispose();}
};
`);
await build({configFile:false,root,publicDir:false,logLevel:'warn',build:{outDir:resolve(out,'app'),emptyOutDir:true,reportCompressedSize:false,lib:{entry:resolve(source,'check.ts'),formats:['es'],fileName:'check'}}});
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://local').pathname;
  if(path==='/'){res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}canvas{width:100vw;height:100vh;display:block}</style><canvas></canvas><script type="module" src="/check.js"></script>');return;}
  if(path==='/favicon.ico'){res.writeHead(204).end();return;}
  const base=path.startsWith('/map/')?resolve(root,'tools/map/out/lombard'):path.startsWith('/art/')?resolve(root,'web/public'):resolve(out,'app');
  const file=resolve(base,'.'+(path.startsWith('/map/')?path.slice(4):path));
  if(!file.startsWith(base+'/')){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',({'.js':'text/javascript','.png':'image/png','.json':'application/json'})[extname(file)]??'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser; const evidence=[];
try{
  browser=await chromium.launch({headless:true});
  for(const [name,width,height] of [['desktop',1100,720],['phone',390,844]]){
    const page=await browser.newPage({viewport:{width,height}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
    await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>window.saCheck);
    const proof=await page.evaluate(()=>window.saCheck.proof());console.log(JSON.stringify({name,proof}));assert.deepEqual(proof.opaqueBloom,proof.opaquePlain,'opaque creative must not bloom');assert(proof.skyBloom.slice(0,3).some((v,i)=>v>proof.skyPlain[i]),'sky alpha must admit bounded bloom');
    const map=await page.evaluate(()=>window.saCheck.mount());assert.equal(map.atlas.state,'ready');
    const times={};for(const [period,date] of [['day','2026-10-02T11:00:00-07:00'],['golden','2026-10-02T18:15:00-07:00'],['night','2026-10-02T23:00:00-07:00']]){
      times[period]=await page.evaluate(date=>window.saCheck.render(date),date);assert.deepEqual(times[period].fog,times[period].horizon);await page.screenshot({path:resolve(out,name+'-'+period+'.png')});
    }
    assert.deepEqual(errors,[]);evidence.push({name,proof,map,times,errors});await page.evaluate(()=>window.saCheck.dispose());await page.close();
  }
  await writeFile(resolve(out,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
