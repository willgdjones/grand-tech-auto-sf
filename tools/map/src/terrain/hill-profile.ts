/** Read the shipped GLBs, lane graph and DEM for the single hill-fidelity checkpoint. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readGlb } from '../glb';
import { settings } from '../pipeline/settings';
import { decodeTerrarium, Terrain } from '../pipeline/elevation';
import { decodeHeightfield } from '../pipeline/heightfield';
import { SpatialIndex } from '../pipeline/geometry';
import { atomicWrite, digest } from '../pipeline/sources';
import type { MapManifest, RoadGraph, SourceManifest, XYZ } from '../pipeline/types';

const s=settings('lombard');
const json=async<T>(root:string,path:string)=>JSON.parse(await readFile(join(root,path),'utf8')) as T;
const manifest=await json<MapManifest>(s.out,'manifest.json');
const sources=await json<SourceManifest>(s.cache,'sources.json');
const graph=await json<RoadGraph>(s.out,manifest.roadGraph.path);
const local=await json<{pickup:{edges:string[]};downhill:{edges:string[]}}>(s.out,'local-play.json');
const tiles=new Map<string,Float32Array>();
for(const source of sources.records.filter(r=>r.key.startsWith('terrain-'))) {
  const bytes=await readFile(join(s.cache,source.file));
  assert.equal(digest(bytes),source.sha256,`Changed source tile ${source.key}`);
  tiles.set(source.key.slice(8),decodeTerrarium(bytes));
}
const terrain=new Terrain(s.zoom,tiles),edges=new Map(graph.edges.map(e=>[e.id,e]));
const points=[...local.pickup.edges.map(id=>({id,part:'approach'})),...local.downhill.edges.map(id=>({id,part:'downhill'}))]
  .flatMap(({id,part})=>edges.get(id)!.points.map(p=>({part,edge:id,point:p})));
const chunkIds=new Set(points.map(({point:p})=>`${Math.floor(p[0]/256)}_${Math.floor(p[2]/256)}`));
type Triangle=[XYZ,XYZ,XYZ];
const roadIndices=[new SpatialIndex<Triangle>(16),new SpatialIndex<Triangle>(16)];
const fields=new Map<string,ReturnType<typeof decodeHeightfield>>();
for(const chunk of manifest.chunks.filter(c=>chunkIds.has(c.id))) {
  fields.set(chunk.id,decodeHeightfield(await readFile(join(s.out,chunk.terrain.path))));
  for(const lod of [0,1]) {
    const doc=await readGlb(await readFile(join(s.out,chunk.lods[lod]!.path)));
    for(const node of doc.getRoot().listNodes().filter(n=>n.getName()==='roads')) {
      const translation=node.getTranslation(),scale=node.getScale();
      for(const primitive of node.getMesh()!.listPrimitives()) {
        const position=primitive.getAttribute('POSITION')!,array=position.getArray()!,indices=primitive.getIndices()!.getArray()!;
        assert(array instanceof Int16Array&&position.getNormalized(),'Expected the published normalized Int16 road positions');
        const vertex=(i:number):XYZ=>[Math.max(-1,array[i*3]!/32767)*scale[0]+translation[0]+chunk.x*256,
          Math.max(-1,array[i*3+1]!/32767)*scale[1]+translation[1],
          Math.max(-1,array[i*3+2]!/32767)*scale[2]+translation[2]+chunk.z*256];
        for(let i=0;i<indices.length;i+=3) {
          const tri:Triangle=[vertex(indices[i]!),vertex(indices[i+1]!),vertex(indices[i+2]!)];
          roadIndices[lod]!.add([Math.min(...tri.map(p=>p[0])),Math.min(...tri.map(p=>p[2])),Math.max(...tri.map(p=>p[0])),Math.max(...tri.map(p=>p[2]))],tri);
        }
      }
    }
  }
}
function triangleHeight([a,b,c]:Triangle,x:number,z:number):number|undefined {
  const denominator=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);
  if(Math.abs(denominator)<1e-10)return;
  const u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/denominator;
  const v=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/denominator;
  if(u<-.002||v<-.002||u+v>1.002)return;
  return u*a[1]+v*b[1]+(1-u-v)*c[1];
}
const samples=points.map(({part,edge,point:[x,y,z]})=>{
  const field=fields.get(`${Math.floor(x/256)}_${Math.floor(z/256)}`)!;
  const gx=(x-field.x*256)/field.step,gz=(z-field.z*256)/field.step;
  const ix=Math.min(field.size-2,Math.floor(gx)),iz=Math.min(field.size-2,Math.floor(gz)),tx=gx-ix,tz=gz-iz;
  const at=(a:number,b:number)=>(field.offsetCm+field.values[b*field.size+a]!)/100;
  const ground=(at(ix,iz)*(1-tx)+at(ix+1,iz)*tx)*(1-tz)+(at(ix,iz+1)*(1-tx)+at(ix+1,iz+1)*tx)*tz;
  const mesh=roadIndices.map(index=>index.query([x,z,x,z]).map(t=>triangleHeight(t,x,z)).filter((v):v is number=>v!==undefined).sort((a,b)=>Math.abs(a-y)-Math.abs(b-y))[0]);
  return {part,edge,x,y,z,dem:terrain.sample(x,z),ground,mesh};
});
const max=(values:number[])=>Math.max(...values.map(Math.abs));
const summary=['approach','downhill'].map(part=>{
  const selected=samples.filter(p=>p.part===part),first=selected[0]!,last=selected.at(-1)!;
  return {part,samples:selected.length,first:{road:first.y,dem:first.dem,ground:first.ground,mesh:first.mesh},last:{road:last.y,dem:last.dem,ground:last.ground,mesh:last.mesh},
    heightChangeM:last.y-first.y,roadDemDifferenceM:max(selected.map(p=>p.y-p.dem)),roadHeightfieldDifferenceM:max(selected.map(p=>p.y-p.ground)),
    missingMeshSamples:[0,1].map(lod=>selected.filter(p=>p.mesh[lod]===undefined).length),
    roadMeshDifferenceM:[0,1].map(lod=>max(selected.filter(p=>p.mesh[lod]!==undefined).map(p=>p.y-p.mesh[lod]!)))};
});
const report={at:new Date().toISOString(),sourceDigests:manifest.sourceDigests,chunks:[...chunkIds],terrainZoom:s.zoom,summary,samples};
await atomicWrite(join(s.out,'hill-profile.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({chunks:report.chunks,summary},null,2));
for(const part of summary) {
  assert(part.missingMeshSamples.every(n=>n===0),'Every contact point needs a real road triangle at both LODs');
  assert(part.roadMeshDifferenceM.every(n=>n<=.05),'Published mesh must stay within 5cm of lane contact');
  assert(part.roadDemDifferenceM<=.25&&part.roadHeightfieldDifferenceM<=.25,'Road contact must stay within the documented source/carving envelope');
}
assert(summary[0]!.heightChangeM>10&&summary[1]!.heightChangeM< -30,'Real uphill and downhill relief must survive publication');
