import { expect, test } from 'vitest';
import { encodeC2S, decodeC2S } from './c2s';
import { encodeS2C, decodeS2C } from './s2c';
import { C2S, S2C } from './constants';
import type { C2SMessage, S2CMessage } from './types';

// GTA-pivot combat (flag serverHits) wire contract — the client reports a shot, the server broadcasts the result.

test('COMBAT_FIRE round-trips weapon + aim direction', () => {
  const fire: C2SMessage = { type: 'COMBAT_FIRE', weapon: 2, dir: [0.0, -0.2588, 0.9659] };
  const bytes = encodeC2S(fire);
  expect(bytes[0]).toBe(C2S.COMBAT_FIRE);
  expect(decodeC2S(bytes)).toEqual({ ok: true, msg: fire });
});

test('COMBAT_READY round-trips (combat opt-in / PvP target signal)', () => {
  const ready: C2SMessage = { type: 'COMBAT_READY' };
  const bytes = encodeC2S(ready);
  expect(bytes[0]).toBe(C2S.COMBAT_READY);
  expect(decodeC2S(bytes)).toEqual({ ok: true, msg: ready });
});

test('COMBAT_CRIME round-trips the ped-crime kind and rejects unknown kinds', () => {
  for (const kind of [0, 1, 2, 3] as const) {
    const crime: C2SMessage = { type: 'COMBAT_CRIME', kind };
    const bytes = encodeC2S(crime);
    expect(bytes[0]).toBe(C2S.COMBAT_CRIME);
    expect(decodeC2S(bytes)).toEqual({ ok: true, msg: crime });
  }
  expect(decodeC2S(Uint8Array.of(C2S.COMBAT_CRIME, 4)).ok).toBe(false);
  expect(decodeC2S(Uint8Array.of(C2S.COMBAT_CRIME)).ok).toBe(false);
});

test('COMBAT_HIT round-trips the tracer and the applied damage/death', () => {
  const hit: S2CMessage = {
    type: 'COMBAT_HIT', shooterId: 7, weapon: 3,
    origin: [10.5, 1.4, -3.25], to: [42.0, 1.1, -3.25],
    targetId: 1_000_042, damage: 34, killed: true,
  };
  const bytes = encodeS2C(hit);
  expect(bytes[0]).toBe(S2C.COMBAT_HIT);
  expect(decodeS2C(bytes)).toEqual({ ok: true, msg: hit });
});

test('COMBAT_HIT with no target (a pure tracer / miss relay) round-trips', () => {
  const miss: S2CMessage = {
    type: 'COMBAT_HIT', shooterId: 7, weapon: 0,
    origin: [0, 1.4, 0], to: [0, 1.4, 60], targetId: 0, damage: 0, killed: false,
  };
  expect(decodeS2C(encodeS2C(miss))).toEqual({ ok: true, msg: miss });
});

test('OFFICERS round-trips officer positions (and an empty clear)', () => {
  const m: S2CMessage = { type: 'OFFICERS', entries: [
    { id: 1_500_007, x: -4012, y: 250, z: 98_765, yaw: 200, moving: true },
    { id: 1_500_008, x: 12, y: -30, z: -5, yaw: 0, moving: false },
  ] };
  const bytes = encodeS2C(m);
  expect(bytes[0]).toBe(S2C.OFFICERS);
  expect(decodeS2C(bytes)).toEqual({ ok: true, msg: m });
  expect(decodeS2C(encodeS2C({ type: 'OFFICERS', entries: [] }))).toEqual({ ok: true, msg: { type: 'OFFICERS', entries: [] } });
});

test('VEHICLE_CRASH + EXPLOSION round-trip', () => {
  const crash: C2SMessage = { type: 'VEHICLE_CRASH', closing: 17 };
  expect(decodeC2S(encodeC2S(crash))).toEqual({ ok: true, msg: crash });
  expect(decodeC2S(encodeC2S({ type: 'VEHICLE_CRASH', closing: 999 }))).toEqual({ ok: true, msg: { type: 'VEHICLE_CRASH', closing: 255 } });
  const boom: S2CMessage = { type: 'EXPLOSION', x: 114_460, y: 250, z: -128_750 };
  expect(decodeS2C(encodeS2C(boom))).toEqual({ ok: true, msg: boom });
});

test('COMBAT_VITALS + PICKUP_STATE round-trip', () => {
  const v: S2CMessage = { type: 'COMBAT_VITALS', health: 64, armour: 50 };
  expect(decodeS2C(encodeS2C(v))).toEqual({ ok: true, msg: v });
  const p: S2CMessage = { type: 'PICKUP_STATE', index: 3, available: false };
  expect(decodeS2C(encodeS2C(p))).toEqual({ ok: true, msg: p });
});

test('BUSTED round-trips (server-applied arrest)', () => {
  const m: S2CMessage = { type: 'BUSTED' };
  const bytes = encodeS2C(m);
  expect(bytes[0]).toBe(S2C.BUSTED);
  expect(decodeS2C(bytes)).toEqual({ ok: true, msg: m });
});

test('WANTED round-trips the star level', () => {
  for (const level of [0, 1, 3, 5]) {
    const m: S2CMessage = { type: 'WANTED', level };
    expect(decodeS2C(encodeS2C(m))).toEqual({ ok: true, msg: m });
  }
});

test('PED_PUNCH + COMBAT_CRIME kind 3 round-trip (pedMelee)', () => {
  const punch: C2SMessage = { type: 'PED_PUNCH' };
  expect(decodeC2S(encodeC2S(punch))).toEqual({ ok: true, msg: punch });
  const ko: C2SMessage = { type: 'COMBAT_CRIME', kind: 3 };
  expect(decodeC2S(encodeC2S(ko))).toEqual({ ok: true, msg: ko });
});

test('POLICE_RAM round-trips a unit direction to ~0.01', () => {
  const r = decodeS2C(encodeS2C({ type: 'POLICE_RAM', dirX: 0.6, dirZ: -0.8 }));
  expect(r.ok && r.msg.type === 'POLICE_RAM').toBe(true);
  if (r.ok && r.msg.type === 'POLICE_RAM') { expect(r.msg.dirX).toBeCloseTo(0.6, 1); expect(r.msg.dirZ).toBeCloseTo(-0.8, 1); }
});

test('WANTED_SIGHT round-trips', () => {
  for (const seen of [true, false]) { const m: S2CMessage = { type: 'WANTED_SIGHT', seen, x: -12345, z: 67890 }; expect(decodeS2C(encodeS2C(m))).toEqual({ ok: true, msg: m }); }
});

test('WANTED_ESCAPE round-trips (gtasf-66lvh) and rejects a bad phase', () => {
  for (const phase of [0, 1, 2]) { const m: S2CMessage = { type: 'WANTED_ESCAPE', phase, progress: 128, remainingDs: 1234, cover: 5 }; expect(decodeS2C(encodeS2C(m))).toEqual({ ok: true, msg: m }); }
  const bytes = encodeS2C({ type: 'WANTED_ESCAPE', phase: 1, progress: 0, remainingDs: 0, cover: 0 }); bytes[1] = 3;
  expect(decodeS2C(bytes).ok).toBe(false);
});

test('KERB_CAR_TAKE round-trips and rejects an unknown kind', () => {
  const m: C2SMessage = { type: 'KERB_CAR_TAKE', x: -123456, z: 789012, yaw: 200, kind: 1 };
  expect(decodeC2S(encodeC2S(m))).toEqual({ ok: true, msg: m });
  const bad = encodeC2S(m); bad[bad.length - 1] = 2;
  expect(decodeC2S(bad).ok).toBe(false);
});

test('OPENING_CAR round-trips its facing byte (openingDrive)', () => {
  for (const yaw of [0, 77, 255]) { const m: C2SMessage = { type: 'OPENING_CAR', yaw }; expect(decodeC2S(encodeC2S(m))).toEqual({ ok: true, msg: m }); }
  expect(decodeC2S(encodeC2S({ type: 'OPENING_CAR', yaw: -1 }))).toEqual({ ok: true, msg: { type: 'OPENING_CAR', yaw: 255 } });
});
