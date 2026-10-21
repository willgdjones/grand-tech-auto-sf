import { COASTLINE_MAX_VERTICES, type CoastlineData } from '../../../../shared/coastline';
import { difference, intersection } from './boolean';
import { clipSegment, openRing, ringArea, round, simplifyRing } from './geometry';
import { project, SF_FRAME } from './settings';
import type { Bounds, OsmExtract, Polygon, XZ } from './types';

const key = ([x,z]:XZ) => `${round(x)},${round(z)}`;
const same = (a:XZ,b:XZ) => key(a) === key(b);

/** Preserve source direction: OSM's land-left convention becomes water-left in +z-south coordinates.
 * Only the rectangle's boundary may close a clipped coast. Missing interior ways fail explicitly.
 */
export function coastlineRings(lines:readonly XZ[][],bounds:Bounds,toleranceM=2):XZ[][] {
  if(!bounds.every(Number.isFinite)||bounds[0]>=bounds[2]||bounds[1]>=bounds[3]||
    lines.some(line=>line.some(point=>point.some(n=>!Number.isFinite(n)))))throw new Error('Invalid coastline coordinates');
  const [x0,z0,x1,z1]=bounds, width=x1-x0, height=z1-z0, perimeter=2*(width+height);
  const boundary=(p:XZ):number|undefined=>{
    if(Math.abs(p[1]-z0)<.002)return p[0]-x0;
    if(Math.abs(p[0]-x1)<.002)return width+p[1]-z0;
    if(Math.abs(p[1]-z1)<.002)return width+height+x1-p[0];
    if(Math.abs(p[0]-x0)<.002)return 2*width+height+z1-p[1];
    return undefined;
  };
  const fragments:XZ[][]=[];
  for(const line of lines) {
    let part:XZ[]=[];
    const flush=()=>{if(part.length>1)fragments.push(part);part=[];};
    for(let i=1;i<line.length;i++) {
      const a=line[i-1]!,b=line[i]!,interval=clipSegment(a,b,bounds);
      if(!interval){flush();continue;}
      const point=(t:number):XZ=>[round(a[0]+(b[0]-a[0])*t),round(a[1]+(b[1]-a[1])*t)];
      const start=point(interval[0]),end=point(interval[1]);
      if(same(start,end))continue;
      if(part.length&&!same(part.at(-1)!,start))flush();
      if(!part.length)part.push(start);
      part.push(end);
      if(interval[1]<1)flush();
    }
    flush();
  }
  const starts=new Map<string,number>(),ends=new Set<string>();
  for(const [i,line] of fragments.entries()) {
    const start=key(line[0]!);
    if(starts.has(start))throw new Error(`Branching coastline at ${start}`);
    starts.set(start,i);ends.add(key(line.at(-1)!));
  }
  const pending=new Set(fragments.map((_,i)=>i)),closed:XZ[][]=[],open:XZ[][]=[];
  while(pending.size) {
    const first=[...pending].find(i=>!ends.has(key(fragments[i]![0]!)))??pending.values().next().value!;
    let current=first;
    const chain:XZ[]=[];
    while(pending.has(current)) {
      pending.delete(current);
      const line=fragments[current]!;chain.push(...(chain.length?line.slice(1):line));
      if(same(chain[0]!,chain.at(-1)!))break;
      const next=starts.get(key(chain.at(-1)!));
      if(next===undefined)break;
      if(!pending.has(next))throw new Error('Coastline rejoins an already consumed branch');
      current=next;
    }
    if(same(chain[0]!,chain.at(-1)!))closed.push(chain);
    else {
      if(boundary(chain[0]!)===undefined||boundary(chain.at(-1)!)===undefined)
        throw new Error('Incomplete coastline inside map bounds; refusing to invent a shore');
      open.push(chain);
    }
  }
  // Trace each water face: source shoreline, then clockwise rectangle boundary to the next coast.
  const shells:Polygon[]=closed.filter(r=>ringArea(r)>0).map(r=>[r]);
  const islands:Polygon[]=closed.filter(r=>ringArea(r)<0).map(r=>[r]);
  const corners:{at:number;point:XZ}[]=[{at:0,point:[x0,z0]},{at:width,point:[x1,z0]},
    {at:width+height,point:[x1,z1]},{at:2*width+height,point:[x0,z1]}];
  const unused=new Set(open.map((_,i)=>i));
  while(unused.size) {
    const first=unused.values().next().value!;let current=first;
    const ring:XZ[]=[];
    for(;;) {
      if(!unused.delete(current))throw new Error('Invalid coastline boundary topology');
      const line=open[current]!;ring.push(...line);
      const from=boundary(line.at(-1)!)!;
      const choices=open.map((chain,i)=>({i,delta:(boundary(chain[0]!)!-from+perimeter)%perimeter}))
        .sort((a,b)=>a.delta-b.delta||a.i-b.i);
      const next=choices[0]!;
      for(const corner of corners.map(c=>({...c,delta:(c.at-from+perimeter)%perimeter})).sort((a,b)=>a.delta-b.delta))
        if(corner.delta>.002&&corner.delta<next.delta-.002)ring.push(corner.point);
      ring.push(open[next.i]![0]!);
      if(next.i===first)break;
      current=next.i;
    }
    if(ringArea(ring)<=0)throw new Error('Coastline water face has reversed winding');
    shells.push([ring]);
  }
  const rectangle:Polygon=[[[x0,z0],[x1,z0],[x1,z1],[x0,z1],[x0,z0]]];
  // A bounded extract containing only offshore islands still has water around those islands.
  if(!shells.length&&islands.length)shells.push(rectangle);
  if(!shells.length)return [];
  const water=islands.length?difference(shells,islands):intersection(shells,rectangle);
  const rings=water.flatMap(polygon=>polygon.map(ring=>{
    const simplified=simplifyRing(openRing(ring),toleranceM).map(([x,z]):XZ=>[round(x),round(z)]);
    return [...simplified,simplified[0]!];
  }));
  if(rings.reduce((n,r)=>n+r.length,0)>COASTLINE_MAX_VERTICES)throw new Error('Coastline exceeds vertex budget');
  return rings;
}

export function buildCoastline(osm:OsmExtract,bounds:Bounds,sourceSha256:string):CoastlineData|undefined {
  const ways=osm.elements.filter(e=>e.type==='way'&&e.tags?.natural==='coastline').sort((a,b)=>a.id-b.id);
  if(!ways.length)return undefined;
  const lines=ways.map(way=>{
    if(!way.geometry||way.geometry.length<2)throw new Error(`Missing coastline geometry: ${way.id}`);
    return way.geometry.map(({lon,lat})=>{
      if(!Number.isFinite(lon)||!Number.isFinite(lat))throw new Error(`Invalid coastline geometry: ${way.id}`);
      return project(lon,lat);
    });
  });
  return {version:1,frame:SF_FRAME,units:'metres',bounds,rings:coastlineRings(lines,bounds),toleranceM:2,
    source:{label:'© OpenStreetMap contributors — ODbL; natural=coastline',sha256:sourceSha256,ways:ways.length}};
}
