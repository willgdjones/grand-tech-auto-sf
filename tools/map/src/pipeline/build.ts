import { readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { MAP_CITYWIDE_BUDGET_BYTES, MAP_COMPRESSED_BUDGET_BYTES } from '../config';
import { project, SF_FRAME } from './settings';
import type { Settings } from './settings';
import type { Artifact, Bounds, ChunkRecord, MapManifest, Road, RoadGraph } from './types';
import type { Inputs } from './sources';
import { atomicWrite, digest } from './sources';
import { buildBuildings } from './buildings';
import { createSurfaceJoins } from './surfaceJoins';
import { extractRoads } from './osm';
import { flattenSunkenPlazas } from './sunkenPlazas';
import { coarseChunkTest, liftGraphToCoarseRoads, quantizeGraphHeights } from './graphCoarseLift';
import { fillPierGaps } from './pierGaps';
import { prepareRoadSurfaces, RoadTerrain } from './roads';
import { buildRoadGraph, components, findRoute } from './roadgraph';
import { addBuildings, addRoadMeshes, addTerrainMeshes, ChunkMeshes, chunkGlb, type Cut } from './meshes';
import { overlaps, polygonBounds, SpatialIndex } from './geometry';
import { createHeightfield, decodeHeightfield, encodeHeightfield } from './heightfield';
import { writeLocalRoutes } from './local-play';
import { compactRoadGraph } from './compact';
import { decodePackedRoadGraph, unpackRoadGraph } from '../../../../shared/roadgraphPacked';
import { pavementExclusions, preparePavements } from './pavement';
import { districtGroundSampler, districtStreetDetail } from './districts';
import { buildCoastline } from './coastline';
import { COASTLINE_MAX_BYTES, validCoastline } from '../../../../shared/coastline';

export type { MapManifest } from './types';
// gtasf-8hr5: MAP_FRONTAGE_BBOXES='w,s,e,n;...' (lon/lat) limits citywide district-street frontage
// retention (districtDetail.keepBuilding) to those areas in LOW chunks only, so a dense-residential
// bake keeps full-detail street fronts in the tour districts without paying the ~8.7 MB gz the
// post-Oct-3 frontages add city-wide (never shipped). Unset = whole city (current/default behaviour);
// detailed corridor chunks always keep their frontages. Collision rings drop to cm precision below.
let frontageAreas: Bounds[] | null | undefined;
function frontageBboxes(): Bounds[] | null {
  if (frontageAreas === undefined) {
    frontageAreas = process.env.MAP_FRONTAGE_BBOXES ? process.env.MAP_FRONTAGE_BBOXES.split(';').map(box => {
      const parts = box.split(',').map(Number);
      // A typo must fail the bake loudly, not silently keep no frontages anywhere.
      if (parts.length !== 4 || !parts.every(Number.isFinite)) throw new Error(`MAP_FRONTAGE_BBOXES: bad box '${box}' (want w,s,e,n in lon/lat)`);
      const [w, s, e, n] = parts as [number, number, number, number]; const [x0, z0] = project(w, n), [x1, z1] = project(e, s);
      return [Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)] as Bounds;
    }) : null;
    if (frontageAreas) console.log(`MAP_FRONTAGE_BBOXES areas (world m): ${JSON.stringify(frontageAreas.map(b => b.map(Math.round)))}`);
  }
  return frontageAreas;
}
const pointInFrontageAreas = (x: number, z: number): boolean => { const a = frontageBboxes(); return !a || a.some(([x0, z0, x1, z1]) => x >= x0 && x <= x1 && z >= z0 && z <= z1); };
async function artifact(root:string,path:string,bytes:string|Uint8Array):Promise<Artifact> {
  const buffer=typeof bytes==='string'?Buffer.from(bytes):bytes;
  const gzip=gzipSync(buffer,{level:9});
  await atomicWrite(join(root,path),buffer);await atomicWrite(join(root,`${path}.gz`),gzip);
  return {path,bytes:buffer.length,gzipBytes:gzip.length,sha256:digest(buffer)};
}
export async function buildMap(s:Settings,input:Inputs,options:{repairTunnels?:boolean;repairDistrictGround?:boolean}={}):Promise<MapManifest> {
  const warnings:string[]=[];
  if(options.repairTunnels&&options.repairDistrictGround)throw new Error('Select one map repair scope');
  const previous=options.repairTunnels||options.repairDistrictGround?JSON.parse(await readFile(join(s.out,'manifest.json'),'utf8')) as MapManifest:undefined;
  if(previous&&(JSON.stringify(previous.bounds)!==JSON.stringify(s.bounds)||
    JSON.stringify(previous.sourceDigests)!==JSON.stringify(input.sources.records.map(({key,sha256})=>({key,sha256})))))
    throw new Error('Map repair requires an existing bake with identical bounds and source digests');
  const previousChunks=new Map(previous?.chunks.map(c=>[c.id,c])??[]),tunnelRepairs:Bounds[]=[];
  const roads=extractRoads(input.osm,s.bounds);
  if(!roads.length)throw new Error('No roads intersect this area');
  const ground=fillPierGaps(flattenSunkenPlazas(input.terrain,input.osm,warnings),input.osm,warnings,s.bounds);
  prepareRoadSurfaces(roads,ground,warnings);
  const terrain=new RoadTerrain(ground,roads);
  console.log(`Preparing ${roads.length} roads and DataSF footprints`);
  const buildings=buildBuildings(input.buildings,input.osm,terrain,s,warnings,roads,bounds=>tunnelRepairs.push(bounds));
  console.log(`Prepared ${buildings.length} collision-clear buildings; building lane graph`);
  const sourceGraph=buildRoadGraph(roads,input.osm,terrain);
  const graph=s.detailBounds?compactRoadGraph(sourceGraph):sourceGraph;
  // gtasf-8mjjf: graph = the DRAWN road on coarse chunks (same 32 m lift as addRoadMeshes). Opt-in until a reviewed bake.
  if(process.env.MAP_GRAPH_COARSE_LIFT==='1'&&process.env.MAP_COARSE_ROAD_LIFT!=='0') {
    const detail=districtStreetDetail(roads),lift=liftGraphToCoarseRoads(graph,terrain,coarseChunkTest(s.chunkSize,s.detailBounds,b=>detail.hasDetail(b)));
    console.log(`Graph coarse lift: ${lift.points} lane points + ${lift.nodes} nodes raised (max ${lift.maxRaise} m)`);
  }
  if(process.env.MAP_GRAPH_HEIGHT_QUANT){quantizeGraphHeights(graph,Number(process.env.MAP_GRAPH_HEIGHT_QUANT));console.log(`Graph heights quantised to ${process.env.MAP_GRAPH_HEIGHT_QUANT} m`);}
  if(!graph.edges.length)throw new Error('No drivable lanes in this area');
  warnings.push(...graph.warnings);
  const graphFile=await artifact(s.out,'roadgraph.json',JSON.stringify(graph)+'\n');
  const osmSource=input.sources.records.find(r=>r.key==='osm-pbf-normalized'||r.key==='osm');
  const coast=osmSource?buildCoastline(input.osm,s.bounds,osmSource.sha256):undefined;
  let coastline:Artifact|undefined;
  if(coast?.rings.length) {
    const encoded=JSON.stringify(coast)+'\n';
    if(!validCoastline(coast,SF_FRAME)||Buffer.byteLength(encoded)>COASTLINE_MAX_BYTES)throw new Error('Coastline exceeds overlay contract');
    coastline=await artifact(s.out,'coastline.json',encoded);
  }
  console.log(`Wrote graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ${graphFile.bytes} bytes (${graphFile.gzipBytes} gzip)`);
  if(s.bounds[2]>1500)await writeLocalRoutes(s.out,graph,terrain,buildings.map(b=>({id:b.id,polygon:b.polygon,minY:b.foundation,maxY:b.base+b.height})),s.detailBounds);
  console.log('Local routes audited; writing map chunks');
  // The authored Ferry Building landmark supplies the mesh; keep its surveyed collision.
  const renderedBuildings=buildings.filter(b=>!b.id.startsWith('datasf:201006.0000058:'));
  if(renderedBuildings.length<buildings.length)warnings.push('Ferry Building generic mesh replaced by authored landmark; source collision retained');
  const chunks=new Map<string,ChunkRecord>();
  const collisionIndex=new SpatialIndex<typeof buildings[number]>(s.chunkSize);
  for(const b of buildings)collisionIndex.add(polygonBounds(b.polygon),b);
  const roadIndex=new SpatialIndex<Road>(s.chunkSize);
  for(const road of roads) {
    const box=polygonBounds([road.points.map(p=>[p.x,p.z])]),pad=road.width+4;
    roadIndex.add([box[0]-pad,box[1]-pad,box[2]+pad,box[3]+pad],road);
  }
  const renderedIds=new Set(renderedBuildings.map(b=>b.id));
  const districtDetail=districtStreetDetail(roads),groundColour=districtGroundSampler(input.osm,warnings);
  const pavementIndex=new SpatialIndex<ReturnType<typeof preparePavements>[number]>(s.chunkSize);
  for(const pavement of preparePavements(roads,[...pavementExclusions(input.osm,warnings),...buildings.map(b=>b.polygon)]))
    pavementIndex.add(polygonBounds(pavement.polygon),pavement);
  const total=(s.bounds[2]-s.bounds[0])*(s.bounds[3]-s.bounds[1])/s.chunkSize**2;
  let rewritten=0;
  // Bound peak memory to one chunk; a citywide in-memory mesh scales into GBs.
  for(let x=s.bounds[0];x<s.bounds[2];x+=s.chunkSize)for(let z=s.bounds[1];z<s.bounds[3];z+=s.chunkSize) {
    const bounds:Bounds=[x,z,x+s.chunkSize,z+s.chunkSize],id=`${x/s.chunkSize}_${z/s.chunkSize}`;
    if(previous&&options.repairTunnels&&!tunnelRepairs.some(repair=>overlaps(repair,bounds))) {
      const old=previousChunks.get(id);if(!old)throw new Error(`Missing existing chunk ${id}`);
      chunks.set(id,old);continue;
    }
    const detailed=!s.detailBounds||overlaps([x+0.001,z+0.001,x+s.chunkSize-0.001,z+s.chunkSize-0.001],s.detailBounds);
    const localRoads=roadIndex.query(bounds),localBuildings=collisionIndex.query(bounds).filter(b=>overlaps(polygonBounds(b.polygon),bounds));
    // gtasf-8hr5: the district street-detail features (16 m ground grid, pavements, terrain cuts, surface
    // joins, finer terrain.bin) add ~61 MB gz to a full-city bake. MAP_DISTRICT_STREETS=0 excludes them so a
    // dense-residential/LiDAR bake can stay within the whole-city payload budget. Unset keeps them (default).
    const streetDetail=!detailed&&districtDetail.hasDetail(bounds)&&process.env.MAP_DISTRICT_STREETS!=='0';
    if(previous&&options.repairDistrictGround&&!streetDetail) {
      const old=previousChunks.get(id);if(old)chunks.set(id,old);
      continue;
    }
    rewritten++;
    // gtasf-8hr5: detailed corridor keeps every frontage; low chunks keep them only inside MAP_FRONTAGE_BBOXES
    // (unset = whole city). A kept frontage renders at full detail (tolerance 0) and enters low-chunk collision.
    const retained=new Set(localBuildings.filter(b=>districtDetail.keepBuilding(b)&&(detailed||pointInFrontageAreas(b.polygon[0]![0]![0],b.polygon[0]![0]![1]))).map(b=>b.id));
    const localPavements=pavementIndex.query(bounds).filter(p=>detailed||streetDetail&&districtDetail.keepPavement(p));
    // Skip empty bay/ocean chunks outside the corridor: no roads and no buildings means nothing but open
    // water, so there is nothing to spawn on or stream. Deep links snap to the citywide road graph, which
    // only points at chunks that still exist. Shrinks the citywide payload a lot. (gtasf-o0cb)
    if(!detailed&&!localRoads.length&&!localBuildings.length){rewritten--;continue;}
    for(const lod of (detailed?[0,1]:[1]) as (0|1)[]) {
      const meshes=new ChunkMeshes(bounds,s.chunkSize),chunk=meshes.chunks.get(id)!;
      const cuts=addRoadMeshes(meshes,localRoads,terrain,lod,localPavements,!detailed,
        // Opt-in until a coordinated bake checks the 25 MB budget: MAP_DRAPE_ROADS=4 (metres).
        Number(process.env.MAP_DRAPE_ROADS??0),
        // MAP_COARSE_ROAD_LIFT=0 restores roads on the raw DEM under the uncut 32 m coarse ground (buried on slopes).
        !detailed&&!streetDetail&&process.env.MAP_COARSE_ROAD_LIFT!=='0'?32:0);
      // Keep one cheap LOD outside the corridor. Selected district streets use a 16m ground grid;
      // the remaining city keeps 32m. Source landcover and district palettes colour either grid.
      // District street arrivals use the road-carved contact field. Retain its surface
      // cutouts too: coarse terrain triangles otherwise bridge above roads on hills.
      addTerrainMeshes(meshes,terrain,detailed||streetDetail?cuts:new SpatialIndex<Cut>(32),detailed?(lod===0?s.terrainStep:s.terrainStep*4):streetDetail?16:32,s.terrainStep,[],groundColour);
      // Close exposed cut/junction edges without moving either surface or its contact field.
      // Joins are hairline crack fills: their corners reuse the road's existing vertices at the same position and
      // colour (any normal) - same faces, far fewer new vertices (gtasf-8hr5).
      if(streetDetail)for(const join of createSurfaceJoins(chunk.terrain,chunk.roads).triangles)chunk.roads.add(join.points,join.colour,true);
      addBuildings(meshes,localBuildings.filter(b=>renderedIds.has(b.id)),lod,!detailed,retained);
      const triangles=(chunk.terrain.indices.length+chunk.roads.indices.length+chunk.buildings.indices.length+chunk.structures.indices.length)/3;
      const glb=await artifact(s.out,`chunks/${id}/lod${lod}.glb`,await chunkGlb(chunk,s.chunkSize));
      if(!chunks.has(id)) {
        // District arrival streets need the source contact grid, like the original corridor;
        // keep the 32m field elsewhere. This adds no second visual LOD.
        const field=await artifact(s.out,`chunks/${id}/terrain.bin`,encodeHeightfield(createHeightfield(chunk.bounds,terrain,detailed||streetDetail?s.terrainStep:s.terrainStep*8)));
        // Source-identical frontage mesh/collision near selected streets; distant coarse stock
        // retains its old budget policy. The production payload gate still applies to the new bake.
        const collisionBuildings=detailed?localBuildings:localBuildings.filter(b=>retained.has(b.id));
        // gtasf-8hr5: cm precision (not mm) on footprint rings/heights — far below the 0.5 m collision
        // margin and invisible to footprint placement, saves ~18% of collision gz. Deterministic.
        const round2=(v:number)=>Math.round(v*100)/100||0;
        const collision={version:1,origin:[chunk.bounds[0],0,chunk.bounds[1]],buildings:collisionBuildings
          .sort((a,b)=>a.id.localeCompare(b.id)).map(b=>({
            id:b.id,minY:round2(b.foundation),maxY:round2(b.base+b.height),heightSource:b.heightSource,
            rings:b.polygon.map(r=>r.map(([x,z])=>[round2(x-chunk.bounds[0]),round2(z-chunk.bounds[1])])),
          }))};
        const collisionFile=await artifact(s.out,`chunks/${id}/collision.json`,JSON.stringify(collision)+'\n');
        chunks.set(id,{id,...(!detailed?{detail:'low' as const}:{}),x:chunk.x,z:chunk.z,bounds:chunk.bounds,lods:[glb,glb],terrain:field,collision:collisionFile,triangles:[triangles,triangles]});
      } else {const record=chunks.get(id)!;record.lods[1]=glb;record.triangles[1]=triangles;}
    }
    if(chunks.size%25===0||chunks.size===total)console.log(`Wrote ${chunks.size}/${total} chunks`);
  }
  if(previous)console.log(`Repaired ${rewritten} ${options.repairTunnels?'tunnel':'district ground'} chunks; retained ${chunks.size-rewritten} source-identical chunks`);
  const records=[...chunks.values()].sort((a,b)=>a.x-b.x||a.z-b.z);
  const gzipBytes=graphFile.gzipBytes+(coastline?.gzipBytes??0)+records.reduce((sum,c)=>sum+c.lods[0].gzipBytes+
    (c.lods[0].path===c.lods[1].path?0:c.lods[1].gzipBytes)+c.terrain.gzipBytes+c.collision.gzipBytes,0);
  // The whole-city bake (detailBounds set) streams on demand, so its total payload is bounded by the
  // 80 MB production budget rather than the 25 MB slice/first-load budget (see config.ts). (gtasf-o0cb)
  const budget=s.detailBounds?MAP_CITYWIDE_BUDGET_BYTES:MAP_COMPRESSED_BUDGET_BYTES;
  const manifest:MapManifest={version:1,generator:'gtasf-map/0.1.0',area:s.area,frame:SF_FRAME,axes:{x:'east',y:'up',z:'south',units:'metres'},
    bounds:s.bounds,chunkSize:s.chunkSize,terrain:{step:s.terrainStep,format:'GTHF-v1',vertical:'source DEM metres; road-carved'},roadGraph:graphFile,...(coastline?{coastline}:{}),chunks:records,
    sourceDigests:input.sources.records.map(({key,sha256})=>({key,sha256})),
    stats:{roads:roads.length,buildings:buildings.length,lanes:graph.edges.filter(e=>e.kind==='lane').length,
      signals:new Set(graph.nodes.filter(n=>n.control==='signal').map(n=>n.osmNode)).size,
      stops:new Set(graph.nodes.filter(n=>n.control==='stop').map(n=>n.osmNode)).size,
      gzipBytes,budgetBytes:budget,withinBudget:gzipBytes<=budget},warnings:[...new Set(warnings)].sort(),
    attribution:[{label:'© OpenStreetMap contributors — ODbL',url:'https://www.openstreetmap.org/copyright'},
      {label:'DataSF Building Footprints — PDDL',url:'https://data.sf.gov/d/ynuv-fyni'},
      {label:'Mapzen Terrain Tiles; USGS 3DEP; NOAA',url:'https://github.com/tilezen/joerd/blob/master/docs/attribution.md'}]};
  // Publish the index last. A failed build cannot point a new index at absent chunk assets.
  await artifact(s.out,'manifest.json',JSON.stringify(manifest,null,2)+'\n');
  await atomicWrite(join(s.out,'sources.json'),JSON.stringify(input.sources,null,2)+'\n');
  return manifest;
}
export interface Validation {
  files:number;chunks:number;nodes:number;edges:number;components:number;largestComponentNodes:number;
  largestComponentFraction:number;routeChecks:number;routeSuccesses:number;allNodesStronglyConnected:boolean;
  lombard:{lanes:number;maximumPoints:number;minimumHeight:number|null;maximumHeight:number|null};
  gzipBytes:number;withinBudget:boolean;
}
export async function validateMap(root:string):Promise<Validation> {
  const manifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8')) as MapManifest;
  if(manifest.version!==1||manifest.chunkSize!==256)throw new Error('Unknown map manifest');
  const artifacts=[manifest.roadGraph,...(manifest.neighbourhoods?[manifest.neighbourhoods]:[]),...(manifest.coastline?[manifest.coastline]:[]),...manifest.chunks.flatMap(c=>[...c.lods,c.terrain,c.collision])];
  for(const entry of artifacts) {
    const path=resolve(root,entry.path);
    if(!path.startsWith(resolve(root)+sep))throw new Error('Artifact path escapes output directory');
    const bytes=await readFile(path),compressed=await readFile(`${path}.gz`);
    if(bytes.length!==entry.bytes||digest(bytes)!==entry.sha256||compressed.length!==entry.gzipBytes||digest(gunzipSync(compressed))!==entry.sha256)throw new Error(`Artifact hash/length mismatch: ${entry.path}`);
  }
  const graphBytes=await readFile(join(root,manifest.roadGraph.path));
  const graph=(manifest.roadGraph.encoding==='roadpack-v1'?unpackRoadGraph(decodePackedRoadGraph(graphBytes)):
    JSON.parse(graphBytes.toString())) as RoadGraph;
  const ids=new Set(graph.nodes.map(n=>n.id)),edges=new Map(graph.edges.map(e=>[e.id,e]));
  if(ids.size!==graph.nodes.length||edges.size!==graph.edges.length)throw new Error('Duplicate graph identifiers');
  for(const n of graph.nodes)if(![n.x,n.y,n.z].every(Number.isFinite))throw new Error(`Invalid road node ${n.id}`);
  for(const edge of graph.edges) {
    if(!ids.has(edge.from)||!ids.has(edge.to)||edge.lengthM<=0||edge.points.length<2||edge.points.flat().some(n=>!Number.isFinite(n)))throw new Error(`Invalid road edge ${edge.id}`);
    if(edge.next?.some(id=>!edges.has(id)||edges.get(id)!.from!==edge.to))throw new Error(`Invalid lane continuation ${edge.id}`);
  }
  const fields=new Map<string,ReturnType<typeof decodeHeightfield>>();
  for(const c of manifest.chunks)fields.set(c.id,decodeHeightfield(await readFile(join(root,c.terrain.path))));
  for(const [id,field] of fields) {
    for(const [dx,dz] of [[1,0],[0,1]]) {
      const adjacent=fields.get(`${field.x+dx!}_${field.z+dz!}`);if(!adjacent)continue;
      // Corridor/coarse LOD boundary: the detail corridor keeps a 4 m collision heightfield while coarse
      // chunks use 32 m, so adjacent grids differ there. The visual terrain mesh stitches across via its
      // seamStep; the sub-metre collision seam at that boundary is an accepted LOD tradeoff. (gtasf-o0cb)
      if(adjacent.step!==field.step)continue;
      if(adjacent.size!==field.size)throw new Error('Mismatched adjacent heightfield grids');
      for(let i=0;i<field.size;i++) {
        const a=dx?i*field.size+field.size-1:(field.size-1)*field.size+i;
        const b=dx?i*field.size:i;
        if(field.offsetCm+field.values[a]! !== adjacent.offsetCm+adjacent.values[b]!)throw new Error(`Terrain seam at ${id}`);
      }
    }
  }
  const groups=components(graph),largest=groups[0]??[];
  let successes=0,state=0x475441;
  const pick=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return largest[state%largest.length]!;};
  const checks=largest.length>=2?100:0;
  for(let i=0;i<checks;i++){const from=pick();let to=pick();if(to===from)to=largest[(largest.indexOf(from)+1)%largest.length]!;if(findRoute(graph,from,to))successes++;}
  if(successes!==checks||checks!==100)throw new Error(`Routing failed: ${successes}/${checks}`);
  const lombard=graph.edges.filter(e=>e.kind==='lane'&&e.osmWay===402111597),heights=lombard.flatMap(e=>e.points.map(p=>p[1]));
  const report:Validation={files:artifacts.length,chunks:manifest.chunks.length,nodes:graph.nodes.length,edges:graph.edges.length,
    components:groups.length,largestComponentNodes:largest.length,largestComponentFraction:largest.length/Math.max(1,graph.nodes.length),
    routeChecks:checks,routeSuccesses:successes,allNodesStronglyConnected:groups.length===1,
    lombard:{lanes:lombard.length,maximumPoints:Math.max(0,...lombard.map(e=>e.points.length)),minimumHeight:heights.length?Math.min(...heights):null,maximumHeight:heights.length?Math.max(...heights):null},
    gzipBytes:manifest.stats.gzipBytes,withinBudget:manifest.stats.withinBudget};
  await atomicWrite(join(root,'validation.json'),JSON.stringify(report,null,2)+'\n');
  return report;
}
