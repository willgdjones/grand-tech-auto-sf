import { Box3, BufferGeometry, DataTexture, DoubleSide, Float32BufferAttribute, Group, LinearFilter, LinearMipmapLinearFilter, Mesh, MeshLambertMaterial, MeshStandardMaterial, NearestFilter, NearestMipmapLinearFilter, RepeatWrapping, RGBAFormat, Sphere, SRGBColorSpace, Texture, Vector3 } from 'three';
import { flags } from '@gtasf/shared/flags';
import { areaXZ, type RoadDrape, type DrapeVertex } from '@gtasf/shared/terrainDrape';
import { graphicsPreset } from './graphicsPreset';
import { addSidewalkFinish, roadSurfaceDetailTexture } from './roadSurfaceDetail';
import { claimHeavyFrame } from './mountScheduler';

type Point = [number, number, number];
interface Road {
  id: string; name: string; highway: string; points: Point[]; width: number;
  offsetM?: number;
  forward: number; backward: number; shared: boolean; oneway: number; surface: string;
  sidewalk?: string; sidewalkLeft?: string; sidewalkRight?: string; markingRanges: [number, number][];
}
interface Track { id: string; points: Point[]; gaugeM: number; kind: 'cable' | 'tram'; offsetM?: number }
interface Crossing { id: string; points: Point[]; width: number; markings: string; offsetM?: number }
export interface RoadDetailLayout { version: 1; roads: Road[]; tracks: Track[]; crossings: Crossing[]; districts?: { path: string } }
interface DistrictCell { key: string; path: string; bytes: number; sha256: string }
type Kind = 'yellow' | 'white' | 'crossing' | 'slab' | 'track' | 'steel' | 'slot'
  | 'stopline' | 'gutter' | 'kerbRed' | 'kerbYellow' | 'kerbWhite' | 'manhole' | 'grate' | 'ramp';
/** `across` tiles the texture laterally every N metres (a crosswalk laid across a road). `face` draws a vertical face of that height on the carriageway side; `local` maps v 0..1 per segment. */
interface Ribbon { kind: Kind; a: Point; b: Point; offset: number; width: number; start: number; end: number; repeat: number; lift: number; kerb: boolean; face?: number; local?: boolean; across?: number }
/** flags.streetDetail extras (teleop look); `low` thins the manhole spacing for phones. */
interface DetailOptions { detail: boolean; low: boolean;
  polish?: boolean;
  /** Source-crossing lookup; district batches share one built from their whole file. */
  hasCrossing?: (x: number, z: number) => boolean }
/** 10m buckets of source crossing points; generated crosswalks never duplicate a mapped one. */
export function crossingIndex(crossings: Crossing[]) {
  const cells=new Set<string>();
  for(const c of crossings)for(const p of c.points)cells.add(`${Math.floor(p[0]/10)}_${Math.floor(p[2]/10)}`);
  return (x:number,z:number)=>{for(let i=-1;i<=1;i++)for(let j=-1;j<=1;j++)if(cells.has(`${Math.floor(x/10)+i}_${Math.floor(z/10)+j}`))return true;return false;};
}
function pointAt(points: Point[], distance: number): Point {
  let walked=0;
  for(let i=1;i<points.length;i++){const a=points[i-1]!,b=points[i]!,l=Math.hypot(b[0]-a[0],b[2]-a[2]);
    if(walked+l>=distance&&l>0){const t=(distance-walked)/l;return[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];}walked+=l;}
  return points.at(-1)!;
}
const CELL = 256;
const keyAt = (x: number, z: number) => `${Math.floor(x/CELL)}_${Math.floor(z/CELL)}`;
/** Realistic-path surface response: worn paint, concrete, cast iron and polished rail heads. */
export const ROAD_PBR: Record<Kind, { roughness: number; metalness: number }> = {
  yellow:{roughness:.62,metalness:0}, white:{roughness:.62,metalness:0}, crossing:{roughness:.6,metalness:0}, stopline:{roughness:.6,metalness:0},
  slab:{roughness:.88,metalness:0}, gutter:{roughness:.9,metalness:0}, kerbRed:{roughness:.7,metalness:0}, kerbYellow:{roughness:.7,metalness:0},
  kerbWhite:{roughness:.7,metalness:0}, track:{roughness:.85,metalness:0}, slot:{roughness:.9,metalness:.2},
  steel:{roughness:.32,metalness:.9}, manhole:{roughness:.55,metalness:.65},
  grate:{roughness:.7,metalness:.5}, ramp:{roughness:.9,metalness:0},
};
const kinds: Kind[] = ['yellow','white','crossing','slab','track','steel','slot','stopline','gutter','kerbRed','kerbYellow','kerbWhite','manhole','grate','ramp'];

function hash(value: string){let n=2166136261;for(let i=0;i<value.length;i++)n=Math.imul(n^value.charCodeAt(i),16777619);return n>>>0;}
function pathLength(points: Point[]){let total=0;for(let i=1;i<points.length;i++)total+=Math.hypot(points[i]![0]-points[i-1]![0],points[i]![2]-points[i-1]![2]);return total;}
/** Procedural cast-iron cover: a dark disc with concentric ring and grid relief, alpha-cut outside. */
export function manholeTexture(size = 64): DataTexture {
  const data=new Uint8Array(size*size*4),c=(size-1)/2;
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const r=Math.hypot(x-c,y-c)/c,i=(y*size+x)*4;
    const ring=r>.86||Math.abs(r-.55)<.05,grid=(Math.floor(x/5)+Math.floor(y/5))%2===0;
    const v=ring?92:grid?64:48;
    data[i]=v;data[i+1]=v-2;data[i+2]=v-6;data[i+3]=r<=1?255:0;
  }
  const texture=new DataTexture(data,size,size,RGBAFormat);texture.colorSpace=SRGBColorSpace;texture.needsUpdate=true;
  return texture;
}

/**
 * gtasf-trqe: the whole-city road-detail index (~0.4 s desktop, ~0.7 s throttled phone in one task) is built
 * lazily per 256 m cell instead. Items (roads, then crossings, then tracks, in source order) are bucketed by the
 * cells their centreline spans; building a cell indexes its not-yet-done items one at a time (each item's
 * ribbons are independent: phase resets per item and the crossing index is global) and files every ribbon under
 * its own cell. A cell's list is re-sorted into source-item order, so get(key) equals indexLayout's cell exactly.
 */
export function createLazyRoadIndex(data: RoadDetailLayout, extras: DetailOptions) {
  const hasCrossing = extras.hasCrossing ?? crossingIndex(data.crossings);
  type Item = { layout: RoadDetailLayout; cells: string[] };
  const items: Item[] = [], buckets = new Map<string, number[]>();
  const add = (layout: RoadDetailLayout, points: Point[]) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of points) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[2]); z1 = Math.max(z1, p[2]); }
    const index = items.length, cells: string[] = [];
    if (Number.isFinite(x0)) for (let x = Math.floor(x0 / CELL); x <= Math.floor(x1 / CELL); x++) for (let z = Math.floor(z0 / CELL); z <= Math.floor(z1 / CELL); z++) {
      const key = `${x}_${z}`; cells.push(key); (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(index);
    }
    items.push({ layout, cells });
  };
  for (const road of data.roads) add({ version: 1, roads: [road], tracks: [], crossings: [] }, road.points);
  for (const crossing of data.crossings) add({ version: 1, roads: [], tracks: [], crossings: [crossing] }, crossing.points);
  for (const track of data.tracks) add({ version: 1, roads: [], tracks: [track], crossings: [] }, track.points);
  const done = new Uint8Array(items.length), parts = new Map<string, { item: number; ribbons: Ribbon[] }[]>(), ready = new Map<string, Ribbon[]>();
  let segments = 0, warnedOutside = false;
  function build(key: string): Ribbon[] {
    const cached = ready.get(key); if (cached) return cached;
    for (const index of buckets.get(key) ?? []) {
      if (done[index]) continue; done[index] = 1;
      const out = indexLayout(items[index]!.layout, { ...extras, hasCrossing });
      segments += out.segments;
      for (const [cell, ribbons] of out.cells) {
        // Ribbons are keyed by their centreline midpoint (keyAt on the un-offset points), so they always land in
        // the item's own bbox cells. Guard that invariant: a ribbon outside them would be missing from that cell
        // whenever the cell is built before this item (1.2 review of 7ba45a79).
        if (!items[index]!.cells.includes(cell) && !warnedOutside) { warnedOutside = true; console.warn('Road detail ribbon outside its item cells', cell); }
        (parts.get(cell) ?? parts.set(cell, []).get(cell)!).push({ item: index, ribbons });
      }
    }
    const list = (parts.get(key) ?? []).sort((a, b) => a.item - b.item).flatMap(part => part.ribbons);
    parts.delete(key); ready.set(key, list);
    return list;
  }
  return {
    /** Cheap superset of the cells that can hold ribbons (no indexing). */
    mayHave: (key: string) => buckets.has(key),
    /** Whether this cell has been built (get/has will not index anything). */
    isBuilt: (key: string) => ready.has(key) || !buckets.has(key),
    /** Exact: indexes the cell on first use. */
    has: (key: string) => build(key).length > 0,
    get: (key: string) => build(key),
    get segments() { return segments; },
    get bucketCells() { return buckets.size; },
    clear() { ready.clear(); parts.clear(); buckets.clear(); items.length = 0; },
  };
}

/** Source centreline geometry is prepared offline; no whole-road scan in the render loop. */
export function indexLayout(data: RoadDetailLayout, extras: DetailOptions = { detail: false, low: false }) {
  const hasCrossing=extras.hasCrossing??crossingIndex(data.crossings);
  const cells = new Map<string, Ribbon[]>();
  let segments = 0;
  let phase = 0;
  function ribbon(points: Point[], kind: Kind, width: number, offset: number, repeat: number, lift: number, ranges?: [number, number][], kerb = false, face?: number, local?: boolean, across?: number) {
    let walked = 0;
    for (let i=1;i<points.length;i++) {
      const a=points[i-1]!,b=points[i]!, length=Math.hypot(b[0]-a[0],b[2]-a[2]);
      if(length<0.01)continue;
      for (const range of ranges ?? [[0,Infinity]]) {
        const start=Math.max(walked,range[0]),end=Math.min(walked+length,range[1]);if(end-start<0.02)continue;
        // Source points normally have 3m spacing; subdivision bounds authored long rail segments.
        const steps=Math.ceil((end-start)/3);
        for(let j=0;j<steps;j++){
          const from=start+(end-start)*j/steps,to=start+(end-start)*(j+1)/steps;
          const point=(distance:number):Point=>{const t=(distance-walked)/length;return[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];};
          const p=point(from),q=point(to),key=keyAt((p[0]+q[0])/2,(p[2]+q[2])/2),cell=cells.get(key)??[];
          const r:Ribbon={kind,a:p,b:q,offset,width,start:from+phase,end:to+phase,repeat,lift,kerb};if(face)r.face=face;if(local)r.local=true;if(across)r.across=across;cell.push(r);cells.set(key,cell);segments++;
        }
      }
      walked+=length;
    }
  }
  /** Stop lines at each junction-side end of a marked range, plus lane-centre manhole covers. */
  function streetDetail(road: Road, paint: boolean, laneWidth: number) {
    const total=pathLength(road.points),twoWay=road.forward>0&&road.backward>0,seed=hash(road.id);
    if(paint&&road.width>=5)for(const [start,end] of road.markingRanges){
      // Forward traffic stops at a range end before a junction; reverse traffic at a range start.
      const across=(twoWay?road.width/2:road.width)-.5,side=twoWay?road.width/4:0;
      if(road.forward>0&&end<total-1&&end-start>4)ribbon(road.points,'stopline',across,side,1,.045,[[end-.5,end]]);
      if(road.backward>0&&start>1&&end-start>4)ribbon(road.points,'stopline',across,twoWay?-side:0,1,.045,[[start,start+.5]]);
    }
    // Continental crosswalks in each junction-side clearance gap that has no mapped crossing.
    if(paint&&road.width>=6){
      const ranges=road.markingRanges,gaps:[number,number][]=[];
      if(ranges.length&&ranges[0]![0]>=4)gaps.push([ranges[0]![0]-3.6,ranges[0]![0]-.6]);
      for(let i=0;i<ranges.length;i++){const end=ranges[i]![1],next=ranges[i+1]?.[0]??total;if(next-end>=4)gaps.push([end+.6,end+3.6]);}
      for(const [from,to] of gaps){
        const mid=pointAt(road.points,(from+to)/2);if(hasCrossing(mid[0],mid[2]))continue;
        ribbon(road.points,'crossing',road.width-.4,0,1,.05,[[from,to]],false,undefined,true,1.2);
      }
    }
    // Real SF lanes carry PG&E/SFPUC covers every few dozen metres; deterministic per road.
    const spacing=extras.low?90:42;
    for(let d=8+seed%17,i=0;d<total-4;d+=spacing+((seed>>>(i%24))&15),i++){
      const lane=road.shared?0:(i%2?1:-1)*Math.min(laneWidth/2,road.width/2-1);
      ribbon(road.points,'manhole',.78,lane,1,.03,[[d,d+.78]],false,undefined,true);
    }
  }
  /** Concrete gutter, plus red kerb at junction mouths and occasional yellow/white loading zones. */
  function kerbDetail(road: Road, side: number) {
    const edge=side*road.width/2,seed=hash(`${road.id}:${side}`),total=pathLength(road.points);
    ribbon(road.points,'gutter',.36,edge-side*.18,3,.03,road.markingRanges);
    const paint=(kind:Kind,from:number,to:number)=>{if(to-from>.5)ribbon(road.points,kind,.2,edge+side*.095,1,.13,[[from,to]],false,.13);};
    for(const [start,end] of road.markingRanges){
      if(start>1)paint('kerbRed',start,Math.min(end,start+6));
      if(end<total-1)paint('kerbRed',Math.max(start,end-6),end);
      for(let d=start+14,i=0;d<end-20;d+=26,i++){
        const pick=(seed>>>((i*3)%27))%9;
        if(pick===0)paint('kerbYellow',d,d+9);else if(pick===1)paint('kerbWhite',d,d+6);
        else if(pick===2&&i%3===0)paint('kerbRed',d,d+4); // hydrant / bus-zone stretch
      }
    }
  }
  function gutterGrates(road: Road, side: number) {
    const seed=hash(`${road.id}:drain:${side}`),edge=side*(road.width/2-.32);
    for(const [start,end] of road.markingRanges)
      for(let d=start+8+seed%13;d<end-6;d+=38+seed%17)
        ribbon(road.points,'grate',.58,edge,1,.04,[[d,d+.9]],false,undefined,true);
  }
  for (const road of data.roads) {
    phase=road.offsetM??0;
    const drivable = /^(primary|secondary|tertiary|residential|unclassified|living_street)$/.test(road.highway);
    if(!drivable || road.width<3 || road.width>35 || road.points.length<2)continue;
    const lanes=road.forward+road.backward,laneWidth=road.width/(road.shared?1:Math.max(1,lanes));
    // Keep the narrow brick switchbacks unmarked, and source junction/crossing clearances clear.
    const paint = !road.shared && !/brick|cobblestone|sett/.test(road.surface) && road.markingRanges.length>0;
    if(paint && road.forward>0 && road.backward>0 && road.width>=6) ribbon(road.points,'yellow',6,0,6,.035,road.markingRanges);
    if(paint && laneWidth>=2.5) {
      if(road.forward>0 && road.backward>0) {
        for(let i=1;i<road.forward;i++)ribbon(road.points,'white',6,i*laneWidth,4,.04,road.markingRanges);
        for(let i=1;i<road.backward;i++)ribbon(road.points,'white',6,-i*laneWidth,4,.04,road.markingRanges);
      } else for(let i=1;i<lanes;i++)ribbon(road.points,'white',6,-road.width/2+i*laneWidth,4,.04,road.markingRanges);
    }
    if(extras.detail)streetDetail(road,paint,laneWidth);
    // Cosmetic shoulders use declared sidewalks when supplied. A narrow conventional shoulder
    // is inferred only for named ordinary streets; it never becomes a movement/collision surface.
    if(!road.name || road.width<6 || /brick|cobblestone|sett/.test(road.surface))continue;
    for(const side of [-1,1]) {
      const tag=(side<0?road.sidewalkLeft:road.sidewalkRight)??road.sidewalk;
      if(tag==='no'||tag==='none'||tag==='left'&&side>0||tag==='right'&&side<0)continue;
      if(extras.polish&&!extras.low)gutterGrates(road,side);
      if(tag==='separate')continue;
      ribbon(road.points,'slab',1.25,side*(road.width/2+.625),3,.12,road.markingRanges,true);
      if(extras.detail)kerbDetail(road,side);
      if(extras.polish&&!extras.low){
        const total=pathLength(road.points);
        // Adjacent to each shoulder end at a junction; never stack over the raised slab.
        for(const [start,end] of road.markingRanges){
          if(start>=2)ribbon(road.points,'ramp',1.25,side*(road.width/2+.625),1,.12,[[start-1.8,start]],false,undefined,true);
          if(end<=total-2)ribbon(road.points,'ramp',1.25,side*(road.width/2+.625),1,.12,[[end,end+1.8]],false,undefined,true);
        }
      }
    }
  }
  for (const crossing of data.crossings) {
    phase=crossing.offsetM??0;
    if(!/^(zebra|ladder|ladder:skewed|lines|yes|surface)$/.test(crossing.markings))continue;
    ribbon(crossing.points,'crossing',Math.max(1.5,Math.min(5,crossing.width)),0,1.2,.05);
  }
  for(const track of data.tracks) {
    phase=track.offsetM??0;
    const gauge=Math.max(.8,Math.min(1.6,track.gaugeM||1.067));
    if(track.kind==='cable') {
      ribbon(track.points,'track',gauge*1.67,0,4,.026);
      ribbon(track.points,'slot',.06,0,4,.045);
    }
    // Explicit source gauge keeps the rail heads accurate even if the painted tile is stylized.
    for(const side of [-1,1])ribbon(track.points,'steel',.065,side*gauge/2,4,.045);
  }
  return {cells,segments};
}

function validateLayout(data: RoadDetailLayout, district = false) {
  const limit=district?1_500:20_000;
  if(data.version!==1||!Array.isArray(data.roads)||!Array.isArray(data.tracks)||!Array.isArray(data.crossings)||data.roads.length>limit||data.tracks.length>limit||data.crossings.length>limit)throw new Error('Invalid road layout');
  for(const item of [...data.roads,...data.tracks,...data.crossings])if(!Array.isArray(item.points)||item.points.length>50_000||item.points.some(p=>!Array.isArray(p)||p.length!==3||p.some(v=>!Number.isFinite(v)))||(item.offsetM!==undefined&&!Number.isFinite(item.offsetM)))throw new Error('Invalid road points');
  for(const road of data.roads)if(!Number.isFinite(road.width)||!Number.isFinite(road.forward)||!Number.isFinite(road.backward)||!Array.isArray(road.markingRanges)||road.markingRanges.some(r=>r.length!==2||r.some(v=>!Number.isFinite(v))))throw new Error('Invalid road markings');
}

interface Options {
  position: { x:number; z:number };
  heightAt(x:number,z:number):number|null;
  /** Split horizontal paint at actual decoded road/terrain triangle boundaries. */
  drapeTriangle?:RoadDrape;
  /** Source building occupancy clips decorative shoulders at real building walls. */
  collides?(x:number,y:number,z:number,radius?:number,height?:number):boolean;
  /** Distinguishes streamed terrain readiness from graph-based surface height fallback. */
  isLoaded?(x:number,z:number):boolean;
  low?:boolean; enabled?:boolean;
  /** Overrides flags.realisticRender: PBR materials per kind, shadow receiving off the Low preset. */
  realistic?:boolean;
  /** Overrides flags.streetDetail (stop lines, kerb paint, gutters, manholes) for isolated fixtures. */
  detail?:boolean;
}

/** Near-cell static meshes; bounded CPU batches and one mesh reveal per call, within 3x3. */
export async function createRoadDetails(options: Options) {
  if(!(options.enabled??flags.roadDetails))return null;
  const root=new Group();root.name='Sourced SF road paint, kerbs and rails';
  const textures:Texture[]=[],images:ImageBitmap[]=[],materials=new Map<Kind,MeshLambertMaterial|MeshStandardMaterial>();
  const preset=options.low?'low':graphicsPreset();
  // Scene-added road details must follow foundation's HD-only PBR gate too.
  const realistic=flags.ps2Render&&!flags.graphicsV2&&preset==='hd'&&(options.realistic??flags.realisticRender);
  const hdPolish=flags.graphicsV2&&preset==='hd';
  let disposed=false;
  const response=await fetch('/art/road-details.json',{signal:AbortSignal.timeout(15_000)});if(!response.ok)throw new Error(`Road layout HTTP ${response.status}`);
  const text=await response.text();if(text.length>10_000_000)throw new Error('Road layout exceeds budget');
  const data=JSON.parse(text) as RoadDetailLayout;
  validateLayout(data);
  const extras={detail:options.detail??(flags.streetDetail||flags.graphicsV2),low:preset==='low',polish:flags.graphicsV2&&(options.detail??true)};
  // Built per cell on demand (gtasf-trqe): no whole-city index task after READY.
  const indexed=createLazyRoadIndex(data,extras);
  async function material(kind:Kind,id?:string,colour='#ffffff',paint=false,generated?:Texture) {
    let texture:Texture|undefined=generated;if(generated)textures.push(generated);
    if(id){
      const response=await fetch(`/art/ground/${id}.tile.png`,{signal:AbortSignal.timeout(15_000)});if(!response.ok)throw new Error(`Road detail texture HTTP ${response.status}`);
      const bytes=await response.arrayBuffer();if(bytes.byteLength>500_000)throw new Error('Road detail texture budget');
      const bitmap=await createImageBitmap(new Blob([bytes],{type:'image/png'}),{imageOrientation:'flipY',premultiplyAlpha:'none',colorSpaceConversion:'none'});
      if(bitmap.width!==256||bitmap.height!==256){bitmap.close();throw new Error('Road detail texture dimensions');}images.push(bitmap);
      texture=new Texture(bitmap);texture.colorSpace=SRGBColorSpace;texture.flipY=false;texture.wrapS=texture.wrapT=RepeatWrapping;
      // Anisotropy keeps the asphalt/paint detail crisp at driving grazing angles (clamped to the device
      // max on upload, GPU-only cost). Matches roadTextures.ts. [gtasf-v2-render-cheap-wins-yjjz]
      texture.minFilter=NearestMipmapLinearFilter;texture.magFilter=NearestFilter;texture.anisotropy=8;texture.needsUpdate=true;textures.push(texture);
    }
    if(texture&&flags.graphicsV2){
      texture.minFilter=LinearMipmapLinearFilter;texture.magFilter=LinearFilter;texture.generateMipmaps=true;
      texture.anisotropy=hdPolish?8:4;texture.needsUpdate=true;
    }
    const base={map:texture??null,color:colour,flatShading:true,side:DoubleSide,fog:true,alphaTest:paint||generated?.4:0,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1};
    // The realistic renderer converts mounted geometry; road detail is scene-added, so it picks PBR here.
    const value=(realistic||(hdPolish&&kind==='slab'))?new MeshStandardMaterial({...base,...ROAD_PBR[kind]}):new MeshLambertMaterial(base);
    if(flags.graphicsV2&&kind==='slab')addSidewalkFinish(value,preset==='low');
    if(paint){value.customProgramCacheKey=()=>`gtasf-road-paint-v1`;value.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#include <map_fragment>
// Generated tiles include asphalt. Cut that background out so only road paint overlays it.
diffuseColor.a *= smoothstep(0.17,0.38,max(diffuseColor.r,max(diffuseColor.g,diffuseColor.b)));`);};}
    if(paint&&hdPolish){
      const prepare=value.onBeforeCompile,key=value.customProgramCacheKey();
      value.customProgramCacheKey=()=>`${key}:graphics-v2-worn-paint`;
      value.onBeforeCompile=(shader,renderer)=>{
        prepare.call(value,shader,renderer);
        shader.vertexShader=shader.vertexShader
          .replace('#include <common>','#include <common>\nvarying vec2 vRoadWear;')
          .replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nvRoadWear=(modelMatrix*vec4(transformed,1.0)).xz;');
        shader.fragmentShader=shader.fragmentShader
          .replace('#include <common>','#include <common>\nvarying vec2 vRoadWear;')
          .replace('#include <alphatest_fragment>',`float roadWear=fract(sin(dot(floor(vRoadWear*12.0),vec2(12.9898,78.233)))*43758.5453);
float roadWearNear=1.0-smoothstep(60.0,110.0,length(vRoadWear-cameraPosition.xz));
diffuseColor.a*=mix(1.0,mix(0.35,1.0,smoothstep(0.07,0.20,roadWear)),roadWearNear);
#include <alphatest_fragment>`);
      };
    }
    // legibleLowPaint: Low skips the HD worn-paint fade above, so markings render at full texture brightness with
    // no tonemap -- neon lane/crosswalk paint at junctions. Bring the SAME wear fade to Low plus a small brightness
    // mute so markings read as worn paint. Paint materials only; flag-off keeps the full-bright Low paint.
    if(paint&&!hdPolish&&preset==='low'&&flags.legibleLowPaint){
      const prepare=value.onBeforeCompile,key=value.customProgramCacheKey();
      value.customProgramCacheKey=()=>`${key}:low-worn-paint`;
      value.onBeforeCompile=(shader,renderer)=>{
        prepare.call(value,shader,renderer);
        shader.vertexShader=shader.vertexShader
          .replace('#include <common>','#include <common>\nvarying vec2 vRoadWear;')
          .replace('#include <worldpos_vertex>','#include <worldpos_vertex>\nvRoadWear=(modelMatrix*vec4(transformed,1.0)).xz;');
        shader.fragmentShader=shader.fragmentShader
          .replace('#include <common>','#include <common>\nvarying vec2 vRoadWear;')
          .replace('#include <alphatest_fragment>',`float roadWear=fract(sin(dot(floor(vRoadWear*12.0),vec2(12.9898,78.233)))*43758.5453);
float roadWearNear=1.0-smoothstep(55.0,105.0,length(vRoadWear-cameraPosition.xz));
diffuseColor.a*=mix(1.0,mix(0.45,1.0,smoothstep(0.07,0.20,roadWear)),roadWearNear);
// no tonemap on Low: pull the paint off neon toward worn pigment -- desaturate slightly and darken, more so
// up close where the full-bright paint glares most, keeping it visibly yellow but weathered.
float lowPaintMute=mix(0.60,0.82,1.0-roadWearNear)*(0.85+0.30*roadWear);
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(dot(diffuseColor.rgb,vec3(0.32,0.52,0.16))),0.16)*lowPaintMute;
#include <alphatest_fragment>`);
      };
    }
    materials.set(kind,value);
  }
  try {
    // Five fixed 256x256 maps (1.31 MB RGBA in total) can fetch together. Geometry reveal/upload
    // remains bounded below. Settle every decode before cleanup so a late success cannot leak.
    const loaded=await Promise.allSettled([
      material('yellow','double-yellow','#ffffff',true),material('white','white-dashes','#ffffff',true),
      material('crossing','crosswalk','#ffffff',true),material('slab','sidewalk-kerb'),material('track','cable-track'),
    ]);
    const failed=loaded.find(result=>result.status==='rejected');if(failed?.status==='rejected')throw failed.reason;
    await material('steel',undefined,'#8a8b82');await material('slot',undefined,'#171919');
    if(extras.detail){
      await material('stopline',undefined,'#ecebe4');await material('gutter',undefined,'#85827a');
      await material('kerbRed',undefined,'#b3352b');await material('kerbYellow',undefined,'#d8ae35');await material('kerbWhite',undefined,'#e6e4dc');
      await material('manhole',undefined,'#ffffff',false,manholeTexture());
      if(hdPolish){
        await material('grate',undefined,'#ffffff',false,roadSurfaceDetailTexture('grate'));
        await material('ramp',undefined,'#ffffff',false,roadSurfaceDetailTexture('ramp'));
      }
      if(flags.graphicsV2)for(const kind of ['gutter','kerbRed','kerbYellow','kerbWhite'] as const){
        // Reuse the concrete tile: gutter aggregate and curb paint get surface detail,
        // while authored vertex colours retain red/yellow/white loading-zone meaning.
        const surface=materials.get(kind)!;surface.map=materials.get('slab')!.map;surface.needsUpdate=true;
      }
    }
  }catch(error){for(const m of materials.values())m.dispose();for(const t of textures)t.dispose();for(const i of images)i.close();throw error;}
  const mounted=new Map<string,Group>(),stats={sourceRoads:data.roads.length,sourceTracks:data.tracks.length,sourceCrossings:data.crossings.length,indexedSegments:0,knownCells:indexed.bucketCells,loadedCells:0,targetCells:0,pendingCells:0,vertices:0,builds:0,buildSteps:0,meshesBuilt:0,skippedBuildingKerbs:0,districtKnownCells:0,districtCachedCells:0,districtRequests:0,districtPending:0,districtBytes:0,districtErrors:0,districtLastError:''};
  const districts=new Map<string,DistrictCell>(),districtCache=new Map<string,Ribbon[]>(),inflight=new Map<string,AbortController>(),failed=new Set<string>();
  if(data.districts)try{
    if(data.districts.path!=='/art/district-roads/manifest.json')throw new Error('Invalid district index path');
    const response=await fetch(data.districts.path,{signal:AbortSignal.timeout(15_000)});if(!response.ok)throw new Error(`District index HTTP ${response.status}`);
    const text=await response.text();if(text.length>150_000)throw new Error('District index budget');
    const manifest=JSON.parse(text) as {version:number;cellSize:number;cells:DistrictCell[]};
    // Matches the bounded citywide source selection in prepare-district-roads;
    // only the metadata index expands. The 3x3 cache and byte caps stay unchanged.
    if(manifest.version!==1||manifest.cellSize!==CELL||!Array.isArray(manifest.cells)||manifest.cells.length>1024)throw new Error('Invalid district index');
    for(const cell of manifest.cells){
      if(!/^-?\d+_-?\d+$/.test(cell.key)||cell.path!==`/art/district-roads/${cell.key}.json`||!Number.isInteger(cell.bytes)||cell.bytes<1||cell.bytes>300_000||! /^[a-f0-9]{64}$/.test(cell.sha256))throw new Error('Invalid district cell');
      // Exact base-vs-district choice is deferred to mount time (isDistrict), so this never indexes a cell.
      districts.set(cell.key,cell);
    }
    stats.districtKnownCells=districts.size;stats.knownCells+=districts.size;
  }catch(error){districts.clear();stats.districtErrors++;stats.districtLastError=String(error);}
  let targetKeys:string[]=[],lastCell='';
  async function requestDistrict(key:string) {
    const entry=districts.get(key)!,controller=new AbortController();inflight.set(key,controller);stats.districtPending=inflight.size;stats.districtRequests++;
    const timer=setTimeout(()=>controller.abort(),15_000);
    try{
      const response=await fetch(entry.path,{signal:controller.signal});if(!response.ok)throw new Error(`District cell HTTP ${response.status}`);
      const bytes=await response.arrayBuffer();if(bytes.byteLength!==entry.bytes)throw new Error('District cell byte count');
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');if(hash!==entry.sha256)throw new Error('District cell digest');
      const value=JSON.parse(new TextDecoder().decode(bytes)) as RoadDetailLayout;validateLayout(value,true);
      const ribbons:Ribbon[]=[],hasCrossing=crossingIndex(value.crossings);
      // Small source batches yield between indexing work; geometry is still built in 2ms steps.
      for(const type of ['roads','tracks','crossings'] as const)for(let i=0;i<value[type].length;i+=16){
        if(disposed||controller.signal.aborted||!targetKeys.includes(key))return;
        const batch:RoadDetailLayout={version:1,roads:[],tracks:[],crossings:[]};
        if(type==='roads')batch.roads=value.roads.slice(i,i+16);
        else if(type==='tracks')batch.tracks=value.tracks.slice(i,i+16);
        else batch.crossings=value.crossings.slice(i,i+16);
        ribbons.push(...(indexLayout(batch,{...extras,hasCrossing}).cells.get(key)??[]));
        await new Promise<void>(resolve=>setTimeout(resolve,0));
      }
      if(!disposed&&!controller.signal.aborted&&targetKeys.includes(key)){districtCache.set(key,ribbons);stats.districtCachedCells=districtCache.size;stats.districtBytes+=bytes.byteLength;}
    }catch(error){if(!disposed&&targetKeys.includes(key)){failed.add(key);stats.districtErrors++;stats.districtLastError=String(error);}}
    finally{clearTimeout(timer);inflight.delete(key);stats.districtPending=inflight.size;}
  }
  interface Buffer {position:number[];normal:number[];uv:number[];bounds:Box3}
  interface CellBuild {key:string;group:Group;buffers:Map<Kind,Buffer>;segments:Ribbon[];cursor:number;kind:number}
  const boundsPoint=new Vector3();
  let pending:CellBuild|undefined;
  function startCell(key:string):CellBuild {
    const group=new Group();group.name=`Road detail ${key}`;
    const buffers=new Map<Kind,Buffer>();for(const k of kinds)buffers.set(k,{position:[],normal:[],uv:[],bounds:new Box3()});
    stats.pendingCells=1;
    const base=indexed.get(key);stats.indexedSegments=indexed.segments;
    return{key,group,buffers,segments:base.length?base:districtCache.get(key)??[],cursor:0,kind:0};
  }
  function advanceCell(build:CellBuild) {
    stats.buildSteps++;
    const add=(kind:Kind,points:Point[],uv:number[],lift?:number)=>{
      const buffer=build.buffers.get(kind)!;
      const emit=(a:DrapeVertex,b:DrapeVertex,c:DrapeVertex)=>{
        const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
        const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,length=Math.hypot(nx,ny,nz)||1;
        for(const p of [a,b,c]){
          buffer.bounds.expandByPoint(boundsPoint.set(Math.fround(p[0]),Math.fround(p[1]),Math.fround(p[2])));
          buffer.position.push(p[0],p[1],p[2]);buffer.normal.push(nx/length,ny/length,nz/length);buffer.uv.push(p[3]!,p[4]!);
        }
      };
      for(const indices of [[0,1,2],[0,2,3]]){
        const vertices=indices.map(i=>[...points[i]!,uv[i*2]!,uv[i*2+1]!] as DrapeVertex);
        const [a,b,c]=vertices as [DrapeVertex,DrapeVertex,DrapeVertex];
        if(flags.graphicsV2&&options.drapeTriangle&&lift!==undefined){
          // Partial coverage (neighbour chunk not loaded yet) keeps the old flat quad rather
          // than leaving a hole in the paint.
          const parts:DrapeVertex[][]=[];let covered=0;
          options.drapeTriangle([a,b,c],lift,(p,q,r)=>{parts.push([p,q,r]);covered+=Math.abs(areaXZ(p,q,r));});
          if(covered>=Math.abs(areaXZ(a,b,c))*.999)for(const t of parts)emit(t[0]!,t[1]!,t[2]!);else emit(a,b,c);
        }else emit(a,b,c);
      }
    };
    if(build.cursor<build.segments.length){
      const deadline=performance.now()+2,maximum=options.low?48:120;
      let count=0;
      while(build.cursor<build.segments.length&&count<maximum){
        if(count%8===0&&performance.now()>=deadline)break;
        const segment=build.segments[build.cursor++]!;count++;
        const {a,b,width,offset,lift}=segment,dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz),nx=-dz/length,nz=dx/length;
        const corner=(p:Point,side:number):Point=>{const x=p[0]+nx*(offset+side*width/2),z=p[2]+nz*(offset+side*width/2),sample=options.heightAt(x,z);
          const rise=segment.kind==='ramp'?(side*Math.sign(offset)>0?.12:.025):lift;
          return[x,(sample??p[1])+rise,z];};
        const p=[corner(a,-1),corner(a,1),corner(b,1),corner(b,-1)];
        if((segment.kerb||segment.face||segment.kind==='ramp')&&options.collides&&p.some(q=>options.collides!(q[0],q[1]+.1,q[2],.05,.3))){stats.skippedBuildingKerbs++;continue;}
        const v0=segment.local?0:segment.start/segment.repeat,v1=segment.local?1:segment.end/segment.repeat;
        const u0=segment.kerb&&offset>0?1:0,u1=1-u0;
        // A crosswalk laid along the road tiles its stripes across the carriageway instead.
        if(segment.across){const w=width/segment.across;add(segment.kind,p,[0,0,0,w,1,w,1,0],lift);}
        else add(segment.kind,p,[u0,v0,u1,v0,u1,v1,u0,v1],segment.kind==='ramp'?undefined:lift);
        if(segment.face){
          // Painted kerb: colour continues down the carriageway-side face.
          const edge=offset>0?[p[0]!,p[3]!]:[p[1]!,p[2]!],h=segment.face;
          add(segment.kind,[edge[0]!,[edge[0]![0],edge[0]![1]-h,edge[0]![2]],[edge[1]![0],edge[1]![1]-h,edge[1]![2]],edge[1]!],[0,0,1,0,1,1,0,1]);
        }
        if(segment.kerb){
          // Low visual vertical face; source collision and feet/car contact remain unchanged.
          const edge=offset>0?[p[0]!,p[3]!]:[p[1]!,p[2]!];
          add('slab',[edge[0]!,[edge[0]![0],edge[0]![1]-.12,edge[0]![2]],[edge[1]![0],edge[1]![1]-.12,edge[1]![2]],edge[1]!],[0,v0,.04,v0,.04,v1,0,v1]);
        }
      }
      // Do not combine the final CPU batch with typed-array creation or a driver upload.
      return;
    }
    while(build.kind<kinds.length){
      const kind=kinds[build.kind++]!,b=build.buffers.get(kind)!;if(!b.position.length)continue;
      const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(b.position,3));geometry.setAttribute('normal',new Float32BufferAttribute(b.normal,3));geometry.setAttribute('uv',new Float32BufferAttribute(b.uv,2));
      // An exact accumulated box gives a conservative sphere even for high hills,
      // wide crossings and kerb faces which extend beyond their source cell.
      geometry.boundingBox=b.bounds;geometry.boundingSphere=b.bounds.getBoundingSphere(new Sphere());
      const mesh=new Mesh(geometry,materials.get(kind)!);mesh.name=`${kind} sourced road detail`;mesh.userData.gtasfRoadDetail=true;mesh.receiveShadow=(realistic||hdPolish)&&!options.low;build.group.add(mesh);stats.vertices+=b.position.length/3;stats.meshesBuilt++;
      b.position.length=b.normal.length=b.uv.length=0;
      if(!build.group.parent)root.add(build.group);
      break;
    }
    if(build.kind===kinds.length){mounted.set(build.key,build.group);stats.loadedCells=mounted.size;stats.builds++;stats.pendingCells=0;pending=undefined;}
  }
  function clearGroup(group:Group){root.remove(group);for(const mesh of group.children as Mesh[]){stats.vertices-=mesh.geometry.getAttribute('position').count;mesh.geometry.dispose();}}
  function releaseCell(key:string,group:Group){clearGroup(group);mounted.delete(key);stats.loadedCells=mounted.size;}
  function update(position:{x:number;z:number}) {
    if(disposed)return;
    const cell=keyAt(position.x,position.z);
    if(cell!==lastCell){lastCell=cell;const cx=Math.floor(position.x/CELL),cz=Math.floor(position.z/CELL);targetKeys=[];
      for(let x=cx-1;x<=cx+1;x++)for(let z=cz-1;z<=cz+1;z++){const key=`${x}_${z}`;if(indexed.mayHave(key)||districts.has(key))targetKeys.push(key);}
      targetKeys.sort((a,b)=>{const at=(key:string)=>{const[x,z]=key.split('_').map(Number);return Math.hypot((x!+.5)*CELL-position.x,(z!+.5)*CELL-position.z);};return at(a)-at(b);});
      const target=new Set(targetKeys);for(const [key,group]of mounted)if(!target.has(key))releaseCell(key,group);
      for(const key of districtCache.keys())if(!target.has(key))districtCache.delete(key);
      for(const [key,controller]of inflight)if(!target.has(key))controller.abort();
      for(const key of failed)if(!target.has(key))failed.delete(key);
      stats.districtCachedCells=districtCache.size;
      stats.targetCells=targetKeys.length;
      if(pending&&!target.has(pending.key)){clearGroup(pending.group);pending=undefined;stats.pendingCells=0;}
    }
    let built=false; // index at most one new base cell per update, so entering an area never builds 9 at once
    // gtasf-3k35 (sequencedMount): run the heavy road-detail work (one base-cell index + the geometry
    // advance) only on a frame this stage owns so it never shares the mount frame with the prop/billboard/
    // radar builds. District fetches (async) and target bookkeeping above still run every frame. No-op off.
    const heavy=claimHeavyFrame('roadDetails');
    for(const key of targetKeys){if(mounted.has(key))continue;const[x,z]=key.split('_').map(Number);
      if(options.isLoaded&&!options.isLoaded((x!+.5)*CELL,(z!+.5)*CELL))continue;
      if(!indexed.isBuilt(key)){if(built||!heavy)continue;built=true;indexed.get(key);stats.indexedSegments=indexed.segments;}
      // A district file covers only cells the base layout leaves empty (same rule as the old eager index).
      if(districts.has(key)&&indexed.has(key)){districts.delete(key);stats.districtKnownCells=districts.size;}
      if(districts.has(key)&&!districtCache.has(key)){
        if(inflight.size<2&&!inflight.has(key)&&!failed.has(key))void requestDistrict(key);
        continue;
      }
      if(!pending&&heavy)pending=startCell(key);
    }
    if(pending&&heavy)advanceCell(pending);
  }
  update(options.position);
  return {root,stats,update,dispose(){if(disposed)return;disposed=true;for(const controller of inflight.values())controller.abort();districtCache.clear();districts.clear();stats.districtCachedCells=0;if(pending){clearGroup(pending.group);pending=undefined;stats.pendingCells=0;}for(const[key,group]of mounted)releaseCell(key,group);root.removeFromParent();for(const m of materials.values())m.dispose();for(const t of textures)t.dispose();for(const i of images)i.close();indexed.clear();}};
}
export type RoadDetails = NonNullable<Awaited<ReturnType<typeof createRoadDetails>>>;
