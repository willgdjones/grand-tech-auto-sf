import { expect, it } from 'vitest';
import { DISTRICTS_SOUTH } from '../src/districts/south';
import { districtAt } from '../src/districts';
import { buildBuildings } from '../src/pipeline/buildings';
import { districtGroundSampler, districtStreetDetail } from '../src/pipeline/districts';
import { addBuildings, addRoadMeshes, ChunkMeshes } from '../src/pipeline/meshes';
import { preparePavements } from '../src/pipeline/pavement';
import { project, settings, unproject } from '../src/pipeline/settings';
import type { OsmElement, Road, Tags } from '../src/pipeline/types';

it('bakes coloured southern streets with small mixed-use buildings and mapped pavement', () => {
  expect(DISTRICTS_SOUTH.map(d => d.id)).toEqual([
    'bernal-heights', 'potrero-hill', 'bayview', 'excelsior', 'glen-park', 'noe-valley', 'castro',
  ]);
  for (const district of DISTRICTS_SOUTH) {
    const [x, z] = project(district.spawn.lon, district.spawn.lat);
    expect(districtAt(x, z)?.id, district.name).toBe(district.id);
    const area = settings('southern-smoke', district.bbox);
    const ring = (id: number, dx: number, dz: number, width: number, depth: number, tags: Tags): OsmElement => {
      const coordinates = [[x + dx, z + dz], [x + dx + width, z + dz],
        [x + dx + width, z + dz + depth], [x + dx, z + dz + depth], [x + dx, z + dz]];
      return { type: 'way', id, tags, nodes: [id * 10, id * 10 + 1, id * 10 + 2, id * 10 + 3, id * 10],
        geometry: coordinates.map(([px, pz]) => {
          const { lat, lon } = unproject(px!, pz!); return { lat, lon };
        }) };
    };
    // A residential land-use polygon must not turn a sourced shop or warehouse into a house.
    // Small street-front footprints are intentional: these were lost by the old 400 m² filter.
    const road: Road = { id: 'arrival', osmWay: 1, width: 6.4,
      tags: { highway: 'residential', name: district.streets[0]! },
      points: [{ id: 'a', x: x - 80, z }, { id: 'b', x: x + 80, z }] };
    const buildings = buildBuildings([], { elements: [
      ring(90, -90, -40, 180, 100, { landuse: 'residential' }),
      ring(1, -36, 9, 8, 12, { building: 'house', height: '8' }),
      ring(2, -12, 9, 8, 12, { building: 'retail', height: '10' }),
      ring(3, 12, 9, 8, 12, { building: 'warehouse', height: '12' }),
    ] }, { sample: () => 25 }, area, [], [road]);
    expect(buildings.map(b => [b.landuse, b.height, b.heightSource]), district.name).toEqual([
      ['residential', 8, 'osm-height'], ['retail', 10, 'osm-height'], ['industrial', 12, 'osm-height'],
    ]);
    const [house, shop, warehouse] = buildings;
    expect(house!.colour, district.name).not.toEqual(shop!.colour);
    expect(warehouse!.colour, district.name).not.toEqual(shop!.colour);
    for (const building of buildings) {
      expect(building.colour.every(c => Number.isFinite(c) && c >= 0 && c <= 1)).toBe(true);
    }
    const detail = districtStreetDetail([road]);
    const retained = new Set(buildings.filter(b => detail.keepBuilding(b)).map(b => b.id));
    expect(retained.size, district.name).toBe(3);
    expect(districtStreetDetail([{ ...road, tags: { ...road.tags, name: 'Fixture side street' } }])
      .keepBuilding(house!)).toBe(false);
    const meshes = new ChunkMeshes([Math.floor((x - 100) / 256) * 256, Math.floor((z - 100) / 256) * 256,
      Math.ceil((x + 100) / 256) * 256, Math.ceil((z + 100) / 256) * 256]);
    addBuildings(meshes, buildings, 1, true, retained);
    expect([...meshes.chunks.values()].reduce((sum, c) => sum + c.buildings.indices.length, 0)).toBeGreaterThan(0);
    const footway = (id: string, points: [number, number][], kind: 'sidewalk' | 'crossing'): Road => ({
      id, osmWay: 2, width: 2, tags: { highway: 'footway', footway: kind },
      points: points.map(([px, pz]) => ({ id: `${px},${pz}`, x: px, z: pz })),
    });
    const roads = [road,
      footway('north', [[x - 80, z - 6], [x + 80, z - 6]], 'sidewalk'),
      footway('east', [[x + 80, z - 6], [x + 80, z + 6]], 'crossing'),
      footway('south', [[x + 80, z + 6], [x - 80, z + 6]], 'sidewalk'),
      footway('west', [[x - 80, z + 6], [x - 80, z - 6]], 'crossing'),
    ];
    const pavements = preparePavements(roads, buildings.map(b => b.polygon)).filter(p => detail.keepPavement(p));
    expect(pavements.length, district.name).toBeGreaterThan(0);
    addRoadMeshes(meshes, roads, { sample: () => 25 }, 1, pavements, true);
    // Concrete footway tops remain distinct from the asphalt carriageway/underlay.
    expect([...meshes.chunks.values()].some(c => c.roads.colours.some((r, i) =>
      i % 3 === 0 && r === 130 && c.roads.colours[i + 1] === 125 && c.roads.colours[i + 2] === 112)), district.name)
      .toBe(true);
    // Keep the park fixture west of the arrival: Potrero's east side meets Dogpatch.
    const ground = districtGroundSampler({ elements: [ring(91, -70, -50, 40, 30, { leisure: 'park' })] }, []);
    expect(ground(x, z, false), district.name).toEqual(district.ground.urban);
    expect(ground(x - 50, z - 35, false), district.name).toEqual(district.ground.park);
  }
}, 30_000);
