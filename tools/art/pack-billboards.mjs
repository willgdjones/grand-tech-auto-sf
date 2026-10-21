import sharp from 'sharp';
import {readFile,writeFile,mkdir,rename,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const archive='artifacts/street-props/masters';await mkdir(archive,{recursive:true});
const specs=[
 {id:'fog-compute',title:'FOG COMPUTE',footer:'CLOUD NATIVE. LITERALLY.',titleOverlay:true,footerOverlay:true},
 {id:'agentic-toast',title:'AGENTIC TOAST',footer:'NOW WITH EXTRA AGENTS'},
 {id:'cone-coin',title:'CONE COIN',footer:'BACKED BY TRAFFIC CONES',footerOverlay:true},
 {id:'burnt-runway',title:'BURNT RUNWAY',footer:'LESS RUNWAY. MORE DECKS.',footerOverlay:true,cropBottom:34},
 {id:'prompt-juice',title:'PROMPT JUICE',footer:'SQUEEZE MORE SYNERGY',footerOverlay:true},
 {id:'series-sea',title:'SERIES SEA',footer:'RAISE WITH THE TIDE'},
];
const ledger=JSON.parse(await readFile('tools/art/ledger.json','utf8')),tiles=[],assets=[];
for(let i=0;i<specs.length;i++){
 const spec=specs[i],name=`${spec.id}-flat-source.png`,path=`web/public/art/billboards/${name}`;let input=path;
 try{await access(path);}catch{input=`${archive}/${name}`;}
 let image=sharp(input);if(spec.cropBottom)image=image.extract({left:0,top:0,width:1024,height:512-spec.cropBottom});
 const base=await image.resize(496,240,{fit:'fill',kernel:'lanczos3'}).modulate({saturation:.76}).png().toBuffer();
 // Deterministic type restores omitted copy; source artwork remains Scenario-made.
 // Burnt Runway's bottom crop also removes tiny invented signature-like marks.
 const svg=Buffer.from(`<svg width="496" height="240" xmlns="http://www.w3.org/2000/svg">
 ${spec.titleOverlay?`<text x="248" y="33" text-anchor="middle" font-family="Impact,Arial,sans-serif" font-size="32" font-weight="900" fill="#fff1c7" stroke="#234b42" stroke-width="1" paint-order="stroke">${spec.title}</text>`:''}
 ${spec.footerOverlay?`<rect x="0" y="213" width="496" height="27" fill="#153c37"/><text x="248" y="233" text-anchor="middle" font-family="Arial,sans-serif" font-size="15" font-weight="900" fill="#fff1c7">${spec.footer}</text>`:''}
 </svg>`);
 const decorated=await sharp(base).composite([{input:svg}]).png().toBuffer();
 const tile=await sharp(decorated).extend({left:8,right:8,top:8,bottom:8,extendWith:'copy'}).png().toBuffer();
 tiles.push({input:tile,left:(i%2)*512,top:Math.floor(i/2)*256});
 const generated=ledger.entries.find(e=>e.output===path);
 assets.push({...spec,generationId:generated?.id,sourceSha256:generated?.sha256,pixelRect:[(i%2)*512+8,Math.floor(i/2)*256+8,496,240],selected:true});
}
const bytes=await sharp({create:{width:1024,height:768,channels:3,background:'#173c36'}}).composite(tiles).png({palette:true,colours:96,dither:0}).toBuffer();
await writeFile('web/public/art/billboards/unsold-atlas.png',bytes);
await writeFile('web/public/art/billboards/manifest.json',JSON.stringify({version:1,provider:'Scenario',model:'model_bfl-flux-1-dev',ledger:'tools/art/ledger.json',path:'/art/billboards/unsold-atlas.png',width:1024,height:768,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),assets,
 review:'Six original fictional startup parodies. First scenic/perspective drafts rejected; flat variants inspected by eye. Missing headlines/taglines composed as local text. No reference photos or SA screenshots were provider inputs.',
 rejected:specs.map(s=>({id:s.id,variant:'first',reason:'Provider drew physical sign frame/perspective or omitted required copy; archived unshipped.'}))},null,2)+'\n');
for(const spec of specs){const name=`${spec.id}-flat-source.png`;try{await rename(`web/public/art/billboards/${name}`,`${archive}/${name}`);}catch(error){if(error.code!=='ENOENT')throw error;}}
console.log(JSON.stringify({bytes:bytes.length,pixels:1024*768,assets:assets.length}));
