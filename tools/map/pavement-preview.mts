/** Finite, isolated North Beach pavement specimen. Never writes the live map/art. */
import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { dirname, extname, resolve } from 'node:path';
import { build } from 'vite';
import { chromium } from '@playwright/test';
import { readGlb, writeGlb } from './src/glb';
import { parseOpl } from './src/pipeline/pbf';
import { settings, geographicBounds } from './src/pipeline/settings';
import { decodeTerrarium, Terrain, tileKey, tilesForBbox } from './src/pipeline/elevation';
import { extractRoads } from './src/pipeline/osm';
import { prepareRoadSurfaces, RoadTerrain } from './src/pipeline/roads';
import { pavementExclusions, pavementSidewalkTags, preparePavements } from './src/pipeline/pavement';
import { addRoadMeshes, addTerrainMeshes, ChunkMeshes, chunkGlb, MeshData } from './src/pipeline/meshes';
import { overlaps, polygonBounds, contains, SpatialIndex } from './src/pipeline/geometry';
import type { Bounds, MapManifest, Polygon, SourceManifest } from './src/pipeline/types';

const root=process.cwd(),s=settings('sf'),out=resolve(root,'tools/map/out/pavement-qv7g');
const bounds:Bounds=[-512,-2048,256,-1280],sourceBounds:Bounds=[-768,-2304,512,-1024];
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const write=async(path:string,bytes:string|Uint8Array)=>{const p=resolve(out,path);await mkdir(dirname(p),{recursive:true});await writeFile(p,bytes);};
const sourceManifestBytes=await readFile(resolve(s.out,'manifest.json'));
const manifest=JSON.parse(sourceManifestBytes.toString()) as MapManifest;
const originalGraph=await readFile(resolve(s.out,manifest.roadGraph.path));
assert.equal(sha(originalGraph),manifest.roadGraph.sha256);
const chunks=manifest.chunks.filter(c=>c.bounds[0]>=bounds[0]&&c.bounds[2]<=bounds[2]&&c.bounds[1]>=bounds[1]&&c.bounds[3]<=bounds[3]);
assert.equal(chunks.length,9);
await mkdir(out,{recursive:true});

if(process.argv.includes('--bake')) {
  const sourceBbox=geographicBounds(sourceBounds,64),opl=resolve(out,'specimen.opl');
  execFileSync('osmium',['extract',resolve('tools/map/out/SanFrancisco.osm.pbf'),'--bbox',sourceBbox.join(','),'--strategy','smart','-S','types=multipolygon,restriction','--output-format','opl','--overwrite','--output',opl]);
  const osm=await parseOpl(createInterface({input:createReadStream(opl),crlfDelay:Infinity}));
  const records=(JSON.parse(await readFile(resolve(s.cache,'sources.json'),'utf8')) as SourceManifest).records;
  const needed=new Set(tilesForBbox(geographicBounds(sourceBounds,8),s.zoom).map(t=>`terrain-${tileKey(t)}`));
  const tiles=new Map<string,Float32Array>();
  for(const record of records.filter(r=>needed.has(r.key))) {
    const b=await readFile(resolve(s.cache,record.file));assert.equal(sha(b),record.sha256);
    tiles.set(record.key.slice(8),decodeTerrarium(b));
  }
  assert.equal(tiles.size,needed.size);
  const original=new Terrain(s.zoom,tiles),roads=extractRoads(osm,sourceBounds),warnings:string[]=[];
  prepareRoadSurfaces(roads,original,warnings);const terrain=new RoadTerrain(original,roads);
  const exclusions=pavementExclusions(osm,warnings);
  for(const c of chunks) {
    const collision=JSON.parse(await readFile(resolve(s.out,c.collision.path),'utf8'));
    for(const b of collision.buildings)exclusions.push(b.rings.map((r:number[][])=>r.map(([x,z])=>[x!+c.bounds[0],z!+c.bounds[1]])) as Polygon);
  }
  const pavements=preparePavements(roads,exclusions);
  const mappedRoads=new Set(preparePavements(roads).flatMap(p=>p.roadIds));
  const target=pavements.filter(p=>contains(p.polygon,[-110,-1700])||p.roadIds.includes('681183500:0'));
  assert(target.length>0,'Source Columbus face required');
  const inventory=[];
  for(const c of chunks)for(const lod of [0,1] as const) {
    const meshes=new ChunkMeshes(c.bounds),chunk=meshes.chunks.get(c.id)!;
    const local=roads.filter(r=>{const b=polygonBounds([r.points.map(p=>[p.x,p.z])]);return overlaps([b[0]-r.width,b[1]-r.width,b[2]+r.width,b[3]+r.width],c.bounds);});
    const cuts=addRoadMeshes(meshes,local,terrain,lod,pavements.filter(p=>overlaps(polygonBounds(p.polygon),c.bounds)));
    addTerrainMeshes(meshes,terrain,cuts,lod===0?4:16,4);
    // Existing tunnel shells are copied below, just like buildings. Do not
    // retain a second generated shell from the road-meshing pass.
    chunk.structures=new MeshData();
    const doc=await readGlb(await chunkGlb(chunk,256));
    const old=await readGlb(await readFile(resolve(s.out,c.lods[lod].path)));
    const buffer=doc.getRoot().listBuffers()[0]!,scene=doc.getRoot().getDefaultScene()!;
    let retained=0;
    // Copy quantized building/structure attributes and transforms unchanged.
    for(const node of old.getRoot().listNodes()) {
      if(!['buildings','structures'].includes(node.getName())||!node.getMesh())continue;
      const mesh=doc.createMesh(node.getName());
      for(const p of node.getMesh()!.listPrimitives()) {
        const next=doc.createPrimitive().setMode(p.getMode());
        const copy=(a:NonNullable<ReturnType<typeof p.getIndices>>)=>doc.createAccessor().setType(a.getType()).setNormalized(a.getNormalized()).setArray(a.getArray()!.slice()).setBuffer(buffer);
        for(const semantic of p.listSemantics())next.setAttribute(semantic,copy(p.getAttribute(semantic)!));
        if(p.getIndices())next.setIndices(copy(p.getIndices()!));
        next.setMaterial(doc.createMaterial(node.getName()).setRoughnessFactor(1).setMetallicFactor(0));mesh.addPrimitive(next);retained++;
      }
      scene.addChild(doc.createNode(node.getName()).setMesh(mesh).setTranslation(node.getTranslation()).setRotation(node.getRotation()).setScale(node.getScale()));
    }
    const bytes=await writeGlb(doc),entry={...c.lods[lod],bytes:bytes.length,gzipBytes:gzipSync(bytes).length,sha256:sha(bytes)};
    c.triangles[lod]=doc.getRoot().listMeshes().reduce((sum,m)=>sum+m.listPrimitives().reduce((n,p)=>n+(p.getIndices()?.getCount()??0)/3,0),0);
    await write(entry.path,bytes);inventory.push({id:c.id,lod,retainedPrimitives:retained,triangles:c.triangles[lod],bytes:bytes.length,sha256:entry.sha256});c.lods[lod]=entry;
    console.log(`Specimen ${c.id} LOD${lod}: ${bytes.length} bytes`);
  }
  // This pre-existing art graph is source geometry only; prove it still matches
  // the source raw graph used to create it before using it for the camera.
  const artRoot=resolve(root,'artifacts/district-art');
  const artProof=JSON.parse(await readFile(resolve(artRoot,'source-proof.json'),'utf8'));
  assert.equal(sha(await readFile(resolve(s.out,'roadgraph.json'))),artProof.sourceGraphSha256,'Frozen art graph source changed');
  const graphBytes=await readFile(resolve(artRoot,'district-graph.json'));
  assert.equal(sha(graphBytes),artProof.subsetGraphSha256);
  await write('district-graph.json',graphBytes);
  const specimen={...manifest,chunks,roadGraph:{path:'district-graph.json',bytes:graphBytes.length,gzipBytes:gzipSync(graphBytes).length,sha256:sha(graphBytes)}};
  await write('manifest.json',JSON.stringify(specimen));
  const details=JSON.parse(await readFile(resolve(root,'web/public/art/road-details.json'),'utf8'));
  const sourceRoads=new Map(roads.map(r=>[r.id,r]));let suppressed=0;
  for(const road of details.roads) {
    const source=sourceRoads.get(road.id);if(!source)continue;
    const tags=pavementSidewalkTags(source,mappedRoads);Object.assign(road,tags);if(mappedRoads.has(road.id))suppressed++;
  }
  await write('road-details.json',JSON.stringify(details));
  await write('bake-report.json',JSON.stringify({scope:'Isolated source North Beach pavement specimen; no runtime activation, driving, streaming or production-budget acceptance',sourceManifestSha256:sha(sourceManifestBytes),sourceGraphSha256:sha(originalGraph),sourceOplSha256:sha(await readFile(opl)),bounds,roads:roads.length,pavements:pavements.length,suppressedInteriorKerbs:suppressed,target:target.map(p=>({roadIds:p.roadIds,polygon:p.polygon})),inventory,warnings},null,2));
  // Both graph and manifest stay pinned in the shared city output.
  assert.equal(sha(await readFile(resolve(s.out,'manifest.json'))),sha(sourceManifestBytes));
  assert.equal(sha(await readFile(resolve(s.out,manifest.roadGraph.path))),sha(originalGraph));
}

if(process.argv.includes('--bake')||process.argv.includes('--scope-details')) {
  // A bounded specimen cannot suppress curbs on the rest of a long road whose
  // pavement has not been baked. Keep those source details until the city bake.
  const sourceDetails=JSON.parse(await readFile(resolve(root,'web/public/art/road-details.json'),'utf8'));
  const previewDetails=JSON.parse(await readFile(resolve(out,'road-details.json'),'utf8'));
  const sourceById=new Map(sourceDetails.roads.map((r:{id:string})=>[r.id,r]));
  let changed=0,suppressed=0;
  previewDetails.roads=previewDetails.roads.map((r:{id:string;points:number[][];sidewalk?:string})=>{
    const original=sourceById.get(r.id);assert(original,'Preview road must exist in source');
    if(!r.points.every(([x,,z])=>x!>=bounds[0]&&x!<=bounds[2]&&z!>=bounds[1]&&z!<=bounds[3]))return original;
    if(JSON.stringify(r)!==JSON.stringify(original)){changed++;if(r.sidewalk==='separate')suppressed++;}
    return r;
  });
  await write('road-details.json',JSON.stringify(previewDetails));
  const report=JSON.parse(await readFile(resolve(out,'bake-report.json'),'utf8'));
  report.previewChangedRoadDetails=changed;report.previewSuppressedInteriorKerbs=suppressed;
  await write('bake-report.json',JSON.stringify(report,null,2));
}

if(process.argv.includes('--render')) {
  const frozen=JSON.parse(await readFile(resolve(out,'bake-report.json'),'utf8'));
  assert.equal(frozen.sourceManifestSha256,sha(sourceManifestBytes),'Rebake specimen after source manifest changes');
  const source=await readFile(resolve(root,'artifacts/district-art/source/check.ts'),'utf8');
  // Reuse the game's render foundation, road detail renderer, avatar and exact
  // North Beach camera from the original diagnostic; omit unrelated districts.
  await write('source/check.ts',source);
  await build({configFile:false,root,publicDir:false,logLevel:'warn',resolve:{alias:[{find:/^@gtasf\/shared\/(.*)$/,replacement:resolve(root,'shared')+'/$1'}]},build:{outDir:resolve(out,'app'),emptyOutDir:true,target:'es2022',reportCompressedSize:false,lib:{entry:resolve(out,'source/check.ts'),formats:['es'],fileName:'check'}}});
  let after=false;
  const server=createServer(async(req,res)=>{
    const path=new URL(req.url??'/','http://local').pathname;
    if(path==='/api/weather') {
      try {const upstream=await fetch('http://127.0.0.1:8787/api/weather');res.writeHead(upstream.status,{'Content-Type':'application/json'});res.end(Buffer.from(await upstream.arrayBuffer()));}
      catch {res.writeHead(502).end();}return;
    }
    if(path==='/'){res.setHeader('Content-Type','text/html');res.end('<meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0}canvas{width:100vw;height:100vh;display:block}</style><canvas></canvas><script type="module" src="/check.js"></script>');return;}
    if(path==='/favicon.ico'){res.writeHead(204).end();return;}
    let base=path.startsWith('/map/sf/')?s.out:path.startsWith('/art/')||path.startsWith('/assets/')?resolve(root,'web/public'):resolve(out,'app');
    let relative=path.startsWith('/map/sf/')?path.slice(8):path.slice(1);
    if(path==='/map/sf/manifest.json') {
      base=after?out:resolve(root,'artifacts/district-art');relative=after?'manifest.json':'district-manifest.json';
    }else if(path==='/map/sf/district-graph.json'){base=out;relative='district-graph.json';}
    else if(after&&path.startsWith('/map/sf/')&&path.endsWith('.glb'))base=out;
    else if(after&&path==='/art/road-details.json'){base=out;relative='road-details.json';}
    const file=resolve(base,relative);
    if(!file.startsWith(resolve(base)+'/')){res.writeHead(403).end();return;}
    try{const b=await readFile(file);res.setHeader('Content-Type',({'.js':'text/javascript','.json':'application/json','.png':'image/png','.webp':'image/webp'} as Record<string,string>)[extname(file)]??'application/octet-stream');res.end(b);}catch{res.writeHead(404).end();}
  });
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  let browser;const evidence:unknown[]=[];
  try {
    browser=await chromium.launch({headless:true});
    const address=server.address();assert(address&&typeof address!=='string');
    for(const stage of ['before','after'])for(const [name,width,height] of [['desktop',1100,720],['phone',390,844]] as const) {
      after=stage==='after';const page=await browser.newPage({viewport:{width,height}}),errors:string[]=[],httpErrors:string[]=[];page.setDefaultTimeout(120_000);
      page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)httpErrors.push(r.url()+': '+r.status());});
      await page.goto('http://127.0.0.1:'+address.port);await page.waitForFunction(()=>Boolean((window as any).districtCheck));
      const view=await page.evaluate(()=>((window as any).districtCheck).view(0));
      await page.screenshot({path:resolve(out,`${stage}-${name}.png`)});evidence.push({stage,name,view,errors,httpErrors});
      await write('render-report.json',JSON.stringify(evidence,null,2));assert.deepEqual(errors,[]);assert.deepEqual(httpErrors,[]);assert.deepEqual(view.map.errors,[]);
      await page.close();
    }
  }finally{await browser?.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
  console.log('Desktop/phone comparison saved to '+out);
}
if(process.argv.includes('--audit')) {
  const report=JSON.parse(await readFile(resolve(out,'bake-report.json'),'utf8'));
  type Triangle={points:[number,number,number][];kind:string};
  const load=async(base:string,path='chunks/-1_-7/lod0.glb',retainedOnly=false)=>{
    const doc=await readGlb(await readFile(resolve(base,path))),index=new SpatialIndex<Triangle>(4);
    const buildings=createHash('sha256');
    for(const node of doc.getRoot().listNodes()) {
      const kind=node.getName(),scale=node.getScale(),translation=node.getTranslation();
      if(!['roads','terrain','buildings','structures'].includes(kind))continue;
      if(retainedOnly&&kind!=='buildings'&&kind!=='structures')continue;
      if(kind==='buildings'||kind==='structures')buildings.update(JSON.stringify([kind,scale,translation,node.getRotation()]));
      for(const primitive of node.getMesh()?.listPrimitives()??[]) {
        const a=primitive.getAttribute('POSITION')!.getArray()!,ids=primitive.getIndices()!.getArray()!;
        if(kind==='buildings'||kind==='structures') {
          for(const semantic of primitive.listSemantics().sort()) {
            const attr=primitive.getAttribute(semantic)!,array=attr.getArray()!;
            buildings.update(semantic).update(new Uint8Array(array.buffer,array.byteOffset,array.byteLength));
          }
          // Meshopt may rotate a triangle's first index during re-encoding.
          // Compare its oriented geometry, not that incidental byte ordering.
          const triangles:string[]=[];
          for(let i=0;i<ids.length;i+=3) {
            const face=[ids[i]!,ids[i+1]!,ids[i+2]!];
            triangles.push([0,1,2].map(first=>[face[first],face[(first+1)%3],face[(first+2)%3]].join(',')).sort()[0]!);
          }
          buildings.update(triangles.sort().join(';'));
          continue;
        }
        const point=(i:number):[number,number,number]=>[a[i*3]!/32767*scale[0]+translation[0]-256,a[i*3+1]!/32767*scale[1]+translation[1],a[i*3+2]!/32767*scale[2]+translation[2]-1792];
        for(let i=0;i<ids.length;i+=3) {
          const points=[point(ids[i]!),point(ids[i+1]!),point(ids[i+2]!)];
          index.add(polygonBounds([points.map(p=>[p[0],p[2]])]),{kind,points});
        }
      }
    }
    return {index,buildings:buildings.digest('hex')};
  };
  const before=await load(s.out),after=await load(out);
  assert.equal(after.buildings,before.buildings,'Source building/structure geometry and transforms retained');
  const retainedGeometry:Record<string,string>={};
  for(const path of new Set(chunks.flatMap(c=>c.lods.map(a=>a.path)))) {
    const old=path==='chunks/-1_-7/lod0.glb'?before:await load(s.out,path,true);
    const next=path==='chunks/-1_-7/lod0.glb'?after:await load(out,path,true);
    assert.equal(next.buildings,old.buildings,`Retained source buildings/structures: ${path}`);retainedGeometry[path]=next.buildings;
  }
  const at=(index:SpatialIndex<Triangle>,x:number,z:number)=>{
    const result:{kind:string;y:number}[]=[];
    for(const {points:[a,b,c],kind} of index.query([x,z,x,z])) {
      const det=(b![2]-c![2])*(a![0]-c![0])+(c![0]-b![0])*(a![2]-c![2]);if(Math.abs(det)<1e-10)continue;
      const u=((b![2]-c![2])*(x-c![0])+(c![0]-b![0])*(z-c![2]))/det;
      const v=((c![2]-a![2])*(x-c![0])+(a![0]-c![0])*(z-c![2]))/det,w=1-u-v;
      if(Math.min(u,v,w)>1e-7)result.push({kind,y:u*a![1]+v*b![1]+w*c![1]});
    }
    return result;
  };
  let samples=0,formerGaps=0,covered=0,overlapsTerrain=0,missing=0,maxGroundDeltaM=0;
  for(const {polygon} of report.target as {polygon:Polygon}[]) {
    const b=polygonBounds(polygon);
    for(let x=Math.floor(Math.max(-256,b[0]))+.37;x<Math.min(0,b[2]);x++)for(let z=Math.floor(Math.max(-1792,b[1]))+.53;z<Math.min(-1536,b[3]);z++) {
      if(!contains(polygon,[x,z]))continue;
      const old=at(before.index,x,z),now=at(after.index,x,z),road=now.find(t=>t.kind==='roads');samples++;
      if(!road){missing++;continue;}
      if(now.some(t=>t.kind==='terrain'&&t.y>road.y-.05))overlapsTerrain++;
      if(!old.some(t=>t.kind==='roads')&&old.some(t=>t.kind==='terrain')) {
        formerGaps++;covered++;maxGroundDeltaM=Math.max(maxGroundDeltaM,Math.abs(road.y-old.find(t=>t.kind==='terrain')!.y));
      }
    }
  }
  const result={samples,formerGaps,covered,missing,overlapsTerrain,maxGroundDeltaM,buildingGeometrySha256:after.buildings,retainedGeometry};
  await write('geometry-report.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  assert(formerGaps>100,'The audit must cover real former grass gaps');assert.equal(missing,0);assert.equal(overlapsTerrain,0);
}
if(!process.argv.some(a=>['--bake','--render','--audit','--scope-details'].includes(a)))throw new Error('Use --bake, --audit, --scope-details and/or --render');
