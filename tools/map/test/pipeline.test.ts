import { afterAll, describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { MAP_ROOT, settings, unproject } from '../src/pipeline/settings';
import { decodeTerrarium, Terrain, terrariumHeight, tileKey } from '../src/pipeline/elevation';
import { createHeightfield, decodeHeightfield, encodeHeightfield } from '../src/pipeline/heightfield';
import { gradeSeparated, offsetPath, prepareRoadSurfaces, RoadTerrain, surfaceHeight } from '../src/pipeline/roads';
import { buildRoadGraph, components, findRoute } from '../src/pipeline/roadgraph';
import { extractPolygons, extractRoads, laneCounts, metric } from '../src/pipeline/osm';
import { buildBuildings, heightFor } from '../src/pipeline/buildings';
import { buildMap, validateMap } from '../src/pipeline/build';
import { digest, SourceCache } from '../src/pipeline/sources';
import { readGlb } from '../src/glb';
import type { DataSfBuilding, OsmExtract, Road, Tags, XZ } from '../src/pipeline/types';

const created:string[]=[];
async function temporary():Promise<string> {
  await mkdir(join(MAP_ROOT,'out/tests'),{recursive:true});
  const path=await mkdtemp(join(MAP_ROOT,'out/tests/run-'));created.push(path);return path;
}
afterAll(async()=>{for(const path of created)await rm(path,{recursive:true,force:true});});
const flat={sample:()=>10};
function road(id:number,points:[string,number,number][],tags:Tags={}):Road {
  return {id:`${id}:0`,osmWay:id,width:6.4,tags:{highway:'residential',...tags},points:points.map(([id,x,z])=>({id,x,z}))};
}
const empty:OsmExtract={elements:[]};

describe('source data and coordinates',()=>{
  it('decodes centimetres/fractions from raw PNG bytes, including negative elevations',()=>{
    expect(terrariumHeight(128,0,128)).toBe(0.5);
    expect(terrariumHeight(127,255,0)).toBe(-1);
    const png=new PNG({width:256,height:256});
    for(let i=0;i<png.data.length;i+=4){png.data[i]=128;png.data[i+1]=12;png.data[i+2]=64;png.data[i+3]=255;}
    expect(decodeTerrarium(PNG.sync.write(png))[120]).toBe(12.25);
    png.data[3]=0;expect(()=>decodeTerrarium(PNG.sync.write(png))).toThrow('no-data');
  });
  it('bilinearly samples across all four tiles at a shared corner',()=>{
    const tiles=new Map<string,Float32Array>();
    for(const [x,y,h] of [[9,19,10],[10,19,20],[9,20,30],[10,20,40]])tiles.set(tileKey({z:5,x:x!,y:y!}),new Float32Array(256*256).fill(h!));
    const terrain=new Terrain(5,tiles),lon=10/32*360-180,lat=Math.atan(Math.sinh(Math.PI*(1-2*20/32)))*180/Math.PI;
    expect(terrain.sampleLonLat(lon,lat)).toBeCloseTo(25,6);
    expect(()=>terrain.sampleLonLat(0,0)).toThrow('Missing terrain tile');
  });
  it('keeps shared heightfield edges identical after per-chunk quantization',()=>{
    const terrain={sample:(x:number,z:number)=>-7+x*0.193-z*0.091};
    const a=decodeHeightfield(encodeHeightfield(createHeightfield([0,0,256,256],terrain)));
    const b=decodeHeightfield(encodeHeightfield(createHeightfield([256,0,512,256],terrain)));
    expect(a.offsetCm).not.toBe(b.offsetCm);
    for(let z=0;z<a.size;z++)expect(a.offsetCm+a.values[z*a.size+a.size-1]!).toBe(b.offsetCm+b.values[z*b.size]!);
    expect(()=>decodeHeightfield(new Uint8Array(12))).toThrow('header');
  });
  it('rejects altered cached bytes and works offline without another HTTP request',async()=>{
    const root=await temporary();let requests=0;
    const server=createServer((_req,res)=>{requests++;res.end('pinned source');});
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
    try {
      const address=server.address();if(!address||typeof address==='string')throw new Error('No test port');
      const url=`http://127.0.0.1:${address.port}/data`,first=new SourceCache(root,true);
      expect(Buffer.from(await first.get('fixture',url)).toString()).toBe('pinned source');
      const offline=new SourceCache(root,false);await offline.get('fixture',url);expect(requests).toBe(1);
      await writeFile(join(root,first.records[0]!.file),'altered bytes');
      await expect(offline.get('fixture',url)).rejects.toThrow('Corrupt');
      await expect(offline.get('absent',url)).rejects.toThrow('Missing cached');
    }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
  });
});

describe('roads and hills',()=>{
  it('flattens a surface road across its width and leaves shoulders outside the blend untouched',()=>{
    const terrain={sample:(x:number,z:number)=>x/10+z*3};
    const r=road(1,[['a',0,0],['b',20,0]]);prepareRoadSurfaces([r],terrain,[]);
    const carved=new RoadTerrain(terrain,[r]);
    expect(carved.sample(10,2)).toBeCloseTo(1);
    expect(carved.sample(10,15)).toBe(46);
    expect(surfaceHeight(r,carved,10,2)).toBeCloseTo(1.1);
    expect(offsetPath([[0,0],[10,0]],1.6)).toEqual([[0,1.6],[10,1.6]]);
  });
  it.each([{bridge:'yes'},{tunnel:'yes'},{layer:'1'},{layer:'-1'}] as Tags[])('interpolates portals and does not carve grade-separated %j',tags=>{
    const terrain={sample:(x:number)=>Math.abs(x-10)<5?50:0};
    const r=road(1,[['a',0,0],['b',20,0]],tags);expect(gradeSeparated(r)).toBe(true);
    prepareRoadSurfaces([r],terrain,[]);
    expect(surfaceHeight(r,terrain,10,0)).toBeCloseTo(0.1);
    expect(new RoadTerrain(terrain,[r]).sample(10,0)).toBe(50);
  });
  it('uses portal ends across split bridge ways rather than sampling terrain under the join',()=>{
    const terrain={sample:(x:number)=>x===10?-30:x===0?10:20};
    const a=road(1,[['a',0,0],['mid',10,0]],{bridge:'yes'}),b=road(2,[['mid',10,0],['b',20,0]],{bridge:'yes'});
    prepareRoadSurfaces([a,b],terrain,[]);
    expect(surfaceHeight(a,terrain,10,0)).toBeCloseTo(15.1);
    expect(surfaceHeight(b,terrain,10,0)).toBeCloseTo(15.1);
  });
  it('keeps a reverse one-way and lane counts instead of treating every street as bidirectional',()=>{
    expect(laneCounts({oneway:'-1',lanes:'2'})).toMatchObject({forward:0,backward:2});
    expect(laneCounts({highway:'service',lanes:'1'})).toMatchObject({forward:1,backward:1,shared:true});
    const graph=buildRoadGraph([road(1,[['a',0,0],['b',30,0]],{oneway:'-1',lanes:'1'})],empty,flat);
    expect(graph.edges.filter(e=>e.kind==='lane')).toHaveLength(1);
    expect(graph.edges[0]!.points[0]![0]).toBeGreaterThan(graph.edges[0]!.points.at(-1)![0]);
  });
  it('does not invent a junction at a geometric crossing without a shared OSM node',()=>{
    const roads=[road(1,[['a',-20,0],['b',20,0]]),road(2,[['c',0,-20],['d',0,20]])];
    const graph=buildRoadGraph(roads,empty,flat);
    expect(components(graph)).toHaveLength(2);
    const start=graph.edges.find(e=>e.kind==='lane'&&e.osmWay===1)!,end=graph.edges.find(e=>e.kind==='lane'&&e.osmWay===2)!;
    expect(findRoute(graph,start.from,end.to)).toBeUndefined();
  });
  it('connects shared junctions, preserves controls, and removes prohibited turns',()=>{
    const roads=[road(1,[['a',-30,0],['osm:10',0,0],['b',30,0]]),road(2,[['c',0,-30],['osm:10',0,0],['d',0,30]])];
    roads[0]!.points[1]!.control='signal';roads[1]!.points[1]!.control='signal';
    const osm:OsmExtract={elements:[{type:'relation',id:100,tags:{type:'restriction',restriction:'no_right_turn'},members:[
      {type:'way',ref:1,role:'from'},{type:'node',ref:10,role:'via'},{type:'way',ref:2,role:'to'},
    ]}]};
    const unrestricted=buildRoadGraph(roads,empty,flat),restricted=buildRoadGraph(roads,osm,flat);
    const forbidden=unrestricted.edges.filter(e=>e.kind==='connector'&&e.id.startsWith('turn:lane:1:')&&e.osmWay===2);
    expect(forbidden.length).toBeGreaterThan(0);expect(restricted.nodes.some(n=>n.control==='signal')).toBe(true);
    expect(restricted.edges.some(e=>forbidden.some(f=>f.id===e.id))).toBe(false);
    expect(components(unrestricted)).toHaveLength(1);
    expect(findRoute(unrestricted,unrestricted.nodes[0]!.id,unrestricted.nodes.at(-1)!.id)).toBeDefined();
  });
});

describe('buildings and OSM polygons',()=>{
  it('uses DataSF before OSM height, and parses height/level fallbacks with units',()=>{
    expect(heightFor({hgt_median_m:'12.5'},{height:'90'})).toEqual({height:12.5,source:'datasf'});
    expect(heightFor({hgt_median_m:'0'},{height:'100 ft'}).height).toBeCloseTo(30.48);
    expect(heightFor(undefined,{'building:levels':'60'})).toEqual({height:192,source:'osm-levels'});
    expect(metric('8.5 m')).toBe(8.5);expect(metric('unspecified')).toBeUndefined();
  });
  it('assembles reversed multipolygon members and keeps an inner courtyard',()=>{
    const coords=(points:XZ[])=>points.map(([x,z])=>{const p=unproject(x,z);return {lat:p.lat,lon:p.lon};});
    const osm:OsmExtract={elements:[{type:'relation',id:1,tags:{type:'multipolygon',building:'yes'},members:[
      {type:'way',ref:1,role:'outer',geometry:coords([[0,0],[20,0],[20,20]])},
      {type:'way',ref:2,role:'outer',geometry:coords([[0,0],[0,20],[20,20]])},
      {type:'way',ref:3,role:'inner',geometry:coords([[5,5],[5,15],[15,15],[15,5],[5,5]])},
    ]}]};
    const warnings:string[]=[],polygons=extractPolygons(osm,t=>Boolean(t.building),warnings);
    expect(warnings).toEqual([]);expect(polygons[0]!.polygon).toHaveLength(2);
  });
  it('anchors building bases at the minimum sampled ground under the footprint',()=>{
    const coords=[[10,10],[30,10],[30,30],[10,30],[10,10]].map(([x,z])=>{const p=unproject(x!,z!);return [p.lon,p.lat] as XZ;});
    const row:DataSfBuilding={sf16_bldgid:'test',hgt_median_m:'12',shape:{type:'MultiPolygon',coordinates:[[coords]]}};
    const s={...settings(),bounds:[0,0,256,256] as const};
    const buildings=buildBuildings([row],empty,{sample:(x,z)=>x+z},s,[]);
    expect(buildings).toHaveLength(1);expect(buildings[0]!.base).toBeCloseTo(20,4);expect(buildings[0]!.heightSource).toBe('datasf');
  });
});

it('builds two compressed LODs, collision and a routable graph deterministically from offline inputs',async()=>{
  const out=await temporary(),s={...settings('lombard'),bounds:[0,0,256,256] as const,out};
  const points=[[20,128],[128,128],[236,128]].map(([x,z])=>{const p=unproject(x!,z!);return {lat:p.lat,lon:p.lon};});
  const osm:OsmExtract={elements:[{type:'way',id:1,nodes:[1,2,3],geometry:points,tags:{highway:'residential',name:'Fixture Street',lanes:'2'}},
    {type:'node',id:2,...points[1]!,tags:{highway:'stop'}}]};
  const coords=[[100,150],[120,150],[120,170],[100,170],[100,150]].map(([x,z])=>{const p=unproject(x!,z!);return [p.lon,p.lat] as XZ;});
  const input={osm,buildings:[{sf16_bldgid:'fixture',hgt_median_m:'12',shape:{type:'MultiPolygon' as const,coordinates:[[coords]]}}],
    terrain:{sample:(x:number,z:number)=>20+x*.03+z*.02} as Terrain,sources:{version:1 as const,configKey:'fixture',records:[],dataSfAsOf:[]}};
  const roads=extractRoads(osm,s.bounds);expect(roads).toHaveLength(1);
  const manifest=await buildMap(s,input),chunk=manifest.chunks[0]!;
  expect(chunk.triangles[0]).toBeGreaterThan(chunk.triangles[1]);
  const glb=await readFile(join(out,chunk.lods[0].path)),doc=await readGlb(glb);
  expect([...new Set(doc.getRoot().listMeshes().map(m=>m.getName()))].sort()).toEqual(['buildings','roads','terrain']);
  expect(doc.getRoot().listExtensionsRequired().map(e=>e.extensionName)).toContain('EXT_meshopt_compression');
  const report=await validateMap(out);expect(report.routeSuccesses).toBe(100);expect(report.allNodesStronglyConnected).toBe(true);
  const first=digest(await readFile(join(out,'manifest.json')));
  await buildMap(s,input);
  expect(digest(await readFile(join(out,'manifest.json')))).toBe(first);
  expect(digest(await readFile(join(out,chunk.lods[0].path)))).toBe(digest(glb));
},60_000);
