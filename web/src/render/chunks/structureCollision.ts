import { Mesh, Ray, Triangle, Vector3, type Object3D } from 'three';
import { flags } from '@gtasf/shared/flags';
/** One number per cell (no string): unique for cell indices within +-32767 (8 m cells = +-262 km). */
const cellKey=(x:number,z:number)=>(x+32768)*65536+(z+32768);

interface Face {
  triangle:Triangle;
  minX:number;maxX:number;minY:number;maxY:number;minZ:number;maxZ:number;
  stamp:number;
}
const CELL=8;

/** Static collision triangles taken from the exact decoded render geometry. The default pattern indexes
 * tunnel structures*; pass /^buildings(?:_|$)/ to index coarse chunks' building meshes instead (they ship
 * no footprint collision JSON), so distant blocks occlude/collide at zero payload cost. [gtasf-q3r6/ntcl] */
export class StructureCollisionIndex {
  private chunks=new Map<string,Face[]>();
  // Numeric cell keys (gtasf-pooa): string keys allocated a new string per probed cell, many times per frame.
  private cells=new Map<number,Face[]>();
  private minX=Infinity;private maxX=-Infinity;private minZ=Infinity;private maxZ=-Infinity;
  private stamp=0;
  private lower=new Vector3();private upper=new Vector3();private closest=new Vector3();
  private ray=new Ray(new Vector3(),new Vector3(0,1,0));
  // rebuilds/rebuildMs/setChunks/setChunkMs/maxCellFaces are cheap (chunk-mount only, not per-collide);
  // they let a mount profile separate rebuild churn from dense cells from the query itself (gtasf-3k35).
  readonly stats={triangles:0,cells:0,queries:0,candidates:0,triangleTests:0,rebuilds:0,rebuildMs:0,setChunks:0,setChunkMs:0,maxCellFaces:0};

  setChunk(id:string,root:Object3D,pattern:RegExp=/^structures(?:_|$)/):void {
    const setChunkStart=performance.now();this.stats.setChunks++;
    root.updateWorldMatrix(true,true);
    const faces:Face[]=[],seen=new Set<string>();
    root.traverse(object=>{
      if(!(object instanceof Mesh)||!pattern.test(object.name))return;
      const position=object.geometry.getAttribute('position'),indices=object.geometry.index;
      if(!position)return;
      const count=indices?.count??position.count;
      for(let i=0;i+2<count;i+=3) {
        // Attribute getters decode normalized INT16 positions before the node's
        // quantization scale and chunk/world transforms are applied.
        const points=[0,1,2].map(offset=>new Vector3().fromBufferAttribute(position,indices?indices.getX(i+offset):i+offset).applyMatrix4(object.matrixWorld));
        if(points.some(p=>![p.x,p.y,p.z].every(Number.isFinite)))continue;
        const triangle=new Triangle(points[0]!,points[1]!,points[2]!);
        if(triangle.getArea()<1e-8)continue;
        const key=points.map(p=>`${p.x},${p.y},${p.z}`).sort().join(';');
        if(seen.has(key))continue;seen.add(key); // The baked shell has paired windings.
        faces.push({triangle,minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),
          minY:Math.min(...points.map(p=>p.y)),maxY:Math.max(...points.map(p=>p.y)),
          minZ:Math.min(...points.map(p=>p.z)),maxZ:Math.max(...points.map(p=>p.z)),stamp:0});
      }
    });
    if(!faces.length&&!this.chunks.has(id)){this.stats.setChunkMs+=performance.now()-setChunkStart;return;}
    if(flags.fastStructureCollision){
      // Incremental (gtasf-3k35 part a): add only this chunk's faces to the existing cell grid instead of
      // re-bucketing every chunk's triangles on each mount (the near-quadratic churn). Same cells/faces as
      // a full rebuild, so collides() is identical. Re-setting a chunk first drops its previous faces.
      const previous=this.chunks.get(id);if(previous)this.unbucket(previous);
      this.chunks.set(id,faces);this.bucket(faces);
    }else{this.chunks.set(id,faces);this.rebuild();}
    this.stats.setChunkMs+=performance.now()-setChunkStart;
  }

  removeChunk(id:string):void {
    const previous=this.chunks.get(id);if(!previous||!this.chunks.delete(id))return;
    if(flags.fastStructureCollision)this.unbucket(previous);else this.rebuild();
  }
  clear():void {
    this.chunks.clear();this.cells.clear();this.minX=this.minZ=Infinity;this.maxX=this.maxZ=-Infinity;
    this.stats.triangles=0;this.stats.cells=0;this.stats.maxCellFaces=0;
  }
  /** Incremental: bucket one chunk's faces into the existing grid (fastStructureCollision). */
  private bucket(faces:Face[]):void {
    const rebuildStart=performance.now();this.stats.rebuilds++;this.stats.triangles+=faces.length;
    let maxCellFaces=this.stats.maxCellFaces;
    for(const face of faces){
      const x0=Math.floor(face.minX/CELL),x1=Math.floor(face.maxX/CELL),z0=Math.floor(face.minZ/CELL),z1=Math.floor(face.maxZ/CELL);
      if(x0<this.minX)this.minX=x0;if(x1>this.maxX)this.maxX=x1;if(z0<this.minZ)this.minZ=z0;if(z1>this.maxZ)this.maxZ=z1;
      for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++){
        const key=cellKey(x,z),cell=this.cells.get(key);
        if(cell){cell.push(face);if(cell.length>maxCellFaces)maxCellFaces=cell.length;}else{this.cells.set(key,[face]);if(maxCellFaces<1)maxCellFaces=1;}
      }
    }
    this.stats.cells=this.cells.size;this.stats.maxCellFaces=maxCellFaces;this.stats.rebuildMs+=performance.now()-rebuildStart;
  }
  /** Incremental: drop one chunk's faces from the grid (bounds stay a monotonic superset — still correct). */
  private unbucket(faces:Face[]):void {
    const gone=new Set(faces),touched=new Set<number>();
    for(const face of faces){
      const x0=Math.floor(face.minX/CELL),x1=Math.floor(face.maxX/CELL),z0=Math.floor(face.minZ/CELL),z1=Math.floor(face.maxZ/CELL);
      for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++)touched.add(cellKey(x,z));
    }
    for(const key of touched){
      const cell=this.cells.get(key);if(!cell)continue;
      const kept=cell.filter(f=>!gone.has(f));if(kept.length)this.cells.set(key,kept);else this.cells.delete(key);
    }
    this.stats.triangles-=faces.length;this.stats.cells=this.cells.size;
  }
  private rebuild():void {
    const rebuildStart=performance.now();this.stats.rebuilds++;
    this.cells.clear();this.minX=this.minZ=Infinity;this.maxX=this.maxZ=-Infinity;this.stats.triangles=0;
    for(const faces of this.chunks.values())for(const face of faces) {
      this.stats.triangles++;
      const x0=Math.floor(face.minX/CELL),x1=Math.floor(face.maxX/CELL),z0=Math.floor(face.minZ/CELL),z1=Math.floor(face.maxZ/CELL);
      this.minX=Math.min(this.minX,x0);this.maxX=Math.max(this.maxX,x1);this.minZ=Math.min(this.minZ,z0);this.maxZ=Math.max(this.maxZ,z1);
      for(let x=x0;x<=x1;x++)for(let z=z0;z<=z1;z++) {
        const key=cellKey(x,z),cell=this.cells.get(key)??[];cell.push(face);this.cells.set(key,cell);
      }
    }
    this.stats.cells=this.cells.size;
    let maxCellFaces=0;for(const cell of this.cells.values())if(cell.length>maxCellFaces)maxCellFaces=cell.length;
    this.stats.maxCellFaces=maxCellFaces;
    this.stats.rebuildMs+=performance.now()-rebuildStart;
  }

  /** Vertical capsule; radius > height/2 conservatively extends its vertical bounds. */
  collides(x:number,y:number,z:number,radius:number,height:number):boolean {
    // Per-argument checks: the array+every form allocated on every probe (gtasf-pooa allocation profile).
    if(!Number.isFinite(x)||!Number.isFinite(y)||!Number.isFinite(z)||!Number.isFinite(radius)||!Number.isFinite(height)||radius<0||height<0)return false;
    this.stats.queries++;const stamp=++this.stamp,cap=Math.min(radius,height/2),low=y+cap,high=y+height-cap;
    this.lower.set(x,low,z);this.upper.set(x,high,z);this.ray.origin.copy(this.lower);
    for(let cx=Math.max(this.minX,Math.floor((x-radius)/CELL));cx<=Math.min(this.maxX,Math.floor((x+radius)/CELL));cx++)
      for(let cz=Math.max(this.minZ,Math.floor((z-radius)/CELL));cz<=Math.min(this.maxZ,Math.floor((z+radius)/CELL));cz++)
        { const faces=this.cells.get(cellKey(cx,cz));if(!faces)continue;
        for(let i=0;i<faces.length;i++) { const face=faces[i]!;
          if(face.stamp===stamp)continue;face.stamp=stamp;this.stats.candidates++;
          if(x+radius<face.minX||x-radius>face.maxX||z+radius<face.minZ||z-radius>face.maxZ||high+radius<face.minY||low-radius>face.maxY)continue;
          this.stats.triangleTests++;
          if(this.touches(face.triangle,x,z,low,high,radius*radius))return true;
        } }
    return false;
  }

  private touches(t:Triangle,x:number,z:number,low:number,high:number,radius2:number):boolean {
    t.closestPointToPoint(this.lower,this.closest);if(this.closest.distanceToSquared(this.lower)<=radius2)return true;
    t.closestPointToPoint(this.upper,this.closest);if(this.closest.distanceToSquared(this.upper)<=radius2)return true;
    if(high>low&&this.ray.intersectTriangle(t.a,t.b,t.c,false,this.closest)&&this.closest.y<=high)return true;
    // Interior segment/edge minima: match height along the vertical capsule.
    // When the edge's nearest height lies outside [low,high], the endpoint/
    // triangle tests above already cover the constrained minimum.
    return this.edge(t.a,t.b,x,z,low,high,radius2)||this.edge(t.b,t.c,x,z,low,high,radius2)||this.edge(t.c,t.a,x,z,low,high,radius2);
  }
  private edge(a:Vector3,b:Vector3,x:number,z:number,low:number,high:number,radius2:number):boolean {
    const dx=b.x-a.x,dz=b.z-a.z,length2=dx*dx+dz*dz;
    if(length2<1e-16) {
      const gap=Math.max(0,low-Math.max(a.y,b.y),Math.min(a.y,b.y)-high);
      return (x-a.x)**2+(z-a.z)**2+gap*gap<=radius2;
    }
    const u=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/length2)),ey=a.y+(b.y-a.y)*u;
    const gap=ey-Math.max(low,Math.min(high,ey));
    return (x-a.x-dx*u)**2+(z-a.z-dz*u)**2+gap*gap<=radius2;
  }
}
