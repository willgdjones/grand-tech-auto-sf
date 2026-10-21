/**
 * GTA V pivot — LANE B (combat & police): a tiny decoupled gunfire-alert bus. The fire system reports each
 * shot's origin here; pedestrians (web/src/render/streetWalkers.ts) read it to flee/cower, without the render
 * layer importing the combat runtime. Purely local/cosmetic — gunfire positions in world metres, kept ~2.5 s.
 */
const RECENT_MS = 2500;
const MAX_EVENTS = 24;
const events: { x: number; z: number; at: number }[] = [];
const IMPACT_FRESH_MS = 400;
const impacts: { x: number; z: number; at: number; melee?: boolean }[] = [];

/** Record a shot at a world position (metres). Called by the fire system on every shot. */
export function reportGunfire(x: number, z: number, now = performance.now()): void {
  events.push({ x, z, at: now });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

/**
 * The nearest recent gunfire within `within` metres of (x, z), or null. Used by peds to decide whether to
 * panic and which way to flee (away from the returned point).
 */
export function gunfireThreat(x: number, z: number, within: number, now = performance.now()): { x: number; z: number } | null {
  let best: { x: number; z: number } | null = null;
  let bestSq = within * within;
  for (const e of events) {
    if (now - e.at > RECENT_MS) continue;
    const dx = e.x - x, dz = e.z - z, d = dx * dx + dz * dz;
    if (d <= bestSq) { bestSq = d; best = { x: e.x, z: e.z }; }
  }
  return best;
}

/**
 * Record a shot's impact point (world metres). The fire system reports where the aim ray lands; peds read this
 * (consumeImpacts) to crumple when a shot lands on them (ragdoll-lite). Separate from gunfire — a gunshot makes
 * the crowd flee, an impact ON a ped wastes that one ped.
 */
export function reportImpact(x: number, z: number, now = performance.now(), melee = false): void {
  impacts.push({ x, z, at: now, melee });
  if (impacts.length > MAX_EVENTS) impacts.splice(0, impacts.length - MAX_EVENTS);
}

/** Return and clear the still-fresh impacts (consume-once, so one shot wastes at most the peds near it once). */
export function consumeImpacts(now = performance.now()): { x: number; z: number; melee: boolean }[] {
  const fresh = impacts.filter(e => now - e.at <= IMPACT_FRESH_MS).map(e => ({ x: e.x, z: e.z, melee: e.melee === true }));
  impacts.length = 0;
  return fresh;
}

/**
 * The local player's car (world metres + speed in m/s), set each frame while driving and null on foot. Peds read
 * it to get knocked down when the car runs into them (flag streetCrimeWanted).
 */
let vehicle: { x: number; z: number; speed: number } | null = null;
export function reportVehicle(next: { x: number; z: number; speed: number } | null): void { vehicle = next; }
export function localVehicle(): { x: number; z: number; speed: number } | null { return vehicle; }

/** A crime the LOCAL player committed that the server can't see (the COMBAT_CRIME kind): 0 shot a ped, 1 ran one
 *  over, 2 rammed a police car. */
export type PedWastedCause = 0 | 1 | 2 | 3; // 3 = knocked out with fists/bat (pedMelee)
let pedWasted: ((cause: PedWastedCause) => void) | undefined;
/** Subscribe to peds the local player wastes (main.ts confesses them to the server for the wanted level). */
export function onPedWasted(listener: ((cause: PedWastedCause) => void) | undefined): void { pedWasted = listener; }
/** Called by the ped renderer when the local player's shot or car wastes a ped. */
export function reportPedWasted(cause: PedWastedCause): void { pedWasted?.(cause); }

let pedPunch: (() => void) | undefined;
/** Subscribe to swings that a ped who fought back landed on the local player (pedMelee; main.ts tells the server). */
export function onPedPunch(listener: (() => void) | undefined): void { pedPunch = listener; }
/** Called by the ped renderer when a fighting ped's swing connects. */
export function reportPedPunch(): void { pedPunch?.(); }

/** Test/teardown helper. */
export function clearGunfire(): void {
  events.length = 0;
  impacts.length = 0;
  vehicle = null;
}
