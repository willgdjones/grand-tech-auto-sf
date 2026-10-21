/**
 * Bounded interest selection for the one-SF world (docs/engineering/zoned-world.md §6).
 *
 * `snapshot.ts` still decides the per-tick send cadence by distance tier; this module
 * decides **which** peers a player considers at all, capped to the nearest `k`. That cap
 * bounds every player's SNAPSHOT to ~k entries no matter how dense the local crowd is, so
 * an event dogpile cannot inflate any one player's packet. Pure and allocation-light: a
 * bounded top-k scan (O(n·k), k small) that reads positions through accessors, so it works
 * on `snapshot.ts`'s nested-pose peers with no per-item allocation and no spatial index.
 * A spatial hash is a later optimisation only if one zone must hold thousands (a hotspot
 * before a zone split).
 */

/** Default full-detail cap: the nearest 60 peers (docs §6). */
export const NEAREST_FULL = 60;

export interface NearestOptions<T> {
  /** Self position in world units (same units as the accessors return). */
  readonly x: number;
  readonly z: number;
  readonly posX: (item: T) => number;
  readonly posZ: (item: T) => number;
  /** Items for which this returns true are skipped (e.g. self). */
  readonly skip?: (item: T) => boolean;
}

/**
 * The nearest `k` items to the self position by planar (x,z) distance, nearest first.
 * Returns every (non-skipped) item, sorted, when there are fewer than `k`. `k <= 0` → `[]`.
 */
export function nearestPeers<T>(items: Iterable<T>, k: number, opts: NearestOptions<T>): T[] {
  if (k <= 0) return [];
  const { x, z, posX, posZ, skip } = opts;
  // kept stays sorted ascending by squared distance; worst is kept[k-1].d2 once full.
  const kept: { item: T; d2: number }[] = [];
  let worst = Infinity;
  for (const item of items) {
    if (skip?.(item)) continue;
    const dx = posX(item) - x, dz = posZ(item) - z, d2 = dx * dx + dz * dz;
    if (kept.length < k) {
      insertSorted(kept, item, d2);
      if (kept.length === k) worst = kept[k - 1]!.d2;
    } else if (d2 < worst) {
      kept.pop();
      insertSorted(kept, item, d2);
      worst = kept[k - 1]!.d2;
    }
  }
  return kept.map(entry => entry.item);
}

function insertSorted<T>(kept: { item: T; d2: number }[], item: T, d2: number): void {
  let i = kept.length;
  kept.push({ item, d2 });
  while (i > 0 && kept[i - 1]!.d2 > d2) { kept[i] = kept[i - 1]!; i--; }
  kept[i] = { item, d2 };
}
