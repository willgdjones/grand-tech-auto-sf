import type { Bounds, OsmCoordinate, OsmElement, OsmExtract, Polygon, Road, RoadPoint, Tags, XZ } from './types';
import { project } from './settings';
import { clipSegment, containsRing, openRing, round } from './geometry';

export function metric(value: string|undefined): number|undefined {
  if (!value) return;
  const match=/^\s*([\d.]+)\s*(m|metres?|meters?|ft|feet|')?\s*$/i.exec(value);
  if (!match) return;
  const n=Number(match[1])*(match[2]&&/ft|feet|'/.test(match[2])?0.3048:1);
  return Number.isFinite(n)&&n>0?n:undefined;
}
export function positiveInt(value:string|undefined,max=20):number|undefined {
  if(!value||!/^\d+$/.test(value))return;
  const n=Number(value);return n>0&&n<=max?n:undefined;
}
export function isDrivable(tags:Tags):boolean {
  if (!/^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|road)$/.test(tags.highway??''))return false;
  const access=tags.motorcar??tags.motor_vehicle??tags.vehicle??tags.access;
  return !['no','private','agricultural','forestry'].includes(access??'')&&tags.area!=='yes';
}
export interface Lanes { forward:number; backward:number; shared:boolean; inferred:boolean }
export function laneCounts(tags:Tags):Lanes {
  const one=tags.oneway==='-1'?-1:['yes','1','true'].includes(tags.oneway??'')||
    (tags.oneway!=='no'&&(tags.junction==='roundabout'||tags.highway==='motorway'))?1:0;
  const total=positiveInt(tags.lanes),f=positiveInt(tags['lanes:forward']),b=positiveInt(tags['lanes:backward']);
  if(one) return {forward:one>0?(total??f??1):0,backward:one<0?(total??b??1):0,shared:false,inferred:!total};
  const count=total??(f&&b?f+b:tags.highway==='service'?1:2);
  if(count===1&&!f&&!b)return {forward:1,backward:1,shared:true,inferred:!total};
  return {forward:f??Math.max(1,count-(b??Math.floor(count/2))),backward:b??Math.max(1,count-(f??Math.ceil(count/2))),shared:false,inferred:!total||(!f&&!b&&count%2!==0)};
}
export function roadWidth(tags:Tags):number {
  const explicit=metric(tags.width);
  if(explicit&&explicit<=80)return explicit;
  if(!isDrivable(tags))return tags.highway==='pedestrian'?5:2;
  const lanes=laneCounts(tags);
  return Math.max(3.2,(lanes.shared?1:lanes.forward+lanes.backward)*3.2);
}
function coordinate(point:OsmCoordinate):XZ {
  if(!point||!Number.isFinite(point.lon)||!Number.isFinite(point.lat))throw new Error('OSM geometry missing coordinates');
  return project(point.lon,point.lat);
}
export function extractRoads(osm:OsmExtract,bounds:Bounds):Road[] {
  const nodes=new Map(osm.elements.filter(e=>e.type==='node').map(e=>[e.id,e.tags??{}]));
  const result:Road[]=[];
  for(const way of osm.elements.filter(e=>e.type==='way'&&e.tags?.highway&&e.tags.area!=='yes').sort((a,b)=>a.id-b.id)) {
    if(!way.geometry||!way.nodes||way.nodes.length!==way.geometry.length)throw new Error(`Missing node geometry for road ${way.id}`);
    const points=way.geometry.map((p,i):RoadPoint=>{
      const [x,z]=coordinate(p),tags=nodes.get(way.nodes![i]!)??{};
      return {id:`osm:${way.nodes![i]}`,x,z,...(tags.highway==='traffic_signals'?{control:'signal' as const}:tags.highway==='stop'?{control:'stop' as const}:{}),
        ...(tags.highway==='give_way'?{yield:true}:{})};
    });
    let part:RoadPoint[]=[];let sequence=0;
    const flush=()=>{if(part.length>=2)result.push({id:`${way.id}:${sequence++}`,osmWay:way.id,tags:way.tags!,points:part,width:roadWidth(way.tags!)});part=[];};
    for(let i=1;i<points.length;i++) {
      const a=points[i-1]!,b=points[i]!;
      const interval=clipSegment([a.x,a.z],[b.x,b.z],bounds);
      if(!interval){flush();continue;}
      const [from,to]=interval;
      const interpolated=(t:number):RoadPoint=>t===0?a:t===1?b:{
        id:`boundary:${way.id}:${i}:${round(t)}`,x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t,
      };
      const start=interpolated(from),end=interpolated(to);
      if(part.length&&part.at(-1)!.id!==start.id)flush();
      if(!part.length)part.push(start);
      if(Math.hypot(part.at(-1)!.x-end.x,part.at(-1)!.z-end.z)>0.001)part.push(end);
      if(to<1)flush();
    }
    flush();
  }
  return result;
}
function stitch(parts:XZ[][]):XZ[][] {
  const pending=parts.map(p=>[...p]),rings:XZ[][]=[];
  const same=(a:XZ,b:XZ)=>Math.hypot(a[0]-b[0],a[1]-b[1])<0.001;
  while(pending.length) {
    const line=pending.shift()!;
    while(!same(line[0]!,line.at(-1)!)) {
      const i=pending.findIndex(p=>same(p[0]!,line.at(-1)!)||same(p.at(-1)!,line.at(-1)!));
      if(i<0)throw new Error('Unclosed OSM multipolygon');
      const next=pending.splice(i,1)[0]!;
      if(!same(next[0]!,line.at(-1)!))next.reverse();
      line.push(...next.slice(1));
    }
    if(line.length>=4)rings.push(openRing(line));
  }
  return rings;
}
export interface OsmPolygon {id:string;polygon:Polygon;tags:Tags}
export function extractPolygons(osm:OsmExtract,predicate:(tags:Tags)=>boolean,warnings:string[]):OsmPolygon[] {
  const result:OsmPolygon[]=[],members=new Set<number>();
  for(const e of osm.elements.filter(e=>e.type==='relation'&&predicate(e.tags??{})).sort((a,b)=>a.id-b.id)) {
    try {
      const parts=(role:string)=>e.members?.filter(m=>m.type==='way'&&(m.role===role||(role==='outer'&&m.role===''))).map(m=>{
        if(!m.geometry)throw new Error('Relation member has no geometry');
        return m.geometry.map(coordinate);
      })??[];
      const outer=stitch(parts('outer')),inner=stitch(parts('inner'));
      if(!outer.length)throw new Error('Relation has no outer rings');
      for(let i=0;i<outer.length;i++)result.push({id:`relation:${e.id}:${i}`,polygon:[outer[i]!,...inner.filter(h=>containsRing(outer[i]!,h[0]!))],tags:e.tags!});
      for(const m of e.members??[])if(m.type==='way')members.add(m.ref);
    }catch(error){warnings.push(`OSM relation ${e.id}: ${error instanceof Error?error.message:String(error)}`);}
  }
  for(const e of osm.elements.filter(e=>e.type==='way'&&predicate(e.tags??{})&&!members.has(e.id)).sort((a,b)=>a.id-b.id)) {
    if(!e.geometry||e.geometry.length<4||e.nodes?.[0]!==e.nodes?.at(-1))continue;
    result.push({id:`way:${e.id}`,polygon:[openRing(e.geometry.map(coordinate))],tags:e.tags!});
  }
  return result;
}
export function restrictions(osm:OsmExtract,warnings:string[]):{from:number;to:number;via:string;only:boolean}[] {
  const result:{from:number;to:number;via:string;only:boolean}[]=[];
  for(const relation of osm.elements.filter(e=>e.type==='relation'&&e.tags?.type==='restriction')) {
    const tags=relation.tags??{},members=relation.members??[];
    const restriction=tags['restriction:motorcar']??tags['restriction:motor_vehicle']??tags.restriction;
    if(!restriction||!(/^(no_|only_)/.test(restriction)))continue;
    if(tags.except?.split(';').some(v=>['motorcar','motor_vehicle','vehicle'].includes(v)))continue;
    const from=members.find(m=>m.role==='from'&&m.type==='way'),to=members.find(m=>m.role==='to'&&m.type==='way');
    const via=members.find(m=>m.role==='via'&&m.type==='node');
    if(!from||!to||!via){warnings.push(`Restriction ${relation.id} uses unsupported via-way topology`);continue;}
    result.push({from:from.ref,to:to.ref,via:`osm:${via.ref}`,only:restriction.startsWith('only_')});
  }
  return result;
}
