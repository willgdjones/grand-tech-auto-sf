import { build } from 'esbuild';
import { Group } from 'three';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const out=resolve(process.env.GTASF_MARKER_WORK_OUT??'artifacts/marker-work/current');
const sourcePath=process.env.GTASF_MARKER_WORK_SOURCE??'web/src/events/markers.ts';
await mkdir(out,{recursive:true});
await build({entryPoints:['web/src/events/markers.ts'],outfile:`${out}/markers.mjs`,bundle:true,platform:'node',format:'esm',external:['three'],logLevel:'silent',
plugins:[{name:'saved-source',setup(b){b.onLoad({filter:/web\/src\/events\/markers\.ts$/},async args=>({contents:await readFile(sourcePath,'utf8'),loader:'ts',resolveDir:dirname(args.path)}));}}]});
const {createEventMarkers}=await import(pathToFileURL(`${out}/markers.mjs`).href);
const origin={lat:37.7955,lon:-122.3937}, scene=new Group(),entries=[];
const events=Array.from({length:2000},(_,i)=>({id:`controlled-marker-${i}`,title:`Controlled marker ${i}`,start:'2026-10-05T17:00:00Z',end:null,
lat:origin.lat+Math.floor(i/50)*.00015,lon:origin.lon+(i%50)*.0002,approx:i%2===0,url:'https://example.test/fixture'}));
let loaded=true,height=0;
const markers=createEventMarkers({scene,frame:{origin,gridRotationDeg:0},surfaceHeightAt:()=>loaded?height:null,
resolvePosition:point=>loaded?{x:point.x+1.25,y:height,z:point.z-.5}:null,
onEnter:event=>entries.push({id:event.id,title:event.title})});
assert.ok(markers);
const source=await readFile(sourcePath,'utf8');
const report={at:new Date().toISOString(),scope:'Actual Three marker scene graph; 2000 explicit local fixture events; allocation identities and behavior only, no renderer/FPS claim',sourceHash:createHash('sha256').update(source).digest('hex'),states:[],entries,passed:false};
const sceneObjects=new Set();
const snapshot=name=>{for(const root of markers.root.children){sceneObjects.add(root.uuid);for(const mesh of root.children)sceneObjects.add(mesh.uuid);}
report.states.push({name,markers:markers.root.children.map(root=>({name:root.name,position:root.position.toArray(),scale:root.scale.toArray(),visible:root.visible,
meshes:root.children.map(mesh=>({position:mesh.position.toArray(),rotation:mesh.rotation.toArray(),geometry:createHash('sha256').update(Buffer.from(mesh.geometry.attributes.position.array.buffer)).digest('hex'),color:mesh.material.color.getHex(),opacity:mesh.material.opacity,side:mesh.material.side,blending:mesh.material.blending,depthWrite:mesh.material.depthWrite}))}))});
};
const advance=(frames,position={x:0,y:0,z:0},canEnter=false)=>{for(let i=0;i<frames;i++)markers.update(position,1/60,canEnter);};
try{
markers.setEvents(events);markers.update({x:0,y:0,z:0},0,false);snapshot('initial');assert.equal(markers.root.children.length,12);
const resources=new Set(markers.root.children.flatMap(root=>root.children.flatMap(mesh=>[mesh.geometry,mesh.material])));
const disposals=new Map([...resources].map(resource=>[resource,0]));
for(const resource of resources)resource.addEventListener('dispose',()=>disposals.set(resource,disposals.get(resource)+1));
const initialIds=new Set(markers.root.children.flatMap(root=>[root.uuid,...root.children.map(mesh=>mesh.uuid)]));
const seenIds=new Set(initialIds);const NativeSet=globalThis.Set;let sets=0;
try{
globalThis.Set=class extends NativeSet{constructor(...args){super(...args);sets++;}};
for(let i=0;i<240;i++){markers.update({x:0,y:0,z:0},1/60,false);for(const root of markers.root.children){seenIds.add(root.uuid);for(const mesh of root.children)seenIds.add(mesh.uuid);}}
}finally{globalThis.Set=NativeSet;}
report.stationary={frames:240,initialSceneObjects:initialIds.size,newSceneObjects:seenIds.size-initialIds.size,newSets:sets};snapshot('stationary');
if(process.env.GTASF_MARKER_WORK_BASELINE_MODE!=='1'){
assert.equal(report.stationary.newSceneObjects,0,'Warmed stationary markers reuse their Group/Mesh objects');
assert.equal(sets,0,'Stationary updates reuse temporary Sets');
}
advance(1,undefined,true);assert.deepEqual(entries,[{id:events[0].id,title:events[0].title}]);
advance(70,undefined,false);advance(1,undefined,true);assert.equal(entries.length,1);snapshot('consumed-after-hold');
loaded=false;advance(70);assert.equal(markers.root.children.length,0);snapshot('unloaded');
loaded=true;height=4;advance(70,undefined,true);assert.equal(entries.length,1);snapshot('different-level');
height=0;advance(70,undefined,true);assert.equal(entries.length,2);snapshot('loaded-return');
markers.setEvents([{...events[0],title:'Refreshed marker'},events[0]]);advance(1);assert.equal(markers.root.children.length,1);snapshot('deduplicated-refresh');
advance(1,{x:-20,y:0,z:0},false);advance(1,undefined,true);
assert.deepEqual(entries.at(-1),{id:events[0].id,title:'Refreshed marker'});
markers.setEvents([]);advance(1);assert.equal(markers.root.children.length,0);snapshot('removed');
markers.setEvents(events);advance(1);assert.equal(markers.root.children.length,12);snapshot('restored');
advance(70,{x:-1000,y:0,z:-1000});assert.equal(markers.root.children.length,0);snapshot('outside-range');
markers.destroy();advance(1,undefined,true);markers.destroy();assert.equal(scene.children.length,0);assert.equal(entries.length,3);
report.disposal={resources:resources.size,counts:[...disposals.values()]};assert.equal(resources.size,4);assert.deepEqual(report.disposal.counts,[1,1,1,1]);
report.sceneObjectsAcrossStates=sceneObjects.size;
if(process.env.GTASF_MARKER_WORK_BASELINE_MODE!=='1')assert.equal(sceneObjects.size,36,'Feed/loading changes keep a bounded twelve-marker pool');
if(process.env.GTASF_MARKER_WORK_BASELINE){
const baseline=JSON.parse(await readFile(process.env.GTASF_MARKER_WORK_BASELINE,'utf8'));
assert.deepEqual(report.states,baseline.states,'Geometry, material, transforms, visible count/order match the preserved source');
assert.deepEqual(entries,baseline.entries);assert.deepEqual(report.disposal,baseline.disposal);report.matchesBaseline=true;
}
report.passed=true;
}finally{markers.destroy();await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));}
console.log(JSON.stringify({passed:report.passed,stationary:report.stationary,states:report.states.length,entries}));
