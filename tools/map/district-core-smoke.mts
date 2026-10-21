/** Read-only arrival audit. Run through tools/heavy.sh npx tsx tools/map/district-core-smoke.mts. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { DISTRICTS_CORE } from './src/districts/core';
import { districtAt } from './src/districts';
import { project, unproject } from './src/pipeline/settings';
import { decodePackedRoadGraph, unpackRoadGraph } from '../../shared/roadgraphPacked';
import { createRoadSnapper, decodeHeightfield, sampleHeight } from '../../web/src/render/chunks/terrain';
import type { MapManifest } from './src/pipeline/types';

const root=resolve(process.argv[2]??'tools/map/out/sf');
const manifestBytes=await readFile(resolve(root,'manifest.json'));
const manifest=JSON.parse(manifestBytes.toString()) as MapManifest;
assert.equal(manifest.roadGraph.encoding,'roadpack-v1');
const graphBytes=await readFile(resolve(root,manifest.roadGraph.path));
assert.equal(createHash('sha256').update(graphBytes).digest('hex'),manifest.roadGraph.sha256);
const graph=unpackRoadGraph(decodePackedRoadGraph(graphBytes)),snap=createRoadSnapper(graph);
const surfaceSnap=createRoadSnapper({...graph,edges:graph.edges.filter(e=>e.kind==='lane'&&!e.bridge&&!e.tunnel&&!e.layer)});
const arrivals=[];
for(const district of DISTRICTS_CORE) {
  const [x,z]=project(district.spawn.lon,district.spawn.lat);
  assert.equal(districtAt(x,z)?.id,district.id);
  const arrival=snap(x,z,100),surface=surfaceSnap(x,z,100);
  assert.ok(arrival&&surface,`${district.id}: source road missing`);
  assert.ok(Math.hypot(arrival.x-surface.x,arrival.y-surface.y,arrival.z-surface.z)<.05,
    `${district.id}: arrival is on a connector, bridge or tunnel`);
  const chunkId=`${Math.floor(arrival.x/256)}_${Math.floor(arrival.z/256)}`;
  const chunk=manifest.chunks.find(c=>c.id===chunkId);
  assert.ok(chunk,`${district.id}: snapped chunk missing`);
  const bytes=await readFile(resolve(root,chunk.terrain.path));
  const ground=sampleHeight(decodeHeightfield(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)),arrival.x,arrival.z);
  assert.notEqual(ground,null);
  const names=new Set(graph.edges.filter(e=>e.kind==='lane'&&!e.bridge&&!e.tunnel&&
    e.points.some(p=>districtAt(p[0],p[2])?.id===district.id)).map(e=>e.name));
  const missingStreets=district.streets.filter(name=>!names.has(name));
  assert.deepEqual(missingStreets,[],`${district.id}: configured road names absent from source`);
  const geo=unproject(arrival.x,arrival.z);
  arrivals.push({district:district.id,chunk:chunkId,offsetM:+Math.hypot(x-arrival.x,z-arrival.z).toFixed(3),
    laneHeightM:+arrival.y.toFixed(2),terrainHeightM:+ground!.toFixed(2),
    link:`/?at=${geo.lat.toFixed(7)},${geo.lon.toFixed(7)},${district.spawn.heading??0}`,
    streets:district.streets});
}
console.log(JSON.stringify({passed:true,manifestSha256:createHash('sha256').update(manifestBytes).digest('hex'),
  roadGraphSha256:manifest.roadGraph.sha256,arrivals,
  scope:'Source graph and streamed ground only; rebake, visual, payload and device acceptance remain separate.'},null,2));
