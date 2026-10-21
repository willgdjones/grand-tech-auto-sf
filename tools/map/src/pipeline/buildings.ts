import { lidarRoof } from './lidarRoofs';
import type { Bounds, Building, DataSfBuilding, HeightSampler, OsmExtract, Polygon, Road, Tags, XZ } from './types';
import type { Settings } from './settings';
import { project } from './settings';
import { centroid, clipPolygon, contains, openRing, overlaps, polygonBounds, ringArea, SpatialIndex } from './geometry';
import { extractPolygons, isDrivable, metric, positiveInt } from './osm';
import type { OsmPolygon } from './osm';
import { difference } from './boolean';
import { gradeSeparated, offsetPath, resample } from './roads';
import { districtAt } from '../districts';
import { districtBuildingColour } from './districts';

// Vivid SF pass (PLAN-v2.1 §4 / pane 9): richer land-use base colours (warm painted-lady stucco,
// bluer FiDi glass, warmer retail/civic) so the city reads colourful once the global desaturation
// is gone. These also classify each wall's facade style in web/src/render/facades.ts by channel
// RATIO (office b>r·1.03; industrial r≈g>b; retail r in g·[1.10,1.17] & g>b·1.18), so every value
// keeps its original ratio band — saturation raised, ordering unchanged. Takes effect on the next
// map rebuild/deploy (baked into chunk vertex colours); the render-side wash removal shows at once.
export const PALETTE:Record<string,[number,number,number]>={
  residential:[0.78,0.62,0.44],commercial:[0.52,0.58,0.66],retail:[0.72,0.63,0.50],
  industrial:[0.45,0.45,0.41],religious:[0.80,0.74,0.60],civic:[0.72,0.68,0.58],
};
function positive(value:unknown):number|undefined {
  if(value===undefined||value===null||value==='')return;
  const n=Number(value);return Number.isFinite(n)&&n>=1.5&&n<=450?n:undefined;
}
export function heightFor(row:Partial<DataSfBuilding>|undefined,tags:Tags):{height:number;source:Building['heightSource']} {
  const sf=positive(row?.hgt_median_m)??positive(row?.hgt_mediancm?Number(row.hgt_mediancm)/100:undefined)
    ??positive(row?.gnd1st_delta);
  if(sf)return {height:sf,source:'datasf'};
  const osm=metric(tags.height);
  if(osm&&osm<=450)return {height:osm,source:'osm-height'};
  const levels=positiveInt(tags['building:levels'],150);
  if(levels)return {height:levels*3.2,source:'osm-levels'};
  return {height:tags.building==='garage'||tags.building==='garages'?3.2:tags.building==='shed'?2.5:9.6,source:'fallback'};
}
function landuse(tags:Tags,fallback='residential'):string {
  // A mapped school/warehouse/shop wins over a broad residential/commercial zoning polygon.
  const typed=tags.building&&tags.building!=='yes'?tags.building:undefined;
  const value=typed??(tags.shop?'retail':tags.office?'office':tags.amenity==='school'?'school':tags.landuse);
  if(['commercial','office'].includes(value??''))return 'commercial';
  if(['industrial','warehouse'].includes(value??''))return 'industrial';
  if(['retail','supermarket'].includes(value??''))return 'retail';
  if(['church','cathedral','religious'].includes(value??''))return 'religious';
  if(['civic','school','university','hospital','public'].includes(value??''))return 'civic';
  if(['house','apartments','residential','terrace','detached','semidetached_house','dormitory','hotel','garage','garages','shed'].includes(value??''))return 'residential';
  return fallback;
}
function colour(id:string,use:string,point:XZ):[number,number,number] {
  let hash=2166136261;for(const c of id)hash=Math.imul(hash^c.charCodeAt(0),16777619);
  const factor=0.88+((hash>>>0)%100)/100*0.24;
  return (districtBuildingColour(id,use,point)??PALETTE[use]!).map(v=>Math.min(1,v*factor)) as [number,number,number];
}
function matching(index:SpatialIndex<OsmPolygon>,polygon:Polygon):OsmPolygon|undefined {
  const box=polygonBounds(polygon),centre=centroid(polygon[0]!);
  return index.query(box).filter(b=>overlaps(box,polygonBounds(b.polygon))&&
    (contains(b.polygon,centre)||contains(polygon,centroid(b.polygon[0]!))))
    .sort((a,b)=>{
      const ca=centroid(a.polygon[0]!),cb=centroid(b.polygon[0]!);
      return Math.hypot(ca[0]-centre[0],ca[1]-centre[1])-Math.hypot(cb[0]-centre[0],cb[1]-centre[1]);
    })[0];
}
/** Trim the same footprint consumed by both the mesh writer and collision exporter. */
function clearSurfaceRoads(buildings:Building[],roads:Road[],warnings:string[]):Building[] {
  const corridors=new SpatialIndex<Polygon>(32);
  const add=(polygon:Polygon)=>corridors.add(polygonBounds(polygon),polygon);
  for(const road of roads) {
    if(!isDrivable(road.tags)||gradeSeparated(road))continue;
    // Match the detailed road ribbon, with half a metre beyond its edge for clearance.
    const path=resample(road.points.map(p=>[p.x,p.z]),road.tags.name==='Lombard Street'?1:3);
    const half=road.width/2+0.5,left=offsetPath(path,-half),right=offsetPath(path,half);
    for(let i=1;i<path.length;i++)add([[left[i-1]!,left[i]!,right[i]!,right[i-1]!]]);
    // Round end caps leave room at dead ends and split OSM way junctions.
    for(const point of [path[0],path.at(-1)])if(point) {
      const radius=half/Math.cos(Math.PI/8);
      add([Array.from({length:8},(_,i):XZ=>[point[0]+Math.cos(i*Math.PI/4)*radius,point[1]+Math.sin(i*Math.PI/4)*radius])]);
    }
  }
  const area=(p:Polygon)=>Math.abs(ringArea(p[0]!))-p.slice(1).reduce((sum,r)=>sum+Math.abs(ringArea(r)),0);
  let trimmed=0,removed=0;
  const result=buildings.flatMap(building=>{
    const bounds=polygonBounds(building.polygon);
    const cuts=corridors.query(bounds).filter(p=>overlaps(bounds,polygonBounds(p)));
    if(!cuts.length)return [building];
    const parts=difference(building.polygon,...cuts).map(p=>p.map(openRing))
      .filter(p=>p[0]!.length>=3&&area(p)>0.1);
    const lost=area(building.polygon)-parts.reduce((sum,p)=>sum+area(p),0);
    if(lost>0.001)trimmed++;
    if(!parts.length)removed++;
    // Preserve the survey identity, height, foundation and colour after subtraction.
    return parts.map((polygon,i)=>({...building,polygon,id:i?`${building.id}:clear:${i}`:building.id}));
  });
  if(trimmed)warnings.push(`Surface-road clearance trimmed ${trimmed} building footprints (${removed} fully inside road corridors); mesh and collision share the result`);
  return result;
}
/** Preserve mass above/below a tunnel; a low survey foundation is not a solid bore wall. */
export function clearTunnelPassages(buildings:Building[],roads:Road[],warnings:string[],changed?:(bounds:Bounds)=>void):Building[] {
  const corridors=new SpatialIndex<{polygon:Polygon;floor:number;ceiling:number}>(64);
  for(const road of roads)if(isDrivable(road.tags)&&road.tags.tunnel&&road.tags.tunnel!=='no'&&road.profile) {
    const points=road.profile,left=offsetPath(points.map(p=>[p[0],p[2]]),-road.width/2-.5),right=offsetPath(points.map(p=>[p[0],p[2]]),road.width/2+.5);
    for(let i=1;i<points.length;i++) {
      const polygon:Polygon=[[left[i-1]!,left[i]!,right[i]!,right[i-1]!]];
      corridors.add(polygonBounds(polygon),{polygon,floor:Math.min(points[i-1]![1],points[i]![1]),ceiling:Math.max(points[i-1]![1],points[i]![1])+4.6});
    }
  }
  const area=(p:Polygon)=>Math.abs(ringArea(p[0]!))-p.slice(1).reduce((sum,r)=>sum+Math.abs(ringArea(r)),0);
  let cleared=0;
  const result=buildings.flatMap(building=>{
    const bounds=polygonBounds(building.polygon),roof=building.base+building.height;
    const cuts=corridors.query(bounds).filter(c=>overlaps(bounds,polygonBounds(c.polygon))&&c.floor<roof&&c.ceiling>building.foundation);
    if(!cuts.length)return [building];
    const sides=difference(building.polygon,...cuts.map(c=>c.polygon)).map(p=>p.map(openRing)).filter(p=>p[0]!.length>=3&&area(p)>.001);
    if(area(building.polygon)-sides.reduce((sum,p)=>sum+area(p),0)<.001)return [building];
    cleared++;changed?.(bounds);
    const floor=Math.max(building.foundation,Math.min(...cuts.map(c=>c.floor))),ceiling=Math.min(roof,Math.max(...cuts.map(c=>c.ceiling)));
    const parts:Building[]=[];
    const add=(polygon:Polygon,from:number,to:number,suffix:string)=>{
      if(to-from>.001)parts.push({...building,id:`${building.id}:tunnel-${suffix}`,polygon,foundation:from,base:from,height:to-from});
    };
    add(building.polygon,building.foundation,floor,'below');
    sides.forEach((polygon,i)=>add(polygon,floor,ceiling,`side:${i}`));
    add(building.polygon,ceiling,roof,'above');
    return parts;
  });
  if(cleared)warnings.push(`Modelled tunnel bores through ${cleared} extruded building foundations; upper and lower massing/collision retained`);
  return result;
}
// gtasf-tdbw/8hr5: LiDAR roof data (height + shape geometry) applies only inside MAP_LIDAR_ROOFS_BBOXES
// (default: MAP_COARSE_SMALL_BBOXES — the residential tour districts) when a bbox is set. Citywide LiDAR
// roof-shape geometry adds ~16.5 MB gz to a full-city bake (spread over ~1730 chunks), which overruns the
// payload budget; limiting it to the near-empty residential districts keeps the win where it matters. With
// no bbox set, LiDAR applies citywide as before. Boxes are 'w,s,e,n;...' in lon/lat.
let lidarAreas: Bounds[] | null | undefined;
function inLidarRoofArea(centre: XZ): boolean {
  if (lidarAreas === undefined) {
    const spec = process.env.MAP_LIDAR_ROOFS_BBOXES ?? process.env.MAP_COARSE_SMALL_BBOXES;
    lidarAreas = spec ? spec.split(';').map(box => {
      const p = box.split(',').map(Number);
      if (p.length !== 4 || !p.every(Number.isFinite)) throw new Error(`MAP_LIDAR_ROOFS_BBOXES: bad box '${box}' (want w,s,e,n lon/lat)`);
      const [w, s, e, n] = p as [number, number, number, number];
      const a = project(w, s), b = project(e, n);
      return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])] as Bounds;
    }) : null;
  }
  return !lidarAreas || lidarAreas.some(([x0, z0, x1, z1]) => centre[0] >= x0 && centre[0] <= x1 && centre[1] >= z0 && centre[1] <= z1);
}
export function buildBuildings(rows:DataSfBuilding[],osm:OsmExtract,terrain:HeightSampler,s:Settings,warnings:string[],roads:Road[]=[],tunnelChanged?:(bounds:Bounds)=>void):Building[] {
  const polygons=extractPolygons(osm,t=>Boolean(t.building&&t.building!=='no')||Boolean(t['building:part']),warnings);
  const index=new SpatialIndex<OsmPolygon>();
  for(const p of polygons)index.add(polygonBounds(p.polygon),p);
  const land=extractPolygons(osm,t=>Boolean(t.landuse),warnings),landIndex=new SpatialIndex<OsmPolygon>(512);
  for(const p of land)landIndex.add(polygonBounds(p.polygon),p);
  const occupied=new SpatialIndex<OsmPolygon>(),result:Building[]=[];
  const add=(id:string,polygon:Polygon,tags:Tags,row?:DataSfBuilding)=>{
    for(const [part,clipped] of clipPolygon(polygon,s.bounds).entries()) {
      const key=`${id}:${part}`,centre=centroid(clipped[0]!);
      const use=landuse({...landIndex.query(polygonBounds(clipped)).find(p=>contains(p.polygon,centre))?.tags,...tags},districtAt(...centre)?.defaultBuildingUse);
      // gtasf-6w9a: a 3DEP LiDAR main-roof height (MAP_LIDAR_ROOFS) beats the 2010 survey / OSM tags when present.
      // gtasf-tdbw/8hr5: only inside the residential LiDAR bbox, so citywide roof-shape geometry stays in budget.
      const lidar=row&&inLidarRoofArea(centre)?lidarRoof(row.sf16_bldgid):undefined;
      const h=lidar?{height:lidar.h,source:'lidar' as const}:heightFor(row,tags);
      // Buildings start at the lowest ground under the footprint, including samples through its interior.
      const samples=clipped[0]!.map(([x,z])=>terrain.sample(x,z)).sort((a,b)=>a-b);
      const bounds=polygonBounds(clipped);
      for(let x=bounds[0];x<=bounds[2];x+=4)for(let z=bounds[1];z<=bounds[3];z+=4)
        if(contains(clipped,[x,z]))samples.push(terrain.sample(x,z));
      const base=Math.min(...samples);
      result.push({id:key,polygon:clipped,height:h.height,base,foundation:Math.min(...samples)-0.3,
        heightSource:h.source,colour:colour(key,use,centre),landuse:use,...(lidar?{roofShape:lidar}:{})});
      occupied.add(polygonBounds(clipped),{id:key,polygon:clipped,tags});
    }
  };
  for(const row of [...rows].sort((a,b)=>a.sf16_bldgid.localeCompare(b.sf16_bldgid)))
    for(const [part,p] of row.shape.coordinates.entries()) {
      const polygon=p.map(r=>r.map(([lon,lat]):XZ=>project(lon,lat)));
      if(!overlaps(polygonBounds(polygon),s.bounds))continue;
      const match=matching(index,polygon);
      add(`datasf:${row.sf16_bldgid}:${part}`,polygon,match?.tags??{},row);
    }
  // Supplement gaps in the city survey, while keeping a single collision/massing footprint per structure.
  for(const p of polygons) {
    if(!overlaps(polygonBounds(p.polygon),s.bounds)||matching(occupied,p.polygon))continue;
    add(`osm:${p.id}`,p.polygon,p.tags);
  }
  const fallback=result.filter(b=>b.heightSource==='fallback').length;
  if(fallback)warnings.push(`${fallback} buildings use an explicit 9.6 m/garage/shed fallback; inspect heightSource`);
  // Join/deduplicate against complete survey footprints before cutting, otherwise OSM
  // supplementation could refill the corridor that was just cleared from DataSF.
  return clearTunnelPassages(clearSurfaceRoads(result,roads,warnings),roads,warnings,tunnelChanged).sort((a,b)=>a.id.localeCompare(b.id));
}
