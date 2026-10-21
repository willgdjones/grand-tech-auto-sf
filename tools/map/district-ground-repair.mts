/** Rebuild district ground from source in a new candidate; retain the failed bake. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { settings } from './src/pipeline/settings';
import { acquireInputs, atomicWrite, digest } from './src/pipeline/sources';
import { buildMap, validateMap } from './src/pipeline/build';
import { attachNeighbourhoods, writeNeighbourhoods } from './src/pipeline/neighbourhoods';
import { packMapRuntime } from './src/pipeline/runtime';
import type { MapManifest } from './src/pipeline/types';

const base=resolve('tools/map/out/district-tm7m'),root=resolve('tools/map/out/district-tm7m-ground');
const existing=await readdir(root).catch((error:NodeJS.ErrnoException)=>{if(error.code!=='ENOENT')throw error;return [];});
assert.equal(existing.length,0,'Repair candidate must be new and empty');
const baseline=JSON.parse(await readFile(join(base,'district-rollout.json'),'utf8'));
const before=JSON.parse(await readFile(join(base,'manifest.json'),'utf8')) as MapManifest;
assert.equal(digest(await readFile(join(base,'manifest.json'))),baseline.manifestSha256);
await validateMap(base);
const paths=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','tools/map/src','shared/roadgraphPacked.ts','shared/coastline.ts'],{encoding:'utf8'}).trim().split('\n').sort();
async function fingerprint(){
  const files=await Promise.all(paths.map(async path=>({path,sha256:digest(await readFile(path))})));
  return {sha256:digest(JSON.stringify(files)),files};
}
const source=await fingerprint(),sourceCommit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const startedAt=new Date().toISOString();
await cp(base,root,{recursive:true,errorOnExist:true,force:false,
  filter:path=>!['art','district-rollout.json','district-roads-smoke.json','build-start.json'].some(name=>path===join(base,name))});
await atomicWrite(join(root,'build-start.json'),JSON.stringify({startedAt,sourceCommit,source,
  repair:{kind:'district-ground',base,manifestSha256:baseline.manifestSha256,sourceFingerprint:baseline.sourceFingerprint}},null,2)+'\n');
const s={...settings('sf'),out:root};
const input=await acquireInputs(s,false,false,resolve('tools/map/out/SanFrancisco.osm.pbf'));
const neighbourhoods=await writeNeighbourhoods(s,false,false);
await buildMap(s,input,{repairDistrictGround:true});
await attachNeighbourhoods(s,neighbourhoods);await packMapRuntime(root);
assert.equal((await fingerprint()).sha256,source.sha256,'Map source changed during repair');
const validation=await validateMap(root);
const inventory=JSON.parse(await readFile(join(root,'runtime-inventory.json'),'utf8'));
const after=JSON.parse(await readFile(join(root,'manifest.json'),'utf8')) as MapManifest;
assert.equal(after.chunks.length,before.chunks.length,'Repair preserves whole-city coverage');
assert.equal(after.roadGraph.sha256,before.roadGraph.sha256,'Repair preserves the packed source graph');
const oldChunks=new Map(before.chunks.map(chunk=>[chunk.id,chunk]));
const changed=after.chunks.filter(chunk=>chunk.lods.some((lod,i)=>lod.sha256!==oldChunks.get(chunk.id)!.lods[i]!.sha256)).map(chunk=>chunk.id);
for(const chunk of after.chunks){
  const old=oldChunks.get(chunk.id)!;
  assert.equal(chunk.terrain.sha256,old.terrain.sha256,`Contact field unchanged: ${chunk.id}`);
  assert.equal(chunk.collision.sha256,old.collision.sha256,`Building collision unchanged: ${chunk.id}`);
  if(old.detail!=='low')assert.deepEqual(chunk.lods,old.lods,`Original detail corridor unchanged: ${chunk.id}`);
}
const report={sourceCommit,sourceFingerprint:source.sha256,startedAt,completedAt:new Date().toISOString(),candidate:root,
  manifestSha256:digest(await readFile(join(root,'manifest.json'))),validation,
  repair:{base,manifestSha256:baseline.manifestSha256,changedChunks:changed,retainedChunks:after.chunks.length-changed.length},
  inventory:{files:inventory.files.length,rawBytes:inventory.rawBytes,gzipBytes:inventory.gzipBytes,maximumFileBytes:inventory.maximumFileBytes},
  budgets:{wholeCityCompressed25MB:inventory.gzipBytes<=25_000_000,mapAloneBelowProduction80MB:inventory.gzipBytes<=80_000_000,
    individualFile25MB:inventory.maximumFileBytes<=25_000_000,productionTotal:'pending combined inventory',coldReady15MB:'pending actual browser trace'},
  activated:false,uploaded:false,desktopPhoneLook:'pending'};
await atomicWrite(join(root,'district-rollout.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
