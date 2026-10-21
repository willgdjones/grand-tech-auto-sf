import type { HeightSampler, Road, XZ, XYZ } from './types';
import { SpatialIndex } from './geometry';

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
/** Establish portal elevations across connected, split OSM bridge/tunnel ways. */
function deckHeights(roads:Road[],terrain:HeightSampler,warnings:string[]):Map<string,number> {
  const surface=new Set(roads.filter(r=>!gradeSeparated(r)).flatMap(r=>r.points.map(p=>p.id)));
  const nodes=new Map<string,{x:number;z:number;links:{id:string;weight:number}[]}>();
  for(const road of roads.filter(gradeSeparated)) {
    const a=road.points[0]!,b=road.points.at(-1)!;
    let length=0;for(let i=1;i<road.points.length;i++)length+=Math.hypot(road.points[i]!.x-road.points[i-1]!.x,road.points[i]!.z-road.points[i-1]!.z);
    for(const p of [a,b])if(!nodes.has(p.id))nodes.set(p.id,{x:p.x,z:p.z,links:[]});
    nodes.get(a.id)!.links.push({id:b.id,weight:1/Math.max(1,length)});
    nodes.get(b.id)!.links.push({id:a.id,weight:1/Math.max(1,length)});
  }
  const heights=new Map<string,number>(),seen=new Set<string>();
  for(const start of nodes.keys()) {
    if(seen.has(start))continue;
    const group:string[]=[],stack=[start];seen.add(start);
    while(stack.length){const id=stack.pop()!;group.push(id);for(const next of nodes.get(id)!.links)if(!seen.has(next.id)){seen.add(next.id);stack.push(next.id);}}
    const anchors=new Set(group.filter(id=>surface.has(id)||(nodes.get(id)!.links.length===1&&!id.startsWith('boundary:'))));
    if(!anchors.size) {
      warnings.push(`Grade-separated component ${start} has no mapped portal; endpoint elevations need review`);
      for(const id of group.filter(id=>nodes.get(id)!.links.length===1))anchors.add(id);
      if(!anchors.size)anchors.add(start);
    }
    const mean=[...anchors].reduce((sum,id)=>{const p=nodes.get(id)!;return sum+terrain.sample(p.x,p.z);},0)/anchors.size;
    for(const id of group){const p=nodes.get(id)!;heights.set(id,anchors.has(id)?terrain.sample(p.x,p.z):mean);}
    for(let iteration=0;iteration<500;iteration++) {
      let change=0;
      for(const id of group)if(!anchors.has(id)) {
        const links=nodes.get(id)!.links,total=links.reduce((sum,n)=>sum+n.weight,0);
        const value=links.reduce((sum,n)=>sum+heights.get(n.id)!*n.weight,0)/total;
        change=Math.max(change,Math.abs(value-heights.get(id)!));heights.set(id,value);
      }
      if(change<1e-5)break;
    }
  }
  return heights;
}
export function prepareRoadSurfaces(roads:Road[],terrain:HeightSampler,warnings:string[]):void {
  const usage=new Map<string,number>();
  for(const road of roads)for(const p of road.points)usage.set(p.id,(usage.get(p.id)??0)+1);
  const deck=deckHeights(roads,terrain,warnings);
  for(const road of roads) {
    const dense=resample(road.points.map(p=>[p.x,p.z]),road.tags.name==='Lombard Street'?1:4);
    if(gradeSeparated(road)) {
      const from=deck.get(road.points[0]!.id)!,to=deck.get(road.points.at(-1)!.id)!;
      const distances=[0];for(let i=1;i<dense.length;i++)distances.push(distances.at(-1)!+Math.hypot(dense[i]![0]-dense[i-1]![0],dense[i]![1]-dense[i-1]![1]));
      const total=distances.at(-1)!||1;
      road.profile=dense.map(([x,z],i)=>[x,from+(to-from)*distances[i]!/total,z]);
      continue;
    }
    const anchors=new Set(road.points.filter((p,i)=>i===0||i===road.points.length-1||(usage.get(p.id)??0)>1||p.control)
      .map(p=>`${p.x.toFixed(6)},${p.z.toFixed(6)}`));
    const heights=dense.map(([x,z])=>terrain.sample(x,z));
    road.profile=dense.map(([x,z],i):XYZ=>{
      if(anchors.has(`${x.toFixed(6)},${z.toFixed(6)}`))return [x,heights[i]!,z];
      let sum=0,weight=0;
      for(let j=Math.max(0,i-2);j<=Math.min(dense.length-1,i+2);j++){const w=3-Math.abs(j-i);sum+=heights[j]!*w;weight+=w;}
      return [x,sum/weight,z];
    });
  }
  repairBayApproaches(roads,terrain,warnings);
}

/**
 * DEM portal interpolation alone buries the Bay Bridge's Rincon Hill approach.
 * Keep connected ramp endpoints continuous, with a conservative clearance envelope.
 * These remain game deck approximations, not surveyed bridge elevations.
 */
function repairBayApproaches(roads:Road[],terrain:HeightSampler,warnings:string[]):void {
  const isBridge=(r:Road)=>Boolean(r.tags.bridge&&r.tags.bridge!=='no');
  const bridges=roads.filter(isBridge);
  const surface=new Set(roads.filter(r=>!gradeSeparated(r)).flatMap(r=>r.points.map(p=>p.id)));
  const selected=new Set(bridges.filter(r=>r.tags.ref==='I 80'&&r.points.some(p=>p.x<1800&&p.z>-400&&p.z<2200)));
  if(!selected.size)return;
  // Include attached ramps so a correction never leaves a step at their shared node.
  const joins=new Set([...selected].flatMap(r=>[r.points[0]!.id,r.points.at(-1)!.id]));
  let changed=true;
  while(changed){changed=false;for(const r of bridges)if(!selected.has(r)&&
    (joins.has(r.points[0]!.id)||joins.has(r.points.at(-1)!.id))) {
    selected.add(r);joins.add(r.points[0]!.id);joins.add(r.points.at(-1)!.id);changed=true;
  }}
  const elevations=new Map<string,number>();
  for(const r of selected)for(const [source,p] of [[r.points[0]!,r.profile![0]!],[r.points.at(-1)!,r.profile!.at(-1)!]] as const) {
    const clearance=surface.has(source.id)?0:5.5;
    const height=Math.max(p[1],terrain.sample(p[0],p[2])+clearance);
    elevations.set(source.id,Math.max(elevations.get(source.id)??-Infinity,height));
  }
  const profiles=[...selected].map(r=>{
    const profile=r.profile!,a=profile[0]!,b=profile.at(-1)!,distances=[0];
    for(let i=1;i<profile.length;i++)distances.push(distances.at(-1)!+Math.hypot(profile[i]![0]-profile[i-1]![0],profile[i]![2]-profile[i-1]![2]));
    const total=distances.at(-1)!||1,first=r.points[0]!.id,last=r.points.at(-1)!.id;
    const from=elevations.get(first)!,to=elevations.get(last)!;
    const values=profile.map((p,i)=>{
      const distance=distances[i]!,blend=Math.min(1,surface.has(first)?distance/32:1,surface.has(last)?(total-distance)/32:1);
      const base=p[1]+(from-a[1])*(1-distance/total)+(to-b[1])*distance/total;
      return Math.max(base,terrain.sample(p[0],p[2])+5.5*blend);
    });
    return {r,profile,distances,total,first,last,values};
  });
  // Propagate the raise-only slope envelope through shared ramp endpoints.
  // Resetting endpoints after smoothing would introduce a sharp step at every join.
  for(let iteration=0;iteration<=profiles.length;iteration++) {
    let change=0;
    for(const p of profiles) {
      const {first,last,values,distances,total}=p;
      values[0]=elevations.get(first)!;values[values.length-1]=elevations.get(last)!;
      let grade=0.2;
      // A surface portal is a fixed connection. Use the least grade compatible
      // with its clearance samples instead of raising it off the surface road.
      for(let i=0;i<values.length;i++) {
        if(surface.has(first)&&distances[i]!>0)grade=Math.max(grade,(values[i]!-values[0]!)/distances[i]!);
        if(surface.has(last)&&total-distances[i]!>0)grade=Math.max(grade,(values[i]!-values.at(-1)!)/(total-distances[i]!));
      }
      for(let i=1;i<values.length;i++)values[i]=Math.max(values[i]!,values[i-1]!-(distances[i]!-distances[i-1]!)*grade);
      for(let i=values.length-2;i>=0;i--)values[i]=Math.max(values[i]!,values[i+1]!-(distances[i+1]!-distances[i]!)*grade);
      for(const [id,value] of [[first,values[0]!],[last,values.at(-1)!]] as const)if(!surface.has(id)) {
        change=Math.max(change,value-elevations.get(id)!);elevations.set(id,Math.max(value,elevations.get(id)!));
      }
    }
    if(change<1e-7)break;
  }
  let repaired=0;
  for(const {r,profile,values} of profiles) {
    if(values.some((h,i)=>h>profile[i]![1]+0.01))repaired++;
    r.profile=profile.map(([x,,z],i)=>[x,values[i]!,z]);
  }
  // A bridge may end at an island tunnel instead of at a surface road.
  for(const r of roads)if(!selected.has(r)&&gradeSeparated(r)&&r.profile) {
    const first=r.points[0]!.id,last=r.points.at(-1)!.id;
    if(!elevations.has(first)&&!elevations.has(last))continue;
    const a=r.profile[0]!,b=r.profile.at(-1)!,from=(elevations.get(first)??a[1])-a[1],to=(elevations.get(last)??b[1])-b[1];
    const distances=[0];for(let i=1;i<r.profile.length;i++)distances.push(distances.at(-1)!+Math.hypot(r.profile[i]![0]-r.profile[i-1]![0],r.profile[i]![2]-r.profile[i-1]![2]));
    const total=distances.at(-1)!||1;
    r.profile=r.profile.map(([x,y,z],i)=>[x,y+from*(1-distances[i]!/total)+to*distances[i]!/total,z]);
  }
  warnings.push(`Bay Bridge approach: ${repaired} connected deck/ramp profiles raised to a 5.5 m DEM clearance envelope; surface portals blend over 32 m; approximate game elevations`);
}
interface SurfaceSegment {a:XYZ;b:XYZ;half:number}
/** Carve surface roads only; blend shoulders into the untouched bare-earth DEM. */
export class RoadTerrain implements HeightSampler {
  private index=new SpatialIndex<SurfaceSegment>(32);
  constructor(readonly original:HeightSampler,roads:Road[]) {
    for(const road of roads)if(!gradeSeparated(road))for(let i=1;i<(road.profile?.length??0);i++) {
      const a=road.profile![i-1]!,b=road.profile![i]!,half=road.width/2;
      this.index.add([Math.min(a[0],b[0])-half-3,Math.min(a[2],b[2])-half-3,Math.max(a[0],b[0])+half+3,Math.max(a[2],b[2])+half+3],{a,b,half});
    }
  }
  sample(x:number,z:number):number {
    const original=this.original.sample(x,z);
    let best=Infinity,weight=0,elevation=original;
    for(const {a,b,half} of this.index.query([x,z,x,z])) {
      const dx=b[0]-a[0],dz=b[2]-a[2],t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[2])*dz)/(dx*dx+dz*dz||1)));
      const distance=Math.hypot(x-a[0]-dx*t,z-a[2]-dz*t),score=distance/half;
      if(distance>half+3||score>=best)continue;
      best=score;weight=1-Math.max(0,Math.min(1,(distance-half)/3));elevation=a[1]+(b[1]-a[1])*t;
    }
    return original*(1-weight)+elevation*weight;
  }
}
export function pathLength(points:XYZ[]):number {
  let sum=0;for(let i=1;i<points.length;i++)sum+=Math.hypot(...points[i]!.map((n,k)=>n-points[i-1]![k]!) as XYZ);return sum;
}
