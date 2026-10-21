/**
 * Spatial zoning grid for the one-SF world (docs/engineering/zoned-world.md).
 *
 * Pure, config-driven cell math shared by the worker (`/api/world` routing + `ZoneDO`)
 * and the web client (home-cell selection + neighbour observer subscriptions). World
 * metres use the SF_FRAME convention: +x east, +y up, **-z north**, so z is the second
 * grid axis. Everything here is deterministic and allocation-light; no runtime state.
 */

export interface ZoneGrid {
  /** Grid corner in world metres: the minimum x (west) and minimum z (south). */
  readonly minX: number;
  readonly minZ: number;
  /** Cell counts along x (columns) and z (rows). */
  readonly cols: number;
  readonly rows: number;
  /** Square cell edge in metres. */
  readonly cell: number;
}

export interface Cell { readonly cx: number; readonly cy: number }
export interface CellBounds { readonly minX: number; readonly minZ: number; readonly maxX: number; readonly maxZ: number }

/**
 * Provisional SF grid covering the drivable core (5×4 = 20 zones of 2.6 km), within
 * the brief's 16–24 range. The exact extent and cell size are re-pinned from the map
 * manifest when routing is wired (gtasf-k1aa §15 step 1); the math below is independent
 * of these numbers, so a re-pin is a one-line change here.
 */
export const SF_ZONE_GRID: ZoneGrid = { minX: -6700, minZ: -6600, cols: 5, rows: 4, cell: 2600 };

/**
 * How close (metres) to a shared edge/corner a client must be before it read-only
 * subscribes to that neighbour zone, so border peers are visible before the player
 * crosses (docs §5.2). Must exceed the 120 m tier-2 interest edge in `snapshot.ts`.
 */
export const BORDER_SUBSCRIBE_M = 150;

const clampInt = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Total zones in a grid. */
export function zoneCount(grid: ZoneGrid): number { return grid.cols * grid.rows; }

/** Every zone id in the grid, row-major. Bounded (cols*rows), so a city-wide broadcast
 * (e.g. the outbid crown, docs §8) can fan out to all cells without a live zone registry. */
export function allZoneIds(grid: ZoneGrid): string[] {
  const ids: string[] = [];
  for (let cy = 0; cy < grid.rows; cy++) for (let cx = 0; cx < grid.cols; cx++) ids.push(zoneId(cx, cy));
  return ids;
}

/** Row-major index of a cell (0 .. cols*rows-1). */
export function cellIndex(grid: ZoneGrid, cx: number, cy: number): number { return cy * grid.cols + cx; }

/** Inverse of {@link cellIndex}: the cell at a row-major index. */
export function cellFromIndex(grid: ZoneGrid, index: number): Cell { return { cx: index % grid.cols, cy: Math.floor(index / grid.cols) }; }

/**
 * Per-cell id block so a player's WIRE id is globally unique across zones. Player sessions
 * are per-DO `AUTOINCREMENT` (local, 1..STRIDE-1); the zone adds `cellIndex * STRIDE` so a
 * client merging SNAPSHOTs from several zones (its home + neighbour observers,
 * docs/engineering/zoned-world.md §5-§7) can never confuse two zones' local id 1. STRIDE
 * 2^24 ⇒ 16.7M players/zone and up to 255 zones inside the signed-safe 2^32-1 id range.
 */
export const ZONE_ID_STRIDE = 1 << 24;

/** Map a per-DO local session id in a cell to its globally-unique wire id. */
export function globalPlayerId(cellIndex: number, localId: number): number {
  if (!Number.isInteger(cellIndex) || cellIndex < 0 || !Number.isInteger(localId) || localId <= 0 || localId >= ZONE_ID_STRIDE)
    throw new RangeError(`Invalid zoned player id: cell ${cellIndex}, local ${localId}`);
  return cellIndex * ZONE_ID_STRIDE + localId;
}

/** Recover the cell index and per-DO local id from a global wire id. */
export function splitPlayerId(id: number): { cellIndex: number; localId: number } {
  return { cellIndex: Math.floor(id / ZONE_ID_STRIDE), localId: id % ZONE_ID_STRIDE };
}

/** Whether (cx,cy) is a real cell of the grid. */
export function inGrid(grid: ZoneGrid, cx: number, cy: number): boolean {
  return Number.isInteger(cx) && Number.isInteger(cy) && cx >= 0 && cx < grid.cols && cy >= 0 && cy < grid.rows;
}

/**
 * The cell a world position belongs to, clamped to the grid edges so positions beyond
 * the modelled core resolve to the nearest border zone rather than falling out of range.
 */
export function cellOf(grid: ZoneGrid, x: number, z: number): Cell {
  const cx = clampInt(Math.floor((x - grid.minX) / grid.cell), 0, grid.cols - 1);
  const cy = clampInt(Math.floor((z - grid.minZ) / grid.cell), 0, grid.rows - 1);
  return { cx, cy };
}

/** Stable Durable Object name for a cell (used with `idFromName`). */
export function zoneId(cx: number, cy: number): string { return `z:${cx}:${cy}`; }

const CELL_RE = /^z:(\d{1,4}):(\d{1,4})$/;
/** Parse a zone id and validate it against the grid; null if malformed or out of range. */
export function parseZoneId(grid: ZoneGrid, id: string): Cell | null {
  const match = CELL_RE.exec(id);
  if (!match) return null;
  const cx = Number(match[1]), cy = Number(match[2]);
  return inGrid(grid, cx, cy) ? { cx, cy } : null;
}

/** World-metre bounds of a cell. Cells tile the grid with no gaps or overlaps. */
export function cellBounds(grid: ZoneGrid, cx: number, cy: number): CellBounds {
  const minX = grid.minX + cx * grid.cell, minZ = grid.minZ + cy * grid.cell;
  return { minX, minZ, maxX: minX + grid.cell, maxZ: minZ + grid.cell };
}

/** The up-to-8 in-grid cells adjacent to (cx,cy). */
export function neighbours(grid: ZoneGrid, cx: number, cy: number): Cell[] {
  const out: Cell[] = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    if (dx === 0 && dz === 0) continue;
    if (inGrid(grid, cx + dx, cy + dz)) out.push({ cx: cx + dx, cy: cy + dz });
  }
  return out;
}

/**
 * Which neighbour cells a client at (x,z) should read-only observe: the in-grid cells
 * whose shared edge/corner is within `radius` metres of the position (docs §5–§7).
 * Returns the home cell's neighbours only — never the home cell itself — and at most 3
 * (a corner), usually 0–1. Grid-edge directions with no neighbour are omitted.
 */
export function borderObservers(grid: ZoneGrid, x: number, z: number, radius = BORDER_SUBSCRIBE_M): Cell[] {
  const home = cellOf(grid, x, z), b = cellBounds(grid, home.cx, home.cy);
  const west = x - b.minX < radius, east = b.maxX - x < radius;
  const south = z - b.minZ < radius, north = b.maxZ - z < radius;
  const out: Cell[] = [];
  for (const dz of [-1, 0, 1]) for (const dx of [-1, 0, 1]) {
    if (dx === 0 && dz === 0) continue;
    const okX = dx === 0 || (dx === -1 ? west : east);
    const okZ = dz === 0 || (dz === -1 ? south : north);
    if (okX && okZ && inGrid(grid, home.cx + dx, home.cy + dz)) out.push({ cx: home.cx + dx, cy: home.cy + dz });
  }
  return out;
}

export interface ZoneView { readonly home: Cell; readonly observers: readonly Cell[] }
/** The home cell plus the neighbour cells to observe for a position — the full set of
 * zones a client connects to (one writable home + 0–3 read-only observers). */
export function zoneView(grid: ZoneGrid, x: number, z: number, radius = BORDER_SUBSCRIBE_M): ZoneView {
  return { home: cellOf(grid, x, z), observers: borderObservers(grid, x, z, radius) };
}

/**
 * Handoff detection (gtasf-djjz §7, seamless handoff): the destination cell a player has crossed
 * into, or null if they are still inside `fromCellIndex`. The origin zone calls this after each
 * accepted authoritative move — converting its cm pose to metres — to decide whether to hand the
 * session off to a neighbour cell. Positions beyond the modelled core clamp to the nearest border
 * cell (via `cellOf`), so a player at the grid edge simply stops crossing rather than falling out.
 */
export function crossedCell(grid: ZoneGrid, fromCellIndex: number, x: number, z: number): Cell | null {
  const to = cellOf(grid, x, z);
  return cellIndex(grid, to.cx, to.cy) === fromCellIndex ? null : to;
}

/** Hysteresis margin (metres) a crossing player must travel past their home cell's border before the
 *  server hands them off, so walking along a border never thrashes the connection (docs §7). */
export const ZONE_HANDOFF_MARGIN_M = 50;

/**
 * Handoff with hysteresis (gtasf-djjz §7): the destination cell to hand a player off to, or null if
 * they are still inside `fromCellIndex` OR have not yet travelled `marginM` metres past its border.
 * Built on {@link crossedCell} plus the home cell bounds; the margin prevents border-line reconnect
 * thrash (it replaces the old client-side `HANDOFF_MARGIN_M` now that the server owns the decision).
 */
export function handoffDestination(grid: ZoneGrid, fromCellIndex: number, x: number, z: number, marginM = ZONE_HANDOFF_MARGIN_M): Cell | null {
  const to = crossedCell(grid, fromCellIndex, x, z);
  if (!to) return null;
  const home = cellFromIndex(grid, fromCellIndex), b = cellBounds(grid, home.cx, home.cy);
  const dx = Math.max(b.minX - x, x - b.maxX, 0), dz = Math.max(b.minZ - z, z - b.maxZ, 0);
  return Math.hypot(dx, dz) > marginM ? to : null;
}
