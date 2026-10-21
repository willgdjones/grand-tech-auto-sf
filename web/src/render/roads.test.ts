import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { Box3, Mesh, Vector3 } from 'three';
import { createLazyRoadIndex, createRoadDetails, indexLayout, manholeTexture, ROAD_PBR, type RoadDetailLayout } from './roads';

const street = (over: Partial<RoadDetailLayout['roads'][number]> = {}): RoadDetailLayout['roads'][number] => ({
  id: 'w:0', name: 'Test Street', highway: 'residential', width: 10, forward: 1, backward: 1, shared: false, oneway: 0,
  surface: 'asphalt', points: [[0, 0, 0], [60, 0, 0], [120, 0, 0]], markingRanges: [[8, 112]], ...over,
});
const kinds = (layout: RoadDetailLayout, detail: boolean, low = false) => {
  const counts = new Map<string, number>();
  for (const cell of indexLayout(layout, { detail, low }).cells.values())
    for (const r of cell) counts.set(r.kind, (counts.get(r.kind) ?? 0) + 1);
  return counts;
};
const layout = (roads = [street()]): RoadDetailLayout => ({ version: 1, roads, tracks: [], crossings: [] });

describe('street detail road index', () => {
  it('adds nothing when the streetDetail extras are off', () => {
    const k = kinds(layout(), false);
    for (const kind of ['stopline', 'gutter', 'kerbRed', 'manhole']) expect(k.has(kind)).toBe(false);
    expect(k.get('slab')).toBeGreaterThan(0);
  });
  it('places stop lines on the inbound half at both junction ends of a two-way street', () => {
    const cells = [...indexLayout(layout(), { detail: true, low: false }).cells.values()].flat();
    const stops = cells.filter(r => r.kind === 'stopline');
    expect(stops.length).toBe(2);
    // Forward traffic (right-hand, +offset) stops near the far end; reverse traffic near the start.
    const far = stops.find(r => r.a[0] > 100)!, near = stops.find(r => r.a[0] < 20)!;
    expect(far.offset).toBeCloseTo(2.5); expect(near.offset).toBeCloseTo(-2.5);
    expect(far.width).toBeCloseTo(4.5);
  });
  it('one-way streets get a single full-width stop line at the downstream end', () => {
    const stops = [...indexLayout(layout([street({ forward: 2, backward: 0, oneway: 1 })]), { detail: true, low: false }).cells.values()].flat().filter(r => r.kind === 'stopline');
    expect(stops.length).toBe(1); expect(stops[0]!.offset).toBe(0); expect(stops[0]!.width).toBeCloseTo(9.5);
  });
  it('paints red kerbs at junction mouths on both sides with a carriageway face', () => {
    const red = [...indexLayout(layout(), { detail: true, low: false }).cells.values()].flat().filter(r => r.kind === 'kerbRed');
    expect(red.some(r => r.offset > 5 && r.a[0] < 16)).toBe(true);
    expect(red.some(r => r.offset < -5 && r.b[0] > 104)).toBe(true);
    expect(red.every(r => r.face! > 0.1 && Math.abs(r.offset) > 5)).toBe(true);
  });
  it('places lane-centre manholes with local UVs, sparser on low', () => {
    const long = layout([street({ points: [[0, 0, 0], [400, 0, 0]], markingRanges: [[8, 392]] })]);
    const hd = kinds(long, true).get('manhole')!, low = kinds(long, true, true).get('manhole')!;
    expect(hd).toBeGreaterThan(low); expect(low).toBeGreaterThan(0);
    const m = [...indexLayout(long, { detail: true, low: false }).cells.values()].flat().find(r => r.kind === 'manhole')!;
    expect(m.local).toBe(true); expect(Math.abs(m.offset)).toBeLessThan(5);
  });
  it('generates an alpha-cut manhole texture', () => {
    const t = manholeTexture(16), data = t.image.data as Uint8Array;
    expect(data[3]).toBe(0); expect(data[(8 * 16 + 8) * 4 + 3]).toBe(255);
  });
});

describe('generated junction crosswalks', () => {
  const twoBlocks = () => layout([street({ points: [[0, 0, 0], [200, 0, 0]], markingRanges: [[8, 92], [108, 192]] })]);
  it('lays a continental crosswalk across the road in each junction gap, stripes tiled laterally', () => {
    const walks = [...indexLayout(twoBlocks(), { detail: true, low: false }).cells.values()].flat().filter(r => r.kind === 'crossing');
    // Gaps: before 8, after 92, after 192 (the 108 start gap is the one after 92).
    expect(walks.length).toBe(3);
    expect(walks.every(w => w.across === 1.2 && w.offset === 0 && w.width > 9)).toBe(true);
  });
  it('never duplicates a mapped source crossing', () => {
    const value = twoBlocks();
    value.crossings.push({ id: 'c', points: [[94, 0, -5], [94, 0, 5]], width: 3, markings: 'zebra' });
    const walks = [...indexLayout(value, { detail: true, low: false }).cells.values()].flat().filter(r => r.kind === 'crossing' && r.across);
    expect(walks.length).toBe(2);
  });
});

describe('realistic road materials', () => {
  it('gives every road-detail kind a PBR response, metal only for iron and rail', () => {
    for (const [kind, v] of Object.entries(ROAD_PBR)) {
      expect(v.roughness).toBeGreaterThan(0.2); expect(v.roughness).toBeLessThanOrEqual(1);
      expect(v.metalness > 0.5).toBe(kind === 'steel' || kind === 'manhole');
    }
  });
});

it('accepts the expanded district index without fetching distant cells or relaxing byte caps', async () => {
  vi.stubGlobal('createImageBitmap', async () => ({ width: 256, height: 256, close() {} }));
  try {
    for (const [count, padding, accepted] of [[823, 0, true], [1025, 0, false], [823, 150_000, false]] as const) {
      const manifest = JSON.stringify({ version: 1, cellSize: 256, cells: Array.from({ length: count }, (_, x) => ({
        key: `${x}_0`, path: `/art/district-roads/${x}_0.json`, bytes: 100, sha256: 'a'.repeat(64),
      })) }) + ' '.repeat(padding);
      const fetcher = vi.fn(async (path: string) => {
        if (path === '/art/road-details.json') return Response.json({ ...layout([]), districts: { path: '/art/district-roads/manifest.json' } });
        if (path === '/art/district-roads/manifest.json') return new Response(manifest);
        if (path.startsWith('/art/ground/')) return new Response(new ArrayBuffer(0));
        throw new Error(`Unexpected distant cell request: ${path}`);
      });
      vi.stubGlobal('fetch', fetcher);
      const details = (await createRoadDetails({ position: { x: -10_000, z: -10_000 }, heightAt: () => 0,
        enabled: true, detail: false, realistic: false }))!;
      try {
        expect(details.stats.districtKnownCells).toBe(accepted ? count : 0);
        expect(details.stats.districtErrors).toBe(accepted ? 0 : 1);
        expect(details.stats.districtRequests).toBe(0);
        expect(details.stats.districtCachedCells).toBe(0);
      } finally { details.dispose(); }
    }
  } finally { vi.unstubAllGlobals(); }
});

it('spreads Low road construction over smaller batches with the same geometry and conservative hill/kerb bounds', async () => {
  const source = layout([street({ width: 35, points: [[-4, 300, 0], [252, 410, 0]], markingRanges: [[8, 248]] })]);
  vi.stubGlobal('createImageBitmap', async () => ({ width: 256, height: 256, close() {} }));
  vi.stubGlobal('fetch', async (path: string) => path === '/art/road-details.json'
    ? Response.json(source) : new Response(new ArrayBuffer(0)));
  // Fixed clock exercises the hard work cap; this is not frame-rate evidence.
  const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
  const complete: unknown[] = [];
  try {
    for (const low of [false, true]) {
      const heightAt = vi.fn((x: number, z: number) => 300.1234567 + x * .4 + z * .03);
      const details = (await createRoadDetails({ position: { x: 100, z: 1 }, heightAt,
        enabled: true, detail: false, realistic: false, low }))!;
      try {
        expect(heightAt.mock.calls.length).toBe((low ? 48 : 120) * 4);
        for (let calls = 0; details.stats.loadedCells < details.stats.targetCells && calls < 100; calls++) details.update({ x: 100, z: 1 });
        expect(details.stats.loadedCells).toBe(details.stats.targetCells);
        const geometry: { name: string; positions: number[]; normals: number[]; uv: number[] }[] = [];
        details.root.traverse(object => {
          if (!(object instanceof Mesh)) return;
          const shape = object.geometry, positions = shape.getAttribute('position');
          const exactBounds = new Box3(), point = new Vector3();
          for (let index = 0; index < positions.count; index++) {
            point.fromBufferAttribute(positions, index); exactBounds.expandByPoint(point);
            expect(point.distanceTo(shape.boundingSphere!.center)).toBeLessThanOrEqual(shape.boundingSphere!.radius + 1e-7);
          }
          expect(shape.boundingBox!.equals(exactBounds)).toBe(true);
          geometry.push({ name: object.name, positions: Array.from(positions.array),
            normals: Array.from(shape.getAttribute('normal').array), uv: Array.from(shape.getAttribute('uv').array) });
        });
        expect(geometry.some(value => value.name.startsWith('slab'))).toBe(true);
        expect(geometry.length).toBeGreaterThan(1);
        complete.push(geometry);
        const sampled = heightAt.mock.calls.length;
        details.update({ x: 100, z: 1 });
        expect(heightAt).toHaveBeenCalledTimes(sampled); // Completed cells do no geometry work.
      } finally { details.dispose(); }
    }
    expect(complete[1]).toEqual(complete[0]);
  } finally { clock.mockRestore(); vi.unstubAllGlobals(); }
});

describe('lazy road-detail index (gtasf-trqe)', () => {
  it('builds each cell on demand with exactly the eager index ribbons, on the real SF layout', () => {
    const data = JSON.parse(readFileSync(new URL('../../public/art/road-details.json', import.meta.url), 'utf8')) as RoadDetailLayout;
    const extras = { detail: true, low: true, polish: true };
    const full = indexLayout(data, extras), lazy = createLazyRoadIndex(data, extras);
    const keys = [...full.cells.keys()].slice(0, 12);
    expect(lazy.isBuilt(keys[0]!)).toBe(false); // nothing indexed up front
    for (const key of keys) expect(lazy.get(key)).toEqual(full.cells.get(key));
    expect(lazy.has('999_999')).toBe(false);
    expect(lazy.mayHave(keys[0]!)).toBe(true);
  });
});
