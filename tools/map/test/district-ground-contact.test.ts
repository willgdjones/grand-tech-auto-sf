import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { readGlb } from '../src/glb';
import { buildMap } from '../src/pipeline/build';
import { containsRing } from '../src/pipeline/geometry';
import { project, settings, unproject } from '../src/pipeline/settings';
import type { Terrain } from '../src/pipeline/elevation';
import type { Bounds, OsmExtract, XZ } from '../src/pipeline/types';

it('keeps the actual coarse district GLB terrain off the walkable road across a hillside',async()=>{
  const [cx,cz]=project(-122.473,37.807),x0=Math.floor(cx/256)*256,z0=Math.floor(cz/256)*256;
  const bounds:Bounds=[x0,z0,x0+256,z0+256],z=z0+133.7;
  const points:XZ[]=[[x0+20,z],[x0+236,z]];
  const osm:OsmExtract={elements:[{type:'way',id:27031206,nodes:[1,2],
    geometry:points.map(([x,z])=>unproject(x,z)),
    tags:{highway:'residential',name:'Lincoln Boulevard',width:'8',lanes:'2'}}]};
  // Curved ground between the 16m visual grid rows exposes the original overlap.
  const terrain={sample:(x:number,pz:number)=>48+0.01*(pz-z)**2+0.01*(x-x0)};
  const out=await mkdtemp(join(tmpdir(),'gtasf-district-ground-'));
  try {
    const manifest=await buildMap({...settings('sf'),bounds,out},{osm,buildings:[],terrain:terrain as unknown as Terrain,
      sources:{version:1,configKey:'district-ground-smoke',records:[],dataSfAsOf:[]}});
    const chunk=manifest.chunks[0]!;
    expect(chunk.detail).toBe('low');
    expect(chunk.lods[0].path).toBe(chunk.lods[1].path);
    const doc=await readGlb(await readFile(join(out,chunk.lods[0].path)));
    const pointsToCheck:XZ[]=[[73.2,z-z0],[128.3,z-z0+1.2],[199.4,z-z0-1.1]];
    const hits=(name:string,p:XZ)=>doc.getRoot().listNodes().filter(node=>node.getName()===name).reduce((count,node)=>{
      const matrix=new Matrix4().fromArray(node.getWorldMatrix());
      for(const primitive of node.getMesh()!.listPrimitives()) {
        const position=primitive.getAttribute('POSITION')!,indices=primitive.getIndices()!;
        for(let i=0;i<indices.getCount();i+=3) {
          const ring:XZ[]=[];
          for(let j=0;j<3;j++) {
            const value=position.getElement(indices.getScalar(i+j),[]);
            const vertex=new Vector3(value[0]!,value[1]!,value[2]!).applyMatrix4(matrix);
            ring.push([vertex.x,vertex.z]);
          }
          if(containsRing(ring,p))count++;
        }
      }
      return count;
    },0);
    for(const point of pointsToCheck) {
      expect(hits('roads',point),`road exists at ${point}`).toBeGreaterThan(0);
      expect(hits('terrain',point),`ground must not cover road at ${point}`).toBe(0);
    }
    expect(hits('terrain',[77.3,45.2]),'adjacent park terrain is retained').toBeGreaterThan(0);
  } finally {await rm(out,{recursive:true,force:true});}
},30_000);
