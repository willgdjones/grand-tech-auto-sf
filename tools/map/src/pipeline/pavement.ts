import { difference } from './boolean';
import { containsRing, openRing, overlaps, polygonBounds, ringArea, SpatialIndex } from './geometry';
import { extractPolygons, isDrivable } from './osm';
import { gradeSeparated } from './roads';
import type { OsmExtract, Polygon, Road, XZ } from './types';

export interface Pavement { polygon:Polygon; roadIds:string[] }

export function pavementSidewalkTags(road:Pick<Road,'id'|'tags'>,mappedRoads:ReadonlySet<string>):
  {sidewalk?:string;sidewalkLeft?:string;sidewalkRight?:string} {
  if(mappedRoads.has(road.id))return {sidewalk:'separate',sidewalkLeft:'separate',sidewalkRight:'separate'};
  return {
    ...(road.tags['sidewalk:both']||road.tags.sidewalk?{sidewalk:road.tags['sidewalk:both']??road.tags.sidewalk}:{}),
    ...(road.tags['sidewalk:left']?{sidewalkLeft:road.tags['sidewalk:left']}:{}),
    ...(road.tags['sidewalk:right']?{sidewalkRight:road.tags['sidewalk:right']}:{}),
  };
}

/** Land outside a street remains land even when a sidewalk network encloses it. */
export function pavementExclusions(osm:OsmExtract,warnings:string[]):Polygon[] {
  return extractPolygons(osm,t=>Boolean(t.building||t['building:part']||t.natural||t.leisure||
    /^(grass|forest|meadow|recreation_ground|cemetery|allotments|farmland|orchard|vineyard|brownfield)$/.test(t.landuse??'')),warnings)
    .map(p=>p.polygon);
}

/**
 * Closed faces of the mapped sidewalk/crossing network delimit paved streets.
 * An open/missing boundary produces no fill. Lane widths and road profiles are
 * deliberately not changed; neither a guessed buffer nor a block's convex hull
 * establishes where pavement exists.
 */
export function preparePavements(roads:Road[],excluded:Polygon[]=[]):Pavement[] {
  const points=new Map<string,XZ>(),links=new Map<string,Set<string>>();
  for(const road of roads) {
    if(gradeSeparated(road)||road.tags.highway!=='footway'||!['sidewalk','crossing'].includes(road.tags.footway??''))continue;
    for(let i=1;i<road.points.length;i++) {
      const a=road.points[i-1]!,b=road.points[i]!;
      if(a.id===b.id||Math.hypot(a.x-b.x,a.z-b.z)<0.001)continue;
      points.set(a.id,[a.x,a.z]);points.set(b.id,[b.x,b.z]);
      for(const [p,q] of [[a,b],[b,a]] as const) {
        const next=links.get(p.id)??new Set<string>();next.add(q.id);links.set(p.id,next);
      }
    }
  }
  const adjacent=new Map([...links].map(([id,values])=>{
    const a=points.get(id)!;
    return [id,[...values].sort((p,q)=>{
      const b=points.get(p)!,c=points.get(q)!;
      return Math.atan2(b[1]-a[1],b[0]-a[0])-Math.atan2(c[1]-a[1],c[0]-a[0])||p.localeCompare(q);
    })] as const;
  }));
  const samples=new SpatialIndex<{point:XZ;roadId:string}>(32);
  for(const road of roads) {
    if(gradeSeparated(road)||!isDrivable(road.tags)||road.tags.highway==='service')continue;
    for(let i=1;i<road.points.length;i++) {
      const a=road.points[i-1]!,b=road.points[i]!,steps=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/8));
      for(let j=0;j<steps;j++) {
        const t=(j+.5)/steps,point:XZ=[a.x+(b.x-a.x)*t,a.z+(b.z-a.z)*t];
        samples.add([point[0],point[1],point[0],point[1]],{point,roadId:road.id});
      }
    }
  }
  const protections=new SpatialIndex<Polygon>(64);
  for(const p of excluded)protections.add(polygonBounds(p),p);
  const visited=new Map<string,Set<string>>(),result:Pavement[]=[];
  for(const [start,neighbours] of adjacent)for(const next of neighbours) {
    let a=start,b=next;const ids:string[]=[];
    while(!visited.get(a)?.has(b)) {
      const seen=visited.get(a)??new Set<string>();seen.add(b);visited.set(a,seen);ids.push(a);
      const options=adjacent.get(b)!;
      // Keep the bounded face on the left of each directed edge.
      const c=options[(options.indexOf(a)+options.length-1)%options.length]!;a=b;b=c;
    }
    if(a!==start||b!==next||ids.length<3||new Set(ids).size!==ids.length)continue;
    const ring=ids.map(id=>points.get(id)!),area=ringArea(ring);
    // Negative faces are the unbounded exterior. Oversized/incomplete street
    // networks are left alone instead of paving a whole neighbourhood.
    if(area<1||area>12_000)continue;
    const bounds=polygonBounds([ring]);
    const roadIds=[...new Set(samples.query(bounds).filter(s=>containsRing(ring,s.point)).map(s=>s.roadId))].sort();
    if(!roadIds.length)continue;
    const holes=protections.query(bounds).filter(p=>overlaps(polygonBounds(p),bounds));
    const polygons=holes.length?difference([ring],...holes):[[ring]];
    for(const polygon of polygons) {
      const clean=polygon.map(openRing);
      if(clean[0]&&Math.abs(ringArea(clean[0]))>=.1)result.push({polygon:clean,roadIds});
    }
  }
  return result;
}
