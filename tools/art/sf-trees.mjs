import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createFalClient } from './fal.mjs';
const cache='tools/assets/cache/fal/sf-trees';
const species=[['eucalyptus','Mature blue gum eucalyptus, tall pale peeling cream bark trunk branching asymmetrically, airy spreading crown of narrow grey-green leaves'],['pine','Mature Monterey pine, rugged dark trunk, broad windswept irregular tiered crown of dark green needle clusters'],['ficus','Mature Indian laurel fig street tree, short smooth grey branching trunk and dense rounded broad evergreen crown of small glossy deep green leaves']];
if(process.argv[2]==='generate') {
 const fal=createFalClient();
 for(const [i,[id,description]] of species.entries()) {
  const prompt=`Full single tree ${description}. Orthographic front elevation game vegetation cutout, realistic natural botanical silhouette, whole trunk and whole canopy fully inside frame, trunk base at bottom centre. Flat even diffuse daylight, detailed leaves and small gaps. Isolated on perfectly solid bright magenta #ff00ff background. No ground, no grass, no sky, no horizon, no shadow, no text. Tree occupies 90 percent height. San Francisco urban tree.`;
  const result=await fal.run({model:'fal-ai/flux/dev',input:{prompt,image_size:{width:512,height:512},seed:90220+i,num_inference_steps:28,guidance_scale:3.5,num_images:1,output_format:'png'},estimatedUsd:.1,output:`${cache}/${id}.png`});
  console.log(id,result.id,result.status);
 }
} else if(process.argv[2]==='pack') {
 const cells=[];const layers=[];
 const all=[['palm',9,14],['plane',11,12],['cypress',9,13],['eucalyptus',12,20],['pine',12,16],['ficus',10,10]];
 for(const [index,[id,width,height]] of all.entries()) {
  const path=index<3?`web/public/art/foliage/${id}-hd.webp`:`${cache}/${id}.png`;
  const {data,info}=await sharp(path).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  for(let i=0;i<data.length;i+=4) {
   const [r,g,b]=data.subarray(i,i+3);
   if(Math.min(r-g,b-g)>6&&r>g*1.1&&b>g*1.08){data[i+3]=0;data[i]=data[i+1]=data[i+2]=Math.min(r,g,b);}
   else if(r>g&&b>g){data[i]=Math.min(r,g+4);data[i+2]=Math.min(b,g+4);}
  }
  let left=info.width,top=info.height,right=0,bottom=0;
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if(data[(y*info.width+x)*4+3]>180){left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}
  const tree=await sharp(data,{raw:{width:info.width,height:info.height,channels:4}}).extract({left,top,width:right-left+1,height:bottom-top+1}).resize(244,372,{fit:'fill'}).webp({quality:90,alphaQuality:100}).toBuffer();
  // Rectangles have transparent gutters; per-species crop at runtime gets its own mip chain.
  layers.push({input:tree,left:index%3*256+6,top:Math.floor(index/3)*384+6});
  const ledger=JSON.parse(await readFile('tools/art/ledger.json','utf8'));
  const generation=ledger.entries.find(e=>e.output===path);
  const sourceBytes=await readFile(path);
  cells.push({id,widthMetres:width,heightMetres:height,sourceSha256:createHash('sha256').update(sourceBytes).digest('hex'),generationId:generation?.id,rect:[index%3*256+6,Math.floor(index/3)*384+6,244,372],source:path});
 }
 await mkdir('web/public/art/foliage',{recursive:true});
 await sharp({create:{width:768,height:768,channels:4,background:'#00000000'}}).composite(layers).webp({quality:88,alphaQuality:100}).toFile('web/public/art/foliage/sf-trees.webp');
 await writeFile('web/public/art/foliage/sf-trees.json',JSON.stringify({version:1,atlas:'/art/foliage/sf-trees.webp',width:768,height:768,cells},null,2)+'\n');
} else throw Error('generate | pack');
