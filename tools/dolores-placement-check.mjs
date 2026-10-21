/** Offline full-footprint path, building and emitted-ground proof. No game mutation. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Box3 } from 'three';
import { DOLORES_PICNIC, DOLORES_FRIEND_POSITIONS } from '../web/src/render/doloresWeekend.ts';
import { createDoloresPicnic } from '../web/src/render/doloresWeekendModels.ts';
import { geodeticToWorld } from './map/src/geo.ts';
import { SF_FRAME } from './map/src/config.ts';
import { extractRoads } from './map/src/pipeline/osm.ts';
import { resample, offsetPath, gradeSeparated } from './map/src/pipeline/roads.ts';
import { containsRing } from './map/src/pipeline/geometry.ts';
import { decodeHeightfield, sampleHeight, FootprintIndex } from '../web/src/render/chunks/terrain.ts';
import { readGlb } from './map/src/glb.ts';
const root='tools/map/out/sf', read=async p=>JSON.parse(await readFile(p,'utf8'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const manifest=await read(`${root}/manifest.json`), sources=await read(`${root}/sources.json`);
const record=sources.records.find(r=>r.key==='osm-pbf-normalized');assert.ok(record);
const bytes=await readFile(`tools/map/out/cache/sf/${record.file}`);assert.equal(hash(bytes),record.sha256);
const [x,z]=geodeticToWorld(DOLORES_PICNIC.lat,DOLORES_PICNIC.lon,SF_FRAME);
// Four metres encloses both cloths, props and all four standing friends plus radius.
const half=4, ring=[[x-half,z-half],[x+half,z-half],[x+half,z+half],[x-half,z+half]];
const picnic=createDoloresPicnic(), box=new Box3().setFromObject(picnic.root);
assert.ok(Math.max(Math.abs(box.min.x),Math.abs(box.max.x),Math.abs(box.min.z),Math.abs(box.max.z))<half);
assert.ok(DOLORES_FRIEND_POSITIONS.every(([dx,dz])=>Math.max(Math.abs(dx),Math.abs(dz))+.35<half));
picnic.dispose();
const roads=extractRoads(JSON.parse(bytes.toString()),[x-150,z-150,x+150,z+150]).filter(r=>!gradeSeparated(r));
const edges=ring=>ring.map((p,i)=>[p,ring[(i+1)%ring.length]]);
const pointDistance=(p,a,b)=>{const dx=b[0]-a[0],dz=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/(dx*dx+dz*dz||1)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz);};
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const distance=(a,b,c,d)=>{if(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)return 0;return Math.min(pointDistance(a,c,d),pointDistance(b,c,d),pointDistance(c,a,b),pointDistance(d,a,b));};
let nearest={metres:Infinity};
for(const road of roads){const dense=resample(road.points.map(p=>[p.x,p.z]),3),left=offsetPath(dense,-road.width/2),right=offsetPath(dense,road.width/2);
 for(let i=1;i<dense.length;i++){const quad=[left[i-1],left[i],right[i],right[i-1]];
 let metres=ring.some(p=>containsRing(quad,p))||quad.some(p=>containsRing(ring,p))?0:Infinity;
 for(const [a,b] of edges(ring))for(const [c,d] of edges(quad))metres=Math.min(metres,distance(a,b,c,d));
 if(metres<nearest.metres)nearest={metres,osmWay:road.osmWay,width:road.width,tags:road.tags};}}
assert.ok(nearest.metres>.5,'The entire picnic must clear every surface highway path');
const chunks=manifest.chunks.filter(c=>(c.x+1)*256>=x-half&&c.x*256<=x+half&&(c.z+1)*256>=z-half&&c.z*256<=z+half);
const fields=new Map(),collisions=[],triangles=[[],[]],receipts=[];
for(const chunk of chunks){
 const field=await readFile(`${root}/${chunk.terrain.path}`);assert.equal(hash(field),chunk.terrain.sha256);fields.set(chunk.id,decodeHeightfield(field.buffer.slice(field.byteOffset,field.byteOffset+field.byteLength)));
 const collision=await readFile(`${root}/${chunk.collision.path}`);assert.equal(hash(collision),chunk.collision.sha256);collisions.push(JSON.parse(collision));
 for(const lod of [0,1]){const asset=chunk.lods[lod],data=await readFile(`${root}/${asset.path}`);assert.equal(hash(data),asset.sha256);
 const doc=await readGlb(data);
 for(const node of doc.getRoot().listNodes()){const mesh=node.getMesh();if(!mesh)continue;const t=node.getTranslation(),s=node.getScale();assert.deepEqual(node.getRotation(),[0,0,0,1]);
 for(const primitive of mesh.listPrimitives()){const position=primitive.getAttribute('POSITION'),array=position.getArray(),ids=primitive.getIndices().getArray();assert.ok(array instanceof Int16Array&&position.getNormalized());
 const vertex=i=>[Math.max(-1,array[i*3]/32767)*s[0]+t[0]+chunk.x*256,Math.max(-1,array[i*3+1]/32767)*s[1]+t[1],Math.max(-1,array[i*3+2]/32767)*s[2]+t[2]+chunk.z*256];
 for(let i=0;i<ids.length;i+=3){const points=[vertex(ids[i]),vertex(ids[i+1]),vertex(ids[i+2])];if(Math.max(...points.map(p=>p[0]))<x-half||Math.min(...points.map(p=>p[0]))>x+half||Math.max(...points.map(p=>p[2]))<z-half||Math.min(...points.map(p=>p[2]))>z+half)continue;triangles[lod].push({kind:node.getName(),points});}}}
 receipts.push({chunk:chunk.id,lod,path:asset.path,sha256:asset.sha256});}}
const footprint=new FootprintIndex();footprint.rebuild(collisions);
const heightAt=(px,pz)=>sampleHeight(fields.get(`${Math.floor(px/256)}_${Math.floor(pz/256)}`),px,pz);
function triangleHeight([a,b,c],x,z){const d=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);if(Math.abs(d)<1e-10)return null;
 const u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/d,v=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/d;
 return u< -1e-6||v< -1e-6||u+v>1+1e-6?null:u*a[1]+v*b[1]+(1-u-v)*c[1];}
assert.equal(footprint.collides(x,heightAt(x,z),z,Math.SQRT2*half,2),false,'Full square footprint is outside building collision');
const samples=[];
for(let dx=-half;dx<=half;dx+=.5)for(let dz=-half;dz<=half;dz+=.5){const px=x+dx,pz=z+dz,contact=heightAt(px,pz);
 const visible=triangles.map(list=>{const hits=list.map(t=>({kind:t.kind,y:triangleHeight(t.points,px,pz)})).filter(t=>t.y!==null&&t.y<contact+2);return hits.sort((a,b)=>b.y-a.y)[0]??null;});
 assert.ok(visible.every(v=>v),'Both emitted LODs must cover the picnic');samples.push({dx,dz,contact,visible,delta:visible.map(v=>contact-v.y)});}
const visibleAt=(px,pz,y)=>triangles.map(list=>Math.max(...list.map(t=>triangleHeight(t.points,px,pz)).filter(value=>value!==null&&value<y+2)));
const groundedPicnic=createDoloresPicnic();
assert.equal(groundedPicnic.ground((dx,dz)=>heightAt(x+dx,z+dz)),true);
const cloth=[];
groundedPicnic.root.traverse(object=>{
 if(!object.isMesh||!object.name.includes('woven'))return;
 const position=object.geometry.getAttribute('position');
 for(let i=0;i<position.count;i++){
  const px=x+position.getX(i),pz=z+position.getZ(i),y=position.getY(i);
  cloth.push(visibleAt(px,pz,y).map(visible=>y-visible));
 }
});
groundedPicnic.dispose();assert.ok(cloth.length,'Actual blanket vertices are required');
const actors=DOLORES_FRIEND_POSITIONS.map(([dx,dz])=>{
 const y=heightAt(x+dx,z+dz);
 return{dx,dz,delta:visibleAt(x+dx,z+dz,y).map(visible=>y-visible)};
});
const actualSites={clothVertices:cloth.length,clothMin:Math.min(...cloth.flat()),clothMax:Math.max(...cloth.flat()),actors};
const maxGroundDifference=[0,1].map(lod=>Math.max(...samples.map(s=>Math.abs(s.delta[lod]))));
const passed=maxGroundDifference.every(d=>d<.1)&&actualSites.clothMin>=.003&&actualSites.clothMax<=.065
 &&actors.every(actor=>actor.delta.every(delta=>Math.abs(delta)<=.025));
const report={checkedAt:new Date().toISOString(),anchor:{...DOLORES_PICNIC,x,z},footprintHalfExtent:half,osm:record.sha256,nearestPath:nearest,receipts,buildingClear:true,samples,maxGroundDifference,actualSites,passed,
 scope:'Full 8x8m envelope including original picnic props and four actor sites; every surface-highway width, emitted terrain/roads/structures at both LODs, 0.5m ground grid. No native or device acceptance.'};
await mkdir('artifacts/dolores-weekend',{recursive:true});await writeFile('artifacts/dolores-weekend/placement-full.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({nearestPath:nearest,maxGroundDifference,actualSites,passed,emittedKinds:triangles.map(list=>[...new Set(list.map(t=>t.kind))])}));
assert.ok(passed,'Picnic grid, actual blanket visibility or actor contact exceeds the recorded limits');
