import { describe, expect, it } from 'vitest';
import { CRASH_HP_FLOOR, VEHICLE_MAX_HP, WRECK_MS } from '@gtasf/shared/combat/vehicleDamage';
import type { VehicleEntry } from '@gtasf/shared/protocol/types';
import { BURNING_FLAG, crashReportAllowed, SMOKING_FLAG, WorldVehicleDamage, WRECK_FLAG } from './vehicleDamage';

const car = (id: number, x = 0, z = 0): VehicleEntry => ({ id, x, y: 0, z, yaw: 0, flags: 0x20, kind: 'prius', driverId: 7, speedCmps: 900 });

describe('WorldVehicleDamage', () => {
  it('untouched vehicles are full HP and untracked', () => {
    const d = new WorldVehicleDamage();
    expect(d.hpOf(5)).toBe(VEHICLE_MAX_HP);
    expect(d.trackedCount).toBe(0);
  });
  it('explodes exactly once; a wreck takes no more damage', () => {
    const d = new WorldVehicleDamage();
    expect(d.damage(5, 900)).toBe(false);
    expect(d.damage(5, 200)).toBe(true);
    d.wreck(car(5), 0);
    expect(d.damage(5, 500)).toBe(false);
    expect(d.isWreck(5)).toBe(true);
  });
  it('a burning car burns down and explodes on its own; vanished cars are dropped', () => {
    const d = new WorldVehicleDamage();
    d.damage(5, VEHICLE_MAX_HP * 0.8); // 200 HP: burning
    d.damage(6, VEHICLE_MAX_HP * 0.8);
    let exploded: number[] = [];
    for (let i = 0; i < 100 && !exploded.length; i++) exploded = d.tick(0.1, id => id !== 6);
    expect(exploded).toEqual([5]);
    expect(d.trackedCount).toBe(1); // 6 dropped (gone); 5 still tracked at 0 until wrecked
  });
  it('snapshot flags: smoking / burning bits on live cars, WRECK on wrecks (stationary, driverless)', () => {
    const d = new WorldVehicleDamage();
    d.damage(1, VEHICLE_MAX_HP * 0.6); d.damage(2, VEHICLE_MAX_HP * 0.8);
    expect(d.flagsFor(1, 0x20) & SMOKING_FLAG).toBeTruthy();
    expect(d.flagsFor(2, 0x40) & BURNING_FLAG).toBeTruthy();
    expect(d.flagsFor(3, 0x20)).toBe(0x20);
    d.wreck(car(9, 1000, 0), 0);
    const [w] = d.wreckEntries(0, 0, 1);
    expect(w).toMatchObject({ id: 9, driverId: 0, speedCmps: 0 });
    expect(w!.flags & WRECK_FLAG).toBeTruthy();
  });
  it('wrecks expire after WRECK_MS and are out of range far away', () => {
    const d = new WorldVehicleDamage();
    d.wreck(car(9, 1000, 0), 0);
    expect(d.wreckEntries(10_000_000, 0, 1)).toHaveLength(0);
    expect(d.wreckEntries(0, 0, WRECK_MS + 1)).toHaveLength(0);
    expect(d.isWreck(9)).toBe(false);
  });
});

describe('review: crash damage + blast attribution', () => {
  it('crash() never explodes (stops at burning) and records the driver; a shot records the shooter', () => {
    const d = new WorldVehicleDamage();
    for (let i = 0; i < 10; i++) d.crash(7, 600, 42);
    expect(d.hpOf(7)).toBe(CRASH_HP_FLOOR);
    expect(d.attackerOf(7)).toBe(42);
    expect(d.damage(7, 10_000, 99)).toBe(true); // a shot can still finish it
    expect(d.attackerOf(7)).toBe(99);
  });
});

describe('crashReportAllowed (review B-H1/B-L1)', () => {
  const driver = { id: 7, combatActive: true };
  it('an opted-in driver of the car may report a crash, at most every 250 ms', () => {
    expect(crashReportAllowed(driver, car(5), undefined, 1000)).toBe(true);
    expect(crashReportAllowed(driver, car(5), 900, 1000)).toBe(false);
    expect(crashReportAllowed(driver, car(5), 750, 1000)).toBe(true);
  });
  it('a player who never accepted the 18+ combat gate cannot crash-bomb (they could not be shot back)', () => {
    expect(crashReportAllowed({ id: 7 }, car(5), undefined, 1000)).toBe(false);
    expect(crashReportAllowed({ id: 7, combatActive: false }, car(5), undefined, 1000)).toBe(false);
  });
  it('a passenger (robotaxi / bus / cable car: driverId 0) or anyone but the driver cannot damage the car', () => {
    expect(crashReportAllowed(driver, { driverId: 0 }, undefined, 1000)).toBe(false);
    expect(crashReportAllowed(driver, { driverId: 8 }, undefined, 1000)).toBe(false);
    expect(crashReportAllowed(driver, undefined, undefined, 1000)).toBe(false);
  });
});

describe('review B-L2: crash attribution', () => {
  it('a crash on an already-burning car does not re-assign the attacker; attribution expires after 30 s', async () => {
    const { ATTACKER_TTL_MS } = await import('@gtasf/shared/combat/vehicleDamage');
    const d = new WorldVehicleDamage();
    d.crash(8, 10_000, 1, 1000);            // driver 1 sets it burning
    d.crash(8, 10_000, 2, 2000);            // driver 2 bumps the burning car: no new attacker
    expect(d.attackerOf(8, 2000)).toBe(1);
    expect(d.attackerOf(8, 1000 + ATTACKER_TTL_MS + 1)).toBeUndefined();
  });
});

describe('driveBy: vehicleOnShot', () => {
  it('a shot fired from inside a car never hits that car; it hits the next car on the line', async () => {
    const { vehicleOnShot } = await import('./vehicleDamage');
    const own = { id: 1, x: 0, y: 0, z: 0 }, ahead = { id: 2, x: 2000, y: 0, z: 0 }, aside = { id: 3, x: 1000, y: 0, z: 1000 };
    const origin: [number, number, number] = [0, 1.4, 0], to: [number, number, number] = [60, 1.4, 0];
    expect(vehicleOnShot(origin, to, [own, ahead, aside])).toBe(1);                // without exclusion: your own car
    expect(vehicleOnShot(origin, to, [own, ahead, aside], { exclude: 1 })).toBe(2); // drive-by: the car ahead
    expect(vehicleOnShot(origin, to, [own, ahead], { exclude: 1, los: () => false })).toBeUndefined(); // walled off
  });
});
