/** Apply only the reviewed North Beach specimen; retain the complete prior receipt. */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { atomicWrite, digest } from './src/pipeline/sources';
import { writeRuntimeInventory } from './src/pipeline/runtime';
import type { Artifact, MapManifest } from './src/pipeline/types';

const source=resolve('tools/map/out/sf'),specimen=resolve('tools/map/out/pavement-qv7g'),art=resolve('web/public/art/road-details.json');
const oldManifestBytes=await readFile(resolve(source,'manifest.json'));
const manifest=JSON.parse(oldManifestBytes.toString()) as MapManifest;
const next=JSON.parse(await readFile(resolve(specimen,'manifest.json'),'utf8')) as MapManifest;
const bake=JSON.parse(await readFile(resolve(specimen,'bake-report.json'),'utf8'));
const geometry=JSON.parse(await readFile(resolve(specimen,'geometry-report.json'),'utf8'));
const renders=JSON.parse(await readFile(resolve(specimen,'render-report.json'),'utf8')) as {stage:string;name:string;errors:string[];httpErrors:string[];view:{map:{errors:string[]}}}[];
assert.equal(digest(oldManifestBytes),bake.sourceManifestSha256,'Original city pin changed; rebake/review first');
assert.equal(digest(await readFile(resolve(source,manifest.roadGraph.path))),bake.sourceGraphSha256);
assert.equal(geometry.missing,0);assert.equal(geometry.overlapsTerrain,0);assert(geometry.covered>100);
assert.equal(Object.keys(geometry.retainedGeometry??{}).length,18,'Canonical building/structure audit required at both LODs');
assert.deepEqual(new Set(renders.map(r=>`${r.stage}-${r.name}`)),new Set(['before-desktop','before-phone','after-desktop','after-phone']));
for(const r of renders){assert.deepEqual(r.errors,[]);assert.deepEqual(r.httpErrors,[]);assert.deepEqual(r.view.map.errors,[]);}
assert.equal(next.chunks.length,9);
const replacements=new Map<string,Buffer>();
const put=(path:string,b:Buffer)=>{assert(!replacements.has(path));replacements.set(path,b);};
const sourceChunks=new Map(manifest.chunks.map(c=>[c.id,c]));
for(const c of next.chunks) {
  const original=sourceChunks.get(c.id);assert(original);
  assert.deepEqual(c.terrain,original.terrain);assert.deepEqual(c.collision,original.collision);
  assert.deepEqual(c.bounds,original.bounds);assert(c.bounds[0]>=-512&&c.bounds[1]>=-2048&&c.bounds[2]<=256&&c.bounds[3]<=-1280);
  for(const a of [original.terrain,original.collision])assert.equal(digest(await readFile(resolve(source,a.path))),a.sha256);
  for(const [i,a] of c.lods.entries()) {
    assert.equal(a.path,original.lods[i]!.path);
    const old=await readFile(resolve(source,a.path));assert.equal(digest(old),original.lods[i]!.sha256);
    const bytes=await readFile(resolve(specimen,a.path));assert.equal(digest(bytes),a.sha256);assert.equal(bytes.length,a.bytes);
    const compressed=gzipSync(bytes,{level:9});a.gzipBytes=compressed.length;
    put(a.path,bytes);put(a.path+'.gz',compressed);
  }
  original.lods=c.lods;original.triangles=c.triangles;
}
const originalArt=await readFile(art),nextArt=await readFile(resolve(specimen,'road-details.json'));
const oldDetails=JSON.parse(originalArt.toString()),newDetails=JSON.parse(nextArt.toString());
assert.equal(oldDetails.roads.length,newDetails.roads.length);
assert.deepEqual(oldDetails.tracks,newDetails.tracks);assert.deepEqual(oldDetails.crossings,newDetails.crossings);
const artRoads=new Map(oldDetails.roads.map((r:{id:string})=>[r.id,r]));let changedRoads=0;
for(const road of newDetails.roads) {
  const original=artRoads.get(road.id);assert(original);
  if(JSON.stringify(original)===JSON.stringify(road))continue;
  assert(road.points.every(([x,,z]:number[])=>x!>=-512&&x!<=256&&z!>=-2048&&z!<=-1280),'Curb change outside baked region');
  const strip=(r:Record<string,unknown>)=>Object.fromEntries(Object.entries(r).filter(([k])=>!['sidewalk','sidewalkLeft','sidewalkRight'].includes(k)));
  assert.deepEqual(strip(road),strip(original as Record<string,unknown>));changedRoads++;
}
assert(changedRoads>0);
const unique=new Map<string,Artifact>();
for(const a of [manifest.roadGraph,...(manifest.neighbourhoods?[manifest.neighbourhoods]:[]),...manifest.chunks.flatMap(c=>[...c.lods,c.terrain,c.collision])])unique.set(a.path,a);
manifest.stats.gzipBytes=[...unique.values()].reduce((sum,a)=>sum+a.gzipBytes,0);
manifest.stats.withinBudget=manifest.stats.gzipBytes<=manifest.stats.budgetBytes;
const manifestBytes=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
put('manifest.json',manifestBytes);put('manifest.json.gz',gzipSync(manifestBytes,{level:9}));
const receipt={applied:false,reviewRequired:'Inspect four before/after images and coordinate P2/Root STOP before --apply',
  beforeManifestSha256:digest(oldManifestBytes),afterManifestSha256:digest(manifestBytes),graphSha256:manifest.roadGraph.sha256,
  changedRoads,changedMapFiles:[...replacements.keys(),'runtime-inventory.json'],changedArt:'web/public/art/road-details.json',
  geometry,scope:'Nine North Beach chunks; no whole-city/production-budget or performance acceptance'};
if(process.argv.includes('--apply')) {
  const backup=resolve(specimen,'before-activation');
  // Exclusive creation prevents a retry from overwriting the original receipt.
  await mkdir(backup);
  for(const path of [...replacements.keys(),'runtime-inventory.json']) {
    const old=await readFile(resolve(source,path));const dest=resolve(backup,'sf',path);await mkdir(dirname(dest),{recursive:true});await writeFile(dest,old);
  }
  await writeFile(resolve(backup,'road-details.json'),originalArt);
  await writeFile(resolve(backup,'activation-plan.json'),JSON.stringify(receipt,null,2));
  for(const [path,bytes] of replacements)await atomicWrite(resolve(source,path),bytes);
  await atomicWrite(art,nextArt);await writeRuntimeInventory(source,manifest);
  for(const [path,bytes] of replacements)assert.equal(digest(await readFile(resolve(source,path))),digest(bytes));
  for(const c of next.chunks)for(const a of c.lods){assert.equal(digest(gunzipSync(await readFile(resolve(source,a.path+'.gz')))),a.sha256);}
  assert.equal(digest(await readFile(resolve(source,manifest.roadGraph.path))),bake.sourceGraphSha256);
  assert.equal(digest(await readFile(art)),digest(nextArt));receipt.applied=true;
  await writeFile(resolve(specimen,'activation-report.json'),JSON.stringify({...receipt,appliedAt:new Date().toISOString(),backup},null,2));
}
console.log(JSON.stringify(receipt));
