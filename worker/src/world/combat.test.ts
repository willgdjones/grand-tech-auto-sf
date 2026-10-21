import { describe, expect, it } from 'vitest';
import type { MapCollision } from '@gtasf/shared/mapCollision';
import { MAX_HEALTH } from '@gtasf/shared/combat/economy';
import { WEAPON_ORDER, WEAPONS } from '@gtasf/shared/combat/weapons';
import { CHEST_M, DEAD_SETTLE_GRACE_MS, overdueDeaths, pvpTargets, SPAWN_PROTECTION_MS, WorldCombat, type CombatTarget } from './combat';

// Weapon indices (WEAPON_ORDER): 0 fists, 1 bat, 2 pistol (22 dmg / 60 m / 300 ms), 3 smg, 4 rifle (34/120/140).
const PISTOL = 2, RIFLE = 4;
const ORIGIN = { x: 0, y: 0, z: 0 }; // cm → metres origin (0, 1.4, 0) after the chest offset
const EAST: [number, number, number] = [1, 0, 0];
const chest = (x: number, z: number, id: number): CombatTarget => ({ id, x, y: 1.4, z });

describe('WorldCombat.fire — target resolution', () => {
  it('hits a target in front within range and applies damage server-side', () => {
    const c = new WorldCombat();
    const r = c.fire(1, ORIGIN, { weapon: PISTOL, dir: EAST }, [chest(10, 0, 2)], 1000);
    expect(r).toMatchObject({ targetId: 2, damage: 22, killed: false, health: 78 });
    expect(c.healthOf(2)).toBe(78);
    expect(r!.origin).toEqual([0, 1.4, 0]);
    expect(r!.to).toEqual([10, 1.4, 0]);
  });

  it('misses when the target is off the aim line (returns a tracer with targetId 0)', () => {
    const c = new WorldCombat();
    const r = c.fire(1, ORIGIN, { weapon: PISTOL, dir: EAST }, [chest(10, 5, 2)], 1000); // 5 m to the side
    expect(r).toMatchObject({ targetId: 0, damage: 0, killed: false });
    expect(c.healthOf(2)).toBe(100);
  });

  it('misses a target beyond the weapon range', () => {
    const c = new WorldCombat();
    const r = c.fire(1, ORIGIN, { weapon: PISTOL, dir: EAST }, [chest(80, 0, 2)], 1000); // pistol range is 60 m
    expect(r!.targetId).toBe(0);
  });

  it('misses a target behind the shooter', () => {
    const c = new WorldCombat();
    const r = c.fire(1, ORIGIN, { weapon: PISTOL, dir: EAST }, [chest(-10, 0, 2)], 1000);
    expect(r!.targetId).toBe(0);
  });

  it('never hits the shooter and picks the nearest target in line', () => {
    const c = new WorldCombat();
    const r = c.fire(1, ORIGIN, { weapon: RIFLE, dir: EAST }, [chest(0, 0, 1), chest(30, 0, 3), chest(12, 0, 2)], 1000);
    expect(r!.targetId).toBe(2); // the 12 m target, not the shooter (id 1) nor the 30 m one
  });
});

describe('WorldCombat.fire — rate limit', () => {
  it('rejects a second shot inside the weapon cooldown and allows it after', () => {
    const c = new WorldCombat();
    expect(c.fire(1, ORIGIN, { weapon: PISTOL, dir: EAST }, [], 1000)).not.toBeNull();
    expect(c.fire(1, ORIGIN, { weapon: PISTOL, dir: EAST }, [], 1100)).toBeNull(); // 100 ms < 300 ms
    expect(c.fire(1, ORIGIN, { weapon: PISTOL, dir: EAST }, [], 1300)).not.toBeNull();
  });
});

describe('WorldCombat.fire — death', () => {
  it('reports killed once cumulative damage drops health to 0', () => {
    const c = new WorldCombat();
    const t = [chest(10, 0, 2)];
    expect(c.fire(1, ORIGIN, { weapon: RIFLE, dir: EAST }, t, 0)!.health).toBe(66); // 100-34
    expect(c.fire(1, ORIGIN, { weapon: RIFLE, dir: EAST }, t, 200)!.health).toBe(32); // 66-34
    const third = c.fire(1, ORIGIN, { weapon: RIFLE, dir: EAST }, t, 400);
    expect(third).toMatchObject({ killed: true, health: 0 }); // 32-34 clamps to 0
    expect(c.healthOf(2)).toBe(0);
  });
});

describe('WorldCombat.fire — no double kill (review)', () => {
  it('a target already at 0 health is skipped, so a second shot cannot kill/debit them again', () => {
    const c = new WorldCombat();
    const t = [chest(10, 0, 2)];
    c.fire(1, ORIGIN, { weapon: RIFLE, dir: EAST }, t, 0);   // 100 → 66
    c.fire(1, ORIGIN, { weapon: RIFLE, dir: EAST }, t, 200); // 66 → 32
    const kill = c.fire(1, ORIGIN, { weapon: RIFLE, dir: EAST }, t, 400); // 32 → 0
    expect(kill).toMatchObject({ targetId: 2, killed: true, health: 0 });
    // The victim is at 0, awaiting the async respawn/reset; a shot in that window must NOT hit them again.
    const again = c.fire(1, ORIGIN, { weapon: RIFLE, dir: EAST }, t, 600);
    expect(again).toMatchObject({ targetId: 0, killed: false });
    expect(c.healthOf(2)).toBe(0);
  });
});

describe('WorldCombat.fire — spawn protection (review)', () => {
  it('a spawn-protected target is invulnerable for the window, then hittable', () => {
    const c = new WorldCombat();
    c.reset(2, 1000); // protected until 1000 + SPAWN_PROTECTION_MS
    const t = [chest(10, 0, 2)];
    const during = c.fire(1, ORIGIN, { weapon: RIFLE, dir: EAST }, t, 1000);
    expect(during).toMatchObject({ targetId: 0, killed: false });
    expect(c.healthOf(2)).toBe(MAX_HEALTH);
    expect(c.isProtected(2, 1000)).toBe(true);
    const after = c.fire(1, ORIGIN, { weapon: RIFLE, dir: EAST }, t, 1000 + SPAWN_PROTECTION_MS + 1);
    expect(after).toMatchObject({ targetId: 2, killed: false });
    expect(c.healthOf(2)).toBe(MAX_HEALTH - 34);
  });

  it('reset without a time grants no protection (back-compat default)', () => {
    const c = new WorldCombat();
    c.reset(2);
    expect(c.isProtected(2, 1_000_000)).toBe(false);
  });
});

describe('WorldCombat.fire — line of sight', () => {
  // A wall at x∈[40,50] between the shooter (x0) and a target at x80.
  const WALL: MapCollision = {
    version: 1, origin: [0, 0, 0],
    buildings: [{ id: 'w', minY: 0, maxY: 20, heightSource: 'test', rings: [[[40, 5], [40, -5], [50, -5], [50, 5]]] }],
  };
  it('a building between shooter and target blocks the hit', () => {
    const c = new WorldCombat();
    const r = c.fire(1, ORIGIN, { weapon: RIFLE, dir: EAST }, [chest(80, 0, 2)], 1000, { collision: WALL });
    expect(r!.targetId).toBe(0); // blocked by the wall
  });
  it('a clear line (null collision) lets the shot through', () => {
    const c = new WorldCombat();
    const r = c.fire(1, ORIGIN, { weapon: RIFLE, dir: EAST }, [chest(80, 0, 2)], 1000, { collision: null });
    expect(r!.targetId).toBe(2);
  });
});

describe('WorldCombat.fire — validation', () => {
  it('rejects an invalid weapon index or a zero aim vector', () => {
    const c = new WorldCombat();
    expect(c.fire(1, ORIGIN, { weapon: 9, dir: EAST }, [], 1000)).toBeNull();
    expect(c.fire(1, ORIGIN, { weapon: PISTOL, dir: [0, 0, 0] }, [], 1000)).toBeNull();
    expect(c.fire(1, ORIGIN, { weapon: PISTOL, dir: [NaN, 0, 0] }, [], 1000)).toBeNull();
  });

  it('reset restores full health; forget drops state', () => {
    const c = new WorldCombat();
    c.fire(1, ORIGIN, { weapon: RIFLE, dir: EAST }, [chest(10, 0, 2)], 0);
    expect(c.healthOf(2)).toBe(66);
    c.reset(2);
    expect(c.healthOf(2)).toBe(100);
    c.forget(2);
    expect(c.healthOf(2)).toBe(100); // back to default
  });
});

describe('pvpTargets (open-PvP gate)', () => {
  // combatActive = the peer sent COMBAT_READY (accepted the 18+ gate); only those are valid targets.
  const peers = [
    { id: 1, pose: { x: 0, y: 0, z: 0 }, combatActive: true },
    { id: 2, pose: { x: 500, y: 300, z: -200 }, combatActive: true }, // cm
    { id: 3, pose: { x: -100, y: 0, z: 100 }, combatActive: true },
  ];
  it('returns no targets when open PvP is disabled (serverHits alone cannot harm players)', () => {
    expect(pvpTargets(peers, 1, false)).toEqual([]);
  });
  it('excludes the shooter and converts cm→metres at chest height when enabled', () => {
    const t = pvpTargets(peers, 1, true);
    expect(t.map(x => x.id)).toEqual([2, 3]);
    expect(t[0]).toEqual({ id: 2, x: 5, y: 3 + CHEST_M, z: -2 });
    expect(t[1]).toEqual({ id: 3, x: -1, y: CHEST_M, z: 1 });
  });
  it('is empty when the shooter is the only peer', () => {
    expect(pvpTargets([{ id: 9, pose: { x: 0, y: 0, z: 0 }, combatActive: true }], 9, true)).toEqual([]);
  });
  it('excludes players who have not opted into combat (no COMBAT_READY) even when open PvP is on', () => {
    const mixed = [
      { id: 1, pose: { x: 0, y: 0, z: 0 }, combatActive: true },    // shooter
      { id: 2, pose: { x: 500, y: 0, z: 0 }, combatActive: true },  // confirmed → a valid target
      { id: 3, pose: { x: -100, y: 0, z: 0 } },                     // never opted in → NOT a target
      { id: 4, pose: { x: 200, y: 0, z: 0 }, combatActive: false }, // explicitly not active → NOT a target
    ];
    expect(pvpTargets(mixed, 1, true).map(x => x.id)).toEqual([2]);
  });
});

describe('server armour (vitalsPickups)', () => {
  it('armour absorbs a hit before health, and is lost on death/respawn', () => {
    const c = new WorldCombat();
    c.setVitals(2, 100, 40);
    expect(c.damage(2, 30, 0)).toEqual({ remaining: 100, killed: false });
    expect(c.armourOf(2)).toBe(10);
    expect(c.damage(2, 30, 0)).toEqual({ remaining: 80, killed: false });
    expect(c.armourOf(2)).toBe(0);
    c.reset(2, 0);
    expect(c.armourOf(2)).toBe(0);
  });
  it('a validated shot also goes through armour', () => {
    const c = new WorldCombat();
    c.setVitals(2, 100, 100);
    const r = c.fire(1, { x: 0, y: 0, z: 0 }, { weapon: WEAPON_ORDER.indexOf('pistol'), dir: [1, 0, 0] }, [{ id: 2, x: 5, y: 1.4, z: 0 }], 0);
    expect(r?.targetId).toBe(2);
    expect(r?.health).toBe(100); // all absorbed
    expect(c.armourOf(2)).toBe(100 - WEAPONS.pistol.damage);
  });
});

describe('driveBy server gate (review DB-M1)', () => {
  it('in a vehicle: no shots while the flag is off, guns only while it is on; on foot always', async () => {
    const { vehicleFireAllowed } = await import('./combat');
    expect(vehicleFireAllowed(true, false, false)).toBe(false); // flag off: a modified client can't drive-by
    expect(vehicleFireAllowed(true, false, true)).toBe(true);
    expect(vehicleFireAllowed(true, true, true)).toBe(false);   // no melee from a car
    expect(vehicleFireAllowed(false, true, false)).toBe(true);  // on foot unaffected
  });
});

describe('healthRegen: WorldCombat.regenerate', () => {
  it('refills whole HP up to half after 5 s without damage; a new hit restarts the wait', () => {
    const c = new WorldCombat();
    c.damage(3, 80, 0);                           // 100 → 20
    expect(c.regenerate(4_000, 1_000)).toEqual([]); // still within the delay
    expect(c.healthOf(3)).toBe(20);
    c.regenerate(5_000, 1_000);                     // +2/s
    expect(c.healthOf(3)).toBe(22);
    for (let t = 5_250; t <= 30_000; t += 250) c.regenerate(t, 250);
    expect(c.healthOf(3)).toBe(50);                 // capped at half
    expect(Number.isInteger(c.healthOf(3))).toBe(true);
    c.damage(3, 10, 31_000);                        // hurt again: wait restarts
    c.regenerate(33_000, 2_000);
    expect(c.healthOf(3)).toBe(40);
  });
});

describe('review HR-L1: a restore waits for regen like fresh damage', () => {
  it('markHurt restarts the 5 s wait', () => {
    const c = new WorldCombat();
    c.setHealth(4, 10); c.markHurt(4, 1_000);
    c.regenerate(5_000, 1_000);
    expect(c.healthOf(4)).toBe(10);       // still inside the wait
    c.regenerate(6_000, 1_000);
    expect(c.healthOf(4)).toBe(12);
  });
});

// Review WG-M1 (gtasf-kill-settle-before-broadcast-yda5o): a dead peer whose settlement never started is picked up by
// the tick watchdog after the grace period, exactly once; peers being settled or back alive are left alone.
describe('overdueDeaths — dead-peer watchdog', () => {
  const NOW = 1_000_000;
  it('settles a peer stuck at 0 health after the grace period, once', () => {
    const seen = new Map<number, number>(), pending = new Set<number>();
    expect(overdueDeaths([7], pending, seen, NOW)).toEqual([]);                 // first sighting: start the clock
    expect(overdueDeaths([7], pending, seen, NOW + DEAD_SETTLE_GRACE_MS - 1)).toEqual([]);
    expect(overdueDeaths([7], pending, seen, NOW + DEAD_SETTLE_GRACE_MS)).toEqual([7]);
    expect(seen.has(7)).toBe(false);                                            // handed off: not re-reported next tick
    expect(overdueDeaths([7], pending, seen, NOW + DEAD_SETTLE_GRACE_MS + 1)).toEqual([]); // the clock restarts instead
  });
  it('ignores peers whose death settlement is in flight, and forgets peers that come back alive', () => {
    const seen = new Map<number, number>(), pending = new Set<number>([3]);
    expect(overdueDeaths([3, 4], pending, seen, NOW)).toEqual([]);
    expect(seen.has(3)).toBe(false);
    expect(seen.has(4)).toBe(true);
    expect(overdueDeaths([], pending, seen, NOW + DEAD_SETTLE_GRACE_MS * 2)).toEqual([]); // 4 respawned meanwhile
    expect(seen.size).toBe(0);
  });
  it('a settlement that starts during the grace period cancels the watchdog for that peer', () => {
    const seen = new Map<number, number>(), pending = new Set<number>();
    overdueDeaths([9], pending, seen, NOW);
    pending.add(9);
    expect(overdueDeaths([9], pending, seen, NOW + DEAD_SETTLE_GRACE_MS * 3)).toEqual([]);
    expect(seen.size).toBe(0);
  });
});
