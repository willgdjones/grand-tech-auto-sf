import type { RoadEdge, RoadGraph, RoadNode } from '@gtasf/shared/roadgraph';
import { flags } from '@gtasf/shared/flags';
import { createRoadSampler, createRoadSnapper } from '../chunks/terrain';
import { districtAt } from '../../../../tools/map/src/districts';
import { registerPlaza } from '../plazas';
import { SF_FRAME } from '../../../../tools/map/src/config';
import { geodeticToWorld } from '../../../../tools/map/src/geo';

export type PropKind='pole'|'light'|'trafficStop'|'parkingMeter'|'hydrant'|'newspaper'|'stop'|'palm'|'plane'|'cypress'|'fence'|'cone'|'bin'|'mailbox'|'bikeRack'|'streetLamp'|'bench'|'bicycle'|'planter'|'treeWell'|'eucalyptus'|'pine'|'ficus'|'yardPlanter'|'monument'|'bollard'|'shopGlow';
const SMALL_FURNITURE=new Set<string>(['bench','bin','newspaper','planter','parkingMeter','bollard','hydrant']);
export type PropDensity='route'|'city';
export interface PropSite {
  id:number;kind:PropKind;x:number;y:number;z:number;yaw:number;street:string;density:PropDensity;
  /** Only source-controlled approaches may create a mast-arm traffic light. */
  signalNodeId?:string;signalJunction?:string;stopNodeId?:string;sourceEdgeId?:string;
  /** DataSF street tree (flags.realStreetTrees): height comes from the ground at mount; scale from its DBH class. */
  real?:true;scale?:number;
}
export interface WireSpan {a:PropSite;b:PropSite;muni:boolean;crossStreet?:boolean}
export interface PropCell {sites:PropSite[];wires:WireSpan[]}
type Road=RoadEdge&{name?:string;kind?:string;bridge?:boolean;tunnel?:boolean;layer?:number;osmWay?:number};
type Node=RoadNode&{osmNode?:string};
type Point=readonly[number,number,number];
type SourceRoad={edge:Road;from:string;to:string;name:string};
type Chain={name:string;points:Point[]};
export type RoadHeightAt=((x:number,z:number,referenceY?:number)=>number|null)&{
  contains?:(x:number,z:number,referenceY?:number)=>boolean;
};
export type KerbCarSpot={x:number;y:number;z:number;yaw:number;street:string;seed:number};
const CELL=128;
const HALF_TURN=Math.PI/2;
const cellKey=(x:number,z:number)=>`${Math.floor(x/CELL)}_${Math.floor(z/CELL)}`;

/** Dense downtown cores where street dressing runs on every sourced street, matching the real
 *  grid. World-metre boxes [x0,z0,x1,z1] from the SF_FRAME projection (-z is north).
 *  [gtasf-0rt5] Deploy #6: realistic street detail on the main route plus SoMa and FiDi. */
const DENSE_DISTRICTS:readonly(readonly[number,number,number,number])[]=[
  [350,-1400,1300,-500], // Financial District core (centre ~634,-1154; south to the Salesforce Tower ~934,-611)
  [-150,-520,1350,1050], // SoMa + downtown core south of Market (centre ~775,633; Union Square ~26,-422)
];
/** Dense authored arrival/drive corridor and downtown cores; the rest of any supplied graph is sparse. */
export function streetPropDensity(x:number,z:number,street:string):PropDensity {
  // Ferry -> Lombard arrival corridor: arterials only, unchanged (look-reviewed).
  if(x>=-1120&&x<=1470&&z>=-2370&&z<=-1030
    &&/^(?:The Embarcadero|Columbus Avenue|Stockton Street|Lombard Street|Broadway|Hyde Street)$/.test(street))return 'route';
  // Financial District and SoMa grids: every ground street. Freeways/ramps/connectors are excluded
  // upstream by groundRoad(), so the boxes never dress an elevated carriageway.
  for(const [x0,z0,x1,z1] of DENSE_DISTRICTS)if(x>=x0&&x<=x1&&z>=z0&&z<=z1)return 'route';
  // Keep extra density on the same sourced frontages selected by the map bake.
  if(districtAt(x,z)?.streets.includes(street))return 'route';
  return 'city';
}
/** Keep the existing waterfront/boulevard palms; authored regions supply the
 * remaining canopy mix, with plane/cypress as the unprofiled city fallback. */
const PALM_STREETS=/^(?:The Embarcadero|Dolores Street)$/;
// Leafy residential neighbourhoods for denseResidentialTrees canopy fill (not every district sets
// defaultBuildingUse='residential'). Excludes the downtown cores (dense/route anyway) and the parks.
const LEAFY_RESIDENTIAL=new Set(['mission','noe-valley','haight-ashbury','castro','hayes-valley','pacific-heights','cow-hollow','marina','richmond','sunset','bernal-heights','potrero-hill','glen-park','excelsior','western-addition','japantown','dogpatch','bayview']);
export function streetTreeKind(street:string,choice:number,x?:number,z?:number,sixSpecies=false):PropKind {
  if(flags.graphicsV2){
    if(street==='The Embarcadero')return choice%3===2?'plane':'palm';
    const district=x===undefined||z===undefined?undefined:districtAt(x,z)?.id;
    if(district==='ocean-beach')return sixSpecies&&choice%3===0?'pine':'cypress';
    if(sixSpecies&&district!=='fidi'&&district!=='soma'&&district!=='moscone'){
      if(choice%7===0)return 'eucalyptus';
      if(choice%5===0)return 'pine';
      if(choice%3===0)return 'ficus';
    }
    if(sixSpecies&&choice%4===0)return 'ficus';
    if(district==='fidi'||district==='soma'||district==='moscone')return choice%5===4?'cypress':'plane';
  }
  if(PALM_STREETS.test(street)&&choice%3===0)return 'palm';
  const trees=x===undefined||z===undefined?undefined:districtAt(x,z)?.trees;
  if(trees?.length)return trees[choice%trees.length]!;
  return choice%3===0?'cypress':'plane';
}
function hash(value:string){let n=2166136261;for(let i=0;i<value.length;i++)n=Math.imul(n^value.charCodeAt(i),16777619);return n>>>0;}
function groundRoad(edge:Road){return edge.kind!=='connector'&&!edge.bridge&&!edge.tunnel&&!edge.layer&&edge.lane===0&&edge.speedMps<=22&&edge.points.length>1;}
function horizontalLength(points:readonly Point[]){let result=0;for(let i=1;i<points.length;i++)result+=Math.hypot(points[i]![0]-points[i-1]![0],points[i]![2]-points[i-1]![2]);return result;}

/** Batches yield during city-wide construction; the existing world road index can be reused. */
export async function createStreetPropLayout(graph:RoadGraph,options:{roadHeightAt?:RoadHeightAt;yieldToMain?:()=>Promise<void>;graphicsV2Hd?:boolean;onPlaza?:(minX:number,minZ:number,maxX:number,maxZ:number)=>void}={}) {
  const cells=new Map<string,PropCell>(),occupied=new Map<number,PropSite[]>();
  // Numeric 16 m grid key (gtasf-c8sj: string keys dominated the whole-city layout on phones).
  const occKey=(gx:number,gz:number)=>(gx+32768)*65536+(gz+32768);
  // Knockable loose props (cones/bins) ship with the loose-arcade knock-over feature; they only exist
  // when flags.propKnockover is on, so the live playtest fleet is unchanged until pane 6 flips it.
  const knockoverProps=flags.propKnockover;
  // Realistic street furniture and denser canopy (gtasf-street-furniture-realistic-bkc0).
  const polish=flags.graphicsV2&&options.graphicsV2Hd===true;
  const detail=flags.streetDetail||polish;
  // lowStreetFurniture: run the commercial-frontage furniture (benches/newsracks/bins/planters/meters/bollards)
  // on the Low path too, so the Ferry->Market spawn walk isn't empty sidewalks on phone. HD keeps `polish`.
  const lowFurn=flags.graphicsV2&&('lowStreetFurniture' in flags&&flags.lowStreetFurniture)&&!polish;
  const furnYield='lowStreetFurniture' in flags&&flags.lowStreetFurniture===true;
  const roadAt=options.roadHeightAt??createRoadSampler(graph);
  const roadContains=roadAt.contains??((x:number,z:number,y?:number)=>roadAt(x,z,y)!==null);
  // residentialYardTrees: nearest-road distance query (three-free, same source graph as the sampler), built ONCE
  // outside the point loop and only when the flag is on, so the per-chunk layout is byte-identical when off.
  const yardSnap=flags.residentialYardTrees?createRoadSnapper(graph):undefined;
  const yieldToMain=options.yieldToMain??(()=>new Promise<void>(resolve=>setTimeout(resolve,0)));
  let batchStarted=performance.now(),work=0,sequence=0;
  // Most scanned nodes/edges do not exhaust the time budget. Avoid allocating and
  // awaiting a resolved Promise for each one; only pause when returning to the UI.
  function checkpoint():Promise<void>|undefined {
    if((++work&31)===0&&performance.now()-batchStarted>=5)
      return yieldToMain().then(()=>{batchStarted=performance.now();});
    return undefined;
  }
  function cell(x:number,z:number){const key=cellKey(x,z);let value=cells.get(key);if(!value){value={sites:[],wires:[]};cells.set(key,value);}return value;}
  function crowded(x:number,z:number,radius:number,kind:PropKind,yaw:number,street:string){
    for(let gx=Math.floor((x-radius)/16);gx<=Math.floor((x+radius)/16);gx++)for(let gz=Math.floor((z-radius)/16);gz<=Math.floor((z+radius)/16);gz++)
      for(const p of occupied.get(occKey(gx,gz))??[]){
        const dx=p.x-x,dz=p.z-z,d2=dx*dx+dz*dz;if(d2>=radius*radius)continue;const distance=Math.sqrt(d2);
        // Poles on opposite sidewalks are intentional pairs, including narrow streets.
        if(kind==='pole'&&p.kind==='pole'&&p.street===street&&distance>=8&&Math.cos(p.yaw-yaw)<-.8)continue;
        // lowStreetFurniture: the commercial dressing spans a whole pole segment (up to 30 m along), so it fell inside the
        // NEXT pole's 18 m / lamp's 10 m clearance and deleted that pole, its wires and lamp (~25% fewer poles on Market).
        // Small furniture only blocks a pole/lamp it actually touches.
        if(furnYield&&(kind==='pole'||kind==='streetLamp')&&SMALL_FURNITURE.has(p.kind)&&distance>=2)continue;
        // shopfrontGlow: light-only sites (no mesh, no collision) never block a prop and are never blocked by one.
        if(p.kind==='shopGlow'||kind==='shopGlow')continue;
        return true;
      }
    return false;
  }
  function place(kind:PropKind,x:number,y:number,z:number,yaw:number,street:string,radius=3,source?:{signalNodeId?:string;signalJunction?:string;stopNodeId?:string;sourceEdgeId:string}):PropSite|null {
    // Companions move along the street but retain their pole's reference height.
    // Query ground lanes without that stale height, which can hide a crossing
    // road on a hill. The sampler still excludes separate bridge/tunnel decks.
    if(roadContains(x,z)||crowded(x,z,radius,kind,yaw,street))return null;
    const p:PropSite={id:++sequence,kind,x,y,z,yaw,street,density:streetPropDensity(x,z,street),...source};cell(x,z).sites.push(p);
    const key=occKey(Math.floor(x/16),Math.floor(z/16)),list=occupied.get(key)??[];list.push(p);occupied.set(key,list);return p;
  }
  function curb(x:number,y:number,z:number,nx:number,nz:number){
    for(let offset=5.2;offset<24;offset+=1.4){const px=x+nx*offset,pz=z+nz*offset;if(!roadContains(px,pz,y))return {x:px,z:pz};}
    return null;
  }
  function wire(a:PropSite,b:PropSite,muni:boolean,crossStreet=false){
    const distance=Math.hypot(a.x-b.x,a.z-b.z);
    if(distance<6||distance>140||(!crossStreet&&Math.cos(a.yaw-b.yaw)<.65))return;
    cell((a.x+b.x)/2,(a.z+b.z)/2).wires.push({a,b,muni,crossStreet});
  }
  const nodes=new Map<string,Node>();
  for(const node of graph.nodes as Node[]){nodes.set(node.id,node);const pause=checkpoint();if(pause)await pause;}

  // Reserve actual controls before decorative poles. Signals keep their first
  // placement priority; stop signs then mark the other source-controlled approaches.
  // Both face incoming traffic, using the original OSM node to deduplicate lanes.
  const controlledApproaches=new Set<string>();
  for(const control of ['signal','stop'] as const)for(const edge of graph.edges as Road[]){
    const pause=checkpoint();if(pause)await pause;if(!groundRoad(edge))continue;
    const node=nodes.get(edge.to);if(node?.control!==control)continue;
    const end=edge.points.at(-1)!,before=edge.points.at(-2)!,dx=end[0]-before[0],dz=end[2]-before[2],length=Math.hypot(dx,dz);if(length<.1)continue;
    const tx=dx/length,tz=dz/length,heading=Math.round(Math.atan2(tx,tz)*4/Math.PI);
    const sourceKey=`${control}:${node.osmNode??node.id}:${heading}`;if(controlledApproaches.has(sourceKey))continue;
    // A short upstream setback leaves junction mouths and crossing roads clear.
    for(const setback of control==='signal'?[5,9,14]:[2,4,7]){
      const x=end[0]-tx*setback,z=end[2]-tz*setback,spot=curb(x,end[1],z,tz,-tx);if(!spot)continue;
      const source={sourceEdgeId:edge.id,...(control==='signal'?{signalNodeId:node.id,signalJunction:node.osmNode??node.id}:{stopNodeId:node.id})};
      const sign=place(control==='signal'?'light':'trafficStop',spot.x,end[1],spot.z,Math.atan2(-tx,-tz),edge.name?.trim()||'Unnamed street',control==='signal'?7:4,source);
      if(sign){controlledApproaches.add(sourceKey);break;}
    }
  }

  // Merge physical street pieces across OSM way splits. Opposing lane-zero edges
  // describe the same street; source endpoints, not lane-offset positions, join them.
  const roads:SourceRoad[]=[],physical=new Map<string,Map<string,Set<string>>>(),adjacency=new Map<string,SourceRoad[]>();
  function nodeKey(id:string,p:Point){return nodes.get(id)?.osmNode??`${Math.round(p[0])}:${Math.round(p[2])}`;}
  function junction(name:string,id:string){return `${name}|${id}`;}
  for(const edge of graph.edges as Road[]){
    const pause=checkpoint();if(pause)await pause;if(!groundRoad(edge))continue;
    const name=edge.name?.trim();if(!name)continue;
    const from=nodeKey(edge.from,edge.points[0]!),to=nodeKey(edge.to,edge.points.at(-1)!);
    // Nested way -> low end -> high end sets: no per-edge key concatenation (gtasf-c8sj, phone layout cost).
    const a=String(from),b=String(to),lo=a<b?a:b,hi=a<b?b:a,way=String(edge.osmWay??name);
    let byLo=physical.get(way);if(!byLo){byLo=new Map();physical.set(way,byLo);}
    let his=byLo.get(lo);if(!his){his=new Set();byLo.set(lo,his);}
    if(his.has(hi))continue;his.add(hi);
    const road={edge,from,to,name};roads.push(road);
    for(const end of [from,to]){const key=junction(name,end),list=adjacency.get(key)??[];list.push(road);adjacency.set(key,list);}
  }
  const visited=new Set<SourceRoad>(),chains:Chain[]=[];
  async function trace(first:SourceRoad,start:string){
    const chain:Chain={name:first.name,points:[]};let road:SourceRoad|undefined=first,at=start;
    while(road&&!visited.has(road)){
      visited.add(road);const forwards=road.from===at,points=forwards?road.edge.points:[...road.edge.points].reverse();
      // Consecutive source lane ends can differ by their 1.6m lane offsets.
      // Keeping the short join preserves alignment without inventing a street shortcut.
      chain.points.push(...points);at=forwards?road.to:road.from;
      const continuations:SourceRoad[]=adjacency.get(junction(road.name,at))??[];
      road=continuations.length===2?continuations.find(next=>!visited.has(next)):undefined;
      const pause=checkpoint();if(pause)await pause;
    }
    if(chain.points.length>1)chains.push(chain);
  }
  // Start at junctions/endpoints before closed loops, to avoid splitting ordinary streets.
  for(const road of roads){
    if(visited.has(road))continue;
    const fromDegree=adjacency.get(junction(road.name,road.from))!.length,toDegree=adjacency.get(junction(road.name,road.to))!.length;
    if(fromDegree!==2||toDegree!==2)await trace(road,fromDegree!==2?road.from:road.to);
  }
  for(const road of roads)if(!visited.has(road))await trace(road,road.from);

  const meters:{x:number;y:number;z:number;yaw:number;street:string}[]=[];
  // Kerbside parked-car candidates (gtasf-7moo): in the outer road strip, parallel to the kerb.
  const kerb:KerbCarSpot[]=[];
  for(const chain of chains){
    const points=chain.points,total=horizontalLength(points);if(total<26)continue;
    let distance=0,next=14;
    const last:[PropSite|null,PropSite|null]=[null,null];
    const muni=/^(?:Market Street|The Embarcadero|Columbus Avenue|Stockton Street|Powell Street|Hyde Street|California Street|Sutter Street|Sacramento Street)$/.test(chain.name);
    for(let i=1;i<points.length;i++){
      const a=points[i-1]!,b=points[i]!,dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz);if(length<.01)continue;
      const tx=dx/length,tz=dz/length;
      while(next<=distance+length&&next<total-10){
        const pause=checkpoint();if(pause)await pause;
        const t=(next-distance)/length,x=a[0]+dx*t,y=a[1]+(b[1]-a[1])*t,z=a[2]+dz*t;
        const density=streetPropDensity(x,z,chain.name),dense=density==='route',seed=hash(`${chain.name}:${Math.round(x)}:${Math.round(z)}`);
        const pair:[PropSite|null,PropSite|null]=[null,null];
        for(let side=0;side<2;side++){
          const sign=side===0?1:-1,nx=-tz*sign,nz=tx*sign,spot=curb(x,y,z,nx,nz);if(!spot)continue;
          const px=spot.x,pz=spot.z,yaw=Math.atan2(nx,nz),pole=place('pole',px,y,pz,yaw,chain.name,dense?18:34);
          if(!pole)continue;
          pair[side]=pole;const previous=last[side];if(previous)wire(previous,pole,muni);last[side]=pole;
        }
        // Place both supports before their companion furniture so a tree on one
        // sidewalk cannot accidentally suppress the opposite utility pole.
        for(let side=0;side<2;side++){
          const pole=pair[side];if(!pole)continue;
          const {x:px,z:pz,yaw}=pole,nx=Math.sin(yaw),nz=Math.cos(yaw);
          const choice=(seed+side*19)>>>0;
          // Sparse outer streets have wider pole intervals and fewer companion props.
          if(!flags.realStreetTrees&&(dense||choice%3===0))place(streetTreeKind(chain.name,choice,px+tx*9,pz+tz*9,polish),px+tx*9,y,pz+tz*9,yaw,chain.name,7);
          if(choice%(dense?3:5)===0)place('hydrant',px-tx*7,y,pz-tz*7,yaw,chain.name);
          if(choice%(dense?4:9)===0)place('newspaper',px+tx*15,y,pz+tz*15,yaw+Math.PI,chain.name);
          if(muni&&choice%5===1)place('stop',px-tx*12,y,pz-tz*12,yaw+Math.PI,chain.name);
          if(choice%(dense?11:23)===0)place('fence',px+nx*3+tx*22,y,pz+nz*3+tz*22,yaw,chain.name,5);
          if(knockoverProps&&choice%(dense?5:13)===2)place('cone',px-tx*4,y,pz-tz*4,yaw,chain.name,2);
          if(knockoverProps&&choice%(dense?8:17)===5)place('bin',px+nx*2+tx*18,y,pz+nz*2+tz*18,yaw+Math.PI,chain.name,2);
          if(polish){
            const residential=districtAt(px,pz)?.defaultBuildingUse==='residential';
            if(residential&&choice%2===0)for(const along of [-1,1])place('yardPlanter',px+nx*4+tx*(22+along),y,pz+nz*4+tz*(22+along),yaw,chain.name,1.2);
            // denseResidentialTrees: fill the leafy residential canopy between the real DataSF trees (crowded(6)
            // keeps these off the real ones/poles). Three per ~72 m pole segment per side, so ~every 12 m combined.
            if(flags.denseResidentialTrees&&LEAFY_RESIDENTIAL.has(districtAt(px,pz)?.id??''))for(const off of [12,28,44,60]){
              // real=true so each fill tree is ground-sampled at mount (hilly residential streets diverge >7 m from
              // the pole's y over 60 m, which would otherwise reject it), exactly like the DataSF trees.
              const fill=place(streetTreeKind(chain.name,choice+off,px+tx*off,pz+tz*off,polish),px+tx*off,y,pz+tz*off,yaw,chain.name,6);
              if(fill)fill.real=true;
            }
            if(choice%3===1)place('planter',px+nx*1.5-tx*24,y,pz+nz*1.5-tz*24,yaw,chain.name,2);
            if(choice%3===0)place('bench',px+nx*1.5-tx*23,y,pz+nz*1.5-tz*23,yaw+Math.PI,chain.name,3);
            if(choice%3===1)place('bin',px+tx*19,y,pz+tz*19,yaw+Math.PI,chain.name,2);
            if(choice%3===2)place('hydrant',px-tx*5,y,pz-tz*5,yaw,chain.name,2);
          }
          // residentialYardTrees: a sparse rear-yard tree CLUMP deep in the block interior — real SF canopy sits in
          // the backyards, not on the sidewalk. Both sides (the loop runs side 0/1); hash-gated to ~1/6 of pole
          // segments per side so it stays "a few clumps", not a forest. A nearest-road distance query confirms the
          // clump centre is a genuine mid-block backyard (past the carriageway+sidewalk, not an adjacent street), so
          // narrow/irregular blocks (a cross street within 18 m) reject. Not polish-gated: the phone/Low build gets
          // them too (they reuse the raised tree capacity), which is the pose the phone-perf gate measures.
          if(yardSnap&&choice%6===0&&LEAFY_RESIDENTIAL.has(districtAt(px,pz)?.id??'')){
            const depth=26,along=((choice>>5)&7)-3.5;               // ~±3.5 m along-street so the clump is off the pole
            const bx=px+nx*depth+tx*along,bz=pz+nz*depth+tz*along;
            const road=yardSnap(bx,bz,45),roadDist=road?Math.hypot(bx-road.x,bz-road.z):45;
            if(roadDist>18){
              // Members ~7 m apart (> crowdRadius 6) so all survive the crowd check yet their ~9 m canopies overlap
              // into one clump; crowdRadius 6 also keeps the clump clear of poles/planters and real DataSF trees.
              const spots:[number,number][]=[[0,0],[7.5,0],[-3,7]],count=2+((choice>>8)&1); // 2, or 3 on ~half
              for(let t=0;t<count;t++){
                const [u,v]=spots[t]!,cx=bx+tx*u+nx*v,cz=bz+tz*u+nz*v;
                const tree=place(streetTreeKind(chain.name,choice+t*17,cx,cz,polish),cx,y,cz,yaw,chain.name,6);
                if(tree)tree.real=true; // ground-sample at mount, like the DataSF trees, so hilly blocks keep the clump
              }
            }
          }
          if(detail){
            // Cobra-head lamps sit between utility poles; trees fill the remaining sidewalk.
            if(dense||choice%2===0)place('streetLamp',px+tx*(dense?22:48),y,pz+tz*(dense?22:48),yaw,chain.name,10);
            if(!flags.realStreetTrees&&(dense||choice%2===1))place(streetTreeKind(chain.name,choice+1,px-tx*18,pz-tz*18,polish),px-tx*18,y,pz-tz*18,yaw,chain.name,7);
            if(!flags.realStreetTrees&&dense&&choice%2===0)place(streetTreeKind(chain.name,choice+2,px+tx*31,pz+tz*31,polish),px+tx*31,y,pz+tz*31,yaw,chain.name,7);
            if(choice%(dense?6:17)===3)place('mailbox',px+tx*4.5,y,pz+tz*4.5,yaw+Math.PI,chain.name,3);
            if(choice%(dense?5:15)===4)place(polish?'bicycle':'bikeRack',px-tx*10,y,pz-tz*10,polish?yaw:yaw+HALF_TURN,chain.name,3);
          }
          // The Embarcadero promenade counts as commercial frontage too (founder tour: empty flat waterfront).
          if((polish||lowFurn)&&(chain.name==='The Embarcadero'||dense&&districtAt(px,pz)?.defaultBuildingUse!=='residential')){
            // Dense commercial sidewalk dressing (gtasf-7moo + lowStreetFurniture: a VISIBLE clutter payoff along the
            // Ferry->Market spawn walk, on Low too). Furniture is spread along the whole pole segment, not one cluster,
            // so the sidewalk reads busy: two benches + two newsracks + two planters, a parking-meter run and a bollard
            // run along the kerb, a bin and a hydrant. crowded() + the per-kind instance cap keep it bounded.
            place('bench',px+nx*1.5+tx*12,y,pz+nz*1.5+tz*12,yaw+Math.PI,chain.name,2.5);
            place('bench',px+nx*1.5-tx*20,y,pz+nz*1.5-tz*20,yaw+Math.PI,chain.name,2.5);
            place('bin',px+nx*1.2-tx*13,y,pz+nz*1.2-tz*13,yaw+Math.PI,chain.name,1.5);
            place('newspaper',px-tx*17,y,pz-tz*17,yaw+Math.PI,chain.name,1.5);
            // Low (lowFurn) keeps the look-carrying pieces (benches, planters, bins, one newsrack, two meters) and drops the
            // bollard run: lane B's firefight ABBA measured ~2.5 fps for the full set on a 4x phone (per-instance culling).
            if(!lowFurn)place('newspaper',px+nx*1.2+tx*30,y,pz+nz*1.2+tz*30,yaw+Math.PI,chain.name,1.5);
            if(choice%2===0)place('hydrant',px+tx*27,y,pz+tz*27,yaw,chain.name,2);
            place('planter',px+nx*1.4+tx*6,y,pz+nz*1.4+tz*6,yaw,chain.name,1.5);
            place('planter',px+nx*1.4-tx*28,y,pz+nz*1.4-tz*28,yaw,chain.name,1.5);
            for(const m of lowFurn?[-8,16]:[-8,4,16,28])place('parkingMeter',px+nx*0.6+tx*m,y,pz+nz*0.6+tz*m,yaw,chain.name,1.1);
            if(!lowFurn)for(const b of [0,4,8,12,16])place('bollard',px+nx*0.3+tx*(9+b),y,pz+nz*0.3+tz*(9+b),yaw,chain.name,0.9);
          }
          // shopfrontGlow (lane D, critic N23 residual): lit-shopfront spill on commercial frontages at night, as light-only
          // sites 4 m back from the kerb (the lamp map draws them as warm/cool sidewalk pools that wet roads also mirror).
          if(flags.shopfrontGlow&&(chain.name==='The Embarcadero'||dense&&districtAt(px,pz)?.defaultBuildingUse!=='residential'))
            for(const along of [-14,2,18])place('shopGlow',px+nx*4+tx*along,y,pz+nz*4+tz*along,yaw,chain.name,.5);
          if(flags.kerbParkedCars&&flags.graphicsV2&&next>16&&next<total-16){
            // Pole sits on the sidewalk; walk back toward the road to the kerb, then 1.2 m into the lane.
            for(const along of [-15,3,21]){
              const ax=px+tx*along,az=pz+tz*along;let edge=-1;
              for(let back=.4;back<6;back+=.4)if(roadContains(ax-nx*back,az-nz*back,y)){edge=back;break;}
              if(edge<0)continue;
              const cx=ax-nx*(edge+1.2),cz=az-nz*(edge+1.2);
              if(!roadContains(cx-nx*1.4,cz-nz*1.4,y))continue; // too narrow for a parking strip
              kerb.push({x:cx,y,z:cz,yaw:Math.atan2(tx,tz)+(((choice>>3)+along)&1?Math.PI:0),street:chain.name,seed:(choice+along*7)>>>0});
            }
          }
          if(choice%(dense?3:7)===0)meters.push({x:px-tx*14,y,z:pz-tz*14,yaw:yaw+Math.PI,street:chain.name});
        }
        if(pair[0]&&pair[1]&&seed%3===0)wire(pair[0],pair[1],false,true);
        next+=polish?(dense?36:72):(dense?44:96);
      }
      distance+=length;
    }
  }
  // Final pass: meters can never displace source controls or existing furniture.
  for(const meter of meters){const pause=checkpoint();if(pause)await pause;place('parkingMeter',meter.x,meter.y,meter.z,meter.yaw,meter.street);}
  // Union Square (gtasf-7moo): the real granite plaza between Powell/Stockton and Geary/Post,
  // derived from the sourced street centrelines; Dewey Monument at the centre, palms and benches.
  // unionSquarePlazaLow: also run on the Low preset (polish is HD-only), otherwise the phone renders Union Square
  // as a flat green lawn with no granite/column/palms. The urbanSurfaces granite conversion already runs on Low.
  if(polish || (flags.unionSquarePlazaLow && flags.graphicsV2)){
    const near=(name:string)=>(graph.edges as Road[]).filter(e=>e.name?.trim()===name)
      .flatMap(e=>e.points).filter(p=>Math.hypot(p[0]-26,p[2]+422)<260);
    const median=(values:number[])=>values.length?[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]!:NaN;
    const west=median(near('Powell Street').map(p=>p[0])),east=median(near('Stockton Street').map(p=>p[0]));
    const north=median(near('Post Street').map(p=>p[2])),south=median(near('Geary Street').map(p=>p[2]));
    const minX=Math.min(west,east)+10,maxX=Math.max(west,east)-10,minZ=Math.min(north,south)+10,maxZ=Math.max(north,south)-10;
    if(Number.isFinite(minX+maxX+minZ+maxZ)&&maxX-minX>30&&maxX-minX<160&&maxZ-minZ>30&&maxZ-minZ<160){
      (options.onPlaza??registerPlaza)(minX,minZ,maxX,maxZ);
      const cx=(minX+maxX)/2,cz=(minZ+maxZ)/2,ys=near('Powell Street').map(p=>p[1]),y=median(ys);
      place('monument',cx,y,cz,0,'Union Square',2);
      for(const [fx,fz] of [[0,0],[1,0],[0,1],[1,1]] as const){
        const px=minX+4+(maxX-minX-8)*fx,pz=minZ+4+(maxZ-minZ-8)*fz;
        place('palm',px,y,pz,0,'Union Square',3);
        place('palm',px+(fx?-9:9),y,pz,0,'Union Square',3);
        place('palm',px,y,pz+(fz?-9:9),0,'Union Square',3);
      }
      for(let i=0;i<4;i++){const a=i*Math.PI/2;
        place('bench',cx+Math.sin(a)*13,y,cz+Math.cos(a)*13,a+Math.PI,'Union Square',2);
        place('planter',cx+Math.sin(a+Math.PI/4)*17,y,cz+Math.cos(a+Math.PI/4)*17,a,'Union Square',2);
        place('bin',cx+Math.sin(a+.35)*15,y,cz+Math.cos(a+.35)*15,a,'Union Square',1.5);
      }
      for(const fx of [.25,.75])for(const fz of [.08,.92])place('bench',minX+(maxX-minX)*fx,y,minZ+(maxZ-minZ)*fz,fz<.5?0:Math.PI,'Union Square',2);
    }
  }
  // Embarcadero promenade (night lane): the bay-side walk gets planters, benches, bins and a tree rhythm
  // instead of reading as one empty paved strip. Bay side = away from Union Square. [gtasf-67vc]
  if(polish&&flags.embarcaderoPromenade){
    // Keep the Ferry spawn plaza and its pedestrian walker routes clear. [gtasf-rl2b]
    const ferry=geodeticToWorld(37.7955,-122.3937,SF_FRAME);
    let next=0;
    for(const edge of (graph.edges as Road[]).filter(e=>e.name?.trim()==='The Embarcadero'&&!e.bridge&&!e.tunnel)){
      const pts=edge.points;
      for(let i=1;i<pts.length;i++){
        const a=pts[i-1]!,b=pts[i]!,len=Math.hypot(b[0]-a[0],b[2]-a[2]);if(len<1)continue;
        const tx=(b[0]-a[0])/len,tz=(b[2]-a[2])/len;
        for(let d=next;d<len;d+=18){
          const pause=checkpoint();if(pause)await pause;
          const px=a[0]+tx*d,pz=a[2]+tz*d,y=a[1]+(b[1]-a[1])*d/len;
          let nx=-tz,nz=tx;if(nx*(px-26)+nz*(pz+422)<0){nx=-nx;nz=-nz;}
          let edgeOff=-1;for(let o=2;o<40;o+=1)if(!roadContains(px+nx*o,pz+nz*o,y)){edgeOff=o;break;}
          if(edgeOff<0)continue;
          const k=Math.floor((edge.id?.length??0)+d+i*7)%4,ox=px+nx*(edgeOff+7),oz=pz+nz*(edgeOff+7);
          if(roadContains(ox,oz,y)||Math.hypot(ox-ferry[0],oz-ferry[1])<160)continue;
          const yaw=Math.atan2(-nx,-nz);
          if(k===0)place('planter',ox,y,oz,yaw,'Embarcadero Promenade',2);
          else if(k===1)place('bench',ox,y,oz,yaw,'Embarcadero Promenade',2);
          else if(k===2)place('palm',ox+nx*3,y,oz+nz*3,0,'Embarcadero Promenade',3);
          else {place('treeWell',ox,y,oz,0,'Embarcadero Promenade',3);place('bin',ox+tx*3,y,oz+tz*3,yaw,'Embarcadero Promenade',1.5);}
        }
        next=Math.max(0,next-len)%18;
      }
    }
  }
  // Mission Street (night lane, Oct 6 tour): the wide Mission sidewalks read as empty grey slabs. Both sides get a
  // tree-well rhythm with benches, planters and bins between, on the sidewalk just past the kerb. [gtasf-i2hd]
  if(polish&&flags.missionStreetDressing){
    for(const edge of (graph.edges as Road[]).filter(e=>e.name?.trim()==='Mission Street'&&!e.bridge&&!e.tunnel)){
      const pts=edge.points;
      for(let i=1;i<pts.length;i++){
        const a=pts[i-1]!,b=pts[i]!,len=Math.hypot(b[0]-a[0],b[2]-a[2]);if(len<1)continue;
        const tx=(b[0]-a[0])/len,tz=(b[2]-a[2])/len;
        for(let d=4;d<len;d+=7){
          const px=a[0]+tx*d,pz=a[2]+tz*d;if(districtAt(px,pz)?.id!=='mission')continue;
          const pause=checkpoint();if(pause)await pause;
          const y=a[1]+(b[1]-a[1])*d/len,k=Math.floor(px*.13+pz*.07+d)&3;
          for(const side of [1,-1]){
            const nx=-tz*side,nz=tx*side;let edgeOff=-1;
            for(let o=2;o<30;o+=.5)if(!roadContains(px+nx*o,pz+nz*o,y)){edgeOff=o;break;}
            if(edgeOff<0)continue;
            const ox=px+nx*(edgeOff+1.6),oz=pz+nz*(edgeOff+1.6),yaw=Math.atan2(-nx,-nz);
            if(Math.round(d/7)%2===0)place('ficus',ox,y,oz,0,'Mission Street',3);
            else if(k===0)place('bench',ox,y,oz,yaw+Math.PI,'Mission Street',2);
            else if(k===1)place('planter',ox,y,oz,yaw,'Mission Street',2);
            else if(k===2)place('bin',ox,y,oz,yaw,'Mission Street',1.5);
          }
        }
      }
    }
  }
  // Kerb cars keep clear of hydrants, other furniture at the kerb and each other.
  const kerbCars:KerbCarSpot[]=[],kerbGrid=new Map<string,KerbCarSpot[]>();
  for(const spot of kerb){
    const pause=checkpoint();if(pause)await pause;
    // 8 m grid: a 7 m neighbour is always within the 3x3 block (was an O(n^2) scan of every car).
    const kx=Math.floor(spot.x/8),kz=Math.floor(spot.z/8);let near=false;
    for(let gx=kx-1;gx<=kx+1&&!near;gx++)for(let gz=kz-1;gz<=kz+1&&!near;gz++)
      near=(kerbGrid.get(`${gx}_${gz}`)??[]).some(o=>Math.hypot(o.x-spot.x,o.z-spot.z)<7);
    if(near)continue;
    let blocked=false;
    for(let gx=-1;gx<=1&&!blocked;gx++)for(let gz=-1;gz<=1&&!blocked;gz++)
      for(const p of occupied.get(occKey(Math.floor(spot.x/16)+gx,Math.floor(spot.z/16)+gz))??[])
        if(Math.hypot(p.x-spot.x,p.z-spot.z)<(p.kind==='hydrant'?6:p.kind==='light'||p.kind==='trafficStop'||p.kind==='stop'?9:2.5)){blocked=true;break;}
    if(!blocked){kerbCars.push(spot);const key=`${kx}_${kz}`,list=kerbGrid.get(key)??[];list.push(spot);kerbGrid.set(key,list);}
  }
  const allSites=[...cells.values()].flatMap(value=>value.sites),allWires=[...cells.values()].flatMap(value=>value.wires);
  return withNearby({
    cells,siteCount:sequence,kerbCars,
    counts:{signals:allSites.filter(p=>p.kind==='light').length,stopSigns:allSites.filter(p=>p.kind==='trafficStop').length,parkingMeters:allSites.filter(p=>p.kind==='parkingMeter').length,route:allSites.filter(p=>p.density==='route').length,city:allSites.filter(p=>p.density==='city').length,
      muniSpans:allWires.filter(w=>w.muni).length,crossStreetSpans:allWires.filter(w=>w.crossStreet).length,chains:chains.length},
  });
}
/** Layout data as computed (inline or in layout.worker.ts) plus its cell lookup. */
/** GTST v1 (tools/map/street-trees.mts) kind order and DBH size classes -> billboard scale. */
const REAL_TREE_KINDS:PropKind[]=['palm','plane','cypress','eucalyptus','pine','ficus'];
const REAL_TREE_SCALE=[.55,.75,.95,1.12];
/**
 * gtasf-umar: file DataSF street trees (decoded GTST v1) into the layout's cells. Without the HD six-species atlas,
 * eucalyptus/ficus draw as plane and pine as cypress. Returns the number of trees added.
 */
export function addRealStreetTrees(cells:Map<string,PropCell>,bytes:ArrayBuffer,sixSpecies:boolean,firstId=1e9):number {
  const view=new DataView(bytes);
  if(bytes.byteLength<12||String.fromCharCode(view.getUint8(0),view.getUint8(1),view.getUint8(2),view.getUint8(3))!=='GTST'||view.getUint8(4)!==1)throw new Error('Unsupported street tree data');
  const n=view.getUint32(8,true);if(bytes.byteLength<12+n*6)throw new Error('Truncated street tree data');
  for(let i=0;i<n;i++){
    const x=view.getInt16(12+i*4,true)/2,z=view.getInt16(14+i*4,true)/2,k=view.getUint8(12+n*4+i),size=view.getUint8(12+n*5+i);
    let kind=REAL_TREE_KINDS[k]??'plane';
    if(!sixSpecies)kind=kind==='pine'?'cypress':kind==='eucalyptus'||kind==='ficus'?'plane':kind;
    const key=cellKey(x,z);let value=cells.get(key);if(!value){value={sites:[],wires:[]};cells.set(key,value);}
    value.sites.push({id:firstId+i,kind,x,y:NaN,z,yaw:((i*2654435761)>>>0)/4294967296*Math.PI*2,street:'',density:'city',real:true,scale:REAL_TREE_SCALE[size]??1});
  }
  return n;
}
export function withNearby<T extends {cells:Map<string,PropCell>}>(data:T){
  const cells=data.cells;
  return {...data,
    nearby(x:number,z:number,radius:number):PropCell[]{
      const result:PropCell[]=[];
      for(let cx=Math.floor((x-radius)/CELL);cx<=Math.floor((x+radius)/CELL);cx++)for(let cz=Math.floor((z-radius)/CELL);cz<=Math.floor((z+radius)/CELL);cz++){
        const value=cells.get(`${cx}_${cz}`);if(value)result.push(value);
      }
      return result;
    },
  };
}
