import { flags } from '@gtasf/shared/flags';
import { describe, expect, it } from 'vitest';
import { MAX_PIECES_PER_CHUNK, buildBuildingDetail } from './buildingDetail';
import type { ShopfrontContext } from './shopfrontSigns';
import type { ChunkCollision } from './chunks/terrain';

// buildBuildingDetail only reads context.collision; ground/nearestRoad are stubs for the type.
function context(buildings: ChunkCollision['buildings'], origin: [number, number, number] = [1000, 0, 2000]): ShopfrontContext {
  return {
    collision: { version: 1, origin, buildings },
    ground: { size: 2, step: 1, baseCm: 0, x: 0, z: 0, values: new Uint16Array(4) },
    nearestRoad: () => null,
  };
}
const square = (s: number): [number, number][] => [[0, 0], [s, 0], [s, s], [0, s]];
const TALL = { id: 'tall', minY: 0, maxY: 30, rings: [square(20)] };
const SHED = { id: 'shed', minY: 0, maxY: 2.5, rings: [square(3)] };

describe('buildBuildingDetail', () => {
  it('adds rooftop clutter + cornice geometry near the roof, skipping sheds', () => {
    const d = buildBuildingDetail(context([TALL, SHED]), { low: false });
    expect(d.buildings).toBe(1);              // the 2.5 m shed is skipped (height < 4)
    expect(d.ids).toEqual(['tall']);
    expect(d.clutter).toBeGreaterThanOrEqual(1);
    expect(d.positions.length).toBeGreaterThan(0);
    expect(d.positions.length % 9).toBe(0);   // whole triangles (3 verts × 3 floats)
    expect(d.positions.length).toBe(d.normals.length);
    expect(d.positions.length).toBe(d.colors.length);
    // All detail sits at/above the roof and inside the footprint's world bounds.
    const [ox, , oz] = [1000, 0, 2000];
    for (let i = 0; i < d.positions.length; i += 3) {
      const x = d.positions[i]!, y = d.positions[i + 1]!, z = d.positions[i + 2]!;
      expect(y).toBeGreaterThan(TALL.maxY - 1.5);
      expect(y).toBeLessThan(TALL.maxY + 6);
      expect(x).toBeGreaterThan(ox - 2); expect(x).toBeLessThan(ox + 20 + 2);
      expect(z).toBeGreaterThan(oz - 2); expect(z).toBeLessThan(oz + 20 + 2);
    }
  });

  it('varies cornice trim colour across buildings for roofline colour variety', () => {
    const blds = Array.from({ length: 30 }, (_, i) => ({ id: `cv${i}`, minY: 0, maxY: 14, rings: [square(16)] }));
    const d = buildBuildingDetail(context(blds), { low: false });
    // Isolate cornice vertices by their y-band (roofY-0.25 lip, ~13.4..14.1); clutter sits at y>=14.
    const cornice = new Set<string>();
    for (let i = 0; i < d.colors.length; i += 3) {
      const y = d.positions[i + 1]!;
      if (y >= 13.4 && y <= 13.9) cornice.add(`${d.colors[i]!.toFixed(3)},${d.colors[i + 1]!.toFixed(3)},${d.colors[i + 2]!.toFixed(3)}`);
    }
    expect(cornice.size).toBeGreaterThanOrEqual(3); // multiple distinct cornice hues across the 30 buildings
  });

  it('hangs a striped awning on the road-facing wall at ground-floor height', () => {
    const oz = 2000;
    const buildings = Array.from({ length: 6 }, (_, i) => ({ id: `shop${i}`, minY: 0, maxY: 30, rings: [square(18)] }));
    const withRoad = context(buildings);
    // A road just south (-z) of each building's south wall, so one wall per building faces a street.
    withRoad.nearestRoad = (qx: number, qz: number) => (qz < oz ? { x: qx, y: 0, z: oz - 6, yaw: 0 } : null);
    const awned = buildBuildingDetail(withRoad, { low: false });
    const bare = buildBuildingDetail(context(buildings), { low: false }); // nearestRoad => null, no awnings
    expect(awned.positions.length).toBeGreaterThan(bare.positions.length);
    let lowY = Infinity;
    for (let i = 1; i < awned.positions.length; i += 3) lowY = Math.min(lowY, awned.positions[i]!);
    expect(lowY).toBeLessThan(8); // awning sits at the shopfront, well below the 30 m roof clutter
  });

  it('climbs fire escapes up walk-up street walls on desktop only, not towers', () => {
    const oz = 2000;
    const blocks = (maxY: number) => Array.from({ length: 16 }, (_, i) => ({ id: `fe${maxY}-${i}`, minY: 0, maxY, rings: [square(22)] }));
    const ctx = (maxY: number) => { const c = context(blocks(maxY)); c.nearestRoad = (qx: number, qz: number) => (qz < oz ? { x: qx, y: 0, z: oz - 6, yaw: 0 } : null); return c; };
    // Only fire-escape platforms live at mid-facade height: awnings sit at ~3 m, clutter/cornices at the roof.
    const midFacade = (d: ReturnType<typeof buildBuildingDetail>, top: number) => { for (let i = 1; i < d.positions.length; i += 3) { const y = d.positions[i]!; if (y > 12 && y < top) return true; } return false; };
    expect(midFacade(buildBuildingDetail(ctx(28), { low: false }), 25)).toBe(true);  // 28 m walk-up: stacked platforms
    expect(midFacade(buildBuildingDetail(ctx(28), { low: true }), 25)).toBe(false);  // phones skip the heavy facade geometry
    // fireEscapeWalkups: no stack up a 40 m tower (it read as nothing, buried in a glass curtain wall).
    expect(midFacade(buildBuildingDetail(ctx(40), { low: false }), 34)).toBe(!flags.fireEscapeWalkups);
  });

  it('adds SF bay windows on mid-rise street walls, desktop only, not on tall towers', () => {
    const oz = 2000;
    const road = (c: ShopfrontContext) => { c.nearestRoad = (qx: number, qz: number) => (qz < oz ? { x: qx, y: 0, z: oz - 6, yaw: 0 } : null); return c; };
    // Bay glazing (#30414d) is a dark DESATURATED blue — distinct from the bright blue awning stripe
    // (b far higher), grey fire-escape metal and the antenna (both darker/greyer), and light/brown
    // clutter. Thresholds in three's managed (linear) colour space, which the test env uses.
    const hasBayGlass = (d: ReturnType<typeof buildBuildingDetail>) => {
      for (let i = 0; i < d.colors.length; i += 3) {
        const r = d.colors[i]!, g = d.colors[i + 1]!, b = d.colors[i + 2]!;
        if (b > 0.06 && b < 0.14 && b > r * 1.45 && b < g * 2.0) return true;
      }
      return false;
    };
    const mids = Array.from({ length: 16 }, (_, i) => ({ id: `mid${i}`, minY: 0, maxY: 14, rings: [square(18)] }));
    expect(hasBayGlass(buildBuildingDetail(road(context(mids)), { low: false }))).toBe(true);
    expect(hasBayGlass(buildBuildingDetail(road(context(mids)), { low: true }))).toBe(false); // phones skip bays
    expect(hasBayGlass(buildBuildingDetail(context(mids), { low: false }))).toBe(false);       // no road → no street bay
    const towers = Array.from({ length: 16 }, (_, i) => ({ id: `twr${i}`, minY: 0, maxY: 30, rings: [square(22)] }));
    expect(hasBayGlass(buildBuildingDetail(road(context(towers)), { low: false }))).toBe(false); // >24 m excluded
    // Every detail vertex + normal (square + canted bays, cornices, clutter) is finite and every normal
    // is non-degenerate — guards the canted-bay side-panel trig against a NaN/zero (sign or divide-by-
    // zero) error that a browser would otherwise be the first to catch.
    const d = buildBuildingDetail(road(context(mids)), { low: false });
    for (let i = 0; i < d.positions.length; i++) expect(Number.isFinite(d.positions[i]!)).toBe(true);
    for (let i = 0; i < d.normals.length; i += 3) {
      const nx = d.normals[i]!, ny = d.normals[i + 1]!, nz = d.normals[i + 2]!;
      expect(Number.isFinite(nx) && Number.isFinite(ny) && Number.isFinite(nz)).toBe(true);
      expect(Math.hypot(nx, ny, nz)).toBeGreaterThan(0.5);
    }
  });

  it('caps Meshy hero pieces per chunk; over budget, cornices and bays fall back to procedural geometry (gtasf-oeua)', () => {
    const oz = 2000;
    const road = (c: ShopfrontContext) => { c.nearestRoad = (qx: number, qz: number) => (qz < oz ? { x: qx, y: 0, z: oz - 6, yaw: 0 } : null); return c; };
    const mids = Array.from({ length: 16 }, (_, i) => ({ id: `mid${i}`, minY: 0, maxY: 14, rings: [square(18)] }));
    const unbounded = buildBuildingDetail(road(context(mids)), { low: false, meshyPieces: true, maxPieces: Infinity });
    const capped = buildBuildingDetail(road(context(mids)), { low: false, meshyPieces: true, maxPieces: 30 });
    expect(unbounded.pieces.length).toBeGreaterThan(30);
    expect(capped.pieces.length).toBeLessThanOrEqual(30);
    expect(capped.positions.length).toBeGreaterThan(unbounded.positions.length); // box lips / bays stand in
    expect(buildBuildingDetail(road(context(mids)), { low: false, meshyPieces: true }).pieces.length).toBeLessThanOrEqual(MAX_PIECES_PER_CHUNK);
  });
  it('records Meshy hero-piece placements (not procedural box geometry) when meshyPieces is set', () => {
    const oz = 2000;
    const road = (c: ShopfrontContext) => { c.nearestRoad = (qx: number, qz: number) => (qz < oz ? { x: qx, y: 0, z: oz - 6, yaw: 0 } : null); return c; };
    const hasBayGlass = (d: ReturnType<typeof buildBuildingDetail>) => {
      for (let i = 0; i < d.colors.length; i += 3) { const r = d.colors[i]!, g = d.colors[i + 1]!, b = d.colors[i + 2]!; if (b > 0.06 && b < 0.14 && b > r * 1.45 && b < g * 2.0) return true; } return false;
    };
    const mids = Array.from({ length: 16 }, (_, i) => ({ id: `mid${i}`, minY: 0, maxY: 14, rings: [square(18)] }));
    const d = buildBuildingDetail(road(context(mids)), { low: false, meshyPieces: true, maxPieces: Infinity });
    const byKind = (k: string) => d.pieces.filter(p => p.kind === k).length;
    const VALID = new Set(['bay-window', 'awning', 'balcony', 'cornice', 'fire-escape']);
    expect(byKind('bay-window')).toBeGreaterThan(0);          // bay placements recorded for the Meshy loader
    expect(byKind('awning')).toBeGreaterThan(0);              // awning placements recorded too
    expect(byKind('balcony')).toBeGreaterThan(0);             // non-bay mid-rise blocks get a Juliet balcony
    expect(byKind('cornice')).toBeGreaterThan(0);             // cornice tiled along roof edges
    expect(d.pieces.every(p => VALID.has(p.kind))).toBe(true);
    expect(hasBayGlass(d)).toBe(false);                       // procedural bay glass suppressed (Meshy replaces it)
    for (const p of d.pieces) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) && Number.isFinite(p.yaw)).toBe(true);
      expect(p.width).toBeGreaterThan(0);
    }
    // Without meshyPieces, pieces are procedural box geometry and no placements are recorded.
    const proc = buildBuildingDetail(road(context(mids)), { low: false });
    expect(proc.pieces.length).toBe(0);
    expect(hasBayGlass(proc)).toBe(true);
  });

  it('caps clutter harder on the low (phone) tier', () => {
    const big = { id: 'big', minY: 0, maxY: 40, rings: [square(60)] };
    const high = buildBuildingDetail(context([big]), { low: false }).clutter;
    const low = buildBuildingDetail(context([big]), { low: true }).clutter;
    expect(low).toBeLessThanOrEqual(2);
    expect(high).toBeGreaterThanOrEqual(low);
  });

  it('respects the shared seen-set so footprints shared across chunks are not doubled', () => {
    const already = new Set<string>(['tall']);
    const d = buildBuildingDetail(context([TALL]), {}, already);
    expect(d.buildings).toBe(0);
    expect(d.positions.length).toBe(0);
  });

  it('honours the per-chunk vertex budget', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ id: `b${i}`, minY: 0, maxY: 25, rings: [square(24)] }));
    const d = buildBuildingDetail(context(many), { low: false, vertexBudget: 3000 });
    expect(d.positions.length / 3).toBeLessThanOrEqual(3000 + 400); // stops once the budget is crossed
    expect(d.buildings).toBeLessThan(50);
  });
});
