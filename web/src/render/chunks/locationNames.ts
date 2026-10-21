import type { RoadGraph } from '@gtasf/shared/roadgraph';
import { INDEX_SLICE, runIndexSteps, runIndexStepsSliced } from './terrain';

type Point = [number, number];
type Bounds = [number, number, number, number];
export interface NeighbourhoodData {
  version: 1;
  neighbourhoods: { id: string; name: string; polygons: Point[][][] }[];
}
export interface LocationName {
  street: string | null;
  neighbourhood: string | null;
  osmWay: number | null;
  distanceM: number | null;
}
type Area = { name: string; polygon: Point[][] };
function grid<T>(size: number) {
  const cells = new Map<string, T[]>();
  return {
    add([x0,z0,x1,z1]: Bounds, value: T) {
      for (let x=Math.floor(x0/size);x<=Math.floor(x1/size);x++) for (let z=Math.floor(z0/size);z<=Math.floor(z1/size);z++) {
        const key=`${x}_${z}`, list=cells.get(key)??[]; list.push(value); cells.set(key,list);
      }
    },
    cell(x: number,z: number) { return cells.get(`${Math.floor(x/size)}_${Math.floor(z/size)}`)??[]; },
  };
}
function inside(ring: Point[],x: number,z: number): boolean {
  let hit=false;
  for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[j]!,b=ring[i]!,dx=b[0]-a[0],dz=b[1]-a[1];
    // Give shared boundary points a deterministic containing polygon, never a blank sliver.
    if (Math.abs((x-a[0])*dz-(z-a[1])*dx)<1e-7 && x>=Math.min(a[0],b[0]) && x<=Math.max(a[0],b[0]) && z>=Math.min(a[1],b[1]) && z<=Math.max(a[1],b[1])) return true;
    if ((a[1]>z)!==(b[1]>z) && x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0]) hit=!hit;
  }
  return hit;
}
/** Build once over the immutable map graph; HUD queries inspect nearby segments/polygons only. */
function* locationNameSteps(graph: RoadGraph, data?: NeighbourhoodData) {
  const areas=grid<Area>(256), step=64;
  // Reuse graph coordinates instead of retaining a boxed geometry object for
  // every named segment. Names are trimmed once per edge, not once per query.
  const names = new Array<string | undefined>(graph.edges.length);
  let capacity=0;
  for (let edgeId=0;edgeId<graph.edges.length;edgeId++) {
    if ((edgeId&INDEX_SLICE)===INDEX_SLICE) yield;
    const edge=graph.edges[edgeId]!, metadata=edge as typeof edge & { name?: string; kind?: string };
    const name=metadata.name?.trim();
    if (!name || metadata.kind==='connector') continue;
    names[edgeId]=name; capacity+=Math.max(0,edge.points.length-1);
  }
  const edgeIds=new Uint32Array(capacity), pointIds=new Uint32Array(capacity), stamps=new Uint32Array(capacity);
  const cells=new Map<number,Map<number,number[]>>();
  let count=0, stamp=0;
  for (let edgeId=0;edgeId<graph.edges.length;edgeId++) {
    if ((edgeId&INDEX_SLICE)===INDEX_SLICE) yield;
    if (!names[edgeId]) continue;
    const edge=graph.edges[edgeId]!;
    for (let i=1;i<edge.points.length;i++) {
      const a=edge.points[i-1]!,b=edge.points[i]!,dx=b[0]-a[0],dz=b[2]-a[2];
      if (!(dx*dx+dz*dz)) continue;
      const id=count++; edgeIds[id]=edgeId; pointIds[id]=i;
      for (let x=Math.floor(Math.min(a[0],b[0])/step);x<=Math.floor(Math.max(a[0],b[0])/step);x++) {
        let column=cells.get(x);
        if (!column) { column=new Map(); cells.set(x,column); }
        for (let z=Math.floor(Math.min(a[2],b[2])/step);z<=Math.floor(Math.max(a[2],b[2])/step);z++) {
          let cell=column.get(z);
          if (!cell) { cell=[]; column.set(z,cell); }
          cell.push(id);
        }
      }
    }
  }
  for (const area of [...(data?.neighbourhoods??[])].sort((a,b)=>a.id.localeCompare(b.id))) for (const polygon of area.polygons) {
    if (!polygon[0]?.length) continue;
    const ring=polygon[0];
    areas.add([Math.min(...ring.map(p=>p[0])),Math.min(...ring.map(p=>p[1])),Math.max(...ring.map(p=>p[0])),Math.max(...ring.map(p=>p[1]))],{name:area.name,polygon});
  }
  return (x: number,z: number,maxDistance=80,referenceY?: number): LocationName => {
    const result: LocationName={street:null,neighbourhood:null,osmWay:null,distanceM:null};
    if (!Number.isFinite(x+z) || !Number.isFinite(maxDistance) || maxDistance<=0) return result;
    const radius=Math.min(256,maxDistance); let best=radius*radius;
    stamp=(stamp+1)>>>0;
    if (!stamp) { stamps.fill(0); stamp=1; }
    // Match the original grid + Set insertion order at equal distances. Numeric
    // stamps de-duplicate crossing segments without allocating a query Set.
    for (let cx=Math.floor((x-radius)/step);cx<=Math.floor((x+radius)/step);cx++) {
      const column=cells.get(cx); if (!column) continue;
      for (let cz=Math.floor((z-radius)/step);cz<=Math.floor((z+radius)/step);cz++) {
        const cell=column.get(cz); if (!cell) continue;
        for (const id of cell) {
          if (stamps[id]===stamp) continue; stamps[id]=stamp;
          const edgeId=edgeIds[id]!, edge=graph.edges[edgeId]!, pointId=pointIds[id]!;
          const a=edge.points[pointId-1]!,b=edge.points[pointId]!,dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],length2=dx*dx+dz*dz;
          const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[2])*dz)/length2));
          // Allow curb/vehicle height, but never borrow another road deck's label.
          if (referenceY!==undefined && (!Number.isFinite(referenceY) || Math.abs(a[1]+dy*t-referenceY)>3)) continue;
          const distance2=(x-a[0]-dx*t)**2+(z-a[2]-dz*t)**2;
          if (distance2<best) {
            best=distance2; result.street=names[edgeId]!;
            result.osmWay=(edge as typeof edge & { osmWay?: number }).osmWay??null;
            result.distanceM=Math.sqrt(distance2);
          }
        }
      }
    }
    for (const area of areas.cell(x,z)) if (inside(area.polygon[0]!,x,z) && !area.polygon.slice(1).some(ring=>inside(ring,x,z))) {
      result.neighbourhood=area.name; break;
    }
    return result;
  };
}

export function createLocationNameLookup(graph: RoadGraph, data?: NeighbourhoodData) { return runIndexSteps(locationNameSteps(graph, data)); }
/** Sliced build for the post-READY full-graph swap (gtasf-0k01). */
export function createLocationNameLookupSliced(graph: RoadGraph, data: NeighbourhoodData | undefined, between: () => Promise<void>) {
  return runIndexStepsSliced(locationNameSteps(graph, data), between);
}
