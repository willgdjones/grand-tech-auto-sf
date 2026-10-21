import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { atomicWrite, digest, SourceCache } from './sources';
import { geographicBounds, settings } from './settings';
import type { Bounds } from './types';

/** graphicsV2 phase 2: per-chunk NAIP aerial (USDA/USGS, public domain) for item 2's
 * aerial-far / generated-near blend. Small JPEGs in EPSG:4326, one per manifest chunk, written to
 * out/aerial-<area>/<id>/aerial.jpg. Not referenced by the manifest or publication yet: the runtime contract
 * (image + world bounds) is agreed with the item-2 owner first.
 * Usage: npx tsx tools/map/src/pipeline/aerial.ts [area] [pixels=64] [--network] [--attach]
 * --attach (coordinated bakes only) writes chunks/<id>/aerial.jpg(+.gz) and references it from manifest.json.
 */
export const NAIP_SERVICE='https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage';
export function naipUrl(bounds:Bounds,pixels:number):string {
  const params=new URLSearchParams({bbox:geographicBounds(bounds).join(','),bboxSR:'4326',imageSR:'4326',
    size:`${pixels},${pixels}`,format:'jpg',compressionQuality:'70',f:'image'});
  return `${NAIP_SERVICE}?${params}`;
}

async function main() {
  const [area='lombard',size='64']=process.argv.slice(2).filter(a=>!a.startsWith('--'));
  const pixels=Number(size);
  // Decoded masters cap at 1 MP; the 25 MB whole-map budget is the real limit (≈4 m/px at 64).
  if(!Number.isInteger(pixels)||pixels<16||pixels>1024)throw new Error('pixels must be 16..1024');
  const s=settings(area),cache=new SourceCache(s.cache,process.argv.includes('--network'));
  const attach=process.argv.includes('--attach');
  const manifest=JSON.parse(await readFile(join(s.out,'manifest.json'),'utf8')) as {chunkSize:number;chunks:{id:string;x:number;z:number;aerial?:unknown}[]};
  let bytes=0;
  for(const chunk of manifest.chunks) {
    const bounds:Bounds=[chunk.x*manifest.chunkSize,chunk.z*manifest.chunkSize,(chunk.x+1)*manifest.chunkSize,(chunk.z+1)*manifest.chunkSize];
    const image=await cache.get(`naip-${pixels}-${chunk.id}`,naipUrl(bounds,pixels));
    if(image[0]!==0xff||image[1]!==0xd8)throw new Error(`NAIP returned a non-JPEG for ${chunk.id}`);
    // Outside the published map tree until publication/manifest support it.
    await atomicWrite(join(s.out,'..',`aerial-${area}`,chunk.id,'aerial.jpg'),image);
    if(attach){
      const path=`chunks/${chunk.id}/aerial.jpg`,gzip=gzipSync(image,{level:9});
      await atomicWrite(join(s.out,path),image);await atomicWrite(join(s.out,`${path}.gz`),gzip);
      chunk.aerial={path,bytes:image.length,gzipBytes:gzip.length,sha256:digest(image)};
    }
    bytes+=image.length;
  }
  if(attach){
    const text=JSON.stringify(manifest,null,2)+'\n';
    await atomicWrite(join(s.out,'manifest.json'),text);await atomicWrite(join(s.out,'manifest.json.gz'),gzipSync(text,{level:9}));
  }
  console.log(`aerial: ${manifest.chunks.length} chunks, ${(bytes/1e6).toFixed(2)} MB at ${pixels}px (${(manifest.chunkSize/pixels).toFixed(1)} m/px)`);
}
if(import.meta.url===`file://${process.argv[1]}`)await main();
