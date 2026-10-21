import { expect, it, vi } from 'vitest';
import type { RoadGraph } from '@gtasf/shared/roadgraph';
import { flags } from '@gtasf/shared/flags';
import { createRoadSampler } from '../chunks/terrain';
import { createStreetPropLayout, streetPropDensity, streetTreeKind } from './layout';
// These tests cover procedural street trees; real DataSF trees (flags.realStreetTrees) replace them in the game.
vi.mock('@gtasf/shared/flags', async original => ({ flags: { ...(await original<typeof import('@gtasf/shared/flags')>()).flags, realStreetTrees: false } }));

it('plants palms only on the waterfront/boulevard streets, plane+cypress inland (SF read)', () => {
  const kinds = (street: string) => Array.from({ length: 12 }, (_, c) => streetTreeKind(street, c));
  // The Embarcadero keeps its waterfront palms...
  expect(kinds('The Embarcadero')).toContain('palm');
  expect(kinds('Dolores Street')).toContain('palm');
  // ...but inland FiDi/SoMa/North Beach get only London plane + cypress, never palms.
  for (const street of ['Montgomery Street', 'Howard Street', 'Columbus Avenue', 'Lombard Street']) {
    const trees = kinds(street);
    expect(trees).not.toContain('palm');
    expect(trees.every(k => k === 'plane' || k === 'cypress')).toBe(true);
  }
});

it('dresses the Financial District and SoMa cores at route density on every street (deploy #6)', () => {
  // SF_FRAME world metres (-z north): FiDi core, the Salesforce Tower, SoMa core and Union Square
  // are dense regardless of street name; outlying streets stay sparse.
  expect(streetPropDensity(634, -1154, 'Montgomery Street')).toBe('route'); // FiDi core
  expect(streetPropDensity(934, -611, 'Mission Street')).toBe('route');     // Salesforce Tower
  expect(streetPropDensity(775, 633, 'Howard Street')).toBe('route');       // SoMa core
  expect(streetPropDensity(26, -422, 'Powell Street')).toBe('route');       // Union Square
  // The Ferry -> Lombard corridor stays arterial-gated: a non-arterial outside the new boxes is sparse.
  expect(streetPropDensity(-800, -2000, 'Leavenworth Street')).toBe('city');
  // A far residential street (outer Sunset) is sparse.
  expect(streetPropDensity(-5000, 1000, 'Judah Street')).toBe('city');
});

it('places realistic furniture (lamps, mailboxes, bike racks, extra trees) off the carriageway when streetDetail is on', async () => {
  const graph: RoadGraph = { version: 1, nodes: [{ id: 'a', x: 0, y: 0, z: -1900 }, { id: 'b', x: 0, y: 0, z: -1100 }],
    edges: [{ id: 'road', from: 'a', to: 'b', lengthM: 800, speedMps: 10, lane: 0, points: [[0, 0, -1900], [0, 0, -1100]], name: 'Columbus Avenue' } as RoadGraph['edges'][number]] };
  const layout = await createStreetPropLayout(graph, { yieldToMain: async () => {} });
  const sites = [...layout.cells.values()].flatMap(c => c.sites), count = (k: string) => sites.filter(s => s.kind === k).length;
  expect(flags.streetDetail).toBe(true);
  expect(count('streetLamp')).toBeGreaterThanOrEqual(count('pole') / 2);
  expect(count('mailbox')).toBeGreaterThan(0);
  expect(count('bikeRack')).toBeGreaterThan(0);
  expect(count('plane') + count('cypress') + count('palm')).toBeGreaterThan(count('pole'));
  // Every new piece keeps the 3.5m lane clearance used by the existing furniture.
  for (const s of sites.filter(s => ['streetLamp', 'mailbox', 'bikeRack'].includes(s.kind))) expect(Math.abs(s.x)).toBeGreaterThanOrEqual(3.5);
});

it('keeps shifted hillside furniture clear of ground junctions while allowing furniture beneath a bridge', async () => {
  const graph: RoadGraph = { version: 1,
    nodes: [
      { id: 'a', x: 0, y: 0, z: -1900 }, { id: 'b', x: 0, y: 200, z: -1100 },
      { id: 'c', x: -30, y: 9, z: -1864 }, { id: 'd', x: 30, y: 9, z: -1864 },
      { id: 'e', x: -30, y: 23.5, z: -1886 }, { id: 'f', x: 30, y: 23.5, z: -1886 },
    ],
    edges: [
      { id: 'hill', from: 'a', to: 'b', lengthM: 800, speedMps: 10, lane: 0,
        points: [[0, 0, -1900], [0, 200, -1100]], name: 'Columbus Avenue' },
      { id: 'crossing', from: 'c', to: 'd', lengthM: 60, speedMps: 10, lane: 0,
        points: [[-30, 9, -1864], [30, 9, -1864]] },
      { id: 'bridge', from: 'e', to: 'f', lengthM: 60, speedMps: 10, lane: 0,
        points: [[-30, 23.5, -1886], [30, 23.5, -1886]], bridge: true, layer: 1 },
    ] as RoadGraph['edges'],
  };
  const roadAt = createRoadSampler(graph);
  // A lamp 22m uphill from the pole would inherit y=3.5 even though its crossing
  // road is at y=9. The renderer permits that 5.5m resampling difference.
  expect(roadAt(5.2, -1864, 3.5)).toBeNull();
  expect(roadAt(5.2, -1864)).toBe(9);
  const layout = await createStreetPropLayout(graph, { roadHeightAt: roadAt, yieldToMain: async () => {} });
  const sites = [...layout.cells.values()].flatMap(cell => cell.sites);
  expect(sites.some(site => site.kind === 'streetLamp')).toBe(true);
  for (const site of sites) expect(roadAt(site.x, site.z), `${site.kind} at ${site.x},${site.z}`).toBeNull();
  const beneathBridge = sites.filter(site => site.kind === 'pole' && Math.abs(site.z + 1886) < .01);
  expect(beneathBridge).toHaveLength(2);
  for (const site of beneathBridge) expect(site.y).toBeCloseTo(3.5, 8);
});
