import { SF_ZONE_GRID, zoneView, type Cell, type ZoneGrid } from '@gtasf/shared/world/zones';
import type { Pose } from '@gtasf/shared/protocol/types';

/**
 * Observer-admission + pose-throttle policy for the zoned-world read-only viewer (bead gtasf-obsv-4un5).
 *
 * The `?observe=1` branch of WorldDO opens a read-only socket that receives this zone's nearest players to a
 * client-supplied filter pose. Kept pure and free of the worker runtime so it is unit-testable: WorldDO wires
 * these into the accept path and the observer MOVE handler.
 *
 * Threats closed: (1) a cross-site page opening unbounded observer sockets to any zone (DoS / connections-map
 * growth) — observers must be same-origin, like the player join path; (2) the same, within one origin —
 * observers are bounded globally and per verified player; (3) sweeping the filter pose faster than the snapshot
 * tick to enumerate every player position — pose updates are throttled to the tick cadence.
 */

/** One 10 Hz world tick (TICK_HZ). A faster filter-pose sweep gains no data, since snapshots are per-tick. */
export const OBSERVER_POSE_MIN_INTERVAL_MS = 100;

/**
 * Max observer sockets one client (verified home-session player id) may hold to a zone — the real abuse bound.
 * A player needs one socket per observed zone, plus one transient replacement during handoff (gtasf-iajw).
 */
export const OBSERVER_PER_CLIENT_CAP = 2;

/** A verified home session can only observe nearby cells. A 50 m allowance covers one car
 * update in flight; a filter request cannot authorize itself by supplying a distant spawn. */
export function observerTargetAllowed(pose: Pose, home: Cell, target: Cell, grid: ZoneGrid = SF_ZONE_GRID): boolean {
  if (home.cx === target.cx && home.cy === target.cy) return false;
  const view = zoneView(grid, pose.x / 100, pose.z / 100, 200);
  return [view.home, ...view.observers].some(c => c.cx === target.cx && c.cy === target.cy);
}

/**
 * The per-zone TOTAL observer bound (DoS backstop for the connections map). Observers are lightweight
 * read-only sockets and the legit border-neighbour viewers into a crowded hotspot can outnumber that
 * zone's own players, so the total is generous — a multiple of the player cap. Abuse is bounded
 * per-client ({@link OBSERVER_PER_CLIENT_CAP}), not by a tight total that would 503 legit viewers and
 * open a visible border seam at 5k concurrent (gtasf-iajw).
 */
export function observerZoneCap(playerCap: number): number { return playerCap * 4; }

/**
 * The HTTP status to reject an observer upgrade with, or null to admit it.
 * - 403 when the request is not same-origin (a cross-site caller must never open an observer socket).
 * - 503 when this client already holds `clientCap` observer sockets to the zone (per-client abuse bound),
 *   or the zone already holds `cap` observers total (connections-map DoS backstop).
 */
export function observerRejectStatus(sameOrigin: boolean, observerCount: number, cap: number, clientObserverCount = 0, clientCap = Infinity): 403 | 503 | null {
  if (!sameOrigin) return 403;
  if (clientObserverCount >= clientCap) return 503;
  if (observerCount >= cap) return 503;
  return null;
}

/** Whether a new filter pose may be accepted yet (at most one per {@link OBSERVER_POSE_MIN_INTERVAL_MS}). */
export function observerPoseUpdateAllowed(now: number, lastAt: number | undefined): boolean {
  return now - (lastAt ?? 0) >= OBSERVER_POSE_MIN_INTERVAL_MS;
}
