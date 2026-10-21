import { readFile } from 'node:fs/promises';
import { describe,expect,it } from 'vitest';
import { parseOsm, acquireInputs } from '../src/pipeline/sources';
import { settings, project } from '../src/pipeline/settings';
import { extractRoads,laneCounts } from '../src/pipeline/osm';
import { parseOpl } from '../src/pipeline/pbf';

describe('A02 pinned source topology',()=>{
  it('retains every live Lombard switchback vertex, one-way lane and tagged control',async()=>{
    const osm=parseOsm(await readFile(new URL('./fixtures/lombard-osm.json',import.meta.url)));
    const way=osm.elements.find(e=>e.id===402111597)!,roads=extractRoads(osm,settings().bounds),lombard=roads.find(r=>r.osmWay===way.id)!;
    expect(way.nodes).toHaveLength(157);expect(lombard.points).toHaveLength(157);
    for(const [i,p] of lombard.points.entries()) {
      expect(p.id).toBe(`osm:${way.nodes![i]}`);
      expect([p.x,p.z]).toEqual(project(way.geometry![i]!.lon,way.geometry![i]!.lat));
    }
    expect(laneCounts(lombard.tags)).toMatchObject({forward:1,backward:0});
    expect(lombard.tags.surface).toBe('bricks');
    expect(roads.some(r=>r.tags.bridge==='yes')).toBe(true);
    expect(osm.elements.some(e=>e.tags?.highway==='traffic_signals')).toBe(true);
    expect(osm.elements.some(e=>e.tags?.highway==='stop')).toBe(true);
  });
  it('rejects timeout remarks and truncated road geometry before accepting source data',()=>{
    const bytes=(value:unknown)=>Buffer.from(JSON.stringify(value));
    expect(()=>parseOsm(bytes({elements:[],remark:'runtime timeout'}))).toThrow('Incomplete');
    expect(()=>parseOsm(bytes({elements:[{type:'way',id:1,tags:{highway:'residential'},nodes:[1,2],geometry:[{lat:37,lon:-122}]}]}))).toThrow('Incomplete OSM road geometry');
  });
  it('refuses citywide Overpass before making network requests',async()=>{
    await expect(acquireInputs(settings('sf'),false)).rejects.toThrow('--osm-pbf');
  });
});

const lines=async function*(text:string){yield* text.trim().split('\n');};
describe('PBF topology conversion through OPL',()=>{
  it('decodes escaped labels, shared node IDs and turn restriction roles',async()=>{
    const osm=await parseOpl(lines(`n1 Thighway=traffic_signals x-122.42 y37.8
n2 T x-122.419 y37.8
n3 T x-122.419 y37.801
w10 Thighway=residential,name=Corner%20%Street,oneway=yes Nn1,n2
w11 Thighway=residential,bridge=yes,layer=1 Nn2,n3
r20 Ttype=restriction,restriction=no_right_turn Mw10@from,n2@via,w11@to`));
    const way=osm.elements.find(e=>e.id===10)!;
    expect(way.tags?.name).toBe('Corner Street');expect(way.nodes).toEqual([1,2]);
    expect(way.geometry?.[1]).toEqual({lat:37.8,lon:-122.419});
    expect(osm.elements.at(-1)?.members?.[2]).toMatchObject({ref:11,role:'to',geometry:[{lat:37.8,lon:-122.419},{lat:37.801,lon:-122.419}]});
  });
  it('rejects missing nodes instead of joining a truncated way across a gap',async()=>{
    await expect(parseOpl(lines('w10 Thighway=residential Nn1,n2'))).rejects.toThrow('missing node');
  });
});
