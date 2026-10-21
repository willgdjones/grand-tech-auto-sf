import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { strongGzip } from './strongGzip';
import { MAP_COMPRESSED_BUDGET_BYTES } from '../config';
import { playableNetwork } from './local-play';
import { packRoadGraph } from './roadPack';
import { atomicWrite, digest } from './sources';
import type { Artifact, MapManifest, RoadGraph } from './types';
import { writeMapTransfer } from './transfer';

/** Citywide routing (gtasf-u4al): GPS and robotaxis may use every edge of the collision-audited playable
 *  network, not just the corridor-clipped roadgraph-playable.json. Same rule as local-play.ts, recomputed
 *  from the persisted audit so a repack needs no chunk re-bake. Slice bakes without an audit keep the JSON. */
export async function routableEdgeIds(root:string,full:RoadGraph):Promise<Set<string>> {
  const audit=await readFile(join(root,'road-collision-audit.json'),'utf8').catch(()=>null);
  if(audit===null) {
    const playable=JSON.parse(await readFile(join(root,'roadgraph-playable.json'),'utf8')) as RoadGraph;
    return new Set(playable.edges.map(e=>e.id));
  }
  const blocked=new Set((JSON.parse(audit) as {blocked:{edge:string}[]}).blocked.map(e=>e.edge));
  return new Set(playableNetwork(full,blocked).playable.edges.map(e=>e.id));
}

/** Retain source JSON for audits; the live manifest references one packed graph. */
export async function packMapRuntime(root:string):Promise<MapManifest> {
  const manifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8')) as MapManifest;
  const full=JSON.parse(await readFile(join(root,'roadgraph.json'),'utf8')) as RoadGraph;
  const bytes=packRoadGraph(full,{routableEdgeIds:await routableEdgeIds(root,full)});
  if(bytes.length>25_000_000)throw new Error(`Packed road file exceeds 25 MB: ${bytes.length}`);
  // gtasf-7vt00: the road graph gzips ~21 % smaller with the host's stronger deflate (strongGzip.ts); same RFC 1952 bytes out.
  const compressed=strongGzip(bytes),path='roadgraph.bin';
  await atomicWrite(join(root,path),bytes);await atomicWrite(join(root,`${path}.gz`),compressed);
  manifest.roadGraph={path,encoding:'roadpack-v1',bytes:bytes.length,gzipBytes:compressed.length,sha256:digest(bytes)};
  const unique=new Map<string,Artifact>();
  for(const a of [manifest.roadGraph,...Object.values(manifest.runtime??{}),...(manifest.neighbourhoods?[manifest.neighbourhoods]:[]),...(manifest.coastline?[manifest.coastline]:[]),
    ...manifest.chunks.flatMap(c=>[...c.lods,c.terrain,c.collision])])unique.set(a.path,a);
  manifest.stats.gzipBytes=[...unique.values()].reduce((sum,a)=>sum+a.gzipBytes,0);
  manifest.stats.withinBudget=manifest.stats.gzipBytes<=manifest.stats.budgetBytes;
  const encoded=JSON.stringify(manifest,null,2)+'\n';
  await atomicWrite(join(root,'manifest.json'),encoded);await atomicWrite(join(root,'manifest.json.gz'),gzipSync(encoded,{level:9}));
  await writeRuntimeInventory(root,manifest);
  await writeMapTransfer(root);
  console.log(`Packed runtime graph: ${bytes.length} raw / ${compressed.length} gzip bytes; whole map ${manifest.stats.gzipBytes} gzip before manifest`);
  return manifest;
}

/** Include the manifest itself without rewriting any pinned map asset. */
export async function writeRuntimeInventory(root:string,manifest?:MapManifest):Promise<void> {
  const [manifestBytes,manifestGzip]=await Promise.all([
    readFile(join(root,'manifest.json')),readFile(join(root,'manifest.json.gz')),
  ]);
  manifest??=JSON.parse(manifestBytes.toString('utf8')) as MapManifest;
  const unique=new Map<string,Artifact>();
  for(const a of [manifest.roadGraph,...Object.values(manifest.runtime??{}),...(manifest.neighbourhoods?[manifest.neighbourhoods]:[]),...(manifest.coastline?[manifest.coastline]:[]),
    ...manifest.chunks.flatMap(c=>[...c.lods,c.terrain,c.collision])])unique.set(a.path,a);
  unique.set('manifest.json',{path:'manifest.json',bytes:manifestBytes.length,gzipBytes:manifestGzip.length,sha256:digest(manifestBytes)});
  const files=[...unique.values()].sort((a,b)=>a.path.localeCompare(b.path));
  const gzipBytes=files.reduce((sum,a)=>sum+a.gzipBytes,0);
  // Older city manifests carry an 80 MB threshold. That remains visible as
  // legacy metadata; it never establishes the required 25 MB whole-city gate.
  const mapBudgetBytes=Math.min(manifest.stats.budgetBytes,MAP_COMPRESSED_BUDGET_BYTES);
  const withinMapBudget=gzipBytes<=mapBudgetBytes;
  await atomicWrite(join(root,'runtime-inventory.json'),JSON.stringify({
    generatedAt:new Date().toISOString(),area:manifest.area,sourceJsonRetainedForAudit:true,
    includesManifest:true,files,rawBytes:files.reduce((sum,a)=>sum+a.bytes,0),gzipBytes,
    maximumFileBytes:Math.max(...files.map(a=>a.bytes)),mapBudgetBytes,withinMapBudget,
    manifestBudgetBytes:manifest.stats.budgetBytes,withinManifestBudget:gzipBytes<=manifest.stats.budgetBytes,
    productionBudgetBlocker:withinMapBudget?null:'gtasf-zzpr',
  },null,2)+'\n');
}
