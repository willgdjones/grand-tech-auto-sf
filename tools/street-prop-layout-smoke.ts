import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { RoadGraph } from '../shared/roadgraph';
import { decodePackedRoadGraph, unpackRoadGraph } from '../shared/roadgraphPacked';
import { createRoadSampler } from '../web/src/render/chunks/terrain';
import { createStreetPropLayout } from '../web/src/render/props/layout';

// One finite placement smoke: actual source controls and road clearance, then the
// same straight road inside/outside the authored corridor to check sparse density.
const graphPath=resolve(process.argv.slice(2).find(value=>!value.startsWith('--'))??'tools/map/out/lombard/roadgraph.json');
const artifact=process.argv.includes('--meters-only')?'parking-meters':process.argv.includes('--controls-only')?'stop-signs':'street-props';
const output=resolve(process.argv.find(value=>value.startsWith('--output='))?.slice('--output='.length)??`artifacts/${artifact}/layout-smoke.json`);
const graph:RoadGraph=graphPath.endsWith('.bin')
  ?unpackRoadGraph(decodePackedRoadGraph(await readFile(graphPath)))
  :JSON.parse(await readFile(graphPath,'utf8'));
const roadAt=createRoadSampler(graph),layout=await createStreetPropLayout(graph,{roadHeightAt:roadAt});
const sites=[...layout.cells.values()].flatMap(cell=>cell.sites),wires=[...layout.cells.values()].flatMap(cell=>cell.wires);
const nodes=new Map(graph.nodes.map(node=>[node.id,node])),edges=new Map(graph.edges.map(edge=>[edge.id,edge]));
assert.equal(typeof layout.nearby,'function','Awaited layout exposes the runtime query');
assert.ok(sites.length>100,'Real map has visible candidate coverage');
for(const site of sites){
  assert.ok([site.x,site.y,site.z,site.yaw].every(Number.isFinite));
  assert.equal(roadAt(site.x,site.z),null,`${site.kind} must be outside every source ground lane`);
  if(site.kind==='light'){
    const source=nodes.get(site.signalNodeId!) as (RoadGraph['nodes'][number]&{osmNode?:string})|undefined;
    assert.equal(source?.control,'signal','Every traffic light has a real signal source');
    assert.equal(site.signalJunction,source?.osmNode??source?.id,'Lamps retain the authoritative source junction phase');
    assert.equal(edges.get(site.sourceEdgeId!)?.to,site.signalNodeId,'Mast arm belongs to that incoming approach');
  }else assert.equal(site.signalNodeId,undefined);
  if(site.kind==='trafficStop'){
    assert.equal(nodes.get(site.stopNodeId!)?.control,'stop','Every STOP sign has a real source stop control');
    assert.equal(edges.get(site.sourceEdgeId!)?.to,site.stopNodeId,'STOP sign belongs to that incoming approach');
    const edge=edges.get(site.sourceEdgeId!)!,end=edge.points.at(-1)!,before=edge.points.at(-2)!;
    const dx=end[0]-before[0],dz=end[2]-before[2],length=Math.hypot(dx,dz);
    assert.ok((-dx*Math.sin(site.yaw)-dz*Math.cos(site.yaw))/length>.999,'STOP face points at incoming drivers');
    const upstream=((end[0]-site.x)*dx+(end[2]-site.z)*dz)/length;
    assert.ok(upstream>=1.9&&upstream<=7.1,'STOP sign stays just upstream of its source intersection');
  }else assert.equal(site.stopNodeId,undefined);
}
assert.ok(layout.counts.signals>0);
assert.ok(layout.counts.stopSigns>0,'Real stop-controlled streets have sign placements');
assert.ok(layout.counts.parkingMeters>0,'Named source streets have fictional curbside meters');
const muniByStreet=wires.filter(wire=>wire.muni).reduce<Record<string,number>>((counts,wire)=>{
  counts[wire.a.street]=(counts[wire.a.street]??0)+1;return counts;
},{});
for(const name of ['Columbus Avenue','Stockton Street'])assert.ok((muniByStreet[name]??0)>0,`${name} has overhead spans`);
assert.ok(wires.some(wire=>wire.crossStreet),'Sagging power spans also cross streets');

function straightRoad(offset:number):RoadGraph {
  const edges:(RoadGraph['edges'][number]&{name:string})[]=[
    {id:'road',from:'a',to:'b',lane:0,lengthM:1000,speedMps:12,points:[[offset,2,-1450],[1000+offset,2,-1450]],name:'The Embarcadero'},
  ];
  return {version:1,nodes:[{id:'a',x:0+offset,y:2,z:-1450},{id:'b',x:1000+offset,y:2,z:-1450}],
    edges};
}
const dense=await createStreetPropLayout(straightRoad(0)),sparse=await createStreetPropLayout(straightRoad(4000));
const countPoles=(value:typeof layout)=>[...value.cells.values()].flatMap(cell=>cell.sites).filter(site=>site.kind==='pole').length;
const densePoles=countPoles(dense),sparsePoles=countPoles(sparse);
// Detail companions can suppress a later pole through the shared crowding guard.
// Compare the complete dressing, while still requiring a sparser support network.
assert.ok(sparsePoles>0&&sparsePoles<densePoles,`Outer-city poles remain sparser (${sparsePoles} vs ${densePoles})`);
assert.ok(sparse.siteCount<dense.siteCount*.7,`Outer-city furniture remains lower density (${sparse.siteCount} vs ${dense.siteCount})`);
assert.ok(dense.counts.route>0&&sparse.counts.city>0);

const evidence={checkedAt:new Date().toISOString(),passed:true,scope:'Source placement and density smoke; no render, frame-rate or device acceptance',graphPath,
  graph:{nodes:graph.nodes.length,edges:graph.edges.length,sourceSignals:graph.nodes.filter(node=>node.control==='signal').length,sourceStops:graph.nodes.filter(node=>node.control==='stop').length},
  counts:layout.counts,sites:layout.siteCount,muniByStreet,densityComparison:{densePolesPerKm:densePoles,sparsePolesPerKm:sparsePoles,densePropsPerKm:dense.siteCount,sparsePropsPerKm:sparse.siteCount},
  signalSamples:sites.filter(site=>site.kind==='light').slice(0,6),stopSamples:sites.filter(site=>site.kind==='trafficStop').slice(0,6)};
await mkdir(dirname(output),{recursive:true});
await writeFile(output,JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify(evidence,null,2));
