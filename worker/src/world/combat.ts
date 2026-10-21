/**
 * GTA V pivot — LANE B (combat & police): server-authoritative hit validation (flag serverHits,
 * gtasf-combat-server-hits-jilc). The template is worker/src/world/mayhem.ts (validate + rate-limit +
 * relay), but hits must be AUTHORITATIVE: the server owns health and resolves who was hit from its own
 * poses, never trusting a client-claimed target or position.
 *
 * WorldDO feeds `fire()` the shooter's authoritative pose (cm) + the client's weapon/aim, plus the current
 * target poses (peers + NPCs, metres). It returns what to broadcast (COMBAT_HIT) and the damage/death the
 * caller then applies (the valuation cost + respawn live in WorldDO, which has D1 + the peer set). Pure,
 * deterministic, unit-tested; no WorldDO/Durable-Object state here beyond the rate + health maps.
 */
import { MAX_ARMOUR, MAX_HEALTH } from '@gtasf/shared/combat/economy';
import { canFire, WEAPON_ORDER, WEAPONS } from '@gtasf/shared/combat/weapons';
import { absorbDamage } from '@gtasf/shared/combat/pickups';
import { regenHealth } from '@gtasf/shared/combat/regen';
import { lineOfSight } from '@gtasf/shared/combat/rayVsWorld';
import { terrainLos } from './combatCollision';
import type { MapCollision } from '@gtasf/shared/mapCollision';

/** Radius (metres) of a target's hit sphere, centred at its chest. */
export const HIT_RADIUS_M = 0.6;
/** Metres above a pose's ground position to treat as the chest (shooter muzzle + target centre). */
export const CHEST_M = 1.4;

export interface CombatPoseCm { x: number; y: number; z: number } // centimetres (authoritative pose)
export interface CombatTarget { id: number; x: number; y: number; z: number } // metres (chest height already applied, or ground+CHEST_M)
export interface CombatFireInput { weapon: number; dir: readonly [number, number, number] }

export interface CombatFireResult {
  origin: [number, number, number];
  to: [number, number, number];
  /** The entity hit, or 0 for a miss / pure tracer. */
  targetId: number;
  damage: number;
  killed: boolean;
  /** The target's remaining health after the hit (0 when missed). */
  health: number;
}

export interface CombatFireOptions {
  /** Building collision for line-of-sight; when omitted, LoS against buildings is skipped (arcade v1). */
  collision?: MapCollision | null;
  heightAt?: (x: number, z: number) => number | null;
}

function finite3(v: readonly [number, number, number]): boolean {
  return Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
}

/**
 * A peer the server can turn into a PvP target: id + authoritative pose in centimetres, plus whether they have
 * opted into combat. `combatActive` is set once the client sends COMBAT_READY (18+ gate accepted / combat live);
 * a player who has not confirmed is never a valid target.
 */
export interface PvpPeer { id: number; pose: { x: number; y: number; z: number }; combatActive?: boolean }

/**
 * Build the candidate PvP targets (metres, chest height) from the live peers, excluding the shooter and any peer
 * who has NOT opted into combat (unconfirmed players are not valid targets — they are unarmed with combat hidden).
 * Returns an empty list when open PvP is disabled, so enabling serverHits alone can't harm other players — PvP is
 * its own opt-in (flag openPvp). Pure + unit-tested; WorldDO.handleCombatFire passes flags.openPvp as `enabled`.
 */
export function pvpTargets(peers: Iterable<PvpPeer>, shooterId: number, enabled: boolean): CombatTarget[] {
  if (!enabled) return [];
  const out: CombatTarget[] = [];
  for (const p of peers) {
    if (p.id === shooterId) continue;
    if (!p.combatActive) continue; // only players who confirmed 18+/combat are valid PvP targets
    out.push({ id: p.id, x: p.pose.x / 100, y: p.pose.y / 100 + CHEST_M, z: p.pose.z / 100 });
  }
  return out;
}

/** Invulnerability window after a respawn/join (ms), so a griefer can't chain-kill someone at SF General. */
export const SPAWN_PROTECTION_MS = 3000;

export class WorldCombat {
  private readonly lastFire = new Map<number, number>();
  private readonly health = new Map<number, number>();
  private readonly lastHurt = new Map<number, number>(); // healthRegen: when damage last landed
  private readonly regenCarry = new Map<number, number>(); // healthRegen: fractional HP not yet applied
  private readonly armour = new Map<number, number>(); // server-owned armour (vitalsPickups); absorbs damage first
  private readonly protectedUntil = new Map<number, number>();

  /** When this player last fired an accepted shot (ms), or -Infinity — busts treat a recent shooter as resisting. */
  lastFireOf(id: number): number { return this.lastFire.get(id) ?? -Infinity; }

  /** Current health for an id (MAX_HEALTH until damaged). */
  healthOf(id: number): number {
    return this.health.get(id) ?? MAX_HEALTH;
  }

  /** Is a player currently spawn-protected (invulnerable) at `now`? */
  /** gtasf-7p7oi: a wanted player reconnecting mid-pursuit gets no spawn protection. */
  clearProtection(id: number): void { this.protectedUntil.delete(id); }
  isProtected(id: number, now: number): boolean {
    return now < (this.protectedUntil.get(id) ?? 0);
  }

  /** Current armour for an id (0 until granted by a pickup / purchase). */
  armourOf(id: number): number {
    return this.armour.get(id) ?? 0;
  }

  /** Set health + armour together (pickups, purchases), clamped. */
  setVitals(id: number, health: number, armour: number): void {
    this.health.set(id, Math.max(0, Math.min(MAX_HEALTH, Math.round(health))));
    this.armour.set(id, Math.max(0, Math.min(MAX_ARMOUR, Math.round(armour))));
  }

  /** Full health (join / respawn), with a spawn-protection window from `now`. Armour is lost on death. */
  reset(id: number, now = 0): void {
    this.health.set(id, MAX_HEALTH);
    this.armour.delete(id);
    if (now > 0) this.protectedUntil.set(id, now + SPAWN_PROTECTION_MS);
  }

  /** Set a specific health (review fix 4: restore stashed health across a reconnect). Clamped to [0, MAX_HEALTH]. */
  setHealth(id: number, health: number): void {
    this.health.set(id, Math.max(0, Math.min(MAX_HEALTH, Math.round(health))));
  }

  /** Apply non-player damage (SFPD return fire): null when the target is already dead or spawn-protected. */
  damage(id: number, amount: number, now: number): { remaining: number; killed: boolean } | null {
    if (this.healthOf(id) <= 0 || this.isProtected(id, now)) return null;
    const remaining = this.absorb(id, amount, now);
    return { remaining, killed: remaining <= 0 };
  }

  /** Apply damage through armour first (absorbDamage); returns the remaining health. */
  private absorb(id: number, amount: number, now = 0): number {
    this.lastHurt.set(id, now); this.regenCarry.delete(id); // healthRegen waits REGEN_DELAY_MS after any damage
    const next = absorbDamage(this.healthOf(id), this.armourOf(id), amount);
    this.health.set(id, next.health);
    if (next.armour > 0) this.armour.set(id, next.armour); else this.armour.delete(id);
    return next.health;
  }

  /** healthRegen: advance regeneration for every hurt player; returns the ids whose WHOLE health changed (to sync). */
  regenerate(now: number, dtMs: number): number[] {
    const changed: number[] = [];
    for (const [id, health] of this.health) {
      // Health stays an integer; the fractional regen accumulates in regenCarry.
      const carry = this.regenCarry.get(id) ?? 0;
      const next = regenHealth(health + carry, now - (this.lastHurt.get(id) ?? -Infinity), dtMs);
      if (next === health + carry) continue;
      const whole = Math.floor(next);
      this.regenCarry.set(id, next - whole);
      if (whole !== health) { this.health.set(id, whole); changed.push(id); }
    }
    return changed;
  }

  /** healthRegen (review HR-L1): treat a restore (reconnect with stashed wounds) as fresh damage, so regen still
   *  waits REGEN_DELAY_MS instead of starting the moment the player rejoins. */
  markHurt(id: number, now: number): void { this.lastHurt.set(id, now); this.regenCarry.delete(id); }

  /** Drop all state for a disconnected player. */
  forget(id: number): void {
    this.lastHurt.delete(id); this.regenCarry.delete(id);
    this.lastFire.delete(id);
    this.health.delete(id);
    this.armour.delete(id);
    this.protectedUntil.delete(id);
  }

  /**
   * Validate and resolve a shot. Returns the broadcast/damage result, or null when the shot is rejected
   * (bad weapon, bad direction, or firing faster than the weapon allows). `targets` are candidate victims
   * in metres at chest height; the shooter is excluded by id.
   */
  fire(shooterId: number, shooterPoseCm: CombatPoseCm, input: CombatFireInput, targets: readonly CombatTarget[], now: number, options: CombatFireOptions = {}): CombatFireResult | null {
    const spec = WEAPONS[WEAPON_ORDER[input.weapon] ?? 'fists'];
    if (!WEAPON_ORDER[input.weapon]) return null;
    if (!finite3(input.dir)) return null;
    if (!canFire(spec, this.lastFire.get(shooterId) ?? -Infinity, now)) return null;

    // Normalise the aim direction (reject a zero vector).
    const len = Math.hypot(input.dir[0], input.dir[1], input.dir[2]);
    if (len < 1e-6) return null;
    const dir: [number, number, number] = [input.dir[0] / len, input.dir[1] / len, input.dir[2] / len];
    const origin: [number, number, number] = [shooterPoseCm.x / 100, shooterPoseCm.y / 100 + CHEST_M, shooterPoseCm.z / 100];

    this.lastFire.set(shooterId, now); // the rate gate counts every accepted trigger, hit or miss

    // Nearest target whose hit sphere the ray crosses, within range, in front of the shooter, with LoS.
    let best: { target: CombatTarget; distance: number } | null = null;
    for (const t of targets) {
      if (t.id === shooterId) continue;
      if (this.healthOf(t.id) <= 0) continue;        // already dead (awaiting respawn) — not a valid target: no double kill/debit
      if (this.isProtected(t.id, now)) continue;     // spawn-protected (invulnerable after respawn/join)
      const vx = t.x - origin[0], vy = t.y - origin[1], vz = t.z - origin[2];
      const along = vx * dir[0] + vy * dir[1] + vz * dir[2]; // projection onto the ray
      if (along < 0 || along > spec.rangeM) continue;
      const cx = origin[0] + dir[0] * along, cy = origin[1] + dir[1] * along, cz = origin[2] + dir[2] * along;
      const perp = Math.hypot(t.x - cx, t.y - cy, t.z - cz);
      if (perp > HIT_RADIUS_M) continue;
      if (options.collision !== undefined && !lineOfSight(origin, [t.x, t.y, t.z], options.collision, terrainLos(options.heightAt, origin, [t.x, t.y, t.z]))) continue;
      if (!best || along < best.distance) best = { target: t, distance: along };
    }

    if (!best) {
      const end: [number, number, number] = [origin[0] + dir[0] * spec.rangeM, origin[1] + dir[1] * spec.rangeM, origin[2] + dir[2] * spec.rangeM];
      return { origin, to: end, targetId: 0, damage: 0, killed: false, health: 0 };
    }

    const remaining = this.absorb(best.target.id, spec.damage, now);
    return {
      origin,
      to: [best.target.x, best.target.y, best.target.z],
      targetId: best.target.id,
      damage: spec.damage,
      killed: remaining <= 0,
      health: remaining,
    };
  }
}

/** Dead-peer watchdog (review WG-M1, gtasf-kill-settle-before-broadcast-yda5o): a contained throw between the damage
 *  that dropped a player to 0 health and `applyPvpDeath` leaves them dead, undebited and never respawned (every damage,
 *  regen and bust path skips dead players, so nothing recovers them). How long a peer may sit at 0 health with no death
 *  settlement in flight before the tick settles it. */
export const DEAD_SETTLE_GRACE_MS = 5000;

/**
 * Pure watchdog step: `dead` = ids of connected peers whose health is <= 0 right now; `pending` = ids whose death
 * settlement is already in flight; `seen` = when each id was first observed dead (mutated: pruned for ids no longer
 * dead or now pending, recorded for new ones). Returns the ids that have been dead and unsettled for longer than
 * `graceMs`, each once (they are removed from `seen`, so a settlement that then starts isn't retriggered next tick).
 */
export function overdueDeaths(dead: Iterable<number>, pending: ReadonlySet<number>, seen: Map<number, number>, now: number, graceMs = DEAD_SETTLE_GRACE_MS): number[] {
  const current = new Set<number>();
  const overdue: number[] = [];
  for (const id of dead) {
    if (pending.has(id)) continue; // being settled: not the watchdog's problem
    current.add(id);
    const since = seen.get(id);
    if (since === undefined) seen.set(id, now);
    else if (now - since >= graceMs) { overdue.push(id); seen.delete(id); current.delete(id); }
  }
  for (const id of seen.keys()) if (!current.has(id)) seen.delete(id);
  return overdue;
}

/** driveBy: may a player inside a vehicle fire? Only with the flag on (review DB-M1: checked on the SERVER, so a
 *  modified client can't drive-by while it's off), and never melee. On foot (no vehicle) is always allowed here. */
export function vehicleFireAllowed(inVehicle: boolean, melee: boolean, driveByOn: boolean): boolean {
  return !inVehicle || (driveByOn && !melee);
}
