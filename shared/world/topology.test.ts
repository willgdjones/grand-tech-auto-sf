import { describe, expect, it } from 'vitest';
import { SF_ZONE_GRID as grid, cellOf, cellBounds } from './zones';
import { decodeS2C, encodeS2C } from '../protocol/s2c';
import { allTopologyNames, childZones, leafHandoff, leafZone, nearbyZones, parentZone, splitZoneMask,
  topologyZones, validZoneCell, zoneBounds, zoneFromIndex, zoneIndex } from './topology';

describe('spatial overload subdivision', () => {
  it('carries actual leaf ownership without changing the existing welcome or handoff formats', () => {
    const message = { type: 'ZONE_LAYOUT' as const, splitMask: 1 << 19, cx: 14, cy: 7 };
    expect(decodeS2C(encodeS2C(message))).toEqual({ ok: true, msg: message });
  });
  it('preserves all parent identities and gives every possible child a distinct namespace', () => {
    const cells = topologyZones(grid, 2 ** 20 - 1, true);
    expect(cells).toHaveLength(100);
    expect(new Set(cells.map(c => zoneIndex(grid, c))).size).toBe(100);
    expect(new Set(allTopologyNames(grid)).size).toBe(100);
    for (const cell of cells) {
      expect(validZoneCell(grid, cell.cx, cell.cy)).toBe(true);
      expect(zoneFromIndex(grid, zoneIndex(grid, cell))).toEqual(cell);
    }
    expect(topologyZones(grid, 0)).toHaveLength(20);
  });
  it('tiles a split district without changing the district on either side', () => {
    const parent = { cx: 2, cy: 2 }, mask = splitZoneMask(grid, 0, parent), bounds = cellBounds(grid, 2, 2);
    expect(topologyZones(grid, mask)).toHaveLength(23);
    for (const child of childZones(grid, parent)) {
      const b = zoneBounds(grid, child), x = (b.minX + b.maxX) / 2, z = (b.minZ + b.maxZ) / 2;
      expect(b.maxX - b.minX).toBe(grid.cell / 2);
      expect(parentZone(grid, child)).toEqual(parent);
      expect(leafZone(grid, mask, x, z)).toEqual(child);
      expect(leafHandoff(grid, mask, parent, x, z)).toEqual(child);
    }
    expect(leafZone(grid, mask, bounds.maxX + 1, bounds.minZ + 1)).toEqual(cellOf(grid, bounds.maxX + 1, bounds.minZ + 1));
  });
  it('observes both sides of a child seam and the draining parent, with handoff hysteresis', () => {
    const parent = { cx: 2, cy: 2 }, mask = splitZoneMask(grid, 0, parent), [west, east] = childZones(grid, parent);
    const b = zoneBounds(grid, west!), z = (b.minZ + b.maxZ) / 2;
    const visible = nearbyZones(grid, mask, b.maxX - 10, z, west!);
    expect(visible).toContainEqual(east); expect(visible).toContainEqual(parent); expect(visible).not.toContainEqual(west);
    expect(leafHandoff(grid, mask, west!, b.maxX + 20, z)).toBeUndefined();
    expect(leafHandoff(grid, mask, west!, b.maxX + 51, z)).toEqual(east);
  });
});
