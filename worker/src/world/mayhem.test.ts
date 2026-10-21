import { describe, expect, it } from 'vitest';
import { MAYHEM_FIRE_COOLDOWN_MS } from '@gtasf/shared/content/mayhem';
import type { C2SMessage } from '@gtasf/shared/protocol/types';
import { MAYHEM_RELAY_RADIUS_M, WorldMayhem, nearMayhem, validMayhemFire } from './mayhem';

type Fire = Extract<C2SMessage, { type: 'MAYHEM_FIRE' }>;
const fire = (over: Partial<Fire> = {}): Fire =>
  ({ type: 'MAYHEM_FIRE', item: 0, at: [10, 2, -5], colour: 0xff2d7a, normal: [0, 1, 0], ...over });

describe('mayhem fire validation', () => {
  it('accepts a well-formed fire, with or without a normal', () => {
    expect(validMayhemFire(fire())).toBe(true);
    expect(validMayhemFire(fire({ normal: null }))).toBe(true); // mid-air burst (confetti)
    expect(validMayhemFire(fire({ item: 2, colour: 0 }))).toBe(true);
    expect(validMayhemFire(fire({ colour: 0xffffffff }))).toBe(true);
  });
  it('rejects an out-of-range item index (would crash the renderer lookup)', () => {
    expect(validMayhemFire(fire({ item: -1 }))).toBe(false);
    expect(validMayhemFire(fire({ item: 3 }))).toBe(false); // only 3 items (0..2)
    expect(validMayhemFire(fire({ item: 1.5 }))).toBe(false);
  });
  it('rejects a non-finite or absurd coordinate', () => {
    expect(validMayhemFire(fire({ at: [Number.NaN, 0, 0] }))).toBe(false);
    expect(validMayhemFire(fire({ at: [Number.POSITIVE_INFINITY, 0, 0] }))).toBe(false);
    expect(validMayhemFire(fire({ at: [1e9, 0, 0] }))).toBe(false);
  });
  it('rejects a bad colour or a malformed normal', () => {
    expect(validMayhemFire(fire({ colour: -1 }))).toBe(false);
    expect(validMayhemFire(fire({ colour: 0x1_0000_0000 }))).toBe(false);
    expect(validMayhemFire(fire({ normal: [0, 1] as unknown as [number, number, number] }))).toBe(false);
    expect(validMayhemFire(fire({ normal: [0, Number.NaN, 1] }))).toBe(false);
  });
});

describe('WorldMayhem relay + rate limit', () => {
  it('stamps senderId and passes the fire through', () => {
    const m = new WorldMayhem();
    const out = m.fire(42, fire({ item: 2, colour: 0x5ab6ff }), 1000);
    expect(out).toEqual({ type: 'MAYHEM_FIRE', senderId: 42, item: 2, at: [10, 2, -5], colour: 0x5ab6ff, normal: [0, 1, 0] });
  });
  it('enforces the per-peer cooldown (never trusts the client)', () => {
    const m = new WorldMayhem();
    expect(m.fire(1, fire(), 1000)).not.toBeNull();
    expect(m.fire(1, fire(), 1000 + MAYHEM_FIRE_COOLDOWN_MS - 1)).toBeNull(); // too soon
    expect(m.fire(1, fire(), 1000 + MAYHEM_FIRE_COOLDOWN_MS)).not.toBeNull();  // allowed again
  });
  it('rate-limits each peer independently', () => {
    const m = new WorldMayhem();
    expect(m.fire(1, fire(), 1000)).not.toBeNull();
    expect(m.fire(2, fire(), 1000)).not.toBeNull(); // a different player is not blocked by peer 1
  });
  it('an invalid fire is dropped without consuming the cooldown slot', () => {
    const m = new WorldMayhem();
    expect(m.fire(1, fire({ item: 99 }), 1000)).toBeNull();
    expect(m.fire(1, fire(), 1000)).not.toBeNull(); // the bad fire did not start the cooldown
  });
  it('forgets a disconnected peer so its cooldown resets', () => {
    const m = new WorldMayhem();
    expect(m.fire(1, fire(), 1000)).not.toBeNull();
    m.forget(1);
    expect(m.fire(1, fire(), 1000)).not.toBeNull(); // immediate re-fire allowed after reconnect
  });
});

describe('nearMayhem (viewer centimetres vs splat metres)', () => {
  const at: [number, number, number] = [100, 0, 0]; // 100 m east
  it('includes a viewer within the radius and excludes one beyond it (y ignored)', () => {
    expect(nearMayhem({ x: 100_00, z: 0 }, at)).toBe(true);               // exactly on the splat
    expect(nearMayhem({ x: (100 + MAYHEM_RELAY_RADIUS_M - 1) * 100, z: 0 }, at)).toBe(true);
    expect(nearMayhem({ x: (100 + MAYHEM_RELAY_RADIUS_M + 1) * 100, z: 0 }, at)).toBe(false);
  });
});
