import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';

// Retain full-resolution originals in ignored review storage, never in the app payload.
const sourceDir = 'artifacts/art-source/ground';
await mkdir(sourceDir, { recursive: true });
const recipes = JSON.parse(await readFile('tools/art/recipes/ground.json', 'utf8')) as { name: string; output: string }[];
for (const recipe of recipes) await rename(recipe.output, `${sourceDir}/${recipe.name}.png`).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
const specs = [
  { id: 'worn-asphalt', source: 'worn-asphalt', metres: [6, 6], review: 'Unmarked charcoal aggregate; base asphalt only.' },
  { id: 'double-yellow', source: 'double-yellow', metres: [6, 6], review: 'Two continuous yellow lines. Road-aligned detail only, never global planar markings.' },
  { id: 'white-dashes', source: 'white-dashes', crop: { left: 0, top: 142, width: 1024, height: 214 }, metres: [6, 4], review: 'Crop selects one correctly shaped single white dash and blank gaps, excluding the unwanted horizontal crossbar. Second candidate rejected for double lines.' },
  { id: 'crosswalk', source: 'crosswalk-b', crop: { left: 16, top: 214, width: 992, height: 196 }, metres: [8, 1.2], review: 'Selected unbroken full-width stripe plus asphalt gap from corrected candidate; first grid-shaped candidate rejected.' },
  { id: 'sidewalk-kerb', source: 'sidewalk-kerb', metres: [3, 3], review: 'Light slabs and narrow kerb at right edge.' },
  { id: 'cobbles', source: 'cobbles', metres: [3, 3], review: 'Terracotta brick cobbles preserve the crooked Lombard road material.' },
  { id: 'cable-track', source: 'cable-track', metres: [2.1, 4], review: 'Steel heads and central cable-grip slot in brick; source cable-car corridors only.' },
];
const ledger = JSON.parse(await readFile('tools/art/ledger.json', 'utf8'));
const ground = [];
for (const spec of specs) {
  let source = sharp(`${sourceDir}/${spec.source}.png`);
  if (spec.crop) source = source.extract(spec.crop);
  const raw = await source.resize(128,128,{kernel:'lanczos3',fit:'fill'}).modulate({saturation:0.72}).removeAlpha().raw().toBuffer();
  // Pair edge texels without blurring the central markings; coarse mipmapped tiles remain stable.
  const n=128, blend=3;
  for (let axis=0;axis<2;axis++) for(let i=0;i<n;i++) for(let j=0;j<blend;j++) for(let c=0;c<3;c++) {
    const a=(axis===0?i*n+j:j*n+i)*3+c, b=(axis===0?i*n+n-1-j:(n-1-j)*n+i)*3+c;
    const average=(raw[a]!+raw[b]!)/2, amount=(blend-j)/blend;
    raw[a]=Math.round(raw[a]!*(1-amount)+average*amount);raw[b]=Math.round(raw[b]!*(1-amount)+average*amount);
  }
  const bytes=await sharp(raw,{raw:{width:n,height:n,channels:3}}).resize(256,256,{kernel:'nearest'}).png({palette:true,colours:32,dither:0}).toBuffer();
  const output=`web/public/art/ground/${spec.id}.tile.png`;
  await writeFile(output,bytes);
  const entry=ledger.entries.find((e:{output:string})=>e.output===`web/public/art/ground/${spec.source}.png`);
  ground.push({id:spec.id,path:`/art/ground/${spec.id}.tile.png`,width:256,height:256,metres:spec.metres,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),generationId:entry?.id,sourceSha256:entry?.sha256,crop:spec.crop,model:entry?.model,colorSpace:'srgb',palette:32,selected:true,review:spec.review});
}
const manifest=JSON.parse(await readFile('web/public/art/manifest.json','utf8'));
manifest.ground=ground;
await writeFile('web/public/art/manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({ground,totalBytes:ground.reduce((sum,a)=>sum+a.bytes,0),credits:ledger.totals.actualCredits}));
