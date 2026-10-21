import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Settings } from './settings';
import type { DataSfBuilding, HeightSampler, OsmExtract, SourceManifest, SourceRecord } from './types';
import { DEM_PIXELS, Dem3dep, decodeFloatTiff, demTileUrl, demTiles } from './dem3dep';
import { decodeTerrarium, Terrain, tileKey, tilesForBbox, tileUrl } from './elevation';
import { SOURCE_CATALOG } from './catalog';
import { importPbf } from './pbf';

export const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export async function atomicWrite(path: string, bytes: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp=`${path}.${process.pid}.tmp`;
  await writeFile(temp,bytes);
  await rename(temp,path);
}
export function overpassQuery(s: Settings): string {
  const [w,south,e,n]=s.sourceBbox;
  return `[out:json][timeout:180][bbox:${south},${w},${n},${e}];\n(\n`+
    'way[highway];\nnode[highway~"^(traffic_signals|stop|give_way)$"];\nrelation[type=restriction];\n'+
    'way[building][building!=no];\nrelation[building][building!=no][type=multipolygon];\n'+
    'way["building:part"];\nrelation["building:part"][type=multipolygon];\n'+
    'way[landuse];\nrelation[landuse][type=multipolygon];\n'+
    'way[leisure=park];\nway[natural~"^(water|coastline)$"];\n'+
    'way[railway];\n);\nout body geom;';
}
const delay = (ms: number) => new Promise(resolve=>setTimeout(resolve,ms));
async function download(url: string, body?: string): Promise<{bytes: Uint8Array; sources?: string}> {
  let last: unknown;
  for (let attempt=0;attempt<3;attempt++) {
    try {
      const response=await fetch(url, {
        method:body ? 'POST':'GET',
        headers:{'user-agent':'GTASF-map/0.1 (gtasf.com)', ...(body ? {'content-type':'application/x-www-form-urlencoded'} : {})},
        ...(body ? {body}:{}), signal:AbortSignal.timeout(body ? 210_000 : 45_000),
      });
      if (!response.ok) {
        const message=`HTTP ${response.status} from ${new URL(url).hostname}`;
        if (![408,429,500,502,503,504].includes(response.status)) throw new PermanentError(message);
        const retry=response.headers.get('retry-after');
        const numeric=Number(retry);
        const wait=retry ? (Number.isFinite(numeric) ? numeric*1000 : Date.parse(retry)-Date.now()) : 0;
        if (attempt<2) {
          console.warn(`${message}; retrying`);
          await delay(Math.min(60_000,Math.max(2000*2**attempt,Number.isFinite(wait)?wait:0)));
          continue;
        }
        throw new Error(message);
      }
      const chunks: Uint8Array[]=[];
      let length=0;
      if (!response.body) throw new Error('Empty HTTP response');
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        length+=chunk.length;
        if (length>512*1024*1024) throw new PermanentError('Source response exceeds 512 MiB; reduce bbox');
        chunks.push(chunk);
      }
      return {bytes:Buffer.concat(chunks), sources:response.headers.get('x-amz-meta-x-imagery-sources')??undefined};
    } catch (error) {
      if (error instanceof PermanentError) throw error;
      last=error;
      if (attempt<2) await delay(2000*2**attempt);
    }
  }
  throw new Error(`Download failed: ${url}`,{cause:last});
}
class PermanentError extends Error {}

export class SourceCache {
  readonly records: SourceRecord[]=[];
  constructor(readonly root: string, readonly network: boolean, readonly refresh=false) {}
  async get(key: string,url: string,body?: string): Promise<Uint8Array> {
    const file=`raw/${digest(`${key}\n${url}\n${body??''}`)}.bin`;
    const path=join(this.root,file),meta=`${path}.json`;
    if (!this.refresh) {
      try {
        const record=JSON.parse(await readFile(meta,'utf8')) as SourceRecord;
        const bytes=await readFile(path);
        if (record.url!==url || record.key!==key || record.file!==file || record.bytes!==bytes.length || digest(bytes)!==record.sha256)
          throw new Error(`Corrupt source cache ${key}; use --refresh to replace it`);
        this.records.push(record);
        return bytes;
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code==='ENOENT')) throw error;
      }
    }
    if (!this.network) throw new Error(`Missing cached ${key}; run fetch or build --fetch first`);
    console.log(`Fetching ${key}`);
    const {bytes,sources}=await download(url,body);
    const record: SourceRecord={key,url,file,sha256:digest(bytes),bytes:bytes.length,fetchedAt:new Date().toISOString(),
      ...(sources?{imagerySources:sources}:{})};
    await atomicWrite(path,bytes);
    await atomicWrite(meta,JSON.stringify(record,null,2)+'\n');
    this.records.push(record);
    return bytes;
  }
}
export function parseOsm(bytes: Uint8Array): OsmExtract {
  const raw=JSON.parse(Buffer.from(bytes).toString('utf8')) as OsmExtract;
  if (!raw || !Array.isArray(raw.elements) || raw.remark) throw new Error(`Incomplete OSM extract: ${raw?.remark??'missing elements'}`);
  if (!raw.elements.some(e=>e.type==='way'&&e.tags?.highway)) throw new Error('OSM extract contains no roads');
  for(const way of raw.elements.filter(e=>e.type==='way'&&e.tags?.highway))
    if(!way.nodes||!way.geometry||way.nodes.length!==way.geometry.length||way.geometry.length<2||
      way.geometry.some(p=>!p||!Number.isFinite(p.lat)||!Number.isFinite(p.lon)))
      throw new Error(`Incomplete OSM road geometry: ${way.id}`);
  return raw;
}
export interface Inputs { osm: OsmExtract; buildings: DataSfBuilding[]; terrain: HeightSampler; sources: SourceManifest }
export async function acquireInputs(s: Settings,network=false,refresh=false,pbf?:string): Promise<Inputs> {
  const cache=new SourceCache(s.cache,network,refresh);
  const query=overpassQuery(s);
  if(!pbf&&(s.bounds[2]-s.bounds[0])*(s.bounds[3]-s.bounds[1])>16_000_000)
    throw new Error('Large areas require --osm-pbf path/to/norcal-latest.osm.pbf; citywide Overpass is disabled');
  let osm:OsmExtract;
  if(pbf){const imported=await importPbf(s,pbf);osm=imported.osm;cache.records.push(...imported.records);}
  else osm=parseOsm(await cache.get('osm',SOURCE_CATALOG.osm.endpoint,new URLSearchParams({data:query}).toString()));
  // Metadata is pinned beside the values so units and acquisition history remain auditable.
  const metadata=JSON.parse(Buffer.from(await cache.get('datasf-metadata',SOURCE_CATALOG.buildings.metadata)).toString('utf8')) as {columns?:{fieldName:string;description?:string}[]};
  if (!metadata.columns?.some(c=>c.fieldName==='hgt_median_m'&&c.description?.includes('meters')))
    throw new Error('DataSF height schema changed; verify hgt_median_m units before building');
  const [w,south,e,n]=s.sourceBbox;
  const where=`intersects(shape, 'POLYGON ((${w} ${south},${e} ${south},${e} ${n},${w} ${n},${w} ${south}))')`;
  const buildings: DataSfBuilding[]=[];
  const seen=new Set<string>();
  for (let offset=0;;offset+=2000) {
    const params=new URLSearchParams({
      '$select':'sf16_bldgid,shape,hgt_median_m,hgt_mediancm,gnd1st_delta,hgt_maxcm,data_as_of',
      '$where':where,'$order':'sf16_bldgid','$limit':'2000','$offset':String(offset),
    });
    const page=JSON.parse(Buffer.from(await cache.get(`datasf-${offset}`,`${SOURCE_CATALOG.buildings.endpoint}?${params}`)).toString('utf8')) as DataSfBuilding[];
    if (!Array.isArray(page)) throw new Error('DataSF returned a non-array response');
    for (const row of page) {
      if (!row.sf16_bldgid || row.shape?.type!=='MultiPolygon' || !Array.isArray(row.shape.coordinates)) throw new Error('Invalid DataSF building');
      if (seen.has(row.sf16_bldgid)) throw new Error('DataSF pagination changed during extraction; refresh');
      seen.add(row.sf16_bldgid);buildings.push(row);
    }
    if (page.length<2000) break;
  }
  const tiles=new Map<string,Float32Array>();
  // Sequential acquisition is intentional: polite upstream load and bounded laptop memory/CPU.
  for (const tile of tilesForBbox(s.sourceBbox,s.zoom)) {
    const bytes=await cache.get(`terrain-${tileKey(tile)}`,tileUrl(tile));
    tiles.set(tileKey(tile),decodeTerrarium(bytes));
  }
  let terrain: HeightSampler=new Terrain(s.zoom,tiles);
  // graphicsV2 phase 2: USGS 3DEP DEM (MAP_DEM=3dep; MAP_DEM_DEGREES=0.01 ≈ 1 m, default 0.02 ≈ 2 m).
  if (process.env.MAP_DEM==='3dep') {
    const degrees=Number(process.env.MAP_DEM_DEGREES??0.02),dem=new Map<string,Float32Array>();
    for (const tile of demTiles(s.sourceBbox,degrees)) {
      const {width,height,values}=decodeFloatTiff(await cache.get(`dem3dep-${degrees}-${tile.i},${tile.j}`,demTileUrl(tile)));
      if (width!==DEM_PIXELS||height!==DEM_PIXELS) throw new Error('3DEP tile size changed');
      dem.set(`${tile.i},${tile.j}`,values);
    }
    terrain=new Dem3dep(degrees,dem,terrain);
  }
  const sources: SourceManifest={version:1,configKey:digest(JSON.stringify({bbox:s.sourceBbox,zoom:s.zoom,query})),
    records:cache.records.sort((a,b)=>a.key.localeCompare(b.key)),
    osmTimestamp:osm.osm3s?.timestamp_osm_base,dataSfAsOf:[...new Set(buildings.flatMap(b=>b.data_as_of?[b.data_as_of]:[]))].sort()};
  await atomicWrite(join(s.cache,'sources.json'),JSON.stringify(sources,null,2)+'\n');
  return {osm,buildings,terrain,sources};
}
