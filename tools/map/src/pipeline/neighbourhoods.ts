import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { SourceCache, atomicWrite, digest } from './sources';
import { project, settings, SF_FRAME } from './settings';
import type { Settings } from './settings';
import type { Artifact, MapManifest, Polygon } from './types';

const SOURCE='https://data.sf.gov/resource/j2bu-swwd.json?$select=nhood,the_geom&$order=nhood&$limit=100';
const METADATA='https://data.sf.gov/api/views/j2bu-swwd.json';
/** Citywide named polygons; no geometry bake required when the HUD label data changes. */
export async function writeNeighbourhoods(s:Settings,network=false,refresh=false):Promise<Artifact> {
  const cache=new SourceCache(resolve(s.cache,'../neighbourhoods'),network,refresh);
  const metadata=JSON.parse(Buffer.from(await cache.get('neighbourhood-metadata',METADATA)).toString()) as {
    license?:{name?:string;termsLink?:string};columns?:{fieldName:string;dataTypeName:string}[];
  };
  if(!metadata.columns?.some(c=>c.fieldName==='the_geom'&&c.dataTypeName==='multipolygon')||
    !metadata.columns.some(c=>c.fieldName==='nhood'))throw new Error('DataSF neighbourhood schema changed');
  const bytes=await cache.get('neighbourhood-polygons',SOURCE);
  const rows=JSON.parse(Buffer.from(bytes).toString()) as {nhood:string;the_geom:{type:string;coordinates:Polygon[]}}[];
  if(!Array.isArray(rows)||!rows.length||rows.length>=100)throw new Error('Incomplete neighbourhood response');
  const neighbourhoods=rows.map(row=>{
    if(!row.nhood||row.the_geom?.type!=='MultiPolygon')throw new Error('Invalid neighbourhood polygon');
    return {id:row.nhood.toLowerCase().replace(/[^a-z0-9]+/g,'-'),name:row.nhood,polygons:row.the_geom.coordinates.map(p=>p.map(r=>r.map(([lon,lat])=>{
      if(!Number.isFinite(lon+lat))throw new Error('Invalid neighbourhood coordinate');
      return project(lon,lat).map(v=>Math.round(v*100)/100);
    })))};
  }).sort((a,b)=>a.id.localeCompare(b.id));
  const output=JSON.stringify({version:1,frame:SF_FRAME,units:'metres',source:{url:SOURCE,metadata:METADATA,sha256:digest(bytes),
    label:'DataSF Analysis Neighborhoods',licence:metadata.license},neighbourhoods})+'\n';
  const path='neighbourhoods.json',compressed=gzipSync(output,{level:9});
  await atomicWrite(join(s.out,path),output);await atomicWrite(join(s.out,`${path}.gz`),compressed);
  await atomicWrite(join(cache.root,'sources.json'),JSON.stringify({version:1,records:cache.records},null,2)+'\n');
  return {path,bytes:Buffer.byteLength(output),gzipBytes:compressed.length,sha256:digest(output)};
}
/** Keep the published manifest and its gzip sibling in sync for the dev/R2 loaders. */
export async function attachNeighbourhoods(s:Settings,artifact:Artifact):Promise<MapManifest> {
  const manifest=JSON.parse(await readFile(join(s.out,'manifest.json'),'utf8')) as MapManifest;
  manifest.stats.gzipBytes+=artifact.gzipBytes-(manifest.neighbourhoods?.gzipBytes??0);
  manifest.stats.withinBudget=manifest.stats.gzipBytes<=manifest.stats.budgetBytes;
  manifest.neighbourhoods=artifact;
  const url='https://data.sf.gov/d/j2bu-swwd';
  if(!manifest.attribution.some(a=>a.url===url))manifest.attribution.push({label:'DataSF Analysis Neighborhoods — PDDL',url});
  const encoded=JSON.stringify(manifest,null,2)+'\n';
  await atomicWrite(join(s.out,'manifest.json'),encoded);await atomicWrite(join(s.out,'manifest.json.gz'),gzipSync(encoded,{level:9}));
  return manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const s=settings(process.argv.find(a=>a.startsWith('--area='))?.slice(7)??'lombard');
  writeNeighbourhoods(s,process.argv.includes('--fetch'),process.argv.includes('--refresh'))
    .then(async artifact=>{await attachNeighbourhoods(s,artifact);console.log(JSON.stringify(artifact));})
    .catch(error=>{console.error(error);process.exitCode=1;});
}
