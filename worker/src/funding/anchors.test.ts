import { expect, it } from 'vitest';
import { decodePackedRoadGraph } from '@gtasf/shared/roadgraphPacked';
import { LocalRoads } from '../world/localRoads';
import { PackedRoads } from '../world/packedRoads';
import { fundingAnchor } from './anchors';
import { cityAnchorRoadBytes, cityAnchorEventId } from './city-anchors.fixture';
import snapshot from '../events/data/sf-tech-week.json';

it('resolves the real outer-city venue with its active packed road and keeps corridor fallback', () => {
  const event = snapshot.events.find(value => value.id === cityAnchorEventId)!;
  expect(fundingAnchor(event)).toBeNull();
  const roads = new PackedRoads(decodePackedRoadGraph(cityAnchorRoadBytes));
  expect(roads.graph.edges).toHaveLength(0); // The indexed graph must not be mistaken for an empty map.
  expect(fundingAnchor(event, roads)).toEqual({ x: -6778.7, y: 58.03, z: 1754.49 });
  const ferry = snapshot.events.find(value => value.id === 'tech-week:22eb5208-ca3b-4daf-93e1-65b4689f038b')!;
  const anchor = fundingAnchor(ferry)!;
  expect(Math.hypot(anchor.x - 1183.2668846333365, anchor.z + 1200.2860857442251)).toBeLessThan(8);
  expect(fundingAnchor(ferry, roads)).toBeNull();
});

it('retains the strict 200m ring snap limit (RING_SNAP_M), excludes connectors and derives road height', () => {
  const source = { lat: 37.7842, lon: -122.4078 };
  function roads(distance: number, id = 'lane:near') {
    return new LocalRoads({ version: 1, nodes: [], edges: [{ id, from: 'a', to: 'b', lane: 0,
      points: [[distance, 12, -10], [distance, 16, 10]], lengthM: 21, speedMps: 8 }] });
  }
  expect(fundingAnchor(source, roads(199.99))).toEqual({ x: 199.99, y: 14, z: 0 });
  expect(fundingAnchor(source, roads(200))).toBeNull();
  expect(fundingAnchor(source, roads(201))).toBeNull();
  expect(fundingAnchor(source, roads(1, 'connector:near'))).toBeNull();
  expect(fundingAnchor({ lat: null, lon: source.lon }, roads(1))).toBeNull();
  expect(fundingAnchor({ lat: source.lat, lon: NaN }, roads(1))).toBeNull();
});
