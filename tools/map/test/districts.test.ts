import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { DISTRICTS_CORE } from '../src/districts/core';
import { districtAt } from '../src/districts';
import { districtGroundSampler, districtStreetDetail } from '../src/pipeline/districts';
import { buildBuildings } from '../src/pipeline/buildings';
import { buildMap } from '../src/pipeline/build';
import { project, settings, unproject } from '../src/pipeline/settings';
import { addBuildings, ChunkMeshes } from '../src/pipeline/meshes';
import { readGlb } from '../src/glb';
import type { Terrain } from '../src/pipeline/elevation';
import type { Bounds, Building, OsmExtract, Road, XZ } from '../src/pipeline/types';

it('bakes sourced district street fronts, paving, ground and collision while retaining the city LOD',async()=>{
  const terrain={sample:()=>20},empty:OsmExtract={elements:[]};
  const ground=districtGroundSampler(empty,[]);
  for(const district of DISTRICTS_CORE) {
    const [x,z]=project(district.spawn.lon,district.spawn.lat);
    expect(districtAt(x,z)?.id,district.id).toBe(district.id);
    expect(ground(x,z,false)).toEqual(district.ground.urban);
    expect(ground(x,z,true)).toEqual([.10,.23,.41]);
    const road:Road={id:'street',osmWay:1,width:8,tags:{highway:'residential',name:district.streets[0]!},
      points:[{id:'a',x:x-100,z},{id:'b',x:x+100,z}]};
    const building:Building={id:'shop',polygon:[[[x-5,z+10],[x+5,z+10],[x+5,z+20],[x-5,z+20]]],
      base:20,foundation:19.7,height:12,heightSource:'osm-height',colour:[.7,.62,.5],landuse:'retail'};
    const detail=districtStreetDetail([road]);
    expect(detail.keepBuilding(building),district.id).toBe(true);
    expect(districtStreetDetail([{...road,tags:{...road.tags,bridge:'yes'}}]).keepBuilding(building)).toBe(false);
    expect(detail.keepBuilding({...building,polygon:building.polygon.map(r=>r.map(([px,pz])=>[px,pz+150]))})).toBe(false);
    const bounds:Bounds=[Math.floor(x/256)*256,Math.floor(z/256)*256,(Math.floor(x/256)+1)*256,(Math.floor(z/256)+1)*256];
    const meshes=new ChunkMeshes(bounds);
    addBuildings(meshes,[building],1,true,new Set(['shop']));
    expect([...meshes.chunks.values()].some(c=>c.buildings.indices.length>0)).toBe(true);
  }

  // One real pipeline chunk: a 100m² shop that the old 400m² cutoff removed, and a mapped
  // sidewalk/crossing loop. Keep the fixture away from the initial detail corridor.
  const [cx,cz]=project(-122.4037,37.7785),x0=Math.floor(cx/256)*256,z0=Math.floor(cz/256)*256;
  const x=x0+128,z=z0+128,bounds:Bounds=[x0,z0,x0+256,z0+256];
  const way=(id:number,points:XZ[],tags:Record<string,string>)=>({type:'way' as const,id,
    nodes:points.map(([px,pz])=>Math.round(px*1000)*100000+Math.round(pz*1000)),
    geometry:points.map(([px,pz])=>unproject(px,pz)),tags});
  const road=way(1,[[x-100,z],[x+100,z]],{highway:'residential',name:'Folsom Street',lanes:'2'});
  const shop=way(2,[[x-5,z+15],[x+5,z+15],[x+5,z+25],[x-5,z+25],[x-5,z+15]],{building:'retail',height:'12'});
  const zoning=way(3,[[x-120,z-120],[x+120,z-120],[x+120,z+120],[x-120,z+120],[x-120,z-120]],{landuse:'residential'});
  const park=way(4,[[x+50,z+50],[x+95,z+50],[x+95,z+95],[x+50,z+95],[x+50,z+50]],{leisure:'park'});
  const osm:OsmExtract={elements:[road,shop,zoning,park,
    way(5,[[x-95,z-7],[x+95,z-7]],{highway:'footway',footway:'sidewalk'}),
    way(6,[[x+95,z-7],[x+95,z+7]],{highway:'footway',footway:'crossing'}),
    way(7,[[x+95,z+7],[x-95,z+7]],{highway:'footway',footway:'sidewalk'}),
    way(8,[[x-95,z+7],[x-95,z-7]],{highway:'footway',footway:'crossing'})]};
  const out=await mkdtemp(join(tmpdir(),'gtasf-district-'));
  try {
    const config={...settings('sf'),bounds,out};
    const source=buildBuildings([],osm,terrain,config,[]);
    expect(source).toHaveLength(1);
    expect(source[0]!.landuse).toBe('retail'); // Explicit building type beats surrounding zoning.
    const sample=districtGroundSampler(osm,[]);
    expect(sample(x+75,z+75,false)).toEqual(districtAt(x+75,z+75)!.ground.park);
    const manifest=await buildMap(config,{osm,buildings:[],terrain:terrain as unknown as Terrain,
      sources:{version:1,configKey:'district-smoke',records:[],dataSfAsOf:[]}});
    const chunk=manifest.chunks[0]!;
    expect(chunk.detail).toBe('low');
    expect(chunk.lods[0].path).toBe(chunk.lods[1].path); // No blanket second LOD.
    const collision=JSON.parse(await readFile(join(out,chunk.collision.path),'utf8'));
    expect(collision.buildings).toHaveLength(1);
    expect(collision.buildings[0].heightSource).toBe('osm-height');
    const doc=await readGlb(await readFile(join(out,chunk.lods[0].path)));
    expect(doc.getRoot().listMeshes().some(m=>m.getName()==='buildings')).toBe(true);
    expect(doc.getRoot().listMeshes().some(m=>m.getName()==='roads')).toBe(true);
    expect(manifest.stats.gzipBytes).toBeLessThan(100_000);
  } finally {await rm(out,{recursive:true,force:true});}
},30_000);
