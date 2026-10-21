import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { COASTLINE_MAX_BYTES, validCoastline } from '../../../../shared/coastline';
import { buildCoastline } from './coastline';
import { containsRing } from './geometry';
import { atomicWrite, digest } from './sources';
import { project, settings } from './settings';
import { writeRuntimeInventory } from './runtime';
import type { Artifact, MapManifest, OsmExtract, SourceManifest } from './types';

/** Read-only by default; --write attaches an optional overlay through the source pipeline.
 * Uses the pinned source of this exact bake and never fetches or hand-edits generated geometry.
 */
export async function exportCoastline(area='sf',write=false) {
  const s=settings(area),original=await readFile(join(s.out,'manifest.json'),'utf8'),manifest=JSON.parse(original) as MapManifest;
  const sources=JSON.parse(await readFile(join(s.out,'sources.json'),'utf8')) as SourceManifest;
  const record=sources.records.find(r=>r.key==='osm-pbf-normalized'||r.key==='osm');
  if(!record||!manifest.sourceDigests.some(r=>r.key===record.key&&r.sha256===record.sha256))
    throw new Error('Coastline requires the pinned OSM source from this map bake');
  const bytes=await readFile(join(s.cache,record.file));
  if(bytes.length!==record.bytes||digest(bytes)!==record.sha256)throw new Error('Coastline source hash/length mismatch');
  const data=buildCoastline(JSON.parse(bytes.toString()) as OsmExtract,manifest.bounds,record.sha256);
  if(!data||!data.rings.length||!validCoastline(data,manifest.frame))throw new Error('No valid sourced coastline for this map');
  const encoded=JSON.stringify(data)+'\n',compressed=gzipSync(encoded,{level:9});
  if(Buffer.byteLength(encoded)>COASTLINE_MAX_BYTES)throw new Error('Coastline exceeds byte budget');
  const waterAt=(lat:number,lon:number)=>data.rings.reduce((wet,r)=>containsRing(r,project(lon,lat))?!wet:wet,false);
  const probes=area==='sf' ? [
    {name:'Ferry plaza',lat:37.795,lon:-122.3948,water:false},
    {name:'FiDi',lat:37.794,lon:-122.402,water:false},
    {name:'Mission Bay',lat:37.771,lon:-122.388,water:false},
    {name:'Marina',lat:37.804,lon:-122.438,water:false},
    {name:'Ocean Beach promenade',lat:37.769,lon:-122.5105,water:false},
    {name:'Treasure Island',lat:37.825,lon:-122.371,water:false},
    {name:'Alcatraz',lat:37.8266,lon:-122.4229,water:false},
    {name:'Bay',lat:37.799,lon:-122.383,water:true},
    {name:'Golden Gate',lat:37.82,lon:-122.476,water:true},
    {name:'Pacific',lat:37.769,lon:-122.524,water:true},
  ].map(p=>({...p,actualWater:waterAt(p.lat,p.lon)})) : [];
  for(const p of probes)if(p.actualWater!==p.water)throw new Error(`Coastline classified ${p.name} incorrectly`);
  const artifact:Artifact={path:'coastline.json',bytes:Buffer.byteLength(encoded),gzipBytes:compressed.length,sha256:digest(encoded)};
  if(write) {
    if(await readFile(join(s.out,'manifest.json'),'utf8')!==original)throw new Error('Map changed during coastline export; retry against the current bake');
    await atomicWrite(join(s.out,artifact.path),encoded);await atomicWrite(join(s.out,`${artifact.path}.gz`),compressed);
    manifest.stats.gzipBytes+=artifact.gzipBytes-(manifest.coastline?.gzipBytes??0);
    manifest.stats.withinBudget=manifest.stats.gzipBytes<=manifest.stats.budgetBytes;
    manifest.coastline=artifact;
    const index=JSON.stringify(manifest,null,2)+'\n';
    await atomicWrite(join(s.out,'manifest.json'),index);await atomicWrite(join(s.out,'manifest.json.gz'),gzipSync(index,{level:9}));
    await writeRuntimeInventory(s.out,manifest);
  }
  return {write,artifact,sourceSha256:record.sha256,rings:data.rings.length,vertices:data.rings.reduce((n,r)=>n+r.length,0),probes};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  exportCoastline(process.argv.find(a=>a.startsWith('--area='))?.slice(7)??'sf',process.argv.includes('--write'))
    .then(report=>console.log(JSON.stringify(report,null,2))).catch(error=>{console.error(error);process.exitCode=1;});
