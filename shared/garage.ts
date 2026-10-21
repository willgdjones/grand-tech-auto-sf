/**
 * Garage phase 1 (flag garageSlots, critique 20e, docs/PLAN-garage.md): how many saved-car slots a funding round gives, and
 * the car each funding tier gifts. Pure; the server derives slots from the round it trusts (reviewer condition 4).
 */
import type { FundingRound } from './funding';
import type { VehicleKind } from './protocol/types';
import { tierForRound } from './content/cosmetics';

/** Slot 0 is today's personal car (auto-saved on leaving a car); each look tier adds one slot, capped. */
export const GARAGE_MAX_SLOTS = 4;
export function garageSlotsForRound(round: Pick<FundingRound, 'id'>): number {
  return Math.min(GARAGE_MAX_SLOTS, 1 + tierForRound(round).index);
}

/** The road car a tier gives (LOOK_TIERS[n].car mapped to a fleet kind). Tier 0 (Bootstrapping, a scooter) gives none. */
export const GARAGE_GIFT_KIND: Readonly<Record<number, VehicleKind>> = Object.freeze({
  1: 'prius',    // Seed: commuter
  2: 'tesla',    // Series A
  3: 'subaru',   // Series D: sports
  4: 'supercar', // Unicorn
  5: 'supercar', // Decacorn
});
