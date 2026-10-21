import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { readFile,writeFile,mkdir,rename,access } from 'node:fs/promises';
import { basename } from 'node:path';

// Local packing/chroma-key processing of original Scenario outputs; no paid calls.
const archive='artifacts/street-props/masters';await mkdir(archive,{recursive:true});
const ledger=JSON.parse(await readFile('tools/art/ledger.json','utf8'));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function source(path){try{await access(path);return path;}catch{return `${archive}/${basename(path)}`;}}
async function chroma(path){
  const {data,info}=await sharp(await source(path)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  // Generated plates use pink/magenta only outside foliage and metal. Remove
  // keyed edge pixels before downsampling, then transparent RGB is desaturated
  // to avoid pink fringes in mipmaps. No learned segmentation or external input.
  for(let i=0;i<data.length;i+=4){
    const r=data[i],g=data[i+1],b=data[i+2],difference=Math.min(r-g,b-g);
    if(difference>12&&r>g*1.15&&b>g*1.1){data[i+3]=0;const grey=Math.min(r,g,b);data[i]=grey;data[i+1]=grey;data[i+2]=grey;}
  }
  return sharp(data,{raw:{width:info.width,height:info.height,channels:4}});
}
const specs=[
  ['wood','weathered-wood',false],['hydrant','hydrant-paint',false],['newspaper','newspaper-front',false],
  ['muni-stop','muni-stop',false],['metal-frame','billboard-metal',false],['chain-link','chain-link',true],
];
const tiles=[],assets=[];
for(let i=0;i<specs.length;i++){
  const [id,name,key]=specs[i],path=`web/public/art/props/${name}-source.png`;
  let input=key?await chroma(path):sharp(await source(path));
  if(id==='newspaper')input=input.extract({left:177,top:24,width:667,height:975});
  const packed=await input.resize(240,240,{fit:'fill',kernel:'lanczos3'}).modulate({saturation:.72})
    .extend({top:8,bottom:8,left:8,right:8,extendWith:'copy'}).png().toBuffer();
  tiles.push({input:packed,left:(i%4)*256,top:Math.floor(i/4)*256});
  const generated=ledger.entries.find(e=>e.output===path);
  assets.push({id,tile:i,pixelRect:[(i%4)*256+8,Math.floor(i/4)*256+8,240,240],generationId:generated?.id,sourceSha256:generated?.sha256,alpha:key});
}
const blank=await sharp({create:{width:256,height:256,channels:4,background:'#ffffff'}}).png().toBuffer();
tiles.push({input:blank,left:512,top:256},{input:blank,left:768,top:256});
const atlas=await sharp({create:{width:1024,height:512,channels:4,background:'#ffffff00'}}).composite(tiles).png({palette:true,colours:96,dither:0}).toBuffer();
await writeFile('web/public/art/props/street-props.png',atlas);
const foliage=[];
for(const [id,candidate,review] of [
  ['palm','palm-1','Slender trunk and drooping feather fronds; selected over brighter candidate 2.'],
  ['plane','plane-2','Muted rounded street-tree crown and branching trunk; candidate 1 was too yellow.'],
  ['cypress','cypress-1','Sculptural branched evergreen crown; candidate 2 included an unwanted ground strip.'],
]){
  const path=`web/public/art/foliage/${candidate}-source.png`,input=await chroma(path);
  const rgba=await input.resize(256,256,{kernel:'lanczos3'}).modulate({saturation:.64}).ensureAlpha().raw().toBuffer();
  // Bring the lowest surviving trunk pixels onto the card's base; no floating tree.
  let bottom=0;for(let y=0;y<256;y++)for(let x=0;x<256;x++)if(rgba[(y*256+x)*4+3]>180)bottom=y;
  const cropped=sharp(rgba,{raw:{width:256,height:256,channels:4}}).extract({left:0,top:0,width:256,height:bottom+1});
  const bytes=await cropped.resize(256,256,{fit:'fill',kernel:'nearest'}).png({palette:true,colours:96,dither:0}).toBuffer();
  await writeFile(`web/public/art/foliage/${id}.png`,bytes);
  const generated=ledger.entries.find(e=>e.output===path);
  foliage.push({id,path:`/art/foliage/${id}.png`,generationId:generated?.id,sourceSha256:generated?.sha256,width:256,height:256,bytes:bytes.length,sha256:sha(bytes),alpha:true,review});
}
const manifest={version:1,provider:'Scenario',model:'model_bfl-flux-1-1-pro',ledger:'tools/art/ledger.json',
  inputs:'Original text prompts only; local SA references were viewed by eye and never supplied to a provider.',
  atlas:{path:'/art/props/street-props.png',width:1024,height:512,bytes:atlas.length,sha256:sha(atlas),columns:4,rows:2,tileSize:256,gutter:8,colorSpace:'srgb',magFilter:'NearestFilter'},
  assets,foliage,originals:'Unshipped source PNGs are archived in ignored artifacts/street-props/masters; recipe reruns can resume the same provider jobs without another paid generation.',
  rejected:[{id:'shopfront-strips',reason:'Garbled and repeated lettering; separate single-sign replacements are being reviewed.'}]};
await writeFile('web/public/art/props/manifest.json',JSON.stringify(manifest,null,2)+'\n');
// Source originals never inflate the public payload. Preserve them locally.
for(const path of [...specs.map(([,name])=>`web/public/art/props/${name}-source.png`),...['palm','plane','cypress'].flatMap(id=>[1,2].map(n=>`web/public/art/foliage/${id}-${n}-source.png`)), 'web/public/art/props/shopfront-strips-source.png']){
  try{await access(path);await rename(path,`${archive}/${basename(path)}`);}catch(error){if(error.code!=='ENOENT')throw error;}
}
console.log(JSON.stringify({atlasBytes:atlas.length,foliageBytes:foliage.reduce((n,a)=>n+a.bytes,0),atlasPixels:1024*512,foliagePixels:3*256*256}));
