/**
 * GTA V pivot — LANE B (combat & police): store robberies (flag storeRobberies). A few fixed SF corner stores /
 * boba shops the player can hold up: stand inside, hold the rob, and the SERVER pays a modest valuation credit
 * (once per store per day — the funding_credits UNIQUE(source,ref) enforces it) and the SFPD get a 2-star wanted.
 *
 * Pure data + helpers; the valuation credit mirrors the mission payout (shared/founder/missions.ts) so it rides
 * the same reviewed award path. The payout is small and daily-capped per store to keep the money path safe.
 */
import { fundingDay, type FundingSource } from '@gtasf/shared/funding';

export interface StoreSpec {
  id: string;
  name: string;
  lat: number;
  lon: number;
}

/** Hold-to-rob duration (ms) the client enforces before it POSTs the robbery. */
export const ROBBERY_HOLD_MS = 2500;
/** The player must be within this many metres of the store to rob it (client + server check). */
export const ROBBERY_RADIUS_M = 6;
/** Wanted level a robbery instantly triggers (store-robbery crime heat = 2 stars). */
export const ROBBERY_STARS = 2;
/** Flat valuation payout per robbery (integer cents). Modest + daily-capped per store ⇒ bounded income. */
export const ROBBERY_PAYOUT_CENTS = 75_000n; // $750

/** Corner stores / boba shops along the playable Ferry→Lombard corridor. Coords are approximate (walkable-verify). */
export const STORE_ROBBERIES: readonly StoreSpec[] = Object.freeze([
  { id: 'embarcadero-market', name: 'Embarcadero Corner Market', lat: 37.796823, lon: -122.398323 },
  { id: 'columbus-boba', name: 'Columbus Ave Boba House', lat: 37.799516, lon: -122.407372 },
  { id: 'north-beach-deli', name: 'North Beach Deli & Liquor', lat: 37.800384, lon: -122.409797 },
  { id: 'russian-hill-grocery', name: 'Russian Hill Grocery', lat: 37.801644, lon: -122.418489 },
]);

export function storeById(id: string): StoreSpec | undefined {
  return STORE_ROBBERIES.find(store => store.id === id);
}

/** Risk/reward rebalance (flag riskReward, critique #12): a robbery pays this share of current valuation, min $750. */
export const ROBBERY_PAYOUT_PCT = 1n;
/** …but never more than $5,000 per robbery (review RR-H1): 1% of valuation × 4 stores/day with flat-capped bust/wasted
 *  risk was a compounding ~4%/day wealth engine. Max $20k/day per device; a Seed robber still nets positive EV. */
export const ROBBERY_PAYOUT_MAX_CENTS = 500_000n;
/**
 * Payout for one robbery (integer cents). Flat $750; with `rebalance` (flags.riskReward) it is max($750, min(1% of the
 * robber's CURRENT valuation, $5,000)) so crime outpays the capped bust/wasted costs without becoming a wealth engine.
 */
export function robberyPayoutCents(_store: StoreSpec, currentCents: bigint | null = null, rebalance = false): bigint {
  if (!rebalance || currentCents === null || currentCents <= 0n) return ROBBERY_PAYOUT_CENTS;
  const pct = currentCents * ROBBERY_PAYOUT_PCT / 100n, share = pct < ROBBERY_PAYOUT_MAX_CENTS ? pct : ROBBERY_PAYOUT_MAX_CENTS;
  return share > ROBBERY_PAYOUT_CENTS ? share : ROBBERY_PAYOUT_CENTS;
}

/** Valuation-credit identity for a robbery: once per store per day (the credits UNIQUE(source,ref) is the cap). */
export function robberyCredit(store: StoreSpec, now: number): { source: FundingSource; sourceRef: string } {
  return { source: 'celebrity', sourceRef: `robbery:${store.id}:${fundingDay(now)}` };
}

/**
 * review fix 1: a robbery may only pay when combat + storeRobberies + wanted are ALL on — never a payout without
 * the 2-star police response. The server handler gates on this (plus a funding binding) before touching the ledger.
 */
export function robberyPayoutAllowed(flags: { combat: boolean; storeRobberies: boolean; wanted: boolean }): boolean {
  return flags.combat && flags.storeRobberies && flags.wanted;
}

/**
 * review fix 2: a robbery completes only after a server-enforced hold (>= holdMs since rob-start) AND the player
 * is STILL inside the store at complete. The client's hold ring is cosmetic; this is the authoritative gate.
 */
export function robberyCompleteStatus(startMs: number, now: number, inStore: boolean, holdMs = ROBBERY_HOLD_MS): 'too-soon' | 'too-far' | 'ready' {
  if (now - startMs < holdMs) return 'too-soon';
  if (!inStore) return 'too-far';
  return 'ready';
}
