import { describe, expect, it } from 'vitest';
import {
  BORDER_SUBSCRIBE_M, SF_ZONE_GRID, ZONE_ID_STRIDE, allZoneIds, borderObservers, cellBounds, cellIndex,
  cellOf, crossedCell, cellFromIndex, handoffDestination, globalPlayerId, inGrid, neighbours, parseZoneId, splitPlayerId, zoneCount, zoneId, zoneView, type ZoneGrid,
} from './zones';

// Synthetic 3×3 grid of 1 km cells so the math asserts against round numbers,
// independent of the (re-pinnable) SF grid.
const g: ZoneGrid = { minX: 0, minZ: 0, cols: 3, rows: 3, cell: 1000 };

describe('zone grid cell math', () => {
  it('maps positions to cells and clamps out-of-grid positions to the nearest border', () => {
    expect(cellOf(g, 1500, 1500)).toEqual({ cx: 1, cy: 1 });
    expect(cellOf(g, 0, 0)).toEqual({ cx: 0, cy: 0 });
    expect(cellOf(g, 2999, 2999)).toEqual({ cx: 2, cy: 2 });
    expect(cellOf(g, -9999, -9999)).toEqual({ cx: 0, cy: 0 });
    expect(cellOf(g, 9999, 9999)).toEqual({ cx: 2, cy: 2 });
  });

  it('round-trips zone ids and rejects malformed or out-of-range ids', () => {
    expect(zoneId(1, 2)).toBe('z:1:2');
    expect(parseZoneId(g, 'z:1:2')).toEqual({ cx: 1, cy: 2 });
    expect(parseZoneId(g, 'z:9:9')).toBeNull();
    expect(parseZoneId(g, 'z:1')).toBeNull();
    expect(parseZoneId(g, 'sf')).toBeNull();
    expect(parseZoneId(g, 'z:-1:0')).toBeNull();
  });

  it('tiles the grid with contiguous, non-overlapping cells', () => {
    expect(cellBounds(g, 1, 1)).toEqual({ minX: 1000, minZ: 1000, maxX: 2000, maxZ: 2000 });
    // A point inside a cell's bounds resolves back to that cell.
    for (const [cx, cy] of [[0, 0], [2, 1], [1, 2]] as const) {
      const b = cellBounds(g, cx, cy);
      expect(cellOf(g, (b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2)).toEqual({ cx, cy });
    }
  });

  it('enumerates every zone id, unique and all in-grid', () => {
    const ids = allZoneIds(g);
    expect(ids).toHaveLength(zoneCount(g)); // 3x3 = 9
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(id => parseZoneId(g, id) !== null)).toBe(true);
    expect(ids).toContain(zoneId(0, 0));
    expect(ids).toContain(zoneId(2, 2));
  });

  it('counts adjacent cells: 8 interior, 5 edge, 3 corner', () => {
    expect(neighbours(g, 1, 1)).toHaveLength(8);
    expect(neighbours(g, 1, 0)).toHaveLength(5);
    expect(neighbours(g, 0, 0)).toHaveLength(3);
    expect(neighbours(g, 2, 2)).toHaveLength(3);
    expect(inGrid(g, 0, 0)).toBe(true);
    expect(inGrid(g, 3, 0)).toBe(false);
    expect(inGrid(g, 1.5, 0)).toBe(false);
  });

  it('observes no neighbour at a cell centre', () => {
    expect(borderObservers(g, 1500, 1500, 100)).toEqual([]);
  });

  it('observes the single neighbour across a near edge', () => {
    expect(borderObservers(g, 1050, 1500, 100)).toEqual([{ cx: 0, cy: 1 }]);
    expect(borderObservers(g, 1950, 1500, 100)).toEqual([{ cx: 2, cy: 1 }]);
  });

  it('observes three neighbours near an interior corner', () => {
    const obs = borderObservers(g, 1050, 1050, 100);
    expect(obs).toHaveLength(3);
    expect(obs).toEqual(expect.arrayContaining([{ cx: 0, cy: 1 }, { cx: 1, cy: 0 }, { cx: 0, cy: 0 }]));
  });

  it('omits grid-edge directions with no neighbour', () => {
    // Top-right corner of the top-right cell: every candidate neighbour is off-grid.
    expect(borderObservers(g, 2950, 2950, 100)).toEqual([]);
  });

  it('zoneView bundles the writable home and read-only observers', () => {
    expect(zoneView(g, 1050, 1500, 100)).toEqual({ home: { cx: 1, cy: 1 }, observers: [{ cx: 0, cy: 1 }] });
  });
});

describe('handoff crossing detection (crossedCell)', () => {
  const home = cellIndex(g, 1, 1); // the centre cell, index 4
  it('returns null while the player stays inside their home cell', () => {
    expect(crossedCell(g, home, 1500, 1500)).toBeNull(); // centre
    expect(crossedCell(g, home, 1001, 1999)).toBeNull(); // still inside (1,1)
  });
  it('returns the destination cell on a border crossing', () => {
    expect(crossedCell(g, home, 2500, 1500)).toEqual({ cx: 2, cy: 1 }); // east
    expect(crossedCell(g, home, 1500, 500)).toEqual({ cx: 1, cy: 0 });  // south (−z)
    expect(crossedCell(g, home, 500, 2500)).toEqual({ cx: 0, cy: 2 });  // diagonal (teleport ok; adjacency not required)
  });
  it('stops crossing at the grid edge (out-of-grid clamps to the border cell)', () => {
    const edge = cellIndex(g, 2, 1); // east-border cell, index 5
    expect(crossedCell(g, edge, 9999, 1500)).toBeNull(); // beyond the east edge clamps back to (2,1)
  });
});

describe('handoff hysteresis (handoffDestination + cellFromIndex)', () => {
  const home = cellIndex(g, 1, 1); // centre cell (1,1); east border at x=2000
  it('cellFromIndex inverts cellIndex across the grid', () => {
    for (let cy = 0; cy < g.rows; cy++) for (let cx = 0; cx < g.cols; cx++)
      expect(cellFromIndex(g, cellIndex(g, cx, cy))).toEqual({ cx, cy });
  });
  it('holds off until the player is clearly past the border (50 m margin)', () => {
    expect(handoffDestination(g, home, 1500, 1500)).toBeNull();        // inside home
    expect(handoffDestination(g, home, 2030, 1500)).toBeNull();        // 30 m past the east border (< 50) — stay
    expect(handoffDestination(g, home, 2051, 1500)).toEqual({ cx: 2, cy: 1 }); // 51 m past — hand off
  });
  it('respects a custom margin', () => {
    expect(handoffDestination(g, home, 2005, 1500, 10)).toBeNull();    // 5 m past (< 10)
    expect(handoffDestination(g, home, 2011, 1500, 10)).toEqual({ cx: 2, cy: 1 }); // 11 m past (> 10)
  });
});

describe('globally-unique player ids across zones', () => {
  it('indexes cells row-major', () => {
    expect(cellIndex(g, 0, 0)).toBe(0);
    expect(cellIndex(g, 1, 0)).toBe(1);
    expect(cellIndex(g, 0, 1)).toBe(g.cols); // first cell of the next row
    expect(cellIndex(g, 2, 2)).toBe(8);
  });

  it('round-trips a local id through its cell block', () => {
    for (const [ci, local] of [[0, 1], [1, 1], [5, 42], [19, ZONE_ID_STRIDE - 1]] as const) {
      const id = globalPlayerId(ci, local);
      expect(splitPlayerId(id)).toEqual({ cellIndex: ci, localId: local });
    }
  });

  it('never collides two zones\' identical local ids', () => {
    // The classic merge hazard: local id 1 in two different cells.
    expect(globalPlayerId(0, 1)).not.toBe(globalPlayerId(1, 1));
    const ids = new Set<number>();
    for (let ci = 0; ci < zoneCount(SF_ZONE_GRID); ci++) for (const local of [1, 2, 1000]) ids.add(globalPlayerId(ci, local));
    expect(ids.size).toBe(zoneCount(SF_ZONE_GRID) * 3);
  });

  it('keeps every SF-grid id within the signed-safe 2^32-1 session range', () => {
    const maxId = globalPlayerId(zoneCount(SF_ZONE_GRID) - 1, ZONE_ID_STRIDE - 1);
    expect(maxId).toBeLessThanOrEqual(4294967295);
  });

  it('rejects an out-of-range local id or negative cell', () => {
    expect(() => globalPlayerId(0, 0)).toThrow();
    expect(() => globalPlayerId(0, ZONE_ID_STRIDE)).toThrow();
    expect(() => globalPlayerId(-1, 1)).toThrow();
  });
});

describe('provisional SF grid', () => {
  it('has 16–24 zones per the brief', () => {
    const n = zoneCount(SF_ZONE_GRID);
    expect(n).toBeGreaterThanOrEqual(16);
    expect(n).toBeLessThanOrEqual(24);
  });

  it('resolves the Ferry Building spawn to a valid in-grid zone', () => {
    const ferry = cellOf(SF_ZONE_GRID, 1196.869, -1224.309);
    expect(inGrid(SF_ZONE_GRID, ferry.cx, ferry.cy)).toBe(true);
    expect(parseZoneId(SF_ZONE_GRID, zoneId(ferry.cx, ferry.cy))).toEqual(ferry);
    const b = cellBounds(SF_ZONE_GRID, ferry.cx, ferry.cy);
    expect(1196.869).toBeGreaterThanOrEqual(b.minX);
    expect(1196.869).toBeLessThan(b.maxX);
    expect(-1224.309).toBeGreaterThanOrEqual(b.minZ);
    expect(-1224.309).toBeLessThan(b.maxZ);
  });

  it('keeps the border-subscribe radius beyond the tier-2 interest edge (120 m)', () => {
    expect(BORDER_SUBSCRIBE_M).toBeGreaterThan(120);
  });
});
