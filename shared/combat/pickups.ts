/**
 * GTA V pivot — LANE B (combat): health + armour pickups (flag vitalsPickups).
 *
 * Pure, shared, SERVER-authoritative. A few world spots (next to the already walkable-verified weapon-pickup / store
 * coordinates) hold a health or armour pickup. Walking into one tops the player up (server-applied — health and armour
 * are server-owned); it then respawns after PICKUP_RESPAWN_MS. A player who is already full doesn't consume it.
 */
import { MAX_ARMOUR, MAX_HEALTH } from './economy';

export type PickupKind = 'health' | 'armour';
export interface PickupSpot { kind: PickupKind; lat: number; lon: number }

/** Order is the wire index (S2C PICKUP_STATE). Append only. */
export const PICKUP_SPOTS: readonly PickupSpot[] = Object.freeze([
  { kind: 'health', lat: 37.795830, lon: -122.394780 },  // Ferry plaza (by the bat pickup)
  { kind: 'armour', lat: 37.796850, lon: -122.398300 },  // Embarcadero Corner Market
  { kind: 'health', lat: 37.800900, lon: -122.405590 },  // Columbus corridor (by the SMG pickup)
  { kind: 'armour', lat: 37.802310, lon: -122.417250 },  // Lombard hills (by the rifle pickup)
]);

export const PICKUP_RADIUS_M = 1.8;
export const PICKUP_RESPAWN_MS = 60_000;
export const PICKUP_AMOUNT: Readonly<Record<PickupKind, number>> = Object.freeze({ health: 50, armour: 50 });

/** Vitals after taking a pickup, or null when it would give nothing (already full — it stays for someone else). */
export function applyPickup(kind: PickupKind, health: number, armour: number): { health: number; armour: number } | null {
  if (kind === 'health') return health >= MAX_HEALTH ? null : { health: Math.min(MAX_HEALTH, health + PICKUP_AMOUNT.health), armour };
  return armour >= MAX_ARMOUR ? null : { health, armour: Math.min(MAX_ARMOUR, armour + PICKUP_AMOUNT.armour) };
}

/** Split incoming damage between armour (absorbed first) and health. */
export function absorbDamage(health: number, armour: number, amount: number): { health: number; armour: number } {
  const dmg = Math.max(0, Math.round(amount));
  const toArmour = Math.min(Math.max(0, armour), dmg);
  return { armour: armour - toArmour, health: Math.max(0, health - (dmg - toArmour)) };
}
