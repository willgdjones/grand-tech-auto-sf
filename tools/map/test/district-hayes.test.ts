import { expect, it } from 'vitest';
import { DISTRICTS, districtAt } from '../src/districts';
import { districtRoadPartOwners } from '../src/districts/roadDetailCells';
import { districtGroundSampler, districtStreetDetail } from '../src/pipeline/districts';
import { project, unproject } from '../src/pipeline/settings';
import type { Building, Road } from '../src/pipeline/types';

it('gives Hayes its own street fronts and paving without repainting parks or neighbouring districts', () => {
  const hayes = DISTRICTS.find(district => district.id === 'hayes-valley')!;
  const [x, z] = project(hayes.spawn.lon, hayes.spawn.lat);
  expect(districtAt(x, z)?.id).toBe('hayes-valley');
  // Preserve the source arrivals of every earlier district despite overlapping
  // art regions; Hayes takes priority only inside its compact frontage area.
  for (const district of DISTRICTS) {
    expect(districtAt(...project(district.spawn.lon, district.spawn.lat))?.id, district.id).toBe(district.id);
  }
  const road: Road = { id: 'hayes', osmWay: 1, width: 8,
    tags: { highway: 'residential', name: 'Hayes Street' },
    points: [{ id: 'a', x: x - 40, z }, { id: 'b', x: x + 40, z }] };
  const shop: Building = { id: 'shop', polygon: [[[x-5,z+10],[x+5,z+10],[x+5,z+20],[x-5,z+20]]],
    base: 20, foundation: 19.7, height: 12, heightSource: 'osm-height', colour: [.75,.66,.49], landuse: 'retail' };
  const frontage = districtStreetDetail([road]);
  expect(frontage.keepBuilding(shop)).toBe(true);
  expect(frontage.keepPavement({ polygon: shop.polygon, roadIds: ['hayes'] })).toBe(true);
  expect(frontage.keepBuilding({ ...shop, polygon: shop.polygon.map(r => r.map(([px,pz]) => [px,pz+100])) })).toBe(false);
  expect(districtStreetDetail([{ ...road, tags: { ...road.tags, bridge: 'yes' } }]).keepBuilding(shop)).toBe(false);
  expect(districtRoadPartOwners({ name: 'Hayes Street', highway: 'residential' }, {
    key: `${Math.floor(x/256)}_${Math.floor(z/256)}`, from: 0, to: 40,
    points: [[x-20,20,z],[x+20,20,z]],
  })).toEqual(['hayes-valley']);

  const geometry = [[x-5,z-5],[x+5,z-5],[x+5,z+5],[x-5,z+5],[x-5,z-5]]
    .map(([px,pz]) => unproject(px!, pz!));
  const ground = districtGroundSampler({ elements: [{ type: 'way', id: 2,
    nodes: [1,2,3,4,1], geometry, tags: { leisure: 'park' } }] }, []);
  expect(ground(x, z, false)).toEqual(hayes.ground.park);
  expect(ground(x+15, z, false)).toEqual(hayes.ground.urban);
  // Actual normalized-u8 colour ratios consumed by both facade paths: painted
  // residential homes must not be mistaken for glass offices or retail bands.
  for (const colour of hayes.buildings.residential!) for (const shade of [.88, 1, 1.12]) {
    const [r,g,b] = colour.map(c => Math.round(c*shade*255)/255) as [number,number,number];
    expect(b > r*1.03 || (r > g*1.10 && r < g*1.17 && g > b*1.18)).toBe(false);
  }
});
