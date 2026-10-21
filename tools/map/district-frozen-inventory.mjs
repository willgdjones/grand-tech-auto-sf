/** Inventory an existing phone-review build for the district preview; never build or edit it.
 * tools/heavy.sh node tools/map/district-frozen-inventory.mjs <phone-report.json> <inventory.json>
 * File/decoded-image accounting follows tools/cold-load.mjs.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { dirname, extname, relative, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';

assert.equal(process.argv.length,4,'Supply a phone review report and a new output inventory');
const reportPath=resolve(process.argv[2]),output=resolve(process.argv[3]);
const reportBytes=await readFile(reportPath),report=JSON.parse(reportBytes),app=resolve(report.app);
assert(report.bundleSha256&&Object.keys(report.bundleSha256).length>0,'Review must pin its emitted entrypoints');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sharp=createRequire(new URL('../assets/package.json',import.meta.url))('sharp');
async function verifyEntrypoints(){
  for(const [path,hash] of Object.entries(report.bundleSha256)){
    const target=resolve(app,path);assert(target.startsWith(app+sep),'Pinned path stays inside app');
    assert.equal(sha(await readFile(target)),hash,`Reviewed entrypoint changed: ${path}`);
  }
}
async function walk(directory){
  const files=[];
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const path=resolve(directory,entry.name);
    if(entry.isDirectory())files.push(...await walk(path));
    else {assert(entry.isFile(),`Unexpected non-file emitted asset: ${path}`);files.push(path);}
  }
  return files.sort();
}
async function imageInfo(bytes){
  const info=await sharp(bytes).metadata();
  assert(info.width&&info.height,'Image metadata has dimensions');
  return {width:info.width,height:info.height,rgba8Bytes:info.width*info.height*4};
}
await verifyEntrypoints();
const emitted=[];
for(const path of await walk(app)){
  const bytes=await readFile(path),suffix=extname(path).toLowerCase();
  const file={path:relative(app,path),fileBytes:bytes.length,sha256:sha(bytes),gzipEstimateBytes:gzipSync(bytes,{level:6}).length};
  if(['.png','.jpg','.jpeg','.webp','.avif'].includes(suffix))file.decodedImage=await imageInfo(bytes);
  if(suffix==='.glb'&&bytes.readUInt32LE(0)===0x46546c67){
    const length=bytes.readUInt32LE(12),gltf=JSON.parse(bytes.subarray(20,20+length).toString()),bin=bytes.subarray(28+length);
    file.embeddedImages=[];
    for(const image of gltf.images??[]){
      const view=gltf.bufferViews?.[image.bufferView];
      if(view)file.embeddedImages.push(await imageInfo(bin.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength)));
      else file.embeddedImages.push({external:true});
    }
  }
  emitted.push(file);
}
await verifyEntrypoints();
for(const file of emitted)assert.equal(sha(await readFile(resolve(app,file.path))),file.sha256,`Asset changed while inventorying: ${file.path}`);
const inventory={recordedAt:new Date().toISOString(),app,sourceReport:reportPath,sourceReportSha256:sha(reportBytes),
  sourceReportPassed:report.passed,flagsSourceSha256:typeof report.flagsSource==='string'?sha(report.flagsSource):null,emitted,
  definitions:{fileBytes:'Emitted bytes before HTTP content-encoding.',gzipEstimateBytes:'Local gzip level 6 estimate, not measured CDN transfer.',
    rgba8Bytes:'Width × height × 4; excludes mipmaps and other GPU allocations.'}};
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(inventory,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({inventory:output,app,files:emitted.length,rawBytes:emitted.reduce((sum,file)=>sum+file.fileBytes,0),
  gzipEstimateBytes:emitted.reduce((sum,file)=>sum+file.gzipEstimateBytes,0),sourceReportPassed:report.passed}));
