import { expect, it } from 'vitest';
import { DISTRICTS, districtAt } from '../src/districts';
import { districtRoadPartOwners } from '../src/districts/roadDetailCells';
import { districtGroundSampler, districtStreetDetail } from '../src/pipeline/districts';
import { project, unproject } from '../src/pipeline/settings';
import type { Building, Road } from '../src/pipeline/types';

it('gives Haight sourced street fronts and a distinct arrival while preserving parks and neighbouring arrivals', () => {
  const haight = DISTRICTS.find(district => district.id === 'haight-ashbury')!;
  const [x, z] = project(haight.spawn.lon, haight.spawn.lat);
  expect(districtAt(x, z)?.id).toBe('haight-ashbury');
  for (const district of DISTRICTS) {
    expect(districtAt(...project(district.spawn.lon, district.spawn.lat))?.id, district.id).toBe(district.id);
  }
  // Source Haight Street segment around the arrival, not a fabricated road.
  const [ax, az] = project(-122.4461721, 37.7701142);
  const [bx, bz] = project(-122.4468519, 37.7700282);
  const road: Road = { id: 'haight', osmWay: 417979722, width: 8,
    tags: { highway: 'tertiary', name: 'Haight Street' },
    points: [{ id: 'a', x: ax, z: az }, { id: 'b', x: bx, z: bz }] };
  const house: Building = { id: 'house', polygon: [[[x-5,z+10],[x+5,z+10],[x+5,z+20],[x-5,z+20]]],
    base: 60, foundation: 59.7, height: 10, heightSource: 'osm-height', colour: [.79,.73,.64], landuse: 'residential' };
  const frontage = districtStreetDetail([road]);
  expect(frontage.keepBuilding(house)).toBe(true);
  expect(frontage.keepPavement({ polygon: house.polygon, roadIds: ['haight'] })).toBe(true);
  expect(frontage.keepBuilding({ ...house, polygon: house.polygon.map(r => r.map(([px,pz]) => [px,pz+100])) })).toBe(false);
  expect(districtStreetDetail([{ ...road, tags: { ...road.tags, name: 'Unnamed Lane' } }]).keepBuilding(house)).toBe(false);
  expect(districtStreetDetail([{ ...road, tags: { ...road.tags, bridge: 'yes' } }]).keepBuilding(house)).toBe(false);
  expect(districtRoadPartOwners({ name: 'Haight Street', highway: 'tertiary' }, {
    key: `${Math.floor(x/256)}_${Math.floor(z/256)}`, from: 0, to: 60,
    points: [[ax,60,az],[bx,60,bz]],
  })).toEqual(['haight-ashbury']);

  const geometry = [[x-5,z-5],[x+5,z-5],[x+5,z+5],[x-5,z+5],[x-5,z-5]]
    .map(([px,pz]) => unproject(px!, pz!));
  const ground = districtGroundSampler({ elements: [{ type: 'way', id: 2,
    nodes: [1,2,3,4,1], geometry, tags: { leisure: 'park' } }] }, []);
  expect(ground(x, z, false)).toEqual(haight.ground.park);
  expect(ground(x+15, z, false)).toEqual(haight.ground.urban);
  // Quantized linear RGB is what both facade paths classify in the game.
  for (const colour of haight.buildings.residential!) for (const shade of [.88, 1, 1.12]) {
    const [r,g,b] = colour.map(c => Math.round(c*shade*255)/255) as [number,number,number];
    expect(b > r*1.03 || (r > g*1.10 && r < g*1.17 && g > b*1.18)).toBe(false);
  }
});
