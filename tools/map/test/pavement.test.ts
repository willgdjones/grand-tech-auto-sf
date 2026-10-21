import { expect, it } from 'vitest';
import { contains, containsRing } from '../src/pipeline/geometry';
import { addRoadMeshes, addTerrainMeshes, ChunkMeshes } from '../src/pipeline/meshes';
import type { MeshData } from '../src/pipeline/meshes';
import { preparePavements } from '../src/pipeline/pavement';
import type { Polygon, Road, Tags, XZ } from '../src/pipeline/types';

it('paves a closed mapped street, keeps protected land and decks, and leaves crossings asphalt',()=>{
  let id=0;
  const road=(points:XZ[],tags:Tags,width=2):Road=>({id:String(++id),osmWay:id,width,tags,
    points:points.map(([x,z])=>({id:`${x},${z}`,x,z}))});
  const outline=(offset:number):Road[]=>[
    road([[20+offset,20],[80+offset,20]],{highway:'footway',footway:'sidewalk'}),
    road([[80+offset,20],[80+offset,30],[80+offset,40]],{highway:'footway',footway:'crossing',surface:'asphalt'}),
    road([[80+offset,40],[20+offset,40]],{highway:'footway',footway:'sidewalk'}),
    road([[20+offset,40],[20+offset,30],[20+offset,20]],{highway:'footway',footway:'crossing',surface:'asphalt'}),
  ];
  const lane=road([[20,30],[80,30]],{highway:'residential'},6.4);
  const bridge=road([[100,30],[160,30]],{highway:'residential',bridge:'yes'},6.4);
  bridge.profile=[[100,18,30],[160,18,30]];
  const roads=[...outline(0),lane,...outline(80),bridge],before=JSON.stringify(roads);
  const building:Polygon=[[[39,34],[44,34],[44,38],[39,38]]];
  const park:Polygon=[[[50,22],[60,22],[60,25],[50,25]]];
  const paving=preparePavements(roads,[building,park]);
  expect(paving).toHaveLength(1);
  expect(paving[0]!.roadIds).toEqual([lane.id]);
  expect(contains(paving[0]!.polygon,[30,25])).toBe(true);
  expect(contains(paving[0]!.polygon,[41,36])).toBe(false);
  expect(contains(paving[0]!.polygon,[55,23])).toBe(false);
  expect(preparePavements(roads.filter(r=>r!==roads[0]),[building,park])).toHaveLength(0);
  const meshes=new ChunkMeshes([0,0,256,256]),ground={sample:()=>10};
  const cuts=addRoadMeshes(meshes,roads,ground,0,paving);addTerrainMeshes(meshes,ground,cuts,16);
  const chunk=meshes.chunks.get('0_0')!;
  const facesAt=(mesh:MeshData,p:XZ)=>{
    const result:{colour:number[];y:number}[]=[];
    for(let i=0;i<mesh.indices.length;i+=3) {
      const ids=mesh.indices.slice(i,i+3),ring=ids.map(j=>[mesh.positions[j*3]!,mesh.positions[j*3+2]!] as XZ);
      if(containsRing(ring,p))result.push({colour:mesh.colours.slice(ids[0]!*3,ids[0]!*3+3),y:mesh.positions[ids[0]!*3+1]!});
    }
    return result;
  };
  expect(facesAt(chunk.roads,[30.1,25.2])).toHaveLength(1);
  expect(facesAt(chunk.terrain,[30.1,25.2])).toHaveLength(0);
  expect(facesAt(chunk.roads,[41.1,36.2])).toHaveLength(0);
  expect(facesAt(chunk.roads,[55.1,23.2])).toHaveLength(0);
  expect(facesAt(chunk.roads,[19.7,25.2])[0]!.colour).toEqual([51,54,56]);
  expect(facesAt(chunk.roads,[125.1,25.2])).toHaveLength(0);
  expect(facesAt(chunk.roads,[125.1,30.2])[0]!.y).toBe(18.1);
  expect(JSON.stringify(roads)).toBe(before);
});
