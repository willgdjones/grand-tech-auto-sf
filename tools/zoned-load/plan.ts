/**
 * Pure, tested core for the zoned-world staging load test (docs/engineering/zoned-world.md §13).
 *
 * The live driver (co-designed with pane 5, run against a STAGING deploy — never production) spawns
 * N real protocol WebSocket clients using this plan: where each bot lives, which ones cross borders
 * to exercise handoff, and how to score the client-measurable metrics (bytes/client, snapshot cadence,
 * and handoff glitches). Keeping this logic pure means the hard parts are unit-tested without a server.
 */
import { SF_ZONE_GRID, cellBounds, parseZoneId, zoneId, type Cell, type ZoneGrid } from '@gtasf/shared/world/zones';
import type { S2CMessage } from '@gtasf/shared/protocol/types';

export interface BotPlan {
  readonly index: number;
  readonly cell: Cell;
  readonly zone: string;
  /** Spawn pose in world centimetres (near the cell centre). */
  readonly spawn: { x: number; y: number; z: number; yaw: number };
  /** Border-crosser: drives a straight line to `crossTo` to exercise handoff. */
  readonly crossTo?: { x: number; y: number; z: number; yaw: number };
  readonly watcherIndex?: number;
}

const centreCm = (grid: ZoneGrid, cell: Cell) => {
  const b = cellBounds(grid, cell.cx, cell.cy);
  return { x: Math.round((b.minX + b.maxX) / 2) * 100, y: 300, z: Math.round((b.minZ + b.maxZ) / 2) * 100, yaw: 0 };
};

/**
 * Spread `n` bots across every grid cell round-robin (even per-zone load), making every
 * `crossEvery`-th bot a border-crosser whose route ends in the east-neighbour cell (or the
 * west edge for the last column) so handoff is exercised in multiple zones.
 */
export function distributeBots(n: number, grid: ZoneGrid = SF_ZONE_GRID, crossEvery = 5): BotPlan[] {
  const cells: Cell[] = [];
  for (let cy = 0; cy < grid.rows; cy++) for (let cx = 0; cx < grid.cols; cx++) cells.push({ cx, cy });
  const plans: BotPlan[] = [];
  for (let i = 0; i < n; i++) {
    const cell = cells[i % cells.length]!;
    let spawn = centreCm(grid, cell);
    let crossTo: BotPlan['crossTo'];
    let watcherIndex: number | undefined;
    const ordinal = Math.floor(i / cells.length), group = Math.floor(ordinal / Math.max(2, crossEvery));
    // Each border crosser has a nearby stationary watcher in the same cell. A 100 m walk at 5 m/s
    // exercises the real 50 m handoff margin; the old centre-to-centre path required 130 m/s.
    const crossing = crossEvery > 0 && ordinal % Math.max(2, crossEvery) === 0 && i + cells.length < n;
    const watcher = crossEvery > 0 && ordinal % Math.max(2, crossEvery) === 1;
    if ((crossing || watcher) && grid.cols > 1) {
      const b = cellBounds(grid, cell.cx, cell.cy), east = cell.cx < grid.cols - 1;
      const border = east ? b.maxX : b.minX, direction = east ? 1 : -1;
      spawn = { ...spawn, x: Math.round((border - direction * 20) * 100),
        z: spawn.z + (group % 100 - 50) * 800, yaw: east ? 64 : 192 };
      if (crossing) {
        crossTo = { ...spawn, x: Math.round((border + direction * 80) * 100) };
        watcherIndex = i + cells.length;
      } else spawn = { ...spawn, z: spawn.z + 100 };
    } else {
      spawn = { ...spawn, x: spawn.x + (ordinal % 10 - 5) * 3000, z: spawn.z + (Math.floor(ordinal / 10) % 10 - 5) * 3000 };
    }
    plans.push({ index: i, cell, zone: zoneId(cell.cx, cell.cy), spawn, ...(crossTo ? { crossTo, watcherIndex } : {}) });
  }
  return plans;
}

export function zoneQuery(zone: string, grid: ZoneGrid = SF_ZONE_GRID): string {
  const cell = parseZoneId(grid, zone);
  if (!cell) throw new Error('Invalid load-test zone');
  return `${cell.cx},${cell.cy}`;
}

export function walkToward<T extends { x: number; z: number }>(pose: T, target: { x: number; z: number }, elapsedMs: number): T {
  const dx = target.x - pose.x, dz = target.z - pose.z, distance = Math.hypot(dx, dz);
  const step = Math.min(distance, Math.max(0, Math.min(250, elapsedMs)) * 0.5); // 5 m/s in centimetres
  return distance ? { ...pose, x: Math.round(pose.x + dx / distance * step), z: Math.round(pose.z + dz / distance * step) } : pose;
}

/** Partial snapshots age out: an add-only set incorrectly reports a vanished neighbour as visible. */
export function updateVisibility(lastSeen: Map<number, number>, message: S2CMessage, now: number): void {
  if (message.type === 'SNAPSHOT') for (const entry of message.entries) lastSeen.set(entry.id, now);
  else if (message.type === 'PLAYER_LEAVE') lastSeen.delete(message.id);
  for (const [id, at] of lastSeen) if (now - at > 1500) lastSeen.delete(id);
}

export interface LoadAcceptance {
  bots: number; welcomed: number; expectedCrossers: number; completedHandoffs: number; observedCrossers: number;
  glitches: number; missingSamples: number; malformed: number; errors: number; rttSamples: number;
}
export function clientLoadPassed(s: LoadAcceptance): boolean {
  return s.welcomed === s.bots && s.expectedCrossers > 0 && s.completedHandoffs >= s.expectedCrossers
    && s.observedCrossers === s.expectedCrossers && s.glitches === 0 && s.missingSamples === 0
    && s.malformed === 0 && s.errors === 0 && s.rttSamples > 0;
}

/**
 * A handoff "glitch" is a remote player blinking out and back — present, then absent for a short
 * run, then present again — as seen in a viewer's per-tick presence stream for that id. A clean
 * handoff shows no such rejoin; the simple v1 handoff may show a brief one, which this counts.
 * `maxGapTicks` bounds how long an absence can be and still count as a blink (vs a real leave).
 */
export function countRejoinGlitches(presence: readonly boolean[], maxGapTicks = 10): number {
  let glitches = 0, i = 0;
  while (i < presence.length) {
    if (!presence[i]) { i++; continue; }
    // Find the next absence that starts after we've been present.
    let j = i + 1;
    while (j < presence.length && presence[j]) j++;
    if (j >= presence.length) break; // present to the end — no gap
    const gapStart = j;
    while (j < presence.length && !presence[j]) j++;
    const gapLen = j - gapStart;
    if (j < presence.length && gapLen <= maxGapTicks) glitches++; // reappeared within the window
    i = j;
  }
  return glitches;
}

/**
 * Mirror a client's set of CURRENTLY-visible remote ids as frames arrive, so the per-tick presence
 * stream fed to {@link countRejoinGlitches} reflects real visibility: a SNAPSHOT reveals the ids it
 * carries, and a PLAYER_LEAVE removes one. The leave-pruning is the point — without it a same-id
 * PLAYER_LEAVE→rejoin seam-flicker (exactly what seamless handoff must avoid, §16; and what a clean
 * handoff suppresses) would be invisible to the metric, since the id would stay "seen" forever. (A
 * peer silently ageing out of snapshots with no leave is a possible future refinement via per-id
 * staleness; the explicit leave flicker is the §13 acceptance signal.)
 */
export function applyVisibility(visible: Set<number>, msg: S2CMessage): void {
  if (msg.type === 'SNAPSHOT') for (const e of msg.entries) visible.add(e.id);
  else if (msg.type === 'PLAYER_LEAVE') visible.delete(msg.id);
}

/** Group any per-bot sample by its home zone id, for a per-zone metric breakdown. */
export function byZone<T>(plans: readonly BotPlan[], samples: readonly T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (let i = 0; i < plans.length && i < samples.length; i++) {
    const zone = plans[i]!.zone;
    (out.get(zone) ?? out.set(zone, []).get(zone)!).push(samples[i]!);
  }
  return out;
}
