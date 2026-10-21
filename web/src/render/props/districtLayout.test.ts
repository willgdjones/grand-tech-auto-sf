import { expect, it, vi } from 'vitest';
import type { RoadGraph } from '@gtasf/shared/roadgraph';
import { DISTRICTS_WEST } from '../../../../tools/map/src/districts/west';
import { SF_FRAME } from '../../../../tools/map/src/config';
import { geodeticToWorld } from '../../../../tools/map/src/geo';
import { createStreetPropLayout, streetPropDensity, streetTreeKind } from './layout';
// These tests cover procedural street trees; real DataSF trees (flags.realStreetTrees) replace them in the game.
vi.mock('@gtasf/shared/flags', async original => ({ flags: { ...(await original<typeof import('@gtasf/shared/flags')>()).flags, realStreetTrees: false } }));

it('dresses western source frontages with the owning district canopy and keeps lanes clear', async () => {
  for (const district of DISTRICTS_WEST) {
    const [x, z] = geodeticToWorld(district.spawn.lat, district.spawn.lon, SF_FRAME);
    const street = district.streets[0]!;
    expect(streetPropDensity(x, z, street), district.id).toBe('route');
    expect(streetPropDensity(x, z, 'Unselected residential street'), district.id).toBe('city');
    for (let choice = 0; choice < 12; choice++) {
      expect(district.trees).toContain(streetTreeKind(street, choice, x, z));
    }
    // A short sourced frontage fixture centred at each verified district arrival.
    const graph: RoadGraph = { version: 1,
      nodes: [{ id: 'a', x: x - 100, y: 20, z }, { id: 'b', x: x + 100, y: 20, z }],
      edges: [{ id: 'road', from: 'a', to: 'b', lengthM: 200, speedMps: 10, lane: 0,
        points: [[x - 100, 20, z], [x + 100, 20, z]], name: street } as RoadGraph['edges'][number]],
    };
    const layout = await createStreetPropLayout(graph, { yieldToMain: async () => {} });
    const sites = [...layout.cells.values()].flatMap(cell => cell.sites);
    const trees = sites.filter(site => ['plane', 'cypress', 'palm'].includes(site.kind));
    expect(trees.length, district.id).toBeGreaterThan(0);
    for (const site of trees) {
      expect(district.trees, district.id).toContain(site.kind);
      expect(Math.abs(site.z - z)).toBeGreaterThanOrEqual(3.5);
    }
    if (district.id === 'ocean-beach') expect(new Set(trees.map(site => site.kind))).toEqual(new Set(['cypress']));
  }
});
