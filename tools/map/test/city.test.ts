import { describe, expect, it } from 'vitest';
import { readGlb } from '../src/glb';
import { compactRoadGraph, simplifyProfile } from '../src/pipeline/compact';
import { addRoadMeshes, addTerrainMeshes, ChunkMeshes, chunkGlb } from '../src/pipeline/meshes';
import { SpatialIndex } from '../src/pipeline/geometry';
import { buildRoadGraph, components } from '../src/pipeline/roadgraph';
import { prepareRoadSurfaces, RoadTerrain } from '../src/pipeline/roads';
import { parseOpl } from '../src/pipeline/pbf';
import { clearTunnelPassages } from '../src/pipeline/buildings';
import type { Building, Road, Tags } from '../src/pipeline/types';
import { createRoadSampler, FootprintIndex } from '../../../web/src/render/chunks/terrain';

const flat={sample:()=>10};
function road(id:number,points:[number,number][],tags:Tags={}):Road {
  return {id:String(id),osmWay:id,width:6.4,tags:{highway:'residential',...tags},
    points:points.map(([x,z])=>({id:`${x}:${z}`,x,z}))};
}
describe('city expansion regressions',()=>{
  it('retains the same curved border at detailed and coarse terrain LODs',()=>{
    const edge=(step:number)=>{
      const meshes=new ChunkMeshes([0,0,256,256]);
      addTerrainMeshes(meshes,{sample:(_x,z)=>Math.sin(z/9)*5},new SpatialIndex(),step,4);
      const p=meshes.chunks.get('0_0')!.terrain.positions,values=new Map<number,number>();
      for(let i=0;i<p.length;i+=3)if(p[i]===256)values.set(p[i+2]!,p[i+1]!);
      return [...values].sort((a,b)=>a[0]-b[0]);
    };
    expect(edge(32)).toEqual(edge(4));
    expect(edge(32)).toHaveLength(65);
  });
  it('keeps a player on their bridge or tunnel level at a stacked crossing',()=>{
    const sampler=createRoadSampler({version:1,nodes:[],edges:[
      {id:'lane:ground',from:'a',to:'b',lengthM:40,speedMps:10,lane:0,points:[[-20,0,0],[20,0,0]]},
      {id:'lane:bridge',from:'c',to:'d',lengthM:40,speedMps:10,lane:0,points:[[-20,12,1],[20,12,1]],bridge:true},
      {id:'lane:tunnel',from:'e',to:'f',lengthM:40,speedMps:10,lane:0,points:[[-20,-12,1],[20,-12,1]],tunnel:true},
    ]} as Parameters<typeof createRoadSampler>[0]);
    expect(sampler(0,0,12)).toBe(12);
    expect(sampler(0,0,-12)).toBe(-12);
    expect(sampler(0,0,0)).toBe(0);
    expect(sampler(0,0)).toBe(0);
  });
  it('keeps wheel contact in a portal under a street within five metres overhead',()=>{
    const sampler=createRoadSampler({version:1,nodes:[],edges:[
      {id:'lane:overhead',from:'a',to:'b',lengthM:40,speedMps:10,lane:0,points:[[-20,46.4,0],[20,46.4,0]]},
      {id:'lane:bore',from:'c',to:'d',lengthM:40,speedMps:10,lane:0,points:[[-20,42,1],[20,42,1]],tunnel:true},
    ]} as Parameters<typeof createRoadSampler>[0]);
    expect(sampler(0,0,42)).toBe(42);
    expect(sampler(0,1,46.4)).toBeCloseTo(46.4, 4); // float32 road heights since gtasf-0k01
  });
  it('removes coplanar road overlap while retaining the full intersection area',()=>{
    const roads=[road(1,[[0,128],[256,128]]),road(2,[[128,0],[128,256]])];
    prepareRoadSurfaces(roads,flat,[]);
    const meshes=new ChunkMeshes([0,0,256,256]);
    addRoadMeshes(meshes,roads,new RoadTerrain(flat,roads),1);
    const data=meshes.chunks.get('0_0')!.roads;let area=0;
    for(let i=0;i<data.indices.length;i+=3) {
      const [a,b,c]=data.indices.slice(i,i+3).map(index=>data.positions.slice(index*3,index*3+3));
      area+=Math.abs((b![0]!-a![0]!)*(c![2]!-a![2]!)-(b![2]!-a![2]!)*(c![0]!-a![0]!))/2;
    }
    expect(area).toBeCloseTo(256*6.4*2-6.4**2,2);
  });
  it('bakes a visible tunnel shell and cuts its terrain portals',()=>{
    const r=road(1,[[0,128],[256,128]],{tunnel:'yes',layer:'-1'}),hill={sample:(x:number)=>10+30*Math.sin(Math.PI*x/256)};
    prepareRoadSurfaces([r],hill,[]);
    const meshes=new ChunkMeshes([0,0,256,256]),cuts=addRoadMeshes(meshes,[r],hill,1);
    expect(meshes.chunks.get('0_0')!.structures.indices.length).toBeGreaterThan(0);
    expect(cuts.query([0,128,0,128]).length).toBeGreaterThan(0);
    expect(cuts.query([128,128,128,128])).toHaveLength(0);
  });
  it('opens a tunnel bore through a foundation while retaining the building above and below',()=>{
    const r=road(1,[[-10,20],[50,20]],{tunnel:'yes',layer:'-1'});
    prepareRoadSurfaces([r],flat,[]);
    const building:Building={id:'survey:1',polygon:[[[0,0],[40,0],[40,40],[0,40]]],height:30,base:0,foundation:0,heightSource:'datasf',colour:[.5,.5,.5],landuse:'residential'};
    const changed:number[]=[];
    const parts=clearTunnelPassages([building],[r],[],()=>changed.push(1));
    const index=new FootprintIndex();index.rebuild([{version:1,origin:[0,0,0],buildings:parts.map(b=>({id:b.id,rings:b.polygon,minY:b.foundation,maxY:b.base+b.height}))}]);
    expect(changed).toHaveLength(1);
    expect(index.collides(20,10.1,20,.9,1.8)).toBe(false);
    expect(index.collides(20,16,20,.9,1.8)).toBe(true);
    expect(index.collides(20,8,20,.9,1)).toBe(true);
    expect(index.collides(20,11,5,.9,1.8)).toBe(true);
  });
  it('propagates Bay approach clearance across shared ramp endpoints without a step',()=>{
    const roads=[road(1,[[0,500],[80,500]],{bridge:'yes',layer:'1',ref:'I 80'}),
      road(2,[[80,500],[160,500]],{bridge:'yes',layer:'1'})];
    const ground={sample:(x:number)=>10+25*Math.exp(-((x-65)**2)/200)};
    prepareRoadSurfaces(roads,ground,[]);
    expect(roads[0]!.profile!.at(-1)![1]).toBeCloseTo(roads[1]!.profile![0]![1],6);
    for(const r of roads)for(let i=1;i<r.profile!.length;i++) {
      const a=r.profile![i-1]!,b=r.profile![i]!;
      expect(b[1]-ground.sample(b[0])).toBeGreaterThanOrEqual(5.5-1e-6);
      expect(Math.abs(b[1]-a[1])/Math.hypot(b[0]-a[0],b[2]-a[2])).toBeLessThanOrEqual(.200001);
    }
  });
  it('keeps topology and controls while shrinking redundant graph geometry',()=>{
    const roads=[road(1,[[0,0],[30,0],[60,0]]),road(2,[[30,0],[30,40]])];
    roads[0]!.points[1]!.control='signal';prepareRoadSurfaces(roads,flat,[]);
    const source=buildRoadGraph(roads,{elements:[]},flat),packed=compactRoadGraph(source);
    expect(components(packed).map(c=>c.length)).toEqual(components(source).map(c=>c.length));
    expect(packed.nodes.filter(n=>n.control).map(n=>n.osmNode)).toEqual(source.nodes.filter(n=>n.control).map(n=>n.osmNode));
    expect(JSON.stringify(packed).length).toBeLessThan(JSON.stringify(source).length);
    expect(simplifyProfile([[0,0,0],[1,0,0],[2,1,0],[3,0,0]])).toEqual([[0,0,0],[1,0,0],[2,1,0],[3,0,0]]);
  });
  it('caps every decoded primitive upload at 64 KiB and shares its material',async()=>{
    const meshes=new ChunkMeshes([0,0,256,256]),chunk=meshes.chunks.get('0_0')!;
    for(let i=0;i<10000;i++) {
      const x=i%100,z=Math.floor(i/100);
      chunk.terrain.add([[x,0,z],[x,0,z+.9],[x+.9,0,z]],[.2,.3,.4]);
    }
    const doc=await readGlb(await chunkGlb(chunk,256));
    expect(doc.getRoot().listMeshes().length).toBeGreaterThan(1);
    expect(doc.getRoot().listMaterials()).toHaveLength(1);
    for(const mesh of doc.getRoot().listMeshes())for(const p of mesh.listPrimitives()) {
      const bytes=p.listAttributes().reduce((sum,a)=>sum+a.getArray()!.byteLength,0)+p.getIndices()!.getArray()!.byteLength;
      expect(bytes).toBeLessThanOrEqual(64*1024);
    }
  });
  it('ignores incomplete unused regional boundaries but rejects incomplete building geometry',async()=>{
    const lines=async function*(relation:string){yield* ['n1 T x-122.42 y37.8','n2 T x-122.419 y37.8','w10 Thighway=residential Nn1,n2',relation];};
    const parsed=await parseOpl(lines('r20 Ttype=multipolygon,boundary=protected_area Mw99@outer'));
    expect(parsed.elements.map(e=>e.type)).toEqual(['way']);
    await expect(parseOpl(lines('r20 Ttype=multipolygon,building=yes Mw99@outer'))).rejects.toThrow('missing way');
  });
});
