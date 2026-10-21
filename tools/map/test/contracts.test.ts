import { describe, expect, it } from 'vitest';
import { geodeticToWorld, worldToGeodetic } from '../src/geo';
import { CHUNK_METRES, SF_FRAME } from '../src/config';
import { settings } from '../src/pipeline/settings';
import { SOURCE_CATALOG } from '../src/pipeline/catalog';

describe('A01 map coordinate and source contracts',()=>{
  it('uses Powell/Market ENU metres with east positive and north negative z',()=>{
    expect(SF_FRAME.origin).toEqual({lat:37.7842,lon:-122.4078});
    expect(geodeticToWorld(SF_FRAME.origin.lat,SF_FRAME.origin.lon,SF_FRAME)).toEqual([0,-0]);
    const east=geodeticToWorld(37.7842,-122.4068,SF_FRAME);
    const north=geodeticToWorld(37.7852,-122.4078,SF_FRAME);
    expect(east[0]).toBeGreaterThan(80);expect(east[0]).toBeLessThan(90);
    expect(north[1]).toBeLessThan(-110);expect(north[1]).toBeGreaterThan(-112);
    const [x,z]=geodeticToWorld(37.8021,-122.4187,SF_FRAME),point=worldToGeodetic(x,z,SF_FRAME);
    expect(point.lat).toBeCloseTo(37.8021,9);expect(point.lon).toBeCloseTo(-122.4187,9);
  });
  it('snaps the Ferry-to-Lombard slice to 78 complete 256 m chunks including negative coordinates',()=>{
    const s=settings();expect(CHUNK_METRES).toBe(256);expect(s.bounds).toEqual([-1536,-2560,1792,-1024]);
    expect((s.bounds[2]-s.bounds[0])*(s.bounds[3]-s.bounds[1])/256**2).toBe(78);
    expect(Math.floor(-0.1/256)).toBe(-1);
    expect(s.sourceBbox[0]).toBeLessThan(s.bbox[0]);expect(s.sourceBbox[3]).toBeGreaterThan(s.bbox[3]);
  });
  it('pins DataSF height semantics and all three source attribution records',()=>{
    expect(SOURCE_CATALOG.buildings.heightField).toBe('hgt_median_m');
    expect(SOURCE_CATALOG.buildings.licence).toBe('PDDL');
    for(const source of Object.values(SOURCE_CATALOG)){expect(new URL(source.evidence).protocol).toBe('https:');expect(source.attribution.length).toBeGreaterThan(5);}
  });
});
