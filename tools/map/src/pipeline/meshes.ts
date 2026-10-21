import { ShapeUtils, Vector2 } from 'three';
import { difference, intersection } from './boolean';
import type { Document } from '@gltf-transform/core';
import { newDocument, writeGlb } from '../glb';
import type { Bounds, Building, HeightSampler, Polygon, Road, XYZ, XZ } from './types';
import { gradeSeparated, offsetPath, resample, surfaceHeight } from './roads';
import { contains, openRing, overlaps, polygonBounds, simplifyRing, SpatialIndex } from './geometry';
import type { Pavement } from './pavement';
import { project } from './settings';
import { isDrivable } from './osm';
import { createTerrainDraper, type DrapeVertex } from '@gtasf/shared/terrainDrape';

export type Colour=[number,number,number];
type Triangle=[XYZ,XYZ,XYZ];
export class MeshData {
  positions:number[]=[];normals:number[]=[];colours:number[]=[];indices:number[]=[];
  private vertices=new Map<string,number>();
  /** Position+colour -> first vertex there, for `shareExisting` adds. */
  private byPosition=new Map<string,number>();
  /** `shareExisting`: reuse any existing vertex at the same position+colour whatever its normal (hairline join
   *  faces, gtasf-8hr5); new vertices get the up normal. The face geometry is unchanged either way. */
  /** `shape`: take the normal from this triangle instead (lifted coarse roads keep their DEM normals and sharing). */
  add([a,b,c]:Triangle,colour:Colour,shareExisting=false,shape?:Triangle):void {
    const [sa,sb,sc]=shape??[a,b,c],u=sb.map((v,i)=>v-sa[i]!) as XYZ,v=sc.map((n,i)=>n-sa[i]!) as XYZ;
    const normal:XYZ=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
    const length=Math.hypot(...normal);if(length<1e-8)return;
    const norm=(shareExisting?[0,1,0]:normal.map(n=>n/length)).map(n=>Math.round(n*127)) as XYZ;
    const rgb=colour.map(n=>Math.round(Math.max(0,Math.min(1,n))*255));
    for(const point of [a,b,c]) {
      const rounded=point.map(n=>Math.round(n*1000)/1000),at=[...rounded,...rgb].join(',');
      const key=[...rounded,...norm,...rgb].join(',');let index=shareExisting?this.byPosition.get(at)??this.vertices.get(key):this.vertices.get(key);
      if(index===undefined){index=this.positions.length/3;this.vertices.set(key,index);if(!this.byPosition.has(at))this.byPosition.set(at,index);this.positions.push(...rounded);this.normals.push(...norm);this.colours.push(...rgb);}
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
  emit(kind:'roads'|'buildings'|'structures',triangle:Triangle,colour:Colour,shape?:Triangle):void {
    const xs=triangle.map(p=>p[0]),zs=triangle.map(p=>p[2]);
    const minX=Math.max(this.bounds[0]/this.size,Math.floor(Math.min(...xs)/this.size));
    const maxX=Math.min(this.bounds[2]/this.size-1,Math.floor(Math.max(...xs)/this.size));
    const minZ=Math.max(this.bounds[1]/this.size,Math.floor(Math.min(...zs)/this.size));
    const maxZ=Math.min(this.bounds[3]/this.size-1,Math.floor(Math.max(...zs)/this.size));
    for(let x=minX;x<=maxX;x++)for(let z=minZ;z<=maxZ;z++) {
      const chunk=this.chunks.get(`${x}_${z}`)!;
      for(const clipped of clippedTriangle(triangle,chunk.bounds))chunk[kind].add(clipped,colour,false,shape);
    }
  }
}
export interface Cut {polygon:Polygon}
export function addRoadMeshes(meshes:ChunkMeshes,roads:Road[],terrain:HeightSampler,lod:0|1,pavements:Pavement[]=[],coarse=false,drapeStep=0,uncutGroundStep=0):SpatialIndex<Cut> {
  // Coarse chunks without terrain cuts draw the ground on an uncut uncutGroundStep grid. On concave slopes
  // (Powell at Sutter) that grid's chords rise up to ~0.7 m above the DEM and bury the +0.1 m road, which reads as a
  // dark sunken pit. Lift road vertices to the drawn grid surface too: the same cm-rounded 32 m samples as the chunk's
  // collision heightfield (players and cars already stand on it).
  const groundAt=(x:number,z:number)=>Math.round(terrain.sample(x,z)*100)/100;
  const uncutGround=(x:number,z:number)=>{
    const s=uncutGroundStep,i=Math.floor(x/s),j=Math.floor(z/s),u=x/s-i,v=z/s-j;
    const a=groundAt(i*s,j*s),b=groundAt((i+1)*s,j*s),c=groundAt(i*s,(j+1)*s),d=groundAt((i+1)*s,(j+1)*s);
    // The uncut grid cell triangulates on its (x,z+s)-(x+s,z) diagonal; follow that drawn plane, not bilinear.
    return Math.max(terrain.sample(x,z),u+v<=1?a+u*(b-a)+v*(c-a):d+(1-u)*(c-d)+(1-v)*(b-d));
  };
  const surface=uncutGroundStep>0?uncutGround:(x:number,z:number)=>terrain.sample(x,z);
  // graphicsV2 phase 2: split surface roads on a terrain grid so they follow hills between samples.
  const draper=drapeStep>0&&!coarse?createTerrainDraper(drapeStep,(x,z)=>terrain.sample(x,z)):undefined;
  const emitRoad=(triangle:Triangle,colour:Colour,draped:boolean,shape?:Triangle)=>{
    if(!draper||!draped){meshes.emit('roads',triangle,colour,shape);return;}
    draper.triangle([[...triangle[0]],[...triangle[1]],[...triangle[2]]] as [DrapeVertex,DrapeVertex,DrapeVertex],.1,(a,b,c)=>meshes.emit('roads',upward([a[0],a[1],a[2]],[b[0],b[1],b[2]],[c[0],c[1],c[2]]),colour));
  };
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
      const height=(x:number,z:number)=>separated?surfaceHeight(road,terrain,x,z):surface(x,z)+0.1;
      // Lifted triangles take the DEM triangle's normal: per-face normals of the lifted kinks would split shared
      // vertices (+24-55% road vertices per coarse chunk, +1.25 MB citywide).
      const lifted=uncutGroundStep>0&&!separated;
      const faces=(part:Polygon)=>{const shapes=lifted?triangulate(part,(x,z)=>terrain.sample(x,z)+0.1):[];return triangulate(part,height).map((t,i)=>[t,shapes[i]] as const);};
      // Intersections and split-way joins must have one surface, not coplanar ribbons.
      const prior=occupied.query(bounds),visible=prior.length?difference(footprint,...prior.map(c=>c.polygon)):[footprint];
      for(const polygon of visible) {
        for(const part of islands.length?difference(polygon,...islands):[polygon])
          for(const [triangle,shape] of faces(part))emitRoad(triangle,rgb,!separated,shape);
        // Only the source-tagged refuge between carriageways is concrete, not
        // the pedestrian crossing across the traffic lanes.
        for(const island of islands)for(const part of intersection(polygon,island))
          for(const [triangle,shape] of faces(part))emitRoad(triangle,[0.51,0.49,0.44],!separated,shape);
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
function simplifiedPolygon(polygon:Polygon,tolerance:number):Polygon {
  const result=polygon.map(r=>simplifyRing(r,tolerance));
  // Roof triangulation below checks area and falls back to the source rings if simplification fails.
  return result;
}
/** MAP_COARSE_SMALL_BBOXES='w,s,e,n;...' (lon/lat): limit MAP_COARSE_SMALL to those areas (e.g. residential tour districts,
 *  to stay inside the citywide payload budget). Unset: the whole city. */
let smallAreas: Bounds[] | null | undefined;
function inSmallBuildingAreas([x, z]: XZ): boolean {
  if (smallAreas === undefined) {
    smallAreas = process.env.MAP_COARSE_SMALL_BBOXES ? process.env.MAP_COARSE_SMALL_BBOXES.split(';').map(box => {
    const parts = box.split(',').map(Number);
    // A typo must fail the bake loudly, not silently keep no small buildings anywhere (1.0 review of 09d7a6db).
    if (parts.length !== 4 || !parts.every(Number.isFinite)) throw new Error(`MAP_COARSE_SMALL_BBOXES: bad box '${box}' (want w,s,e,n in lon/lat)`);
    const [w, s, e, n] = parts as [number, number, number, number]; const [x0, z0] = project(w, n), [x1, z1] = project(e, s);
    return [Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)] as Bounds;
  }) : null;
    // Once, at first use (4c7ea616 logged on every building check: ~185k lines per city bake).
    if (smallAreas) console.log(`MAP_COARSE_SMALL areas (world m): ${JSON.stringify(smallAreas.map(b => b.map(Math.round)))}`);
  }
  return !smallAreas || smallAreas.some(([x0, z0, x1, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1);
}
export function addBuildings(meshes:ChunkMeshes,buildings:Building[],lod:0|1,coarse=false,retained:ReadonlySet<string>=new Set()):void {
  // Aggressive visual LOD outside the detail corridor (gtasf-o0cb whole-city 25 MB budget): coarser
  // footprints and dropped tiny structures. Collision stays at source detail (build.ts), so only the
  // distant visual rings change; the 2.5 m tolerance is fine far from the player. Detail-corridor lod1
  // keeps the 0.25 m tolerance (below the 0.5 m road-clearance margin); lod0 stays full.
  for(const building of buildings) {
    // Selected district frontages keep the same footprint as their collision, including road clearance.
    const keep=retained.has(building.id),tolerance=keep?0:coarse?4:lod===1?0.25:0;
    if(coarse&&!keep) {
      const r=building.polygon[0]!;
      const footprint=Math.abs(r.reduce((sum,a,i)=>{const b=r[(i+1)%r.length]!;return sum+a[0]*b[1]-b[0]*a[1];},0)/2);
      // gtasf-tdbw: MAP_COARSE_SMALL=1 keeps small footprints (>= 40 m^2: rowhouses, Victorians) as the same 4 m-simplified
      // boxes instead of dropping them, so residential blocks aren't near-empty; measured against the payload budget.
      const keepSmall=process.env.MAP_COARSE_SMALL==='1'&&footprint>=40&&inSmallBuildingAreas(r[0]!);
      if(footprint<400&&!keepSmall)continue; // only sizeable buildings survive at coarse range: they carry the skyline, while the mass of small footprints (which dominate glb size) is dropped
    }
    const polygon=tolerance?simplifiedPolygon(building.polygon,tolerance):building.polygon;
    const roof=building.base+building.height;
    const emitRoof=(p:Polygon)=>{
      const triangles=triangulate(p,()=>roof);
      const area=(ring:XZ[])=>Math.abs(ring.reduce((sum,a,i)=>{const b=ring[(i+1)%ring.length]!;return sum+a[0]*b[1]-b[0]*a[1];},0)/2);
      const expected=area(p[0]!)-p.slice(1).reduce((s,r)=>s+area(r),0);
      const actual=triangles.reduce((sum,[a,b,c])=>sum+Math.abs((b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]))/2,0);
      if(Math.abs(expected-actual)>Math.max(0.01,expected*1e-5))return false;
      for(const triangle of triangles)meshes.emit('buildings',triangle,building.colour.map(c=>c*0.84) as Colour);
      return true;
    };
    let selected=polygon;
    if(!emitRoof(polygon)) {
      selected=building.polygon;
      if(!emitRoof(selected))throw new Error(`Building roof cannot be triangulated: ${building.id}`);
    }
    for(const [r,ring] of selected.entries()) {
      const area=ring.reduce((sum,a,i)=>{const b=ring[(i+1)%ring.length]!;return sum+a[0]*b[1]-b[0]*a[1];},0);
      const points=(r===0?area<0:area>0)?ring:[...ring].reverse();
      for(let i=0;i<points.length;i++) {
        const a=points[i]!,b=points[(i+1)%points.length]!;
        const bottomA:XYZ=[a[0],building.foundation,a[1]],bottomB:XYZ=[b[0],building.foundation,b[1]],topA:XYZ=[a[0],roof,a[1]],topB:XYZ=[b[0],roof,b[1]];
        meshes.emit('buildings',[bottomA,bottomB,topB],building.colour);
        meshes.emit('buildings',[bottomA,topB,topA],building.colour);
      }
    }
    if(building.roofShape)emitLidarRoof(meshes,building,polygon,roof);
  }
}
/** gtasf-6w9a: LiDAR roof extras (visual only): parapet / false-front walls, gable cap, upper stepped tier. */
function emitLidarRoof(meshes:ChunkMeshes,building:Building,polygon:Polygon,roof:number):void {
  const s=building.roofShape!,ring=polygon[0]!,trim=building.colour.map(c=>Math.min(1,c*1.12)) as Colour,cap=[0.48,0.47,0.46] as Colour;
  const wall=(a:XZ,b:XZ,y0:number,y1:number,c:Colour)=>{
    const A:XYZ=[a[0],y0,a[1]],B:XYZ=[b[0],y0,b[1]],C:XYZ=[b[0],y1,b[1]],D:XYZ=[a[0],y1,a[1]];
    meshes.emit('buildings',[A,B,C],c);meshes.emit('buildings',[A,C,D],c);meshes.emit('buildings',[A,C,B],c);meshes.emit('buildings',[A,D,C],c);
  };
  if(s.type==='flat-parapet'&&s.parapet&&s.parapet>s.h+0.3)
    for(let i=0;i<ring.length;i++)wall(ring[i]!,ring[(i+1)%ring.length]!,roof,building.base+s.parapet,trim);
  if(s.type==='gable'&&s.ridge&&s.axis!==undefined&&s.ridge>s.h+0.5) {
    const ux=Math.cos(s.axis),uz=Math.sin(s.axis),cx=ring.reduce((t,p)=>t+p[0],0)/ring.length,cz=ring.reduce((t,p)=>t+p[1],0)/ring.length;
    const a=ring.map(([x,z])=>(x-cx)*ux+(z-cz)*uz),c=ring.map(([x,z])=>-(x-cx)*uz+(z-cz)*ux);
    const a0=Math.min(...a),a1=Math.max(...a),c0=Math.min(...c),c1=Math.max(...c),cm=(c0+c1)/2,top=building.base+s.ridge;
    const at=(p:number,q:number,y:number):XYZ=>[cx+p*ux-q*uz,y,cz+p*uz+q*ux];
    const A=at(a0,c0,roof),B=at(a1,c0,roof),C=at(a1,c1,roof),D=at(a0,c1,roof),R0=at(a0,cm,top),R1=at(a1,cm,top);
    for(const t of [[A,B,R1],[A,R1,R0],[D,R0,R1],[D,R1,C],[A,R0,D],[B,C,R1]] as Triangle[])meshes.emit('buildings',t,cap);
  }
  if(s.type==='stepped'&&s.upper&&s.upper.h>s.h+1) {
    const u=s.upper,ux=Math.cos(u.axis),uz=Math.sin(u.axis),hl=u.l/2,hw=u.w/2,top=building.base+u.h;
    const corner=(p:number,q:number):XZ=>[u.x+p*ux-q*uz,u.z+p*uz+q*ux];
    const box=[corner(-hl,-hw),corner(hl,-hw),corner(hl,hw),corner(-hl,hw)];
    for(let i=0;i<4;i++)wall(box[i]!,box[(i+1)%4]!,roof,top,building.colour);
    const [p0,p1,p2,p3]=box.map(([x,z]):XYZ=>[x,top,z]) as [XYZ,XYZ,XYZ,XYZ];
    meshes.emit('buildings',[p0,p1,p2],cap);meshes.emit('buildings',[p0,p2,p3],cap);meshes.emit('buildings',[p0,p2,p1],cap);meshes.emit('buildings',[p0,p3,p2],cap);
  }
}
/** Bound each indivisible GPU upload before compression, rather than splitting at runtime. */
function partition(data:MeshData,maxBytes=64*1024):MeshData[] {
  if(data.positions.length*4+data.indices.length*2<=maxBytes)return [data];
  const result:MeshData[]=[];
  let part=new MeshData(),vertices=new Map<number,number>();
  const flush=()=>{if(part.indices.length)result.push(part);part=new MeshData();vertices=new Map();};
  for(let i=0;i<data.indices.length;i+=3) {
    const face=data.indices.slice(i,i+3),added=new Set(face.filter(index=>!vertices.has(index))).size;
    if((vertices.size+added)*12+(part.indices.length+3)*2>maxBytes)flush();
    for(const source of face) {
      let target=vertices.get(source);
      if(target===undefined) {
        target=vertices.size;vertices.set(source,target);
        const offset=source*3;
        part.positions.push(...data.positions.slice(offset,offset+3));
        part.normals.push(...data.normals.slice(offset,offset+3));
        part.colours.push(...data.colours.slice(offset,offset+3));
      }
      part.indices.push(target);
    }
  }
  flush();return result;
}
function primitive(doc:Document,data:MeshData,name:string,origin:XZ,yCentre:number,yHalf:number,size:number) {
  if(!data.indices.length)return;
  const buffer=doc.getRoot().listBuffers()[0]!;
  const positions=new Int16Array(data.positions.length);
  const normals=new Int8Array(data.normals.length);
  for(let i=0;i<positions.length;i+=3) {
    positions[i]=Math.round((data.positions[i]!-origin[0]-size/2)/(size/2)*32767);
    positions[i+1]=Math.round((data.positions[i+1]!-yCentre)/yHalf*32767);
    positions[i+2]=Math.round((data.positions[i+2]!-origin[1]-size/2)/(size/2)*32767);
    // The glTF node unquantizes positions with a nonuniform scale. Pretransform normals so
    // the loader's inverse-transpose normal matrix recovers the original world-space normal.
    const n=[data.normals[i]!*size/2,data.normals[i+1]!*yHalf,data.normals[i+2]!*size/2];
    const length=Math.hypot(...n)||1;
    for(let k=0;k<3;k++)normals[i+k]=Math.round(n[k]!/length*127);
  }
  const p=doc.createPrimitive().setAttribute('POSITION',doc.createAccessor().setType('VEC3').setArray(positions).setNormalized(true).setBuffer(buffer))
    .setAttribute('NORMAL',doc.createAccessor().setType('VEC3').setArray(normals).setNormalized(true).setBuffer(buffer))
    .setAttribute('COLOR_0',doc.createAccessor().setType('VEC3').setArray(new Uint8Array(data.colours)).setNormalized(true).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(data.positions.length/3<=65535?new Uint16Array(data.indices):new Uint32Array(data.indices)).setBuffer(buffer))
    .setMaterial(doc.getRoot().listMaterials().find(material=>material.getName()===name)??
      doc.createMaterial(name).setRoughnessFactor(1).setMetallicFactor(0));
  return doc.createMesh(name).addPrimitive(p);
}
export async function chunkGlb(chunk:ChunkMeshes['chunks'] extends Map<string,infer T>?T:never,size:number):Promise<Uint8Array> {
  const doc=newDocument();doc.createBuffer();const scene=doc.createScene('GTASF chunk');doc.getRoot().setDefaultScene(scene);
  const groups=[['terrain',chunk.terrain],['roads',chunk.roads],['buildings',chunk.buildings],['structures',chunk.structures]] as const;
  let lo=Infinity,hi=-Infinity;
  for(const [,data] of groups)for(let i=1;i<data.positions.length;i+=3){lo=Math.min(lo,data.positions[i]!);hi=Math.max(hi,data.positions[i]!);}
  const yCentre=Number.isFinite(lo)?(hi+lo)/2:0,yHalf=Number.isFinite(lo)?Math.max(1,(hi-lo)/2):1;
  for(const [name,source] of groups)for(const data of partition(source)) {
    const mesh=primitive(doc,data,name,[chunk.bounds[0],chunk.bounds[1]],yCentre,yHalf,size);
    if(mesh)scene.addChild(doc.createNode(name).setMesh(mesh).setTranslation([size/2,yCentre,size/2]).setScale([size/2,yHalf,size/2]));
  }
  return writeGlb(doc);
}
