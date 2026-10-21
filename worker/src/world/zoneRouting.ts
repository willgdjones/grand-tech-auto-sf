import { SF_ZONE_GRID, cellOf, zoneId, type Cell, type ZoneGrid } from '@gtasf/shared/world/zones';
import { leafZone, topologyZones, validZoneCell, zoneIsSplit } from '@gtasf/shared/world/topology';
import { LOCAL_SPAWN, parseSpawnQuery } from './localSpawn';

/**
 * Picks which `WORLD` Durable Object instance a `/api/world` connection joins.
 *
 * With `zonedWorld` off this is always the single `'sf'` instance, so the path is
 * byte-for-byte today's single world. With it on, each grid cell is a separate instance
 * of the same `WorldDO` class (reached by `idFromName('z:cx:cy')`) — spatial partitioning
 * with no new DO class and no wrangler migration (docs/engineering/zoned-world.md,
 * gtasf-k1aa). Neighbour observers, handoff and the global hub are later phases; admission
 * capacity integration (per-zone vs global) is the capacity phase, so zoned routing is
 * exercised with `worldCapacity` off until then.
 */

/** Instance name for the single, whole-city world when zoning is off. */
export const SINGLE_WORLD = 'sf';

const ZONE_RE = /^(\d{1,4}),(\d{1,4})$/;

/**
 * The home zone DO name for a connection: an explicit `?zone=cx,cy`, else the cell under
 * `?spawn=` (poses are integer centimetres; the grid is metres), else the default Ferry
 * spawn cell. Always returns a valid in-grid `z:cx:cy`.
 */
export function resolveZoneCell(url: URL, grid: ZoneGrid = SF_ZONE_GRID): Cell {
  const explicit = url.searchParams.get('zone');
  if (explicit) {
    const match = ZONE_RE.exec(explicit.trim());
    if (match) {
      const cx = Number(match[1]), cy = Number(match[2]);
      if (validZoneCell(grid, cx, cy)) return { cx, cy };
    }
  }
  const pose = parseSpawnQuery(url.searchParams.get('spawn')) ?? LOCAL_SPAWN;
  return cellOf(grid, pose.x / 100, pose.z / 100);
}

export function resolveZoneName(url: URL, grid: ZoneGrid = SF_ZONE_GRID): string {
  const cell = resolveZoneCell(url, grid);
  return zoneId(cell.cx, cell.cy);
}

/** The `WORLD` instance name for this connection: `'sf'` when zoning is off, else the
 * per-cell zone instance. */
export function worldInstanceName(url: URL, zoned: boolean, grid: ZoneGrid = SF_ZONE_GRID, splitMask = 0): string {
  if (!zoned) return SINGLE_WORLD;
  const requested = resolveZoneCell(url, grid);
  // Observers target an exact owner, including a draining parent. Resume likewise starts at the
  // previous owner, which either resumes the session or performs a claimed handoff itself.
  if (url.searchParams.get('observe') === '1' || url.searchParams.get('resume') === '1' || !zoneIsSplit(grid, splitMask, requested))
    return zoneId(requested.cx, requested.cy);
  const pose = parseSpawnQuery(url.searchParams.get('spawn')) ?? LOCAL_SPAWN;
  const leaf = leafZone(grid, splitMask, pose.x / 100, pose.z / 100);
  return zoneId(leaf.cx, leaf.cy);
}

/** The `WORLD` instances a city-wide broadcast (e.g. the outbid crown) must reach:
 * every zone cell when zoning is on, else just the single world (docs §8). */
export function worldBroadcastTargets(zoned: boolean, grid: ZoneGrid = SF_ZONE_GRID, splitMask = 0): string[] {
  return zoned ? topologyZones(grid, splitMask, true).map(c => zoneId(c.cx, c.cy)) : [SINGLE_WORLD];
}
