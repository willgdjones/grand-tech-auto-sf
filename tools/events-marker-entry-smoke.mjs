import {build} from 'esbuild';
import {Group} from 'three';
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// Actual marker module and Three scene graph, without a renderer or API calls.
const root=process.cwd(),out=resolve(root,process.env.GTASF_MARKER_ENTRY_OUT??'artifacts/marker-entry');
const source=process.env.GTASF_MARKER_SOURCE;
await mkdir(out,{recursive:true});
const bundle=resolve(out,'markers.mjs');
await build({entryPoints:['web/src/events/markers.ts'],outfile:bundle,bundle:true,platform:'node',format:'esm',external:['three'],logLevel:'error',
  plugins:source?[{name:'recorded-source',setup(b){b.onLoad({filter:/web\/src\/events\/markers\.ts$/},async args=>({contents:await readFile(source,'utf8'),loader:'ts',resolveDir:dirname(args.path)}));}}]:[]});
const {createEventMarkers}=await import(pathToFileURL(bundle).href);
const origin={lat:37.7955,lon:-122.3937},event={id:'public-ferry-event',title:'Ferry event',start:'2026-10-05T17:00:00Z',end:null,...origin,approx:false,url:'https://www.tech-week.com/calendar/sf'};
const report={at:new Date().toISOString(),scope:'Actual marker entry behavior; no browser, rendering, API or performance acceptance',source:source??'web/src/events/markers.ts',cases:[],passed:false};
function check(name,run){
  const entries=[],scene=new Group();let height=0;
  const markers=createEventMarkers({scene,frame:{origin,gridRotationDeg:0},surfaceHeightAt:()=>height,onEnter:value=>entries.push(value.id)});
  try{
    assert.ok(markers,'Current game flags must enable event markers');markers.setEvents([event]);
    run({markers,entries,step:(canEnter,x=0,y=0)=>markers.update({x,y,z:0},.1,canEnter),setHeight:value=>{height=value;}});
    report.cases.push({name,passed:true});
  }catch(error){report.cases.push({name,passed:false,error:String(error)});}
  finally{markers?.destroy();}
}
check('blocked arrival activates once when driving/modal hold ends',({step,entries})=>{
  step(false);step(false);assert.deepEqual(entries,[]);step(true);step(true);assert.deepEqual(entries,[event.id]);
});
check('an already entered marker stays consumed across modal/vehicle holds',({step,entries})=>{
  step(true);step(false);step(false);step(true);assert.deepEqual(entries,[event.id]);
});
check('leaving a blocked marker cancels deferred entry',({step,entries})=>{
  step(false);step(false,20);step(true,20);assert.deepEqual(entries,[]);step(true);assert.deepEqual(entries,[event.id]);
});
check('departure clears consumption even when interaction is blocked',({step,entries})=>{
  step(true);step(false,20);step(false);assert.deepEqual(entries,[event.id]);step(true);step(true);assert.deepEqual(entries,[event.id,event.id]);
});
check('ordinary physical leave and reentry still activate separately',({step,entries})=>{
  step(true);step(true,20);step(true);assert.deepEqual(entries,[event.id,event.id]);
});
check('another road height cannot enter the event',({step,entries})=>{
  step(true,0,4);step(false,0,4);assert.deepEqual(entries,[]);step(true);assert.deepEqual(entries,[event.id]);
});
check('unloaded ground stays inactive until a valid marker is built',({step,entries,setHeight})=>{
  setHeight(null);step(true);assert.deepEqual(entries,[]);setHeight(0);for(let i=0;i<12;i++)step(true);assert.deepEqual(entries,[event.id]);
});
check('removed events and disposal cannot activate a deferred entry',({markers,step,entries})=>{
  step(false);markers.setEvents([]);step(true);assert.deepEqual(entries,[]);markers.setEvents([event]);step(false);markers.destroy();step(true);assert.deepEqual(entries,[]);
});
report.passed=report.cases.every(value=>value.passed);
await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:report.passed,cases:report.cases.length,failures:report.cases.filter(value=>!value.passed)}));
if(!report.passed)process.exitCode=1;
