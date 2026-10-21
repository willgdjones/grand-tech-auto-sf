import { expect, it } from 'vitest';
import { parseOpl } from '../src/pipeline/pbf';
import { extractPolygons } from '../src/pipeline/osm';

const lines = async function* (text: string) { yield* text.trim().split('\n'); };

it('retains western park, wood, lake and beach relations with holes, and rejects incomplete coverage', async () => {
  const source = `n1 T x-122.49 y37.77
n2 T x-122.48 y37.77
n3 T x-122.48 y37.765
n4 T x-122.49 y37.765
n5 T x-122.487 y37.768
n6 T x-122.485 y37.768
n7 T x-122.485 y37.766
n8 T x-122.487 y37.766
w10 Thighway=residential Nn1,n2
w20 T Nn1,n2,n3
w21 T Nn3,n4,n1
w22 T Nn5,n6,n7,n8,n5`;
  for (const tag of ['leisure=park', 'natural=wood', 'natural=water', 'natural=beach']) {
    const osm = await parseOpl(lines(`${source}\nr30 Ttype=multipolygon,${tag} Mw20@outer,w21@outer,w22@inner`));
    const warnings: string[] = [];
    const polygons = extractPolygons(osm, t => Boolean(t.natural || t.leisure), warnings);
    expect(warnings).toEqual([]);
    expect(polygons).toHaveLength(1);
    expect(polygons[0]!.polygon.map(ring => ring.length)).toEqual([4, 4]);
  }
  const incomplete = await parseOpl(lines(`${source}\nr31 Ttype=multipolygon,natural=wood Mw20@outer,w99@outer`));
  const warnings: string[] = [];
  expect(extractPolygons(incomplete, t => Boolean(t.natural), warnings)).toEqual([]);
  expect(warnings).toEqual(['OSM relation 31: Relation member has no geometry']);
  await expect(parseOpl(lines(`${source}\nr32 Ttype=multipolygon,building=yes Mw99@outer`)))
    .rejects.toThrow('Incomplete PBF relation 32: missing way 99');
});
