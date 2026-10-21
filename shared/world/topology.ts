import { cellBounds, cellFromIndex, cellIndex, cellOf, inGrid, zoneCount, zoneId,
  BORDER_SUBSCRIBE_M, ZONE_HANDOFF_MARGIN_M, type Cell, type CellBounds, type ZoneGrid } from './zones';

export const ZONE_SPLIT_POPULATION = 350;
export const ZONE_FALLBACK_CAPACITY = 500;
export const sameZone = (a: Cell, b: Cell): boolean => a.cx === b.cx && a.cy === b.cy;
export const isChildZone = (grid: ZoneGrid, cell: Cell): boolean => cell.cx >= grid.cols;

/** Child coordinates use the unused x range; old parent addresses and ID blocks never move. */
export function validZoneCell(grid: ZoneGrid, cx: number, cy: number): boolean {
  return inGrid(grid, cx, cy) || (Number.isInteger(cx) && Number.isInteger(cy)
    && cx >= grid.cols && cx < grid.cols * 3 && cy >= 0 && cy < grid.rows * 2);
}
export function parentZone(grid: ZoneGrid, cell: Cell): Cell {
  return isChildZone(grid, cell) ? { cx: Math.floor((cell.cx - grid.cols) / 2), cy: Math.floor(cell.cy / 2) } : cell;
}
export function childZones(grid: ZoneGrid, parent: Cell): Cell[] {
  return [0, 1, 2, 3].map(q => ({ cx: grid.cols + parent.cx * 2 + q % 2, cy: parent.cy * 2 + Math.floor(q / 2) }));
}
export function zoneIndex(grid: ZoneGrid, cell: Cell): number {
  if (!validZoneCell(grid, cell.cx, cell.cy)) throw new RangeError('Invalid zone');
  const parent = parentZone(grid, cell), index = cellIndex(grid, parent.cx, parent.cy);
  return isChildZone(grid, cell) ? zoneCount(grid) + index * 4 + (cell.cy % 2) * 2 + ((cell.cx - grid.cols) % 2) : index;
}
export function zoneFromIndex(grid: ZoneGrid, index: number): Cell {
  const count = zoneCount(grid);
  if (!Number.isInteger(index) || index < 0 || index >= count * 5) throw new RangeError('Invalid zone namespace');
  return index < count ? cellFromIndex(grid, index) : childZones(grid, cellFromIndex(grid, Math.floor((index - count) / 4)))[(index - count) % 4]!;
}
export function zoneBounds(grid: ZoneGrid, cell: Cell): CellBounds {
  const parent = parentZone(grid, cell), b = cellBounds(grid, parent.cx, parent.cy);
  if (!isChildZone(grid, cell)) return b;
  const half = grid.cell / 2, minX = b.minX + ((cell.cx - grid.cols) % 2) * half, minZ = b.minZ + (cell.cy % 2) * half;
  return { minX, minZ, maxX: minX + half, maxZ: minZ + half };
}
export function validSplitMask(grid: ZoneGrid, mask: unknown): mask is number {
  return typeof mask === 'number' && Number.isInteger(mask) && mask >= 0 && mask < 2 ** zoneCount(grid);
}
export function zoneIsSplit(grid: ZoneGrid, mask: number, parent: Cell): boolean {
  const base = parentZone(grid, parent);
  return !!(mask & (1 << cellIndex(grid, base.cx, base.cy)));
}
export function splitZoneMask(grid: ZoneGrid, mask: number, parent: Cell): number {
  return mask | (1 << cellIndex(grid, parent.cx, parent.cy));
}
export function leafZone(grid: ZoneGrid, mask: number, x: number, z: number): Cell {
  const parent = cellOf(grid, x, z);
  if (!zoneIsSplit(grid, mask, parent)) return parent;
  const b = cellBounds(grid, parent.cx, parent.cy), east = x >= (b.minX + b.maxX) / 2, south = z >= (b.minZ + b.maxZ) / 2;
  return childZones(grid, parent)[Number(south) * 2 + Number(east)]!;
}
export function topologyZones(grid: ZoneGrid, mask: number, includeDraining = false): Cell[] {
  const cells: Cell[] = [];
  for (let i = 0; i < zoneCount(grid); i++) {
    const cell = cellFromIndex(grid, i), split = zoneIsSplit(grid, mask, cell);
    if (!split || includeDraining) cells.push(cell);
    if (split) cells.push(...childZones(grid, cell));
  }
  return cells;
}
/** Includes a draining parent so neither a topology refresh nor a claim opens a visibility seam. */
export function nearbyZones(grid: ZoneGrid, mask: number, x: number, z: number, authority: Cell,
  radius = BORDER_SUBSCRIBE_M, includeDraining = true): Cell[] {
  return topologyZones(grid, mask, includeDraining).filter(cell => {
    if (sameZone(cell, authority)) return false;
    const b = zoneBounds(grid, cell);
    return Math.max(b.minX - x, x - b.maxX, 0) <= radius && Math.max(b.minZ - z, z - b.maxZ, 0) <= radius;
  });
}
export function leafHandoff(grid: ZoneGrid, mask: number, from: Cell, x: number, z: number): Cell | undefined {
  const to = leafZone(grid, mask, x, z);
  if (sameZone(from, to)) return;
  if (!isChildZone(grid, from) && zoneIsSplit(grid, mask, from)) return to;
  const b = zoneBounds(grid, from);
  if (Math.hypot(Math.max(b.minX - x, x - b.maxX, 0), Math.max(b.minZ - z, z - b.maxZ, 0)) > ZONE_HANDOFF_MARGIN_M) return to;
}
export function allTopologyNames(grid: ZoneGrid): string[] {
  return topologyZones(grid, 2 ** zoneCount(grid) - 1, true).map(c => zoneId(c.cx, c.cy));
}
