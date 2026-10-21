import { Box3, Mesh, Vector3, type Object3D } from 'three';
import { clipToSurface, emitSurfacePolygon, type DrapeTriangle, type EmitDrapeTriangle } from '@gtasf/shared/terrainDrape';

export interface GroundRegion { minX:number; minZ:number; maxX:number; maxZ:number }
interface ChunkFaces {
  // ax, az, abx, abz, acx, acz, ay, aby, acy, inverse determinant.
  values:Float64Array;
  owners:Mesh[];
  root:Object3D;
  cells:Map<number,Map<number,number[]>>;
}
const CELL=8, STRIDE=10;
// Shared empty bucket for cell misses: heightAt runs per movement step, so a fresh [] per miss churns the GC.
const EMPTY:readonly number[]=[];
const within=(r:GroundRegion,x:number,z:number)=>x>=r.minX&&x<=r.maxX&&z>=r.minZ&&z<=r.maxZ;
const overlaps=(r:GroundRegion,minX:number,minZ:number,maxX:number,maxZ:number)=>minX<=r.maxX&&maxX>=r.minX&&minZ<=r.maxZ&&maxZ>=r.minZ;

/** Opt-in contact with the selected, decoded map LOD in small authored areas.
 * This does not replace graph/heightfield contact outside its requested regions.
 */
export class RenderedGroundIndex {
  private readonly chunks=new Map<string,ChunkFaces>();
  private readonly regions:readonly GroundRegion[];
  readonly stats={triangles:0,queries:0,candidates:0};

  constructor(regions:readonly GroundRegion[]) {
    this.regions=regions.map(region=>({...region}));
    if(this.regions.some(r=>![r.minX,r.minZ,r.maxX,r.maxZ].every(Number.isFinite)||r.minX>r.maxX||r.minZ>r.maxZ))
      throw new Error('Rendered ground requires finite ordered regions');
  }

  setChunk(id:string,root:Object3D):void {
    this.removeChunk(id);
    if(!this.regions.length)return;
    root.updateWorldMatrix(true,true);
    const values:number[]=[],owners:Mesh[]=[],cells:ChunkFaces['cells']=new Map();
    const a=new Vector3(),b=new Vector3(),c=new Vector3(),box=new Box3();
    root.traverse(object=>{
      if(!(object instanceof Mesh)||!/^(terrain|roads)(?:_|$)/.test(object.name))return;
      const geometry=object.geometry,position=geometry.getAttribute('position'),index=geometry.index;
      if(!position)return;
      if(!geometry.boundingBox)geometry.computeBoundingBox();
      if(!geometry.boundingBox)return;
      box.copy(geometry.boundingBox).applyMatrix4(object.matrixWorld);
      if(!this.regions.some(r=>overlaps(r,box.min.x,box.min.z,box.max.x,box.max.z)))return;
      const count=index?.count??position.count;
      for(let i=0;i+2<count;i+=3) {
        // Getters decode normalized INT16 attributes; matrixWorld includes the
        // glTF quantization scale, node transform and translated chunk root.
        a.fromBufferAttribute(position,index?index.getX(i):i).applyMatrix4(object.matrixWorld);
        b.fromBufferAttribute(position,index?index.getX(i+1):i+1).applyMatrix4(object.matrixWorld);
        c.fromBufferAttribute(position,index?index.getX(i+2):i+2).applyMatrix4(object.matrixWorld);
        const abx=b.x-a.x,abz=b.z-a.z,acx=c.x-a.x,acz=c.z-a.z,det=abx*acz-abz*acx;
        // Upward winding only: vertical walls and downward bridge undersides
        // cannot become walking ground.
        if(!Number.isFinite(det)||det>=-1e-10)continue;
        const minX=Math.min(a.x,b.x,c.x),maxX=Math.max(a.x,b.x,c.x),minZ=Math.min(a.z,b.z,c.z),maxZ=Math.max(a.z,b.z,c.z);
        if(!this.regions.some(r=>overlaps(r,minX,minZ,maxX,maxZ)))continue;
        const face=owners.length;
        values.push(a.x,a.z,abx,abz,acx,acz,a.y,b.y-a.y,c.y-a.y,1/det);owners.push(object);
        for(let x=Math.floor(minX/CELL);x<=Math.floor(maxX/CELL);x++)for(let z=Math.floor(minZ/CELL);z<=Math.floor(maxZ/CELL);z++) {
          if(!this.regions.some(r=>overlaps(r,x*CELL,z*CELL,(x+1)*CELL,(z+1)*CELL)))continue;
          let column=cells.get(x);if(!column){column=new Map();cells.set(x,column);}
          let bucket=column.get(z);if(!bucket){bucket=[];column.set(z,bucket);}bucket.push(face);
        }
      }
    });
    if(owners.length){this.chunks.set(id,{values:new Float64Array(values),owners,root,cells});this.stats.triangles+=owners.length;}
  }

  removeChunk(id:string):void {
    const chunk=this.chunks.get(id);if(!chunk)return;
    this.stats.triangles-=chunk.owners.length;this.chunks.delete(id);
  }
  clear():void {this.chunks.clear();this.stats.triangles=0;}

  /** Load-time paint projection against the actual selected LOD, including its quantization.
   * UV attributes survive cuts; no vertex resampling can bridge across a terrain ridge.
   * Index only: no raycasts, mesh mutation or changes to player/vehicle collision.
   */
  drapeTriangle(source:DrapeTriangle,lift:number,emit:EmitDrapeTriangle):number {
    const minX=Math.min(...source.map(p=>p[0])),maxX=Math.max(...source.map(p=>p[0]));
    const minZ=Math.min(...source.map(p=>p[2])),maxZ=Math.max(...source.map(p=>p[2]));
    let count=0;
    for(const chunk of this.chunks.values()) {
      const candidates=new Set<number>();
      for(let x=Math.floor(minX/CELL);x<=Math.floor(maxX/CELL);x++)for(let z=Math.floor(minZ/CELL);z<=Math.floor(maxZ/CELL);z++)
        for(const face of chunk.cells.get(x)?.get(z)??EMPTY)candidates.add(face);
      for(const face of candidates) {
        const v=chunk.values,i=face*STRIDE;
        const surface:DrapeTriangle=[
          [v[i]!,v[i+6]!,v[i+1]!],
          [v[i]!+v[i+2]!,v[i+6]!+v[i+7]!,v[i+1]!+v[i+3]!],
          [v[i]!+v[i+4]!,v[i+6]!+v[i+8]!,v[i+1]!+v[i+5]!],
        ];
        const polygon=clipToSurface(source,surface);
        if(polygon.length<3)continue;
        const x=polygon.reduce((n,p)=>n+p[0],0)/polygon.length,z=polygon.reduce((n,p)=>n+p[2],0)/polygon.length;
        const reference=polygon.reduce((n,p)=>n+p[1],0)/polygon.length-lift;
        const chosen=this.heightAt(x,z,reference,true);
        const dx=x-v[i]!,dz=z-v[i+1]!;
        const u=(dx*v[i+5]!-dz*v[i+4]!)*v[i+9]!,w=(v[i+2]!*dz-v[i+3]!*dx)*v[i+9]!;
        const y=v[i+6]!+u*v[i+7]!+w*v[i+8]!;
        // Keep bridges and tunnel floors on the source road's deck; reject unrelated layers.
        if(chosen===null||Math.abs(chosen-y)>.0001)continue;
        count+=emitSurfacePolygon(polygon,surface,lift,emit);
      }
    }
    return count;
  }

  /** Null means uncovered, not yet revealed, or on a different vertical deck.
   * Callers retain their existing loaded graph/heightfield fallback in that case.
   */
  heightAt(x:number,z:number,referenceY?:number,includeUnrevealed=false):number|null {
    if(!Number.isFinite(x)||!Number.isFinite(z)||referenceY!==undefined&&!Number.isFinite(referenceY)
      ||!this.regions.some(r=>within(r,x,z)))return null;
    this.stats.queries++;
    const cx=Math.floor(x/CELL),cz=Math.floor(z/CELL);
    let result:number|null=null,distance=Infinity;
    for(const chunk of this.chunks.values())for(const face of chunk.cells.get(cx)?.get(cz)??EMPTY) {
      const owner=chunk.owners[face]!;
      // Loading reveals meshes individually. Do not provide contact for a road
      // that has not been uploaded/revealed yet.
      let shown=true;
      for(let object:Object3D|null=owner;object;object=object.parent){if(!object.visible){shown=false;break;}if(object===chunk.root)break;}
      if(!shown&&!includeUnrevealed)continue;
      this.stats.candidates++;
      const v=chunk.values,i=face*STRIDE,dx=x-v[i]!,dz=z-v[i+1]!;
      const u=(dx*v[i+5]!-dz*v[i+4]!)*v[i+9]!,w=(v[i+2]!*dz-v[i+3]!*dx)*v[i+9]!;
      if(u< -1e-7||w< -1e-7||u+w>1+1e-7)continue;
      const y=v[i+6]!+u*v[i+7]!+w*v[i+8]!;
      if(!Number.isFinite(y))continue;
      if(referenceY===undefined){if(result===null||y>result)result=y;continue;}
      const delta=Math.abs(referenceY-y);
      if(delta>5)continue;
      // Preserve the current bridge/tunnel deck. Coplanar overlap ties use the
      // upper surface, as rendered; no-reference queries also use the top face.
      if(delta<distance-1e-7||Math.abs(delta-distance)<=1e-7&&(result===null||y>result)){distance=delta;result=y;}
    }
    return result;
  }
}
