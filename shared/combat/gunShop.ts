/**
 * GTA V pivot — LANE B (combat & police): the gun shop (flag gunShop). A parody of GTA's Ammu-Nation as an
 * SF-VC storefront. Prices are integer cents (bigint) and SCALE WITH STAGE (founder: "gun prices scale with
 * stage") — a higher-valuation founder pays more, so a gun stays a meaningful cost as valuation grows. Pure,
 * shared by the client shop preview and the server-authoritative purchase (worker/src/combat/shop.ts).
 */
import { WEAPONS, type WeaponId } from './weapons';
import { fundingRound, type FundingRound } from '../funding';
import { STORE_ROBBERIES } from './storeRobbery';

/** Parody storefront name: "lead" investor / "lead" (bullets). */
export const GUN_SHOP_NAME = 'Lead Capital';
export const GUN_SHOP_TAGLINE = 'Arms & ammo for the growth-stage founder.';

/** Highest fundable stage (ECON_V3_ROUNDS: 0 bootstrapping … 5 decacorn). */
const MAX_STARS = 5;

/**
 * Price of a weapon at a given stage (the funding round's `stars`, 0–5). Base price × (stage + 1): roughly
 * doubles from bootstrapping to pre-seed and keeps climbing. Melee (base 0) is never sold (price 0).
 */
export function gunPriceCents(weapon: WeaponId, stars: number): bigint {
  const base = WEAPONS[weapon].basePriceCents;
  if (base <= 0) return 0n;
  const stage = Math.max(0, Math.min(MAX_STARS, Math.floor(Number.isFinite(stars) ? stars : 0)));
  return BigInt(base) * BigInt(stage + 1);
}

/** Body armour at the gun shop (vitalsPickups): a full vest, priced like the guns — base × (stage + 1). */
export const ARMOUR_BASE_PRICE_CENTS = 250_000; // $2,500 at stage 0
export function armourPriceCents(stars: number): bigint {
  const stage = Math.max(0, Math.min(MAX_STARS, Math.floor(Number.isFinite(stars) ? stars : 0)));
  return BigInt(ARMOUR_BASE_PRICE_CENTS) * BigInt(stage + 1);
}

/** Whether a weapon is sold at the shop (melee/starter weapons are not). */
export function isForSale(weapon: WeaponId): boolean {
  return WEAPONS[weapon].basePriceCents > 0;
}

/** The weapons the shop sells, in wheel order. */
export function shopWeapons(): WeaponId[] {
  return (Object.keys(WEAPONS) as WeaponId[]).filter(isForSale);
}

/**
 * The lower funding round a purchase would drop the player to, or null when they stay in their round. A purchase that
 * DOWN-ROUNDs needs an explicit confirm (QA gtasf-euhs0: one SMG click took a fresh Seed founder back to Bootstrapping).
 */
export function downRoundAfter(currentCents: bigint, priceCents: bigint): FundingRound | null {
  const before = fundingRound(currentCents < 0n ? 0n : currentCents);
  const after = fundingRound(currentCents - priceCents < 0n ? 0n : currentCents - priceCents);
  return BigInt(after.thresholdCents) < BigInt(before.thresholdCents) ? after : null;
}

/** Body armour is sold over the counter at the corner stores (the radar's $ pins), within this many metres. */
export const ARMOUR_COUNTER_RADIUS_M = 25;
/** Is a player (world metres) at a store counter that sells armour? `project` maps lat/lon to world metres. */
export function atArmourCounter(xM: number, zM: number, project: (lat: number, lon: number) => { x: number; z: number }): boolean {
  return STORE_ROBBERIES.some(store => { const p = project(store.lat, store.lon); return Math.hypot(p.x - xM, p.z - zM) <= ARMOUR_COUNTER_RADIUS_M; });
}

/**
 * Orchestrator (QA gtasf-euhs0): no shop item costs more than SHOP_PRICE_SHARE of the buyer's CURRENT valuation, so a
 * purchase is never ruinous; the stage price applies below that cap, with a SHOP_MIN_PRICE_CENTS floor (a broke
 * founder doesn't get free guns — they just can't afford one yet).
 */
export const SHOP_PRICE_SHARE_PCT = 10n;
export const SHOP_MIN_PRICE_CENTS = 50_000n; // $500
export function cappedShopPrice(stagePriceCents: bigint, currentCents: bigint): bigint {
  if (stagePriceCents <= 0n) return stagePriceCents;
  const cap = (currentCents > 0n ? currentCents : 0n) * SHOP_PRICE_SHARE_PCT / 100n;
  const floor = stagePriceCents < SHOP_MIN_PRICE_CENTS ? stagePriceCents : SHOP_MIN_PRICE_CENTS;
  return cap < stagePriceCents ? (cap > floor ? cap : floor) : stagePriceCents;
}
