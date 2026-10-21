/**
 * Shared-billboard slot assignment (docs/PLAN-founder-ladder.md, founder 2026-10-12 round 2:
 * "Billboards are SHARED — everyone's startups appear on billboards around the city in rotating slots").
 *
 * Server-authoritative WITHOUT a new endpoint: the startup list is the funding leaderboard (already
 * server-owned), and the slot→startup assignment is a PURE function of (slot id, time) over that list —
 * the same pattern the roaming angels use (shared/content/angels.ts), so every client and the worker
 * compute the identical rotation from the same leaderboard snapshot with no extra protocol. Pure and
 * serializable, so the rotation maths is unit-tested without the DOM or three.js.
 */

/** A startup that can appear on a city billboard (a projection of a funding leaderboard entry). */
export interface BillboardStartup {
  /** Stable identity (the leaderboard's deviceId) so a startup keeps its slot cadence as names change. */
  readonly id: string;
  readonly startupName: string;
  /** Funding round label (e.g. "Seed"), shown small under the name. */
  readonly stageLabel?: string;
  /** Billboard-tier rank reached (0..4, shared/founder/ladder.ts BILLBOARD_TIER_RANK). A startup appears on
   *  a surface only when its rank meets the surface's minimum; defaults to 0 (the local Embarcadero tier). */
  readonly tierRank?: number;
}

/** A billboard surface to fill. `minRank` is the surface district's minimum tier rank
 *  (shared/content/billboards.ts DISTRICT_BILLBOARD_RANK); a bare slot-id string means rank 0 (any stage). */
export interface BillboardSlot {
  readonly id: string;
  readonly minRank?: number;
}

/** How long a startup holds a given slot before the rotation advances (founder: like the 20-min angels). */
export const BILLBOARD_ROTATION_MS = 20 * 60_000;

/** FNV-1a so a slot id maps to a stable base offset into the startup list. */
function hash(seed: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  return h >>> 0;
}

/**
 * The startup shown on `slotId` at time `nowMs`, or null when there are no startups. Deterministic:
 * the slot's base offset (hash of its id) plus the time epoch, modulo the list length, so neighbouring
 * slots show different startups and every slot advances one startup each rotation period.
 */
export function startupForSlot(
  slot: string | BillboardSlot,
  startups: readonly BillboardStartup[],
  nowMs: number,
  periodMs: number = BILLBOARD_ROTATION_MS,
): BillboardStartup | null {
  if (startups.length === 0) return null;
  const slotId = typeof slot === 'string' ? slot : slot.id;
  const minRank = typeof slot === 'string' ? 0 : (slot.minRank ?? 0);
  // Prefer startups that have earned this surface's tier (rank >= minRank); fall back to the full list so a
  // prominent board is never blank while the city is still mostly early-stage — the upgrade emerges as more
  // startups climb the ladder (Seed unlocks Market St, Series A the Bay Bridge, …).
  const eligible = minRank > 0 ? startups.filter(s => (s.tierRank ?? 0) >= minRank) : startups;
  const pool = eligible.length > 0 ? eligible : startups;
  const period = periodMs > 0 ? periodMs : BILLBOARD_ROTATION_MS;
  const epoch = Math.floor(Math.max(0, nowMs) / period);
  const index = (hash(slotId) + epoch) % pool.length;
  return pool[index]!;
}

/** Assign a batch of slots at once (a Map keyed by slot id); slots with no startup are omitted. Slots may be
 *  bare ids (rank 0) or {id, minRank} to tier-gate prominent surfaces (DISTRICT_BILLBOARD_RANK). */
export function assignBillboardSlots(
  slots: readonly (string | BillboardSlot)[],
  startups: readonly BillboardStartup[],
  nowMs: number,
  periodMs: number = BILLBOARD_ROTATION_MS,
): Map<string, BillboardStartup> {
  const out = new Map<string, BillboardStartup>();
  for (const slot of slots) {
    const startup = startupForSlot(slot, startups, nowMs, periodMs);
    if (startup) out.set(typeof slot === 'string' ? slot : slot.id, startup);
  }
  return out;
}
