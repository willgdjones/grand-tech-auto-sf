import { readFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { settings,project } from './settings';
import { atomicWrite } from './sources';
import { components,findRoute } from './roadgraph';
import { contains,polygonBounds,SpatialIndex } from './geometry';
import { decodeHeightfield } from './heightfield';
import type { Bounds,HeightSampler,MapManifest,Polygon,RoadEdge,RoadGraph,XYZ } from './types';

export interface CollisionBuilding { id:string;minY:number;maxY:number;polygon:Polygon }
/** Keep the full source graph for road contact; dispatch only on collision-clear edges. */
export function collisionAudit(graph:RoadGraph,buildings:CollisionBuilding[]) {
  const index=new SpatialIndex<CollisionBuilding>(64);
  for(const b of buildings)index.add(polygonBounds(b.polygon),b);
  const blocked=[];
  for(const edge of graph.edges) {
    const hits=new Set<string>();
    for(let i=1;i<edge.points.length;i++) {
      const a=edge.points[i-1]!,b=edge.points[i]!,steps=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[2]-a[2])));
      for(let n=0;n<=steps;n++) {
        const t=n/steps,x=a[0]+(b[0]-a[0])*t,y=a[1]+(b[1]-a[1])*t,z=a[2]+(b[2]-a[2])*t;
        for(const building of index.query([x,z,x,z]))
          if(y>=building.minY-0.2&&y<building.maxY&&contains(building.polygon,[x,z]))hits.add(building.id);
      }
    }
    if(hits.size)blocked.push({edge:edge.id,kind:edge.kind,name:edge.name,osmWay:edge.osmWay,layer:edge.layer,
      bridge:edge.bridge,tunnel:edge.tunnel,reason:'building collision has no modelled vertical passage',buildings:[...hits]});
  }
  return {blockedLanes:blocked.filter(e=>e.kind==='lane').length,blockedEdges:blocked.length,
    lombardBlocked:blocked.filter(e=>e.osmWay===402111597),blocked};
}
function edgeSubset(graph:RoadGraph,keep:(edge:RoadEdge)=>boolean,retainIsolated=false):RoadGraph {
  const edges=graph.edges.filter(keep),ids=new Set(edges.map(e=>e.id)),nodes=new Set(edges.flatMap(e=>[e.from,e.to]));
  return {...graph,nodes:retainIsolated?graph.nodes:graph.nodes.filter(n=>nodes.has(n.id)),
    edges:edges.map(e=>({...e,next:e.next?.filter(id=>ids.has(id))}))};
}

function nearest(edge:RoadEdge,x:number,z:number) {
  let distance=Infinity,position:XYZ=edge.points[0]!;
  for(let i=1;i<edge.points.length;i++) {
    const a=edge.points[i-1]!,b=edge.points[i]!,dx=b[0]-a[0],dz=b[2]-a[2];
    const t=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[2])*dz)/(dx*dx+dz*dz||1)));
    const p=a.map((v,k)=>v+(b[k]!-v)*t) as XYZ,d=Math.hypot(p[0]-x,p[2]-z);
    if(d<distance){distance=d;position=p;}
  }
  return {edge,distance,position};
}
export function localPlay(graph:RoadGraph,ground:HeightSampler) {
  const lanes=graph.edges.filter(e=>e.kind==='lane'&&e.osmWay===402111597).sort((a,b)=>b.points[0]![1]-a.points[0]![1]);
  if(!lanes.length)return;
  const edges=new Map(graph.edges.map(e=>[e.id,e])),route:string[]=[];
  for(const [i,lane] of lanes.entries()) {
    if(i){const bridge=findRoute(graph,lanes[i-1]!.to,lane.from);if(!bridge)throw new Error('Lombard lanes are disconnected');route.push(...bridge);}
    route.push(lane.id);
  }
  const first=lanes[0]!,last=lanes.at(-1)!,position=first.points[0]!,next=first.points[1]!;
  const major=components(graph)[0]??[],members=new Set(major);
  if(!members.has(first.from)||!members.has(last.to))throw new Error('Lombard is outside the main playable network');
  const points=route.flatMap(id=>edges.get(id)!.points).filter((p,i,a)=>!i||p.some((v,k)=>v!==a[i-1]![k]));
  // A real incoming route near the hilltop, suitable for an arriving robotaxi.
  let pickup:{from:string;edges:string[];lengthM:number}|undefined;
  const candidates=graph.nodes.filter(n=>members.has(n.id)).map(n=>({n,d:Math.hypot(n.x-position[0],n.z-position[2])}))
    .filter(p=>p.d>=100&&p.d<=180).sort((a,b)=>Math.abs(a.d-150)-Math.abs(b.d-150));
  for(const {n} of candidates.slice(0,40)) {
    const path=findRoute(graph,n.id,first.from);if(!path)continue;
    const lengthM=path.reduce((sum,id)=>sum+edges.get(id)!.lengthM,0);
    if(lengthM<350){pickup={from:n.id,edges:path,lengthM};break;}
  }
  if(!pickup)throw new Error('No upstream taxi pickup route found');
  const [towerX,towerZ]=project(-122.3937,37.7955),x=towerX-45,z=towerZ+30;
  const plaza:XYZ=[x,ground.sample(x,z),z];
  let ferry: {pickup:{edge:string;position:XYZ;distanceFromPlaza:number};outbound:string[];return:string[];outboundMetres:number;returnMetres:number}|undefined;
  const nearby=graph.edges.filter(e=>e.kind==='lane'&&members.has(e.from)&&members.has(e.to)).map(e=>nearest(e,x,z)).sort((a,b)=>a.distance-b.distance);
  for(const candidate of nearby.slice(0,20)) {
    const there=findRoute(graph,candidate.edge.to,first.from),back=findRoute(graph,last.to,candidate.edge.from);
    if(!there||!back)continue;
    const outbound=[candidate.edge.id,...there],inbound=[...back,candidate.edge.id];
    ferry={pickup:{edge:candidate.edge.id,position:candidate.position,distanceFromPlaza:candidate.distance},outbound,return:inbound,
      outboundMetres:outbound.reduce((sum,id)=>sum+edges.get(id)!.lengthM,0),returnMetres:inbound.reduce((sum,id)=>sum+edges.get(id)!.lengthM,0)};break;
  }
  if(!ferry||ferry.pickup.distanceFromPlaza>200)throw new Error('Ferry plaza has no reachable road within 200m; bake the expanded corridor');
  return {version:1,units:'metres',spawn:{position:plaza,forward:[45,0,-30] as XYZ,yaw:Math.atan2(45,-30),label:'Ferry Building plaza'},
    lombard:{position,forward:[next[0]-position[0],next[1]-position[1],next[2]-position[2]] as XYZ,node:first.from},ferry,
    downhill:{from:first.from,to:last.to,edges:route,points,lengthM:route.reduce((sum,id)=>sum+edges.get(id)!.lengthM,0),dropM:position[1]-last.points.at(-1)![1]},
    pickup,playableGraph:'roadgraph-playable.json',excludedNodeIds:graph.nodes.filter(n=>!members.has(n.id)).map(n=>n.id),
    network:{allNodes:graph.nodes.length,playableNodes:members.size,excludedNodes:graph.nodes.length-members.size,strongComponents:components(graph).length}};
}

/** The largest strongly connected component of the collision-clear graph: every edge in it is
 *  dispatchable (no building in the way, and you can always drive back out). Shared by the local
 *  routes below and the citywide routing mask packed into roadgraph.bin (gtasf-u4al). */
export function playableNetwork(graph:RoadGraph,blockedIds:ReadonlySet<string>) {
  const clear=edgeSubset(graph,e=>!blockedIds.has(e.id),true),groups=components(clear),members=new Set(groups[0]);
  return {groups,members,playable:edgeSubset(clear,e=>members.has(e.from)&&members.has(e.to))};
}

export async function writeLocalRoutes(root:string,graph:RoadGraph,ground:HeightSampler,buildings:CollisionBuilding[],publishBounds?:Bounds) {
  const audit=collisionAudit(graph,buildings),blockedIds=new Set(audit.blocked.map(e=>e.edge));
  const {groups,members,playable}=playableNetwork(graph,blockedIds);
  const routes=localPlay(playable,ground);if(!routes)return;
  const play={...routes,excludedNodeIds:graph.nodes.filter(n=>!members.has(n.id)).map(n=>n.id),
    excludedComponents:groups.slice(1),excludedEdges:audit.blocked,
    network:{allNodes:graph.nodes.length,playableNodes:members.size,excludedNodes:graph.nodes.length-members.size,
      strongComponents:groups.length,blockedLanes:audit.blockedLanes,blockedEdges:audit.blockedEdges}};
  const [sx,sy,sz]=play.spawn.position;
  if(buildings.some(b=>sy>=b.minY&&sy<b.maxY&&contains(b.polygon,[sx,sz])))throw new Error('Ferry spawn intersects building collision');
  // Citywide bakes keep this legacy JSON corridor-clipped (gtasf-o0cb): the full ~90 MB city graph blows
  // the 25 MB per-file cap. Citywide GPS/robotaxi routing instead comes from the routable mask that
  // runtime.ts packs into roadgraph.bin from the same playableNetwork (gtasf-u4al).
  const published=publishBounds
    ?edgeSubset(playable,e=>e.points.some(p=>p[0]>=publishBounds[0]-500&&p[0]<=publishBounds[2]+500&&p[2]>=publishBounds[1]-500&&p[2]<=publishBounds[3]+500))
    :playable;
  const encoded=JSON.stringify(published)+'\n';await atomicWrite(join(root,play.playableGraph),encoded);await atomicWrite(join(root,play.playableGraph+'.gz'),gzipSync(encoded,{level:9}));
  const localEdges=new Set([...play.pickup.edges,...play.downhill.edges,...play.ferry.outbound,...play.ferry.return]);
  const compact=edgeSubset(playable,e=>localEdges.has(e.id));
  compact.warnings=['Local v1 taxi routes: Ferry to Lombard and back, plus hilltop pickup and complete Lombard downhill. Use roadgraph-playable.json for other destinations.'];
  await atomicWrite(join(root,'roadgraph-local-play.json'),JSON.stringify(compact)+'\n');
  await atomicWrite(join(root,'local-play.json'),JSON.stringify(play,null,2)+'\n');
  await atomicWrite(join(root,'road-collision-audit.json'),JSON.stringify(audit,null,2)+'\n');
  return play;
}

/** One source-backed smoke for the playable slice. No network, full build, or performance suite. */
async function main() {
  const s=settings('lombard'),manifest=JSON.parse(await readFile(join(s.out,'manifest.json'),'utf8')) as MapManifest;
  const fields=new Map<string,ReturnType<typeof decodeHeightfield>>();
  for(const c of manifest.chunks)fields.set(c.id,decodeHeightfield(await readFile(join(s.out,c.terrain.path))));
  const ground:HeightSampler={sample:(x,z)=>{
    const cx=Math.floor(x/256),cz=Math.floor(z/256),f=fields.get(`${cx}_${cz}`);if(!f)throw new Error('Spawn chunk missing');
    const gx=(x-cx*256)/f.step,gz=(z-cz*256)/f.step,ix=Math.min(f.size-2,Math.floor(gx)),iz=Math.min(f.size-2,Math.floor(gz)),tx=gx-ix,tz=gz-iz;
    const at=(a:number,b:number)=>(f.offsetCm+f.values[b*f.size+a]!)/100;
    return (at(ix,iz)*(1-tx)+at(ix+1,iz)*tx)*(1-tz)+(at(ix,iz+1)*(1-tx)+at(ix+1,iz+1)*tx)*tz;
  }};
  const graph=JSON.parse(await readFile(join(s.out,manifest.roadGraph.path),'utf8')) as RoadGraph;
  const buildings=new Map<string,CollisionBuilding>();
  for(const chunk of manifest.chunks) {
    const collision=JSON.parse(await readFile(join(s.out,chunk.collision.path),'utf8')) as {origin:XYZ;buildings:{id:string;minY:number;maxY:number;rings:Polygon}[]};
    for(const b of collision.buildings)if(!buildings.has(b.id))buildings.set(b.id,{...b,polygon:b.rings.map(r=>r.map(([x,z])=>[x+collision.origin[0],z+collision.origin[2]]))});
  }
  const play=await writeLocalRoutes(s.out,graph,ground,[...buildings.values()]);
  if(!play)throw new Error('No Lombard route in this build');
  console.log(JSON.stringify({spawn:play.spawn,ferry:{pickup:play.ferry.pickup,outboundMetres:play.ferry.outboundMetres,returnMetres:play.ferry.returnMetres},network:play.network,downhill:{edges:play.downhill.edges,lengthM:play.downhill.lengthM,dropM:play.downhill.dropM},pickup:play.pickup},null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{console.error(error);process.exitCode=1;});
