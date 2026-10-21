/** One offline A05 source smoke around Broadway's tunnel portal and nearby streets. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validPolygon } from '../geom/rings';
import { buildBuildings } from '../pipeline/buildings';
import { decodeTerrarium, Terrain } from '../pipeline/elevation';
import { contains, polygonBounds, SpatialIndex } from '../pipeline/geometry';
import { extractRoads, isDrivable } from '../pipeline/osm';
import { gradeSeparated } from '../pipeline/roads';
import { settings } from '../pipeline/settings';
import type { Building, DataSfBuilding, OsmExtract, SourceManifest, SourceRecord, XZ } from '../pipeline/types';

const s=settings('lombard',[-122.419,37.796,-122.410,37.798]);
const root=resolve(process.argv[2]??s.cache);
const manifest=JSON.parse(await readFile(join(root,'sources.json'),'utf8')) as SourceManifest;
async function pinned(record:SourceRecord):Promise<Buffer> {
  assert.match(record.file,/^raw\/[a-f0-9]{64}\.bin$/);
  const bytes=await readFile(join(root,record.file));
  assert.equal(bytes.length,record.bytes,`Source length changed: ${record.key}`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),record.sha256,`Source checksum changed: ${record.key}`);
  return bytes;
}
const osmSource=manifest.records.find(r=>r.key==='osm');
assert(osmSource,'Fetch the Lombard/corridor sources first');
const osm=JSON.parse((await pinned(osmSource)).toString('utf8')) as OsmExtract;
const rows:DataSfBuilding[]=[],tiles=new Map<string,Float32Array>();
for(const record of manifest.records) {
  if(/^datasf-\d+$/.test(record.key))rows.push(...JSON.parse((await pinned(record)).toString('utf8')) as DataSfBuilding[]);
  if(record.key.startsWith('terrain-'))tiles.set(record.key.slice(8),decodeTerrarium(await pinned(record)));
}
const terrain=new Terrain(15,tiles),roads=extractRoads(osm,s.bounds),warnings:string[]=[];
const original=buildBuildings(rows,osm,terrain,s,[]);
const cleared=buildBuildings(rows,osm,terrain,s,warnings,roads);
const originalById=new Map(original.map(b=>[b.id,b]));
assert(original.length>0&&cleared.length>0,'Missing source buildings');
for(const building of cleared) {
  const source=originalById.get(building.id.replace(/:clear:\d+$/,''));
  assert(source,`Unknown source identity: ${building.id}`);
  assert.deepEqual([building.height,building.base,building.foundation,building.heightSource,building.colour],
    [source.height,source.base,source.foundation,source.heightSource,source.colour]);
  assert(validPolygon(building.polygon),`Invalid cleared footprint: ${building.id}`);
}
function index(buildings:Building[]):SpatialIndex<Building> {
  const result=new SpatialIndex<Building>(32);
  for(const building of buildings)result.add(polygonBounds(building.polygon),building);
  return result;
}
const before=index(original),after=index(cleared);
let sampled=0,blockedBefore=0,blockedAfter=0;
for(const road of roads.filter(r=>isDrivable(r.tags)&&!gradeSeparated(r))) {
  for(let i=1;i<road.points.length;i++) {
    const a=road.points[i-1]!,b=road.points[i]!,dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);
    const steps=Math.max(1,Math.ceil(length));
    for(let n=0;n<=steps;n++)for(const lateral of [-road.width/4,0,road.width/4]) {
      const p:XZ=[a.x+dx*n/steps-dz/length*lateral,a.z+dz*n/steps+dx/length*lateral];
      const box=[p[0],p[1],p[0],p[1]] as const;
      sampled++;
      if(before.query(box).some(building=>contains(building.polygon,p)))blockedBefore++;
      if(after.query(box).some(building=>contains(building.polygon,p)))blockedAfter++;
    }
  }
}
assert(blockedBefore>0,'Smoke must reproduce the real source obstruction');
assert.equal(blockedAfter,0,'Surface road still sealed by a building');
const tunnels=roads.filter(gradeSeparated);
assert(tunnels.some(r=>r.osmWay===8921175),'Missing real Broadway tunnel');
assert.deepEqual(buildBuildings(rows,osm,terrain,s,[],tunnels),original,
  'Grade-separated road subtraction changed surface buildings');
console.log(JSON.stringify({status:'pass',osmSha256:osmSource.sha256,bounds:s.bounds,
  sourceBuildings:original.length,clearedBuildings:cleared.length,sampled,blockedBefore,blockedAfter,
  gradeSeparatedWaysPreserved:tunnels.length,warnings,
  scope:'Source footprint/height smoke only; expanded bake, screenshots and driving acceptance remain separate.'},null,2));
