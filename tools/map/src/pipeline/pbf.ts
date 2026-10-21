import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Settings } from './settings';
import type { OsmElement, OsmExtract, SourceRecord, Tags } from './types';

const hash=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const unescape=(value:string)=>value.replace(/%([\da-f]{1,6})%/gi,(_,hex:string)=>String.fromCodePoint(Number.parseInt(hex,16)));
const kinds={n:'node',w:'way',r:'relation'} as const;
/** OPL retains OSM node references and relation roles; GeoJSON alone loses that topology. */
export async function parseOpl(lines:AsyncIterable<string>):Promise<OsmExtract> {
  const elements:OsmElement[]=[],nodes=new Map<number,OsmElement>(),ways=new Map<number,OsmElement>();
  for await(const line of lines) {
    if(!line.trim())continue;
    const fields=line.split(' '),first=fields.shift()!,kind=first[0] as keyof typeof kinds,id=Number(first.slice(1));
    if(!kinds[kind]||!Number.isSafeInteger(id))throw new Error('Invalid OPL object');
    const f:Record<string,string>=Object.fromEntries(fields.map(part=>[part[0],part.slice(1)]));
    if(f.d==='D')throw new Error('OSM history/change files are not supported');
    const tags:Tags={};
    for(const tag of (f.T??'').split(',').filter(Boolean)) {
      const eq=tag.indexOf('=');if(eq<0)throw new Error('Invalid OPL tag');
      tags[unescape(tag.slice(0,eq))]=unescape(tag.slice(eq+1));
    }
    const item:OsmElement={type:kinds[kind],id,tags};
    if(kind==='n') {
      item.lon=Number(f.x);item.lat=Number(f.y);
      if(!f.x||!f.y||!Number.isFinite(item.lon)||!Number.isFinite(item.lat))throw new Error(`Missing OSM node location ${id}`);
      nodes.set(id,item);
    }else if(kind==='w') {
      const refs=(f.N??'').split(',').filter(Boolean).map(ref=>{
        const match=/^n(\d+)(?:x[^y]+y.+)?$/.exec(ref);if(!match)throw new Error(`Invalid way node ${ref}`);return Number(match[1]);
      });
      item.nodes=refs;
      item.geometry=refs.map(ref=>{
        const node=nodes.get(ref);if(!node)throw new Error(`Incomplete PBF way ${id}: missing node ${ref}`);
        return {lat:node.lat!,lon:node.lon!};
      });ways.set(id,item);
    }else {
      // Keep landcover relations as well as single ways: Golden Gate Park woods,
      // lakes and Ocean Beach can be multipolygons. Partial off-map landcover is
      // left for extractPolygons to reject with a warning; never close its gaps.
      // Buildings, land-use and turn restrictions retain strict completeness.
      const strict=tags.type==='restriction'||Boolean(tags.building||tags['building:part']||tags.landuse);
      if(tags.type!=='restriction'&&!(tags.type==='multipolygon'&&
        (strict||tags.natural||tags.leisure)))continue;
      item.members=(f.M??'').split(',').filter(Boolean).map(value=>{
        const match=/^([nwr])(\d+)@(.*)$/.exec(value);if(!match)throw new Error(`Invalid relation member ${value}`);
        const type=kinds[match[1] as keyof typeof kinds],ref=Number(match[2]),role=unescape(match[3]!);
        const geometry=type==='way'?ways.get(ref)?.geometry:undefined;
        if(type==='way'&&!geometry&&strict)
          throw new Error(`Incomplete PBF relation ${id}: missing way ${ref}`);
        return {type,ref,role,...(geometry?{geometry}:{})};
      });
    }
    elements.push(item);
  }
  if(!elements.some(e=>e.tags?.highway&&e.type==='way'))throw new Error('PBF extract contains no roads');
  // Node references have already been resolved into way/relation geometry. Do not
  // keep millions of untagged source nodes alive throughout a whole-city bake.
  return {elements:elements.filter(e=>e.type==='relation'||(e.type==='node'
    ? /^(traffic_signals|stop|give_way)$/.test(e.tags?.highway??'')
    : Boolean(e.tags?.highway||e.tags?.building||e.tags?.['building:part']||e.tags?.landuse||e.tags?.railway||e.tags?.natural||e.tags?.leisure)))};
}
async function osmium(args:string[],consume?:(lines:AsyncIterable<string>)=>Promise<OsmExtract>):Promise<OsmExtract|undefined> {
  const child=spawn('osmium',args,{stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',(b:Buffer)=>{stderr=(stderr+b.toString()).slice(-4000);});
  const done=new Promise<void>((ok,no)=>{child.on('error',error=>no(new Error('PBF import requires osmium-tool (brew install osmium-tool)',{cause:error})));child.on('close',code=>code===0?ok():no(new Error(`osmium failed (${code}): ${stderr}`)));});
  if(!consume){child.stdout.resume();await done;return;}
  try {const [result]=await Promise.all([consume(createInterface({input:child.stdout,crlfDelay:Infinity})),done]);return result;}
  catch(error){child.kill('SIGTERM');await done.catch(()=>{});throw error;}
}
export async function importPbf(s:Settings,path:string):Promise<{osm:OsmExtract;records:SourceRecord[]}> {
  const original=resolve(path),info=await stat(original),checksum=createHash('sha256');
  for await(const bytes of createReadStream(original))checksum.update(bytes);
  const sourceHash=checksum.digest('hex'),key=hash(JSON.stringify({sourceHash,bbox:s.sourceBbox,version:4}));
  const dir=join(s.cache,'pbf');await mkdir(dir,{recursive:true});
  const file=`pbf/${key}.json`,target=join(s.cache,file),meta=`${target}.meta`;
  let bytes:Buffer,record:SourceRecord;
  try {
    bytes=await readFile(target);record=JSON.parse(await readFile(meta,'utf8')) as SourceRecord;
    if(hash(bytes)!==record.sha256||bytes.length!==record.bytes)throw new Error('Corrupt PBF conversion cache');
  }catch(error) {
    if(!(error instanceof Error&&'code' in error&&error.code==='ENOENT'))throw error;
    const clipped=join(dir,`${key}.osm.pbf`);
    console.log('Clipping the local PBF with complete ways and multipolygon/restriction members');
    await osmium(['extract','--bbox',s.sourceBbox.join(','),'--strategy','smart','-S','types=multipolygon,restriction','--overwrite','--output',clipped,original]);
    const osm=await osmium(['cat',clipped,'--output-format','opl,add_metadata=false'],parseOpl);
    bytes=Buffer.from(JSON.stringify(osm)+'\n');
    record={key:'osm-pbf-normalized',url:pathToFileURL(original).href,file,sha256:hash(bytes),bytes:bytes.length,fetchedAt:new Date().toISOString()};
    await writeFile(`${target}.tmp`,bytes);await rename(`${target}.tmp`,target);await writeFile(meta,JSON.stringify(record)+'\n');
  }
  return {osm:JSON.parse(bytes.toString('utf8')) as OsmExtract,records:[
    {key:'osm-pbf-input',url:pathToFileURL(original).href,file:original,sha256:sourceHash,bytes:info.size,fetchedAt:info.mtime.toISOString()},record,
  ]};
}
