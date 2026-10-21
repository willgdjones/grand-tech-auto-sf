import { tierForRound } from './cosmetics';
import type { FundingRound } from '../funding';

/**
 * Personal micro-mobility rides (PLAN-v2.1 decision 1): pulled out anywhere, ridden at ~2x the 8 m/s
 * sprint, unlocked by funding stage. The stage gate is driven ENTIRELY by pane 7's cosmetics tiers
 * (tierForRound(round).index), so the cosmetics contract stays the single source of truth for unlocks —
 * this module only maps a tier index to the ride it grants and the speed it travels.
 *
 * COSMETIC/MOVEMENT ONLY: reads the funding round to pick the tier; never mutates funding.
 */
/**
 * Pose-flag bit signalling the player is on a personal ride, so remotes can render their ride mesh
 * (gtasf-v21-personal-rides remote visibility). Bit 1 — within the server's 0x3f MOVE mask (so it
 * survives + is broadcast with no server change) and clear of DRIVER_FLAG 0x40 / PASSENGER_FLAG 0x80.
 */
export const RIDING_POSE_FLAG = 0x02;

export interface PersonalRide {
  readonly id: 'scooter' | 'skateboard' | 'ebike' | 'onewheel' | 'segway';
  readonly label: string;
  /** Ground speed in m/s — roughly 2x the on-foot sprint (8 m/s); a gentle progression per tier. */
  readonly speedMps: number;
  /** Cosmetics LookTier index (0..5) at which this ride unlocks; 0 = from the start (Bootstrapping). */
  readonly tierIndex: number;
}

/** Order is stable and ascending by tier; scooter is granted from the start. Append, never reorder. */
export const PERSONAL_RIDES: readonly PersonalRide[] = Object.freeze([
  { id: 'scooter', label: 'Scooter', speedMps: 14, tierIndex: 0 },          // ★0 Bootstrapping — from the start
  { id: 'skateboard', label: 'Skateboard', speedMps: 15, tierIndex: 1 },    // v3 ★1 Seed (v2 Pre-seed)
  { id: 'ebike', label: 'E-bike', speedMps: 16, tierIndex: 2 },             // v3 ★2 Series A (v2 Series A)
  { id: 'onewheel', label: 'Onewheel', speedMps: 17, tierIndex: 3 },        // v3 ★3 Series B (v2 Series D)
  { id: 'segway', label: 'Segway (parody)', speedMps: 17, tierIndex: 4 },   // v3 ★4 Series C (v2 Unicorn)
] as const);

/** Rides unlocked at a funding round (tier-gated), slowest first. Always includes the scooter. */
export function unlockedRides(round: Pick<FundingRound, 'id'>): PersonalRide[] {
  const tier = tierForRound(round).index;
  return PERSONAL_RIDES.filter(ride => ride.tierIndex <= tier);
}

/** The fastest ride the player can pull out at their round (never null — scooter is always granted). */
export function fastestUnlockedRide(round: Pick<FundingRound, 'id'>): PersonalRide {
  const rides = unlockedRides(round);
  return rides[rides.length - 1] ?? PERSONAL_RIDES[0]!;
}

/** A locked ride advertises the tier index a player must reach; the UI resolves the stage label. */
export function rideUnlocked(ride: PersonalRide, round: Pick<FundingRound, 'id'>): boolean {
  return tierForRound(round).index >= ride.tierIndex;
}

/**
 * Server MOVE speed cap (m/s) for a player's round: the fastest ride they could legitimately be on,
 * plus anti-cheat slack, floored at the on-foot cap. The caller supplies the server-known funding
 * round and applies this only to MOVE frames carrying RIDING_POSE_FLAG; walking keeps its own cap.
 */
export function rideSpeedCapMps(round: Pick<FundingRound, 'id'>, onFootCapMps: number): number {
  return Math.max(onFootCapMps, Math.ceil(fastestUnlockedRide(round).speedMps * 1.35));
}
