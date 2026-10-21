/**
 * GTA V pivot — LANE B: per-world vehicle damage state (flag vehicleDamage). Rules live in shared/combat/vehicleDamage.ts;
 * this tracks the HP of DAMAGED vehicles (absent = full), burns down burning ones, and keeps short-lived WRECK entries
 * that ride the vehicle snapshot after an explosion (the source car — fleet / traffic / police — is removed).
 */
import { segmentPointDistance } from '@gtasf/shared/combat/streetCrime';
import { VEHICLE_HIT_RADIUS_M } from '@gtasf/shared/combat/vehicleDamage';
import { ATTACKER_TTL_MS, CRASH_HP_FLOOR, crashHpAfter, damageVehicle, tickVehicleHp, VEHICLE_MAX_HP, vehicleState, WRECK_MS } from '@gtasf/shared/combat/vehicleDamage';
import type { VehicleEntry } from '@gtasf/shared/protocol/types';

/** VehicleEntry.flags bits for damage (0x20 traffic and 0x40 police are taken). */
export const SMOKING_FLAG = 0x01;
export const BURNING_FLAG = 0x02;
export const WRECK_FLAG = 0x04;

/** Review B-H1/B-L1: may this peer's VEHICLE_CRASH report damage `vehicle`? Only a player who accepted the 18+ combat
 *  gate (a crash blast credits them with wanted + the PvP kill, so they must be shootable back), only the car they DRIVE
 *  (never a robotaxi / bus / cable car they ride in), and at most 4 reports a second. */
export function crashReportAllowed(peer: { id: number; combatActive?: boolean }, vehicle: Pick<VehicleEntry, 'driverId'> | undefined,
  lastReportAt: number | undefined, now: number): boolean {
  return Boolean(peer.combatActive) && vehicle !== undefined && vehicle.driverId === peer.id && now - (lastReportAt ?? -Infinity) >= 250;
}

export class WorldVehicleDamage {
  private readonly hp = new Map<number, number>();
  private readonly wrecks = new Map<number, { entry: VehicleEntry; until: number }>();
  private readonly lastDamager = new Map<number, { by: number; at: number }>(); // vehicle id → who last shot/crashed it, when

  hpOf(id: number): number { return this.wrecks.has(id) ? 0 : this.hp.get(id) ?? VEHICLE_MAX_HP; }
  isWreck(id: number): boolean { return this.wrecks.has(id); }
  get trackedCount(): number { return this.hp.size; }

  /** Apply damage; true when THIS damage made it explode (exactly once — a wreck takes no more damage). */
  damage(id: number, amount: number, by?: number, now = 0): boolean {
    if (this.wrecks.has(id)) return false;
    if (by) this.lastDamager.set(id, { by, at: now });
    const result = damageVehicle(this.hpOf(id), amount);
    if (result.hp < VEHICLE_MAX_HP) this.hp.set(id, result.hp);
    return result.exploded;
  }

  /** A crash (review): down to burning at most, never an instant explosion; `by` is the driver (blast-kill credit). */
  crash(id: number, amount: number, by: number, now = 0): void {
    if (this.wrecks.has(id) || amount <= 0) return;
    // Review B-L2: a car that's already burning takes no more crash damage — and its attacker isn't re-assigned.
    if (this.hpOf(id) <= CRASH_HP_FLOOR) return;
    this.lastDamager.set(id, { by, at: now });
    const next = crashHpAfter(this.hpOf(id), amount);
    if (next < VEHICLE_MAX_HP) this.hp.set(id, next);
  }
  /** Who last damaged this vehicle (shot it / crashed it) within ATTACKER_TTL_MS, for crediting its explosion. */
  attackerOf(id: number, now = 0): number | undefined {
    const hit = this.lastDamager.get(id);
    return hit && now - hit.at <= ATTACKER_TTL_MS ? hit.by : undefined;
  }

  /** Burn down burning vehicles; returns the ids that exploded this tick. `alive(id)` drops ids whose car is gone. */
  tick(dtSeconds: number, alive: (id: number) => boolean): number[] {
    const exploded: number[] = [];
    for (const [id, hp] of this.hp) {
      if (!alive(id)) { this.hp.delete(id); this.lastDamager.delete(id); continue; }
      const next = tickVehicleHp(hp, dtSeconds);
      if (next !== hp) { this.hp.set(id, next); if (next === 0) exploded.push(id); }
    }
    return exploded;
  }

  /** Turn a vehicle into a wreck at its last position (stationary, driverless, WRECK_FLAG) for WRECK_MS. */
  wreck(entry: VehicleEntry, now: number): void {
    this.hp.delete(entry.id); this.lastDamager.delete(entry.id);
    this.wrecks.set(entry.id, { entry: { ...entry, driverId: 0, speedCmps: 0, flags: (entry.flags & ~(SMOKING_FLAG | BURNING_FLAG)) | WRECK_FLAG }, until: now + WRECK_MS });
  }

  /** Live wreck entries within `radiusCm` of a viewer (expired wrecks are cleared). */
  wreckEntries(viewerXcm: number, viewerZcm: number, now: number, radiusCm = 50_000): VehicleEntry[] {
    const out: VehicleEntry[] = [];
    for (const [id, w] of this.wrecks) {
      if (w.until <= now) { this.wrecks.delete(id); continue; }
      if (Math.hypot(w.entry.x - viewerXcm, w.entry.z - viewerZcm) <= radiusCm) out.push(w.entry);
    }
    return out;
  }

  /** Damage flag bits for a live vehicle's snapshot entry. */
  flagsFor(id: number, baseFlags: number): number {
    const state = vehicleState(this.hpOf(id));
    return baseFlags | (state === 'smoking' ? SMOKING_FLAG : state === 'burning' ? BURNING_FLAG : 0);
  }
}

/**
 * The vehicle a validated shot hits: nearest along the shot whose body (centre +1 m) is within VEHICLE_HIT_RADIUS_M of
 * the line, with line of sight. `exclude` is the shooter's own vehicle (driveBy: a shot fired from inside starts within
 * its own hit radius and would otherwise always hit it). Pure.
 */
export function vehicleOnShot(origin: readonly [number, number, number], to: readonly [number, number, number],
  entries: Iterable<{ id: number; x: number; y: number; z: number }>, options: { exclude?: number; los?: (body: [number, number, number]) => boolean } = {}): number | undefined {
  let best: { id: number; along: number } | undefined;
  for (const e of entries) {
    if (e.id === options.exclude) continue;
    const body: [number, number, number] = [e.x / 100, e.y / 100 + 1, e.z / 100];
    if (segmentPointDistance(origin, to, body) > VEHICLE_HIT_RADIUS_M) continue;
    const along = Math.hypot(body[0] - origin[0], body[2] - origin[2]);
    if (best && along >= best.along) continue;
    if (options.los && !options.los(body)) continue;
    best = { id: e.id, along };
  }
  return best?.id;
}
