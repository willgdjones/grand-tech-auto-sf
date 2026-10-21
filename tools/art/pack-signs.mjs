import sharp from 'sharp';
import {readFile,writeFile,mkdir,rename,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const archive='artifacts/street-props/masters';await mkdir(archive,{recursive:true});
const specs=[
 {id:'pivot-coffee',source:'coffee',crop:{left:65,top:210,width:894,height:440},review:'Only the large PIVOT COFFEE lettering and green board; no surrounding scene.'},
 {id:'fog-city',source:'ramen',crop:{left:115,top:248,width:790,height:151},review:'Crop selects the red FOG CITY fascia; generated building and extra lettering excluded.'},
 {id:'stealth',source:'laundry',crop:{left:96,top:119,width:753,height:208},review:'Only STEALTH from the yellow fascia; surrounding shop image excluded.'},
 {id:'runway-repairs',source:'repairs',crop:{left:43,top:310,width:937,height:389},review:'RUNWAY REPAIRS lettering on pale blue; extraneous blank margins excluded.'},
];
const ledger=JSON.parse(await readFile('tools/art/ledger.json','utf8')),assets=[],tiles=[];
for(let i=0;i<specs.length;i++){
 const spec=specs[i],name=`sign-${spec.source}-source.png`,path=`web/public/art/props/${name}`;let input=path;
 try{await access(path);}catch{input=`${archive}/${name}`;}
 const data=await sharp(input).extract(spec.crop).resize(504,120,{fit:'fill',kernel:'lanczos3'}).modulate({saturation:.66})
   .extend({left:4,right:4,top:4,bottom:4,extendWith:'copy'}).png().toBuffer();
 tiles.push({input:data,left:0,top:i*128});const generated=ledger.entries.find(e=>e.output===path);
 assets.push({...spec,generationId:generated?.id,sourceSha256:generated?.sha256,pixelRect:[4,i*128+4,504,120]});
}
const bytes=await sharp({create:{width:512,height:512,channels:3,background:'#243e34'}}).composite(tiles).png({palette:true,colours:96,dither:0}).toBuffer();
await writeFile('web/public/art/props/shopfront-signs.png',bytes);
await writeFile('web/public/art/props/signs-manifest.json',JSON.stringify({version:1,provider:'Scenario',model:'model_bfl-flux-1-1-pro',path:'/art/props/shopfront-signs.png',width:512,height:512,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),assets},null,2)+'\n');
for(const spec of specs){const name=`sign-${spec.source}-source.png`;try{await rename(`web/public/art/props/${name}`,`${archive}/${name}`);}catch(error){if(error.code!=='ENOENT')throw error;}}
console.log(JSON.stringify({bytes:bytes.length,assets:assets.length}));
