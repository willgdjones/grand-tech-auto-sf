import type { HeightSampler, OsmExtract, Road, RoadEdge, RoadGraph, RoadNode, RoadPoint, XZ, XYZ } from './types';
import { isDrivable, laneCounts, restrictions } from './osm';
import { gradeSeparated, offsetPath, pathLength, resample, surfaceHeight } from './roads';
import { round } from './geometry';

interface Lane extends RoadEdge { start:RoadPoint;end:RoadPoint;roadId:string;segment:number;direction:1|-1;turns:string[] }
function speed(road:Road):number {
  const parse=(value:string|undefined)=>{
    if(!value)return;
    const m=/^([\d.]+)\s*(mph|km\/h|kph)?$/.exec(value);
    return m?Number(m[1])*(m[2]==='mph'?0.44704:1/3.6):undefined;
  };
  return Math.max(1,Math.min(40,parse(road.tags['maxspeed:advisory'])??parse(road.tags.maxspeed)??
    (road.tags.highway==='motorway'?24:road.tags.highway==='service'?4:11.18)));
}
function direction(points:XYZ[],end:boolean):XZ {
  const a=end?points.at(-2)!:points[0]!,b=end?points.at(-1)!:points[1]!;
  const dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz)||1;return [dx/length,dz/length];
}
function turnKind(incoming:Lane,outgoing:Lane):string {
  const a=direction(incoming.points,true),b=direction(outgoing.points,false);
  const angle=Math.atan2(a[0]*b[1]-a[1]*b[0],a[0]*b[0]+a[1]*b[1]);
  if(Math.abs(angle)>2.5)return 'reverse';
  return Math.abs(angle)<0.55?'through':angle>0?'right':'left';
}
function permitsLaneTurn(turns:string[],kind:string):boolean {
  return !turns.length||turns.includes('none')||turns.some(t=>t===kind||t.endsWith(`_${kind}`));
}
function connector(incoming:Lane,outgoing:Lane):XYZ[] {
  const a=incoming.points.at(-1)!,b=outgoing.points[0]!,u=direction(incoming.points,true),v=direction(outgoing.points,false);
  const span=Math.hypot(b[0]-a[0],b[2]-a[2]);
  if(span<0.01)return [[...a],[...b]];
  const tangent=Math.min(8,span/2),steps=Math.max(2,Math.ceil(span/2)),result:XYZ[]=[];
  for(let i=0;i<=steps;i++) {
    const t=i/steps,s=1-t;
    const x=s*s*s*a[0]+3*s*s*t*(a[0]+u[0]*tangent)+3*s*t*t*(b[0]-v[0]*tangent)+t*t*t*b[0];
    const z=s*s*s*a[2]+3*s*s*t*(a[2]+u[1]*tangent)+3*s*t*t*(b[2]-v[1]*tangent)+t*t*t*b[2];
    result.push([round(x),round(a[1]+(b[1]-a[1])*t),round(z)]);
  }
  return result;
}
export function buildRoadGraph(roads:Road[],osm:OsmExtract,terrain:HeightSampler):RoadGraph {
  const warnings:string[]=[],rules=restrictions(osm,warnings),drivable=roads.filter(r=>isDrivable(r.tags));
  const counts=new Map<string,Set<string>>();
  for(const road of drivable)for(const p of road.points) {
    const set=counts.get(p.id)??new Set();set.add(road.id);counts.set(p.id,set);
  }
  const nodes:RoadNode[]=[],lanes:Lane[]=[];
  for(const road of drivable) {
    if(gradeSeparated(road))
      warnings.push(`Road ${road.osmWay} uses an approximate bridge/tunnel deck profile`);
    const boundaries=[0,...road.points.flatMap((p,i)=>i>0&&i<road.points.length-1&&((counts.get(p.id)?.size??0)>1||p.control||p.yield)?[i]:[]),road.points.length-1];
    const count=laneCounts(road.tags);
    for(let segment=1;segment<boundaries.length;segment++) {
      const raw=road.points.slice(boundaries[segment-1],boundaries[segment]!+1);
      if(raw.length<2)continue;
      for(const dir of [1,-1] as const) {
        const number=dir===1?count.forward:count.backward;
        const route=dir===1?raw:[...raw].reverse();
        const both=count.forward>0&&count.backward>0;
        const laneWidth=road.width/(count.shared?1:count.forward+count.backward);
        for(let lane=0;lane<number;lane++) {
          const offset=count.shared?0:both?(lane+0.5)*laneWidth:(lane-(number-1)/2)*laneWidth;
          const horizontal=offsetPath(route.map(p=>[p.x,p.z]),offset);
          const points=resample(horizontal,3).map(([x,z]):XYZ=>[round(x),round(surfaceHeight(road,terrain,x,z)),round(z)]);
          if(points.length<2||pathLength(points)<0.01)continue;
          const id=`lane:${road.id}:${segment}:${dir}:${lane}`,from=`${id}:a`,to=`${id}:b`;
          const start=route[0]!,end=route.at(-1)!;
          for(const [nodeId,p,reference,isEnd] of [[from,points[0]!,start,false],[to,points.at(-1)!,end,true]] as const)
            nodes.push({id:nodeId,x:p[0],y:p[1],z:p[2],osmNode:reference.id,
              ...(isEnd&&reference.control?{control:reference.control}:{}),...(isEnd&&reference.yield?{yield:true}:{})});
          const turnTags=road.tags[`turn:lanes:${dir===1?'forward':'backward'}`]??(!both?road.tags['turn:lanes']:undefined);
          lanes.push({id,from,to,lengthM:Math.ceil(pathLength(points)*1000)/1000,speedMps:round(speed(road)),lane,points,kind:'lane',osmWay:road.osmWay,
            name:road.tags.name??'',inferredLanes:count.inferred,start,end,roadId:road.id,segment,direction:dir,
            layer:Number(road.tags.layer)||0,bridge:Boolean(road.tags.bridge&&road.tags.bridge!=='no'),tunnel:Boolean(road.tags.tunnel&&road.tags.tunnel!=='no'),
            // An empty turn:lanes slot means unspecified, not a lane with no legal exits.
            // Apply arrows at the OSM way's junction end, not at interior control splits.
            turns:end.id===(dir===1?road.points.at(-1)!.id:road.points[0]!.id)
              ?turnTags?.split('|')[lane]?.split(';').filter(Boolean)??[]:[]});
        }
      }
    }
  }
  const outgoing=new Map<string,Lane[]>();
  for(const lane of lanes){const list=outgoing.get(lane.start.id)??[];list.push(lane);outgoing.set(lane.start.id,list);}
  const edges:RoadEdge[]=lanes.map(({start:_s,end:_e,roadId:_r,segment:_i,direction:_d,turns:_t,...edge})=>edge);
  for(const incoming of lanes) {
    const candidates=outgoing.get(incoming.end.id)??[];
    for(const next of candidates) {
      const reverse=next.roadId===incoming.roadId&&next.segment===incoming.segment&&next.direction!==incoming.direction;
      if(reverse&&candidates.some(c=>c.roadId!==incoming.roadId||c.segment!==incoming.segment))continue;
      if(next.id===incoming.id)continue;
      if(rules.some(r=>r.from===incoming.osmWay&&r.via===incoming.end.id&&(r.only?next.osmWay!==r.to:next.osmWay===r.to)))continue;
      const kind=turnKind(incoming,next);
      if(!permitsLaneTurn(incoming.turns,kind))continue;
      if(kind==='through'&&incoming.osmWay===next.osmWay&&incoming.lane!==next.lane)continue;
      const points=connector(incoming,next);
      edges.push({id:`turn:${incoming.id}>${next.id}`,from:incoming.to,to:next.from,lengthM:Math.max(0.001,Math.ceil(pathLength(points)*1000)/1000),
        speedMps:Math.min(incoming.speedMps,next.speedMps,kind==='through'?15:4),lane:next.lane,points,kind:'connector',
        osmWay:next.osmWay,name:next.name,inferredLanes:incoming.inferredLanes||next.inferredLanes,layer:next.layer,bridge:next.bridge,tunnel:next.tunnel});
    }
  }
  const adjacency=new Map<string,string[]>();
  for(const edge of edges){const list=adjacency.get(edge.from)??[];list.push(edge.id);adjacency.set(edge.from,list);}
  for(const edge of edges)edge.next=(adjacency.get(edge.to)??[]).sort();
  return {version:1,nodes:nodes.sort((a,b)=>a.id.localeCompare(b.id)),edges:edges.sort((a,b)=>a.id.localeCompare(b.id)),warnings:[...new Set(warnings)].sort()};
}
/** A* uses travel distance (not speed) so Euclidean distance is an admissible heuristic. */
export function findRoute(graph:RoadGraph,from:string,to:string):string[]|undefined {
  const nodes=new Map(graph.nodes.map(n=>[n.id,n])),target=nodes.get(to);
  if(!nodes.has(from)||!target)return;
  const adjacent=new Map<string,RoadEdge[]>();
  for(const e of graph.edges){const list=adjacent.get(e.from)??[];list.push(e);adjacent.set(e.from,list);}
  const heap:{id:string;score:number}[]=[];
  const push=(entry:{id:string;score:number})=>{heap.push(entry);let i=heap.length-1;while(i>0){const p=(i-1)>>1;if(heap[p]!.score<=entry.score)break;heap[i]=heap[p]!;i=p;}heap[i]=entry;};
  const pop=()=>{const first=heap[0]!,last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1]!.score<heap[c]!.score)c++;if(heap[c]!.score>=last.score)break;heap[i]=heap[c]!;i=c;}heap[i]=last;}return first;};
  const heuristic=(id:string)=>{const n=nodes.get(id)!;return Math.hypot(n.x-target.x,n.y-target.y,n.z-target.z);};
  const costs=new Map<string,number>([[from,0]]),previous=new Map<string,RoadEdge>(),closed=new Set<string>();push({id:from,score:heuristic(from)});
  while(heap.length) {
    const {id}=pop();if(closed.has(id))continue;
    if(id===to){const result:string[]=[];let current=to;while(current!==from){const e=previous.get(current)!;result.push(e.id);current=e.from;}return result.reverse();}
    closed.add(id);
    for(const e of adjacent.get(id)??[]){const cost=costs.get(id)!+e.lengthM;if(cost<(costs.get(e.to)??Infinity)){costs.set(e.to,cost);previous.set(e.to,e);push({id:e.to,score:cost+heuristic(e.to)});}}
  }
  return;
}
/** Iterative Kosaraju avoids blowing the JS stack on the full city. */
export function components(graph:RoadGraph):string[][] {
  const forward=new Map<string,string[]>(),backward=new Map<string,string[]>();
  for(const n of graph.nodes){forward.set(n.id,[]);backward.set(n.id,[]);}
  for(const e of graph.edges){forward.get(e.from)!.push(e.to);backward.get(e.to)!.push(e.from);}
  const visited=new Set<string>(),order:string[]=[];
  for(const n of graph.nodes) {
    if(visited.has(n.id))continue;
    const stack:[string,boolean][]=[[n.id,false]];
    while(stack.length){const [id,exit]=stack.pop()!;if(exit){order.push(id);continue;}if(visited.has(id))continue;visited.add(id);stack.push([id,true]);for(const next of forward.get(id)!)if(!visited.has(next))stack.push([next,false]);}
  }
  visited.clear();const result:string[][]=[];
  for(const start of order.reverse()) {
    if(visited.has(start))continue;
    const group:string[]=[],stack=[start];visited.add(start);
    while(stack.length){const id=stack.pop()!;group.push(id);for(const next of backward.get(id)!)if(!visited.has(next)){visited.add(next);stack.push(next);}}
    result.push(group.sort());
  }
  return result.sort((a,b)=>b.length-a.length||a[0]!.localeCompare(b[0]!));
}
