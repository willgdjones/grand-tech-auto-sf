import { describe, expect, it } from 'vitest';
import {
  blastDamage, bulletDamage, crashDamage, CRASH_MAX_DAMAGE, damageVehicle, EXPLOSION_MAX_DAMAGE, EXPLOSION_RADIUS_M,
  tickVehicleHp, VEHICLE_MAX_HP, vehicleState,
} from './vehicleDamage';
import { MAX_HEALTH } from './economy';
import { WEAPONS } from './weapons';

describe('vehicle damage rules', () => {
  it('state goes ok → smoking → burning → wrecked as HP falls', () => {
    expect(vehicleState(VEHICLE_MAX_HP)).toBe('ok');
    expect(vehicleState(VEHICLE_MAX_HP * 0.49)).toBe('smoking');
    expect(vehicleState(VEHICLE_MAX_HP * 0.24)).toBe('burning');
    expect(vehicleState(0)).toBe('wrecked');
  });
  it('gentle bumps are free; harder crashes cost more; one crash never destroys a healthy car', () => {
    expect(crashDamage(3)).toBe(0);
    expect(crashDamage(10)).toBeGreaterThan(crashDamage(6));
    expect(crashDamage(60)).toBe(CRASH_MAX_DAMAGE);
    expect(CRASH_MAX_DAMAGE).toBeLessThan(VEHICLE_MAX_HP);
    expect(crashDamage(Number.NaN)).toBe(0);
  });
  it('bullets damage cars, fists and bats do not', () => {
    expect(bulletDamage(WEAPONS.rifle.damage, false)).toBeGreaterThan(0);
    expect(bulletDamage(WEAPONS.bat.damage, true)).toBe(0);
  });
  it('a burning car keeps losing HP until it is wrecked; a smoking one does not', () => {
    let hp = VEHICLE_MAX_HP * 0.2;
    for (let i = 0; i < 100 && hp > 0; i++) hp = tickVehicleHp(hp, 0.1);
    expect(hp).toBe(0);
    expect(tickVehicleHp(VEHICLE_MAX_HP * 0.4, 1)).toBe(VEHICLE_MAX_HP * 0.4);
  });
  it('the hit that reaches 0 is the one that explodes — exactly once', () => {
    expect(damageVehicle(50, 60)).toEqual({ hp: 0, exploded: true });
    expect(damageVehicle(0, 60)).toEqual({ hp: 0, exploded: false }); // already a wreck: no second explosion
    expect(damageVehicle(500, 60)).toEqual({ hp: 440, exploded: false });
  });
  it('blast is lethal point-blank, falls off, and is zero at the radius', () => {
    expect(blastDamage(0)).toBe(EXPLOSION_MAX_DAMAGE);
    expect(EXPLOSION_MAX_DAMAGE).toBeGreaterThanOrEqual(MAX_HEALTH);
    expect(blastDamage(EXPLOSION_RADIUS_M / 2)).toBe(Math.round(EXPLOSION_MAX_DAMAGE / 2));
    expect(blastDamage(EXPLOSION_RADIUS_M)).toBe(0);
    expect(blastDamage(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('review: crashes are capped and never an instant bomb', () => {
  it('a crash brings a car down to burning at most; a burning car takes no more crash damage', async () => {
    const { crashHpAfter, CRASH_HP_FLOOR, VEHICLE_MAX_HP } = await import('./vehicleDamage');
    expect(crashHpAfter(VEHICLE_MAX_HP, 10_000)).toBe(CRASH_HP_FLOOR);
    expect(crashHpAfter(VEHICLE_MAX_HP, 100)).toBe(VEHICLE_MAX_HP - 100);
    expect(crashHpAfter(CRASH_HP_FLOOR - 50, 600)).toBe(CRASH_HP_FLOOR - 50);
    expect(CRASH_HP_FLOOR).toBeGreaterThan(0);
  });
  it('the reported closing speed is capped by the server-measured speed', async () => {
    const { crashClosingCap } = await import('./vehicleDamage');
    expect(crashClosingCap(255, 0)).toBe(2);       // a parked car "crashing" at 255 m/s
    expect(crashClosingCap(12, 15)).toBe(12);      // honest report under the measured speed
    expect(crashClosingCap(60, 10)).toBe(14);      // capped at 1.2× measured + 2
  });
});

describe('review B-M1: measured drive speed resists one shuffled pose', () => {
  it('one 7 m jump in a tick does not read as 70 m/s; sustained speed does; a teleport resets', async () => {
    const { nextDriveTrack, drivePeak } = await import('./vehicleDamage');
    let t = nextDriveTrack(undefined, 0, 0, 0);
    t = nextDriveTrack(t, 0, 0, 100);       // parked
    t = nextDriveTrack(t, 7, 0, 200);       // one shuffled burst: 70 m/s for a single tick
    expect(drivePeak(t, 200)).toBe(0);
    t = nextDriveTrack(t, 7, 0, 300);       // back to parked
    expect(drivePeak(t, 300)).toBe(0);
    let d = nextDriveTrack(undefined, 0, 0, 0);
    for (let i = 1; i <= 5; i++) d = nextDriveTrack(d, i * 1.5, 0, i * 100); // a real 15 m/s drive
    expect(drivePeak(d, 500)).toBeCloseTo(15, 5);
    d = nextDriveTrack(d, 500, 0, 600);     // respawn/teleport jump
    expect(drivePeak(d, 600)).toBe(0);
  });
});
