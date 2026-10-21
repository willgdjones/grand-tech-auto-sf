/**
 * GTA V pivot — LANE B (combat & police): the valuation cost of dying.
 *
 * Single currency = valuation (economy v3 `economy_v3_current_cents`). Founder (2026-10-13):
 *   - WASTED (killed): −2% of current valuation, with a minimum penalty of $1,000; respawn at SF General.
 *   - BUSTED (arrested): −5% of current valuation.
 *   - PvP takes nothing beyond the death cost.
 *
 * Pure integer-cents math (bigint), shared by the server debit (worker/src/funding/penalty.ts — the
 * authoritative money path), the client HUD's optimistic preview, and the unit tests. Money is never a
 * float here; every value is cents as bigint. A cost is always clamped to the player's current balance so
 * valuation can never go negative.
 *
 * NOTE on the wasted floor vs. busted (for the founder): below ~$50k valuation the wasted $1,000 floor can
 * exceed busted's 5% (e.g. at $10k: wasted $1,000 > busted $500). That is the spec as written (the floor
 * keeps death stinging in the early game); if the founder wants "busted always ≥ wasted", add a busted
 * floor here. [gtasf-combat-gate-health-economy-8cqg]
 */

export type DeathKind = 'wasted' | 'busted';

/** WASTED: −2% of current valuation. */
export const WASTED_COST_PCT = 2n;
/** WASTED: never less than $1,000 (100,000 cents), unless the player has less than that. */
export const WASTED_COST_FLOOR_CENTS = 100_000n;
/** BUSTED: −5% of current valuation. */
export const BUSTED_COST_PCT = 5n;
/**
 * Risk/reward rebalance (flag riskReward, critique #12, orchestrator-decided 2026-10-15): crime should pay more than
 * the hospital. WASTED is capped at $1,000, which with the $1,000 floor makes it a flat $1,000 bill (clamped to the
 * balance); BUSTED is capped at $2,500. Callers pass `rebalance = flags.riskReward` so these stay pure.
 */
export const WASTED_COST_CAP_CENTS = 100_000n;
export const BUSTED_COST_CAP_CENTS = 250_000n;

/** The valuation lost on being WASTED: max(2% of current, $1,000), clamped to current (never negative). */
export function wastedCostCents(currentCents: bigint, rebalance = false): bigint {
  if (currentCents <= 0n) return 0n;
  const pct = (currentCents * WASTED_COST_PCT) / 100n;
  let cost = pct > WASTED_COST_FLOOR_CENTS ? pct : WASTED_COST_FLOOR_CENTS;
  if (rebalance && cost > WASTED_COST_CAP_CENTS) cost = WASTED_COST_CAP_CENTS;
  return cost > currentCents ? currentCents : cost;
}

/** The valuation lost on being BUSTED: 5% of current, clamped to current (never negative). */
export function bustedCostCents(currentCents: bigint, rebalance = false): bigint {
  if (currentCents <= 0n) return 0n;
  let cost = (currentCents * BUSTED_COST_PCT) / 100n;
  if (rebalance && cost > BUSTED_COST_CAP_CENTS) cost = BUSTED_COST_CAP_CENTS;
  return cost > currentCents ? currentCents : cost;
}

/** Dispatch by kind. */
export function deathCostCents(kind: DeathKind, currentCents: bigint, rebalance = false): bigint {
  return kind === 'busted' ? bustedCostCents(currentCents, rebalance) : wastedCostCents(currentCents, rebalance);
}

/**
 * Respawn point after being WASTED: Zuckerberg San Francisco General Hospital (1001 Potrero Ave).
 * Busted also respawns here for v1 (outside a holding cell). The server returns this; the client snaps it
 * to walkable road/sidewalk via the existing respawn path. Metres-of-SF geodesy lives in the client/worker
 * projection; this is the lat/lon anchor.
 */
export const SF_GENERAL_RESPAWN = { lat: 37.7554, lon: -122.4040, heading: 0 } as const;

/** Full health and armour (hit points). Shared so the HUD and server agree on the scale. */
export const MAX_HEALTH = 100;
export const MAX_ARMOUR = 100;
