import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { RoadGraph } from '../shared/roadgraph';
import { decodePackedRoadGraph, unpackRoadGraph } from '../shared/roadgraphPacked';
import { createLocationNameLookup } from '../web/src/render/chunks/locationNames';

// Finite real-source comparison at roadside positions on bridges and in tunnels.
const graphPath=resolve(process.argv[2]??'tools/map/out/lombard/roadgraph.json');
const graph:RoadGraph=graphPath.endsWith('.bin')
  ?unpackRoadGraph(decodePackedRoadGraph(await readFile(graphPath)))
  :JSON.parse(await readFile(graphPath,'utf8'));
const lookup=createLocationNameLookup(graph),samples:unknown[]=[],seenStreets=new Set<string>();
let inspected=0;
for(const edge of graph.edges as (RoadGraph['edges'][number]&{name?:string;kind?:string;bridge?:boolean;tunnel?:boolean})[]){
  if(!edge.name||seenStreets.has(edge.name)||edge.kind==='connector'||(!edge.bridge&&!edge.tunnel))continue;
  edgeSamples:for(let i=1;i<edge.points.length;i++){
    const a=edge.points[i-1]!,b=edge.points[i]!,dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz);if(length<1)continue;
    for(const t of [.25,.5,.75])for(const offset of [-3,-1.8,1.8,3]){
      inspected++;
      const x=a[0]+dx*t+dz/length*offset,z=a[2]+dz*t-dx/length*offset,y=a[1]+(b[1]-a[1])*t+.2;
      const before=lookup(x,z,20),after=lookup(x,z,20,y);
      if(before.street&&before.street!==edge.name&&after.street===edge.name){
        samples.push({edge:edge.id,sourceStreet:edge.name,bridge:!!edge.bridge,tunnel:!!edge.tunnel,position:{x,y,z},before,after});
        seenStreets.add(edge.name);break edgeSamples;
      }
    }
  }
  if(samples.length>=8)break;
}
assert.ok(samples.length,'Real stacked streets reproduce an incorrect planar label and a corrected level-aware label');
const output=resolve('artifacts/street-hud/height-aware-source.json');
await mkdir(dirname(output),{recursive:true});
const evidence={checkedAt:new Date().toISOString(),passed:true,scope:'Source lookup comparison, not a native drive or device/visual gate',graphPath,inspected,samples};
await writeFile(output,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence,null,2));
