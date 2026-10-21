type ErrorCode = 'SURFACE_UNKNOWN' | 'INVALID_RECT' | 'VOID_TILES';

export interface RectInput {
  surfaceId: number;
  col0: number;
  row0: number;
  cols: number;
  rows: number;
}

/** Catalogue-owned grid metadata; row zero is the bottom row when facing the surface. */
export interface SurfaceGrid {
  readonly id: number;
  readonly cols: number;
  readonly rows: number;
  readonly tileBase: number;
  readonly tileWeight: number;
  isVoid(col: number, row: number): boolean;
}

export interface CatalogueGrid {
  surface(id: number): SurfaceGrid | undefined;
}

// Keep the pure result discriminants tied to the shared HTTP error catalogue.
type RegisteredCode<C extends ErrorCode> = C;
export type RectError =
  | { code: RegisteredCode<'SURFACE_UNKNOWN'> }
  | { code: RegisteredCode<'INVALID_RECT'>; field?: keyof RectInput }
  | { code: RegisteredCode<'VOID_TILES'>; voids: number[] };

type RectResult =
  { ok: true; surface: SurfaceGrid; delta: bigint; tiles: number } | { ok: false; error: RectError };

const RECT_FIELDS = ['surfaceId', 'col0', 'row0', 'cols', 'rows'] as const;

function invalid(field: keyof RectInput): RectResult {
  return { ok: false, error: { code: 'INVALID_RECT', field } };
}

export function validateRect(cat: CatalogueGrid, r: RectInput): RectResult {
  // A malformed id cannot name a surface. For well-formed ids, lookup precedes all other errors.
  if (!Number.isSafeInteger(r.surfaceId) || r.surfaceId < 0) return invalid('surfaceId');
  const surface = cat.surface(r.surfaceId);
  if (!surface) return { ok: false, error: { code: 'SURFACE_UNKNOWN' } };
  for (const field of RECT_FIELDS) {
    if (!Number.isSafeInteger(r[field]) || r[field] < 0) return invalid(field);
  }
  if (r.cols < 1) return invalid('cols');
  if (r.rows < 1) return invalid('rows');
  if (r.col0 >= surface.cols) return invalid('col0');
  if (r.row0 >= surface.rows) return invalid('row0');
  if (r.cols > surface.cols - r.col0) return invalid('cols');
  if (r.rows > surface.rows - r.row0) return invalid('rows');

  const voids: number[] = [];
  for (let row = r.row0; row < r.row0 + r.rows; row += 1) {
    for (let col = r.col0; col < r.col0 + r.cols; col += 1) {
      if (surface.isVoid(col, row)) {
        voids.push(surface.tileBase + row * surface.cols + col);
        if (voids.length === 50) return { ok: false, error: { code: 'VOID_TILES', voids } };
      }
    }
  }
  if (voids.length) return { ok: false, error: { code: 'VOID_TILES', voids } };
  return {
    ok: true,
    surface,
    tiles: r.cols * r.rows,
    delta: BigInt(r.cols) * BigInt(r.rows) * BigInt(surface.tileWeight),
  };
}

/** Iterate an already validated rectangle in ascending tile-id order, without materializing it. */
export function* rectTileIds(s: SurfaceGrid, r: RectInput): Iterable<number> {
  for (let row = r.row0; row < r.row0 + r.rows; row += 1) {
    const first = s.tileBase + row * s.cols + r.col0;
    for (let col = 0; col < r.cols; col += 1) yield first + col;
  }
}

/** Test a grid cell against the half-open edges of an already validated rectangle. */
export function rectContains(r: RectInput, col: number, row: number): boolean {
  return (
    Number.isSafeInteger(col) &&
    Number.isSafeInteger(row) &&
    col >= r.col0 &&
    col < r.col0 + r.cols &&
    row >= r.row0 &&
    row < r.row0 + r.rows
  );
}

export function rectsEqual(a: RectInput, b: RectInput): boolean {
  return RECT_FIELDS.every((field) => a[field] === b[field]);
}

export function rectsOverlap(a: RectInput, b: RectInput): boolean {
  return (
    a.surfaceId === b.surfaceId &&
    a.col0 < b.col0 + b.cols &&
    b.col0 < a.col0 + a.cols &&
    a.row0 < b.row0 + b.rows &&
    b.row0 < a.row0 + a.rows
  );
}

/** Availability is supplied by the caller; the server remains authoritative. */
export function collectConflicts(
  s: SurfaceGrid,
  r: RectInput,
  isFree: (tileId: number) => boolean,
  max = 50,
): number[] {
  if (!Number.isSafeInteger(max) || max < 0)
    throw new RangeError('Conflict limit must be a nonnegative integer');
  const conflicts: number[] = [];
  if (max === 0) return conflicts;
  const limit = Math.min(max, 50);
  for (const tileId of rectTileIds(s, r)) {
    if (!isFree(tileId)) {
      conflicts.push(tileId);
      if (conflicts.length === limit) break;
    }
  }
  return conflicts;
}
