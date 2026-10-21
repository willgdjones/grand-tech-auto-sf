/** Download only the explicitly licensed Poly Haven CC0 source maps; pack bounded runtime tiles. */
import sharp from 'sharp';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '1';
const sources = { asphalt:'asphalt_02', sidewalk:'concrete_pavement', pavers:'concrete_pavers', roof:'grey_roof_01', stucco:'white_stucco', brick:'red_brick', siding:'weathered_plank_siding', concrete:'concrete_wall_001' };
const out='web/public/art/surfaces', cache='tools/assets/cache/polyhaven-surfaces';
await mkdir(out,{recursive:true}); await mkdir(cache,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex');
async function get(url) {
  const r=await fetch(url,{signal:AbortSignal.timeout(60000)}); if(!r.ok)throw Error(`Source unavailable ${r.status}`);
  const b=Buffer.from(await r.arrayBuffer()); if(b.length>25_000_000)throw Error('Source budget'); return b;
}
const materials=[];
for(const [id,asset] of Object.entries(sources)) {
  const files=JSON.parse(await get(`https://api.polyhaven.com/files/${asset}`));
  const info=JSON.parse(await get(`https://api.polyhaven.com/info/${asset}`));
  const maps={};
  for(const [name,channel] of [['albedo','Diffuse'],['normal','nor_gl'],['roughness','Rough']]) {
    const source=files[channel]?.['1k']?.jpg;
    if(!source)throw Error(`Missing ${asset} ${channel}`);
    const path=`${cache}/${id}-${name}.jpg`;
    let bytes; try{bytes=await readFile(path);}catch{bytes=await get(source.url);await writeFile(path,bytes);}
    if(createHash('md5').update(bytes).digest('hex')!==source.md5)throw Error('Source checksum mismatch');
    // 512px individual tiles retain independent repeat-safe mip chains; never decode large masters.
    const encoded=await sharp(bytes).resize(512,512,{fit:'fill'}).removeAlpha().webp({quality:name==='normal'?95:86,effort:4}).toBuffer();
    const file=`${id}-${name}.webp`; await writeFile(`${out}/${file}`,encoded);
    maps[name]={url:`/art/surfaces/${file}`,bytes:encoded.length,sha256:hash(encoded),sourceUrl:source.url,sourceSha256:hash(bytes)};
  }
  const metres=info.dimensions?.map(v=>Math.round(v)/1000);
  if(!metres||metres.length!==2||metres.some(v=>!(v>0)))throw Error(`No measured scale ${asset}`);
  materials.push({id,asset,source:`https://polyhaven.com/a/${asset}`,authors:info.authors,license:'CC0-1.0',metres,width:512,height:512,maps});
  console.log(id,metres,Object.values(maps).reduce((s,m)=>s+m.bytes,0));
}
await writeFile(`${out}/manifest.json`,JSON.stringify({version:1,licenseUrl:'https://polyhaven.com/license',normalConvention:'OpenGL +Y',materials},null,2)+'\n');
