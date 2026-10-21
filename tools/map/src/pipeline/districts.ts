import { districtAt, DISTRICT_REGIONS } from '../districts';
import type { BuildingUse, Colour, DistrictProfile } from '../districts';
import { centroid, contains, overlaps, polygonBounds, ringArea, SpatialIndex } from './geometry';
import { extractPolygons, isDrivable } from './osm';
import { gradeSeparated } from './roads';
import type { Bounds, Building, OsmExtract, Polygon, Road, Tags, XZ } from './types';

export function districtBuildingColour(id:string,use:string,point:XZ):Colour|undefined {
  const colours=districtAt(...point)?.buildings[use as BuildingUse];
  if(!colours?.length)return;
  let hash=2166136261;
  for(const c of id)hash=Math.imul(hash^c.charCodeAt(0),16777619);
  return colours[(hash>>>0)%colours.length];
}

type GroundKind='water'|'sand'|'scrub'|'park';
function groundKind(tags:Tags):GroundKind|undefined {
  if(tags.natural==='water'||tags.water||tags.waterway==='riverbank'||tags.landuse==='reservoir')return 'water';
  if(tags.natural==='beach'||tags.natural==='sand')return 'sand';
  if(tags.natural==='scrub'||tags.natural==='heath')return 'scrub';
  if(['park','garden','pitch','nature_reserve'].includes(tags.leisure??'')||
    ['grass','meadow','recreation_ground','forest','cemetery'].includes(tags.landuse??'')||
    ['wood','grassland'].includes(tags.natural??''))return 'park';
  return;
}
const GROUND_ORDER:Record<GroundKind,number>={water:0,sand:1,scrub:2,park:3};
/** Keep mapped lakes, beach, scrub and parks distinct, including holes in multipolygons. */
export function districtGroundSampler(osm:OsmExtract,warnings:string[]) {
  const index=new SpatialIndex<{polygon:Polygon;kind:GroundKind}>(256);
  for(const area of extractPolygons(osm,t=>Boolean(groundKind(t)),warnings))
    index.add(polygonBounds(area.polygon),{polygon:area.polygon,kind:groundKind(area.tags)!});
  return (x:number,z:number,underwater:boolean):[number,number,number]=>{
    const district=districtAt(x,z);
    const kind=index.query([x,z,x,z]).filter(a=>contains(a.polygon,[x,z]))
      .sort((a,b)=>GROUND_ORDER[a.kind]-GROUND_ORDER[b.kind])[0]?.kind;
    const colour=kind==='water'||underwater?[.10,.23,.41] as const
      :kind==='sand'?district?.ground.sand??[.64,.56,.39] as const
      :kind==='scrub'?district?.ground.scrub??[.33,.38,.21] as const
      :kind==='park'?district?.ground.park??[.26,.42,.21] as const
      :district?.ground.urban??[.38,.43,.28] as const;
    return [...colour];
  };
}

interface StreetSegment { a:XZ; b:XZ; district:DistrictProfile; bounds:Bounds; roadId:string }
/** Selected sourced surface streets define bounded detail. Never promote freeways, decks or tunnels. */
export function districtStreetDetail(roads:readonly Road[]) {
  const index=new SpatialIndex<StreetSegment>(128);
  for(const road of roads) {
    if(!isDrivable(road.tags)||gradeSeparated(road)||/^(motorway|trunk)(_|$)/.test(road.tags.highway??''))continue;
    for(const {profile,bounds:region} of DISTRICT_REGIONS) {
      if(!profile.streets.includes(road.tags.name??''))continue;
      const radius=profile.buildingRadius+road.width/2;
      for(let i=1;i<road.points.length;i++) {
        const a:XZ=[road.points[i-1]!.x,road.points[i-1]!.z],b:XZ=[road.points[i]!.x,road.points[i]!.z];
        const bounds:Bounds=[Math.min(a[0],b[0])-radius,Math.min(a[1],b[1])-radius,
          Math.max(a[0],b[0])+radius,Math.max(a[1],b[1])+radius];
        if(overlaps(bounds,region))index.add(bounds,{a,b,bounds,district:profile,roadId:road.id});
      }
    }
  }
  const segments=(bounds:Bounds)=>index.query(bounds).filter(s=>overlaps(bounds,s.bounds));
  return {
    hasDetail(bounds:Bounds):boolean {return segments(bounds).length>0;},
    /** Only the district owning the building can lower its coarse-area threshold. */
    keepBuilding(building:Building):boolean {
      const centre=centroid(building.polygon[0]!),district=districtAt(...centre);
      if(!district)return false;
      const area=Math.abs(ringArea(building.polygon[0]!))-building.polygon.slice(1).reduce((sum,r)=>sum+Math.abs(ringArea(r)),0);
      if(area<district.minBuildingArea)return false;
      const bounds=polygonBounds(building.polygon);
      return segments(bounds).some(s=>s.district.id===district.id&&
        building.polygon[0]!.some(p=>pointSegmentDistance(p,s.a,s.b)<=district.buildingRadius));
    },
    keepPavement(pavement:{polygon:Polygon;roadIds:string[]}):boolean {
      return segments(polygonBounds(pavement.polygon)).some(s=>pavement.roadIds.includes(s.roadId));
    },
  };
}
function pointSegmentDistance(p:XZ,a:XZ,b:XZ):number {
  const dx=b[0]-a[0],dz=b[1]-a[1],den=dx*dx+dz*dz;
  const t=den?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/den)):0;
  return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dz);
}
