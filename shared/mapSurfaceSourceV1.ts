/** GTCZ v1 source-surface generator. Pinned internal pipeline algorithms.
 * Do not change geometry, ordering, projection or boolean arithmetic in place;
 * a changed generator requires a new codec version. Only matching source faces
 * are selected, and generated-coordinate hashes reject dependency drift.
 * meshes.ts SHA-256 004f3ed187bc1591ff21bd9a77f51bf46b0030cb3c98ff56ce07d6acf40aedd0
 * geometry.ts SHA-256 d0b3956328dfca30f79aea945923589877c13f9f1e6242e83c6ff1118ae85c36
 * roads.ts SHA-256 b661a629f0c37a0e2b27b7a2906b7bb4866cf32cabc3f9977e05e0ee8381b55b
 * boolean.ts SHA-256 5defcad0b3184d7981daad2503278c995fd1cf5a873180eadecff075b14c536b
 */
import { ShapeUtils, Vector2 } from 'three';
import * as clipping from 'polyclip-ts';
import fast from 'polygon-clipping';
import type { Geom } from 'polyclip-ts';
export type XZ = [number, number];
export type XYZ = [number, number, number];
export type Bounds = readonly [number, number, number, number];
export type Polygon = XZ[][];
export type Tags = Record<string, string>;
export interface Road { id: string; width: number; tags: Tags; points: { id: string; x: number; z: number }[]; profile?: XYZ[] }
export interface HeightSampler { sample(x: number, z: number): number }
export interface Pavement { polygon: Polygon }
// Adapted from BDTS ground/boolean.ts. Overlapping ribbons repeatedly subtract near-collinear
// edges. A micrometre orientation tolerance prevents floating-point spikes at shared edges.
// Precision is scoped to one synchronous operation; it does not change source coordinates.
function operation(kind:'intersection'|'difference',first:Geom,rest:Geom[]) {
  // ENU conversion leaves sub-nanometre differences on otherwise straight source edges.
  // Snap boolean inputs to the same millimetre lattice used by the mesh writer.
  const snap=(value:Geom):Geom=>{
    const polygon=(p:[number,number][][])=>p.map(r=>r.map(([x,z]):[number,number]=>[Math.round(x*1000)/1000,Math.round(z*1000)/1000]));
    return typeof value[0]?.[0]?.[0]==='number'?polygon(value as [number,number][][]):(value as [number,number][][][]).map(polygon);
  };
  const snapped=snap(first),more=rest.map(snap);
  try{return fast[kind](snapped,...more);}catch {
    // The exact-decimal implementation is a bounded fallback for difficult topology, not the
    // hot path for hundreds of thousands of terrain cells on the shared build machine.
    clipping.setPrecision(1e-12);
    try{return clipping[kind](snapped,...more);}finally{clipping.setPrecision();}
  }
}
export const intersection=(first:Geom,...rest:Geom[])=>operation('intersection',first,rest);
export const difference=(first:Geom,...rest:Geom[])=>operation('difference',first,rest);

export const round = (v: number) => Math.round(v*1000)/1000 || 0;
export function polygonBounds(polygon: Polygon): Bounds {
  let minX=Infinity,minZ=Infinity,maxX=-Infinity,maxZ=-Infinity;
  for (const ring of polygon) for (const [x,z] of ring) {
    minX=Math.min(minX,x);minZ=Math.min(minZ,z);maxX=Math.max(maxX,x);maxZ=Math.max(maxZ,z);
  }
  return [minX,minZ,maxX,maxZ];
}
export function overlaps(a: Bounds,b: Bounds): boolean { return a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1]; }
export function ringArea(ring: XZ[]): number {
  let a=0;
  for (let i=0;i<ring.length;i++) { const p=ring[i]!,q=ring[(i+1)%ring.length]!;a+=p[0]*q[1]-q[0]*p[1]; }
  return a/2;
}
export function openRing(ring: XZ[]): XZ[] {
  const clean=ring.filter((p,i)=>i===0||p[0]!==ring[i-1]![0]||p[1]!==ring[i-1]![1]);
  if (clean.length>1&&clean[0]![0]===clean.at(-1)![0]&&clean[0]![1]===clean.at(-1)![1]) clean.pop();
  return clean;
}
export function containsRing(ring: XZ[],[x,z]: XZ): boolean {
  let inside=false;
  for (let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i]!,b=ring[j]!;
    if ((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0]) inside=!inside;
  }
  return inside;
}
export function contains(polygon: Polygon,point: XZ): boolean {
  return containsRing(polygon[0]!,point)&&!polygon.slice(1).some(ring=>containsRing(ring,point));
}
export class SpatialIndex<T> {
  private buckets=new Map<string,T[]>();
  constructor(readonly size=128) {}
  add(bounds:Bounds,value:T):void {
    for(let x=Math.floor(bounds[0]/this.size);x<=Math.floor(bounds[2]/this.size);x++)
      for(let z=Math.floor(bounds[1]/this.size);z<=Math.floor(bounds[3]/this.size);z++) {
        const key=`${x},${z}`,bucket=this.buckets.get(key)??[];bucket.push(value);this.buckets.set(key,bucket);
      }
  }
  query(bounds:Bounds):T[] {
    const result=new Set<T>();
    for(let x=Math.floor(bounds[0]/this.size);x<=Math.floor(bounds[2]/this.size);x++)
      for(let z=Math.floor(bounds[1]/this.size);z<=Math.floor(bounds[3]/this.size);z++)
        for(const value of this.buckets.get(`${x},${z}`)??[])result.add(value);
    return [...result];
  }
}

export function gradeSeparated(road:Road):boolean {
  return Boolean(road.tags.bridge&&road.tags.bridge!=='no')||Boolean(road.tags.tunnel&&road.tags.tunnel!=='no')||
    (Number.isFinite(Number(road.tags.layer))&&Number(road.tags.layer)!==0);
}

export function resample(points:XZ[],spacing:number):XZ[] {
  const result:XZ[]=[];
  for(let i=1;i<points.length;i++) {
    const a=points[i-1]!,b=points[i]!,steps=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/spacing));
    for(let j=0;j<steps;j++)result.push([a[0]+(b[0]-a[0])*j/steps,a[1]+(b[1]-a[1])*j/steps]);
  }
  if(points.length)result.push(points.at(-1)!);
  return result;
}
/** Positive offset is the driver's right; bounded miters keep Lombard hairpins finite. */
export function offsetPath(points:XZ[],offset:number):XZ[] {
  return points.map((p,i)=>{
    const before=points[Math.max(0,i-1)]!,after=points[Math.min(points.length-1,i+1)]!;
    const normal=(a:XZ,b:XZ):XZ=>{
      const dx=b[0]-a[0],dz=b[1]-a[1],length=Math.hypot(dx,dz)||1;return [-dz/length,dx/length];
    };
    const a=normal(i?before:p,i?p:after),b=normal(i<points.length-1?p:before,i<points.length-1?after:p);
    const length=Math.hypot(a[0]+b[0],a[1]+b[1]);
    const m:XZ=length>1e-6?[(a[0]+b[0])/length,(a[1]+b[1])/length]:b;
    const scale=Math.min(2,1/Math.max(0.1,m[0]*b[0]+m[1]*b[1]));
    return [p[0]+m[0]*offset*scale,p[1]+m[1]*offset*scale];
  });
}
export function surfaceHeight(road:Road,terrain:HeightSampler,x:number,z:number):number {
  if(road.profile) {
    let closest=Infinity,height=0;
    for(let i=1;i<road.profile.length;i++) {
      const a=road.profile[i-1]!,b=road.profile[i]!,dx=b[0]-a[0],dz=b[2]-a[2];
      const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[2])*dz)/(dx*dx+dz*dz||1)));
      const distance=(x-a[0]-dx*t)**2+(z-a[2]-dz*t)**2;
      if(distance<closest){closest=distance;height=a[1]+(b[1]-a[1])*t;}
    }
    return height+0.1;
  }
  if(gradeSeparated(road)) {
    // DEMs are bare earth. A separate deck profile avoids draping bridges into water/tunnels over hills.
    // End-point interpolation is a documented approximation until deck surveys are supplied.
    const a=road.points[0]!,b=road.points.at(-1)!,dx=b.x-a.x,dz=b.z-a.z;
    const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz||1)));
    return terrain.sample(a.x,a.z)*(1-t)+terrain.sample(b.x,b.z)*t+0.1;
  }
  return terrain.sample(x,z)+0.1;
}

export function isDrivable(tags:Tags):boolean {
  if (!/^(motorway|motorway_link|trunk|trunk_link|primary|primary_link|secondary|secondary_link|tertiary|tertiary_link|unclassified|residential|living_street|service|road)$/.test(tags.highway??''))return false;
  const access=tags.motorcar??tags.motor_vehicle??tags.vehicle??tags.access;
  return !['no','private','agricultural','forestry'].includes(access??'')&&tags.area!=='yes';
}

export type Colour=[number,number,number];
type Triangle=[XYZ,XYZ,XYZ];
export class MeshData {
  positions:number[]=[];normals:number[]=[];colours:number[]=[];indices:number[]=[];
  private vertices=new Map<string,number>();
  add([a,b,c]:Triangle,colour:Colour):void {
    const u=b.map((v,i)=>v-a[i]!) as XYZ,v=c.map((n,i)=>n-a[i]!) as XYZ;
    const normal:XYZ=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    const length=Math.hypot(...normal);if(length<1e-8)return;
    if(this.indices.length>=900_000)throw new Error('MAP_SURFACE_GENERATION_LIMIT');
    const norm=normal.map(n=>Math.round(n/length*127)) as XYZ;
    const rgb=colour.map(n=>Math.round(Math.max(0,Math.min(1,n))*255));
    for(const point of [a,b,c]) {
      const rounded=point.map(n=>Math.round(n*1000)/1000);
      const key=[...rounded,...norm,...rgb].join(',');let index=this.vertices.get(key);
      if(index===undefined){index=this.positions.length/3;this.vertices.set(key,index);this.positions.push(...rounded);this.normals.push(...norm);this.colours.push(...rgb);}
      this.indices.push(index);
    }
  }
}
function clippedTriangle(triangle:Triangle,bounds:Bounds):Triangle[] {
  let polygon:XYZ[]=[...triangle];
  for(const [axis,edge,greater] of [[0,bounds[0],true],[0,bounds[2],false],[2,bounds[1],true],[2,bounds[3],false]] as const) {
    const output:XYZ[]=[];
    for(let i=0;i<polygon.length;i++) {
      const a=polygon[i]!,b=polygon[(i+1)%polygon.length]!,insideA=greater?a[axis]>=edge:a[axis]<=edge,insideB=greater?b[axis]>=edge:b[axis]<=edge;
      if(insideA)output.push(a);
      if(insideA!==insideB){const t=(edge-a[axis])/(b[axis]-a[axis]);const p=a.map((n,k)=>n+(b[k]!-n)*t) as XYZ;p[axis]=edge;output.push(p);}
    }
    polygon=output;if(!polygon.length)return [];
  }
  const result:Triangle[]=[];for(let i=1;i<polygon.length-1;i++)result.push([polygon[0]!,polygon[i]!,polygon[i+1]!]);return result;
}
export function upward(a:XYZ,b:XYZ,c:XYZ):Triangle {
  return (b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2])>0?[a,b,c]:[a,c,b];
}
export function triangulate(polygon:Polygon,height:(x:number,z:number)=>number):Triangle[] {
  const rings=polygon.map(openRing),points=rings.flat();
  if(!rings[0]||rings[0].length<3)return [];
  const triangles=ShapeUtils.triangulateShape(rings[0].map(p=>new Vector2(...p)),rings.slice(1).map(r=>r.map(p=>new Vector2(...p))));
  return triangles.map(t=>{
    const p=t.map(i=>{const [x,z]=points[i]!;return [x,height(x,z),z] as XYZ;}) as Triangle;
    return upward(...p);
  });
}
export class ChunkMeshes {
  readonly chunks=new Map<string,{x:number;z:number;bounds:Bounds;terrain:MeshData;roads:MeshData;buildings:MeshData;structures:MeshData}>();
  constructor(readonly bounds:Bounds,readonly size=256) {
    for(let x=bounds[0]/size;x<bounds[2]/size;x++)for(let z=bounds[1]/size;z<bounds[3]/size;z++)
      this.chunks.set(`${x}_${z}`,{x,z,bounds:[x*size,z*size,(x+1)*size,(z+1)*size],terrain:new MeshData(),roads:new MeshData(),buildings:new MeshData(),structures:new MeshData()});
  }
  emit(kind:'roads'|'buildings'|'structures',triangle:Triangle,colour:Colour):void {
    const xs=triangle.map(p=>p[0]),zs=triangle.map(p=>p[2]);
    const minX=Math.max(this.bounds[0]/this.size,Math.floor(Math.min(...xs)/this.size));
    const maxX=Math.min(this.bounds[2]/this.size-1,Math.floor(Math.max(...xs)/this.size));
    const minZ=Math.max(this.bounds[1]/this.size,Math.floor(Math.min(...zs)/this.size));
    const maxZ=Math.min(this.bounds[3]/this.size-1,Math.floor(Math.max(...zs)/this.size));
    for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++) {
      const chunk=this.chunks.get(`${x}_${z}`)!;
      for(const clipped of clippedTriangle(triangle,chunk.bounds))chunk[kind].add(clipped,colour);
    }
  }
}
export interface Cut {polygon:Polygon}
export function addRoadMeshes(meshes:ChunkMeshes,roads:Road[],terrain:HeightSampler,lod:0|1,pavements:Pavement[]=[],coarse=false):SpatialIndex<Cut> {
  const cuts=new SpatialIndex<Cut>(32);
  const drawn=new Map<string,SpatialIndex<Cut>>();
  const driveNodes=new Set(roads.filter(r=>isDrivable(r.tags)&&!gradeSeparated(r)).flatMap(r=>r.points.map(p=>p.id)));
  // Crossing fill must yield to actual carriageways, including source ways with larger IDs.
  for(const road of [...roads].sort((a,b)=>Number(a.tags.footway==='crossing')-Number(b.tags.footway==='crossing'))) {
    const separated=gradeSeparated(road),tunnel=Boolean(road.tags.tunnel&&road.tags.tunnel!=='no');
    const key=separated?`${tunnel?'tunnel':'bridge'}:${road.tags.layer??'0'}`:'surface';
    const occupied=drawn.get(key)??new SpatialIndex<Cut>(32);drawn.set(key,occupied);
    const dense=resample(road.points.map(p=>[p.x,p.z]),coarse?12:road.tags.name==='Lombard Street'?1:lod===0?3:6);
    const left=offsetPath(dense,-road.width/2),right=offsetPath(dense,road.width/2);
    const crossing=road.tags.footway==='crossing';
    const rgb:Colour=road.tags.highway==='steps'||road.tags.highway==='footway'&&!crossing?[0.51,0.49,0.44]:road.tags.surface==='bricks'?[0.43,0.21,0.15]:[0.20,0.21,0.22];
    const islands:Polygon[]=[];
    if(crossing&&road.tags['crossing:island']==='yes'&&!separated)for(let i=1;i<road.points.length;i++) {
      const a=road.points[i-1]!,b=road.points[i]!;
      if(!driveNodes.has(a.id)||!driveNodes.has(b.id))continue;
      const line:XZ[]=[[a.x,a.z],[b.x,b.z]],l=offsetPath(line,-road.width/2),r=offsetPath(line,road.width/2);
      islands.push([[l[0]!,l[1]!,r[1]!,r[0]!]]);
    }
    for(let i=1;i<dense.length;i++) {
      const footprint:Polygon=[[left[i-1]!,left[i]!,right[i]!,right[i-1]!]];
      const bounds=polygonBounds(footprint);if(!overlaps(bounds,meshes.bounds))continue;
      const height=(x:number,z:number)=>separated?surfaceHeight(road,terrain,x,z):terrain.sample(x,z)+0.1;
      // Intersections and split-way joins must have one surface, not coplanar ribbons.
      const prior=occupied.query(bounds),visible=prior.length?difference(footprint,...prior.map(c=>c.polygon)):[footprint];
      for(const polygon of visible) {
        for(const part of islands.length?difference(polygon,...islands):[polygon])
          for(const triangle of triangulate(part,height))meshes.emit('roads',triangle,rgb);
        // Only the source-tagged refuge between carriageways is concrete, not
        // the pedestrian crossing across the traffic lanes.
        for(const island of islands)for(const part of intersection(polygon,island))
          for(const triangle of triangulate(part,height))meshes.emit('roads',triangle,[0.51,0.49,0.44]);
      }
      occupied.add(bounds,{polygon:footprint});
      if(!separated)cuts.add(bounds,{polygon:footprint});
      if(tunnel) {
        const [a,b,c,d]=footprint[0]!.map(([x,z]):XYZ=>[x,height(x,z),z]) as [XYZ,XYZ,XYZ,XYZ];
        const clearance=4.5,top=(p:XYZ):XYZ=>[p[0],p[1]+clearance,p[2]];
        // Open the terrain at both portal approaches; keep the hill above the bore.
        if([a,b,c,d].some(p=>terrain.sample(p[0],p[2])<p[1]+clearance))cuts.add(bounds,{polygon:footprint});
        const ta=top(a),tb=top(b),tc=top(c),td=top(d),wall:Colour=[0.36,0.36,0.33],ceiling:Colour=[0.23,0.24,0.24];
        // Paired winding gives the low-poly shell visible interior and exterior faces.
        for(const face of [[a,b,tb],[a,tb,ta],[d,td,tc],[d,tc,c],[ta,tb,tc],[ta,tc,td]] as Triangle[]) {
          const colour=face[0][1]>a[1]+clearance-0.1?ceiling:wall;
          meshes.emit('structures',face,colour);meshes.emit('structures',[face[2],face[1],face[0]],colour);
        }
      }
    }
  }
  for(const {polygon} of pavements) {
    const bounds=polygonBounds(polygon);if(!overlaps(bounds,meshes.bounds))continue;
    // A fixed grid at both LODs keeps new paving draped on the same contact
    // terrain, instead of spanning a hill with one large planar triangle.
    const step=4;
    for(let z=Math.floor(Math.max(bounds[1],meshes.bounds[1])/step)*step;z<Math.min(bounds[3],meshes.bounds[3]);z+=step)
      for(let x=Math.floor(Math.max(bounds[0],meshes.bounds[0])/step)*step;x<Math.min(bounds[2],meshes.bounds[2]);x+=step) {
        const cell:Polygon=[[[x,z],[x+step,z],[x+step,z+step],[x,z+step]]];
        const prior=cuts.query([x,z,x+step,z+step]);
        for(const part of intersection(polygon,cell))for(const visible of prior.length?difference(part,...prior.map(c=>c.polygon)):[part])
          for(const triangle of triangulate(visible,(px,pz)=>terrain.sample(px,pz)+.1))meshes.emit('roads',triangle,[.20,.21,.22]);
      }
    cuts.add(bounds,{polygon});
  }
  return cuts;
}
/** Use the same edge samples at both LODs so coarse neighbours cannot leave cracks. */
function seamTriangles(triangle:Triangle,bounds:Bounds,step:number,height:(x:number,z:number)=>number):Triangle[] {
  // Earcut removes collinear XZ vertices, even when their sampled heights differ.
  // Split after triangulation so every LOD retains the shared border profile.
  const ring=triangle.flatMap((a,i)=>{
    const b=triangle[(i+1)%3]!;
    const axis=a[0]===b[0]&&(a[0]===bounds[0]||a[0]===bounds[2])?2:
      a[2]===b[2]&&(a[2]===bounds[1]||a[2]===bounds[3])?0:undefined;
    if(axis===undefined)return [a];
    const points:XYZ[]=[a],from=Math.min(a[axis],b[axis]),to=Math.max(a[axis],b[axis]);
    for(let value=(Math.floor(from/step)+1)*step;value<to-1e-6;value+=step) {
      const p:XYZ=[...a];p[axis]=value;p[1]=height(p[0],p[2]);points.push(p);
    }
    return [a,...points.slice(1).sort((p,q)=>(p[axis]-q[axis])*Math.sign(b[axis]-a[axis]))];
  });
  if(ring.length===3)return [triangle];
  const x=triangle.reduce((sum,p)=>sum+p[0],0)/3,z=triangle.reduce((sum,p)=>sum+p[2],0)/3;
  const centre:XYZ=[x,height(x,z),z];
  return ring.map((a,i)=>upward(a,ring[(i+1)%ring.length]!,centre));
}
export function addTerrainMeshes(meshes:ChunkMeshes,terrain:HeightSampler,cuts:SpatialIndex<Cut>,step:number,seamStep=step,parks:Polygon[]=[],colourAt?:(x:number,z:number,underwater:boolean)=>Colour):void {
  for(const chunk of meshes.chunks.values()) {
    const [x0,z0,x1,z1]=chunk.bounds;
    for(let z=z0;z<z1;z+=step)for(let x=x0;x<x1;x+=step) {
      const cell:Polygon=[[[x,z],[x,z+step],[x+step,z+step],[x+step,z]]];
      const holes=cuts.query([x,z,x+step,z+step]);
      const polygons=holes.length?difference(cell,...holes.map(h=>h.polygon)):[cell];
      const height=(px:number,pz:number)=>Math.round(terrain.sample(px,pz)*100)/100;
      for(const polygon of polygons)for(const source of triangulate(polygon,height))for(const triangle of seamTriangles(source,chunk.bounds,seamStep,height)) {
        const mean=triangle.reduce((sum,p)=>sum+p[1],0)/3;
        // Vivid SF pass (pane 9, founder): deep-blue bay for underwater triangles; a richer green on
        // park/grass landuse (so parks read distinct from the golden-olive October hillside ground);
        // golden-olive default elsewhere. Non-park land is byte-identical to before. Linear vertex
        // colours, never gamma-decoded.
        let colour:Colour;
        if(colourAt)colour=colourAt(triangle.reduce((sum,p)=>sum+p[0],0)/3,triangle.reduce((sum,p)=>sum+p[2],0)/3,mean<0);
        else if(mean<0) colour=[0.10,0.23,0.41];
        else {
          const cx=(triangle[0][0]+triangle[1][0]+triangle[2][0])/3, cz=(triangle[0][2]+triangle[1][2]+triangle[2][2])/3;
          colour=parks.length&&parks.some(poly=>contains(poly,[cx,cz]))?[0.26,0.42,0.21]:[0.38,0.43,0.28];
        }
        chunk.terrain.add(triangle,colour);
      }
    }
  }
}

// Pinned SF projection from tools/map/src/geo.ts; E7 is used only when exactly reversible.
/** WGS84 horizontal geometry. Building height is independent of tangent-plane up. */
export type Vec3 = readonly [number, number, number];
export type Point2 = [number, number];
export interface Geodetic {
  lat: number;
  lon: number;
  h?: number;
}
export interface WorldFrame {
  origin: Geodetic;
  gridRotationDeg: number;
}
export const WGS84_A = 6_378_137;
export const WGS84_F = 1 / 298.257223563;
const E2 = WGS84_F * (2 - WGS84_F);
const RAD = Math.PI / 180;
export const US_SURVEY_FOOT_M = 1200 / 3937;

function finite(...values: number[]): void {
  if (values.some((v) => !Number.isFinite(v))) throw new Error('GEO_NONFINITE');
}
export function geodeticToEcef(latDeg: number, lonDeg: number, h = 0): Vec3 {
  finite(latDeg, lonDeg, h);
  if (Math.abs(latDeg) > 90 || Math.abs(lonDeg) > 180) throw new Error('GEO_RANGE');
  const phi = latDeg * RAD,
    lambda = lonDeg * RAD;
  const sin = Math.sin(phi),
    cos = Math.cos(phi);
  const n = WGS84_A / Math.sqrt(1 - E2 * sin * sin);
  return [(n + h) * cos * Math.cos(lambda), (n + h) * cos * Math.sin(lambda), (n * (1 - E2) + h) * sin];
}
export function ecefToGeodetic([x, y, z]: Vec3): Required<Geodetic> {
  finite(x, y, z);
  const p = Math.hypot(x, y);
  if (p === 0) {
    if (z === 0) throw new Error('GEO_EARTH_CENTRE');
    return { lat: Math.sign(z) * 90, lon: 0, h: Math.abs(z) - WGS84_A * (1 - WGS84_F) };
  }
  let phi = Math.atan2(z, p * (1 - E2));
  for (let i = 0; i < 20; i++) {
    const sin = Math.sin(phi),
      n = WGS84_A / Math.sqrt(1 - E2 * sin * sin);
    const next = Math.atan2(z + E2 * n * sin, p);
    if (Math.abs(next - phi) < 1e-14) {
      phi = next;
      break;
    }
    phi = next;
    if (i === 19) throw new Error('GEO_INVERSE_DID_NOT_CONVERGE');
  }
  const sin = Math.sin(phi),
    cos = Math.cos(phi);
  const n = WGS84_A / Math.sqrt(1 - E2 * sin * sin);
  const h = Math.abs(cos) > 0.5 ? p / cos - n : z / sin - n * (1 - E2);
  return { lat: phi / RAD, lon: Math.atan2(y, x) / RAD, h };
}
function basis(origin: Geodetic) {
  const phi = origin.lat * RAD,
    lambda = origin.lon * RAD;
  const sinPhi = Math.sin(phi),
    cosPhi = Math.cos(phi),
    sinLambda = Math.sin(lambda),
    cosLambda = Math.cos(lambda);
  return { o: geodeticToEcef(origin.lat, origin.lon, origin.h ?? 0), sinPhi, cosPhi, sinLambda, cosLambda };
}
export function ecefToEnu(point: Vec3, origin: Geodetic): Vec3 {
  finite(...point);
  const { o, sinPhi: s, cosPhi: c, sinLambda: sl, cosLambda: cl } = basis(origin);
  const dx = point[0] - o[0],
    dy = point[1] - o[1],
    dz = point[2] - o[2];
  return [-sl * dx + cl * dy, -s * cl * dx - s * sl * dy + c * dz, c * cl * dx + c * sl * dy + s * dz];
}
export function enuToEcef([e, n, u]: Vec3, origin: Geodetic): Vec3 {
  finite(e, n, u);
  const { o, sinPhi: s, cosPhi: c, sinLambda: sl, cosLambda: cl } = basis(origin);
  return [
    o[0] - sl * e - s * cl * n + c * cl * u,
    o[1] + cl * e - s * sl * n + c * sl * u,
    o[2] + c * n + s * u,
  ];
}
export function enuToWorld(e: number, n: number, gridRotationDeg: number): Point2 {
  finite(e, n, gridRotationDeg);
  const theta = gridRotationDeg * RAD,
    c = Math.cos(theta),
    s = Math.sin(theta);
  return [e * c - n * s, -(e * s + n * c)];
}
export function worldToEnu(x: number, z: number, gridRotationDeg: number): Point2 {
  finite(x, z, gridRotationDeg);
  const theta = gridRotationDeg * RAD,
    c = Math.cos(theta),
    s = Math.sin(theta);
  return [x * c - z * s, -x * s - z * c];
}
export function geodeticToWorld(lat: number, lon: number, frame: WorldFrame): Point2 {
  const [e, n] = ecefToEnu(geodeticToEcef(lat, lon), frame.origin);
  return enuToWorld(e, n, frame.gridRotationDeg);
}

export const surfaceSourceProject = (lon: number, lat: number): XZ => geodeticToWorld(lat, lon, { origin: { lat: 37.7842, lon: -122.4078 }, gridRotationDeg: 0 });
