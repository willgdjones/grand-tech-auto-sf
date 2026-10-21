import { intersection } from './boolean';
import type { Bounds, Polygon, XZ } from './types';

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
export function centroid(ring: XZ[]): XZ {
  let a=0,x=0,z=0;
  for (let i=0;i<ring.length;i++) {
    const p=ring[i]!,q=ring[(i+1)%ring.length]!,cross=p[0]*q[1]-q[0]*p[1];
    a+=cross;x+=(p[0]+q[0])*cross;z+=(p[1]+q[1])*cross;
  }
  return Math.abs(a)>1e-9?[x/(3*a),z/(3*a)]:[ring[0]![0],ring[0]![1]];
}
export function clipPolygon(polygon: Polygon,[x0,z0,x1,z1]: Bounds): Polygon[] {
  if (!polygon.length||polygon[0]!.length<3) return [];
  return intersection(polygon,[[[x0,z0],[x1,z0],[x1,z1],[x0,z1],[x0,z0]]])
    .map(p=>p.map(openRing)).filter(p=>p[0]!.length>=3&&Math.abs(ringArea(p[0]!))>0.1);
}
/** Removes only sub-tolerance deviations; extrema anchor the closed ring. */
export function simplifyRing(input: XZ[],tolerance: number): XZ[] {
  const ring=openRing(input);
  if (ring.length<=4) return ring;
  let anchor=1;
  for (let i=2;i<ring.length;i++) if (Math.hypot(ring[i]![0]-ring[0]![0],ring[i]![1]-ring[0]![1])>
    Math.hypot(ring[anchor]![0]-ring[0]![0],ring[anchor]![1]-ring[0]![1])) anchor=i;
  const rdp=(points:XZ[]):XZ[]=>{
    if (points.length<3) return points;
    const a=points[0]!,b=points.at(-1)!,dx=b[0]-a[0],dz=b[1]-a[1],den=dx*dx+dz*dz;
    let far=tolerance,index=-1;
    for (let i=1;i<points.length-1;i++) {
      const p=points[i]!,t=den?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/den)):0;
      const d=Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz);
      if (d>far) {far=d;index=i;}
    }
    return index<0?[a,b]:[...rdp(points.slice(0,index+1)).slice(0,-1),...rdp(points.slice(index))];
  };
  const result=[...rdp(ring.slice(0,anchor+1)).slice(0,-1),...rdp([...ring.slice(anchor),ring[0]!]).slice(0,-1)];
  return result.length>=3&&Math.sign(ringArea(result))===Math.sign(ringArea(ring))?result:ring;
}
/** Liang–Barsky parameters for a segment, preserving real boundary crossings. */
export function clipSegment(a:XZ,b:XZ,bounds:Bounds):[number,number]|undefined {
  const dx=b[0]-a[0],dz=b[1]-a[1];let from=0,to=1;
  for (const [p,q] of [[-dx,a[0]-bounds[0]],[dx,bounds[2]-a[0]],[-dz,a[1]-bounds[1]],[dz,bounds[3]-a[1]]]) {
    if (p===0) {if(q!<0)return;continue;}
    const t=q!/p!;
    if(p!<0)from=Math.max(from,t);else to=Math.min(to,t);
    if(from>to)return;
  }
  return to-from>1e-9?[from,to]:undefined;
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
