import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { decodeC2S, encodeC2S } from './c2s';
import { decodeS2C, encodeS2C } from './s2c';
import { C2S, C2S_MAX_BYTES, S2C_MAX_BYTES, VEHICLE_MAX_ENTRIES, VEHICLE_KINDS, PLAYER_MODES, ROBOTAXI_STATES } from './constants';
import { normalizeNickname } from './nickname';
import type { C2SMessage, S2CMessage } from './types';
const p = { x: 900_000, y: 30_000, z: -900_000, yaw: 255, flags: 0 };
const destination = { x: -1_000_000, y: 55_000, z: 1_000_000 };
const token = 'a'.repeat(64);
const commands: C2SMessage[] = [
  { type: 'HELLO', name: 'Karl 🌁', resumeToken: token },
  { type: 'MOVE', seq: 65535, ...p },
  { type: 'PING', nonce: 0xffffffff, clientT: 1_780_000_000_000 },
  { type: 'CHAT', clientMsgId: 0xffffffff, eventId: 0x10000, text: 'Meet at Dolores 🌴' },
  { type: 'VEHICLE_ENTER', vehicleId: 0xffffffff }, { type: 'VEHICLE_EXIT', vehicleId: 0xffffffff },
  { type: 'VEHICLE_MOVE', vehicleId: 0xffffffff, seq: 65535, ...p },
  { type: 'ROBOTAXI_HAIL', requestId: 0xffffffff, destination }, { type: 'ROBOTAXI_CANCEL', requestId: 0xffffffff },
  { type: 'EVENT_JOIN', eventId: 0xffffffff }, { type: 'EVENT_LEAVE', eventId: 0xffffffff },
  { type: 'ROAD_RESPAWN' },
  { type: 'SET_APPEARANCE', appearance: 0x3ffffff },
  { type: 'MAYHEM_FIRE', item: 2, at: [12.5, -3.25, 900.5], colour: 0xff2d7a, normal: [0, 1, 0] },
  { type: 'MAYHEM_FIRE', item: 0, at: [0, 0, 0], colour: 0, normal: null },
];
const replies: S2CMessage[] = [
  { type: 'WELCOME', id: 0xffffffff, name: 'Karl', serverT: 1_780_000_000_000, pose: p, resumeToken: token, resumed: true, lastMoveSeq: 65535 },
  { type: 'PLAYER_JOIN', id: 0xffffffff, name: 'Karl', pose: p },
  { type: 'SNAPSHOT', tick: 0xffffffff, serverT: 1, entries: [{ id: 0xffffffff, ...p }] },
  { type: 'PLAYER_LEAVE', id: 0xffffffff }, { type: 'CORRECTION', pose: p },
  { type: 'PONG', nonce: 0xffffffff, clientT: 123, serverT: 124 },
  { type: 'VEHICLE_SNAPSHOT', tick: 0xffffffff, serverT: 123, entries: VEHICLE_KINDS.map((kind, i) => ({ id: 65536 + i, ...p, kind, driverId: 0xffffffff, speedCmps: -32768 })) },
  ...PLAYER_MODES.map(mode => ({ type: 'VEHICLE_STATE' as const, vehicleId: 0xffffffff, playerId: 0xffffffff, mode })),
  ...ROBOTAXI_STATES.map(state => ({ type: 'ROBOTAXI_STATE' as const, requestId: 0xffffffff, vehicleId: 0xffffffff, state, pose: p, destination, etaSeconds: 65535 })),
  { type: 'EVENT_STATE', eventId: 0xffffffff, playerId: 0xffffffff, present: true },
  { type: 'CHAT_BROADCAST', messageId: 0xffffffff, senderId: 0xffffffff, eventId: 0xffffffff, serverT: 123, name: '雪', text: 'Hello 🌉' },
  { type: 'APPEARANCE', id: 0xffffffff, appearance: 0x3ffffff },
  { type: 'MAYHEM_FIRE', senderId: 0xffffffff, item: 1, at: [12.5, -3.25, 900.5], colour: 0x5ab6ff, normal: [0, 1, 0] },
  { type: 'MAYHEM_FIRE', senderId: 7, item: 0, at: [0, 0, 0], colour: 0, normal: null },
  { type: 'ZONE_HANDOFF', token, cx: 65535, cy: 65535 },
  // Appended last so the seeded fuzz corpus indices above are unchanged.
  { type: 'CHAT_BROADCAST', messageId: 7, senderId: 8, eventId: 0, serverT: 124, name: 'Ana', text: 'what is up', spoken: true },
  { type: 'QUEST', json: '{"kind":"race-invite","raceId":"r1","title":"Lombard Switchbacks 🏁"}' },
];

describe('v2 gameplay contract', () => {
  it('round-trips every command and state, with strict truncation and trailing-byte rejection', () => {
    for (const m of commands) {
      const bytes = encodeC2S(m);
      expect(decodeC2S(bytes)).toEqual({ ok: true, msg: m });
      for (let n = 0; n < bytes.length; n++) expect(decodeC2S(bytes.subarray(0, n)).ok, `${m.type}:${n}`).toBe(false);
      expect(decodeC2S(new Uint8Array([...bytes, 0])).ok).toBe(false);
    }
    for (const m of replies) {
      const bytes = encodeS2C(m);
      expect(decodeS2C(bytes)).toEqual({ ok: true, msg: m });
      for (let n = 0; n < bytes.length; n++) expect(decodeS2C(bytes.subarray(0, n)).ok, `${m.type}:${n}`).toBe(false);
      expect(decodeS2C(new Uint8Array([...bytes, 0])).ok).toBe(false);
    }
  });
  it('fuzzes arbitrary frames, subarray offsets and mutations of every valid opcode', () => {
    fc.assert(fc.property(fc.uint8Array({ maxLength: 4096 }), input => {
      const bytes = new Uint8Array(input.length + 6); bytes.set(input, 3);
      expect(() => decodeC2S(bytes.subarray(3, -3))).not.toThrow();
      expect(() => decodeS2C(bytes.subarray(3, -3))).not.toThrow();
    }), { numRuns: 250, seed: 4101 });
    const corpus = [...commands.map(encodeC2S), ...replies.map(encodeS2C)];
    fc.assert(fc.property(fc.integer({ min: 0, max: corpus.length - 1 }), fc.nat(), fc.integer({ min: 0, max: 255 }), (index, at, byte) => {
      const frame = corpus[index]!.slice(); frame[at % frame.length] = byte;
      const result = index < commands.length ? decodeC2S(frame) : decodeS2C(frame);
      if (result.ok) {
        const canonical = index < commands.length ? encodeC2S(result.msg as C2SMessage) : encodeS2C(result.msg as S2CMessage);
        expect(canonical).toEqual(frame);
      }
    }), { numRuns: 400, seed: 4102 });
  });
  it('keeps IDs/coordinates exact over generated vehicle and taxi payloads', () => {
    fc.assert(fc.property(fc.integer({ min: 0, max: 0xffffffff }), fc.integer({ min: -2_000_000, max: 2_000_000 }), (id, x) => {
      const move = { type: 'VEHICLE_MOVE' as const, vehicleId: id, seq: 1, ...p, x };
      const hail = { type: 'ROBOTAXI_HAIL' as const, requestId: id, destination: { ...destination, x } };
      for (const m of [move, hail]) expect(decodeC2S(encodeC2S(m))).toEqual({ ok: true, msg: m });
    }), { numRuns: 150, seed: 4103 });
  });
  it('bounds payloads before allocating and rejects invalid enums, booleans and nonfinite times', () => {
    const entry = { id: 0xffffffff, ...p, kind: 'robotaxi' as const, driverId: 0, speedCmps: 32767 };
    const snapshot = { type: 'VEHICLE_SNAPSHOT' as const, tick: 0, serverT: 123, entries: Array.from({ length: VEHICLE_MAX_ENTRIES }, () => entry) };
    const bytes = encodeS2C(snapshot);
    expect(bytes.length).toBeLessThanOrEqual(S2C_MAX_BYTES);
    expect(decodeS2C(bytes)).toEqual({ ok: true, msg: snapshot });
    expect(() => encodeS2C({ ...snapshot, entries: [...snapshot.entries, entry] })).toThrow();
    bytes[13] = 255; bytes[14] = 255; expect(decodeS2C(bytes)).toEqual({ ok: false, err: 'BAD_COUNT' });
    expect(decodeC2S(new Uint8Array(C2S_MAX_BYTES + 1)).ok).toBe(false);
    expect(decodeS2C(new Uint8Array(S2C_MAX_BYTES + 1)).ok).toBe(false);
    const badEnum = encodeS2C({ type: 'VEHICLE_STATE', vehicleId: 1, playerId: 1, mode: 'driver' }); badEnum[9] = 255;
    expect(decodeS2C(badEnum).ok).toBe(false);
    const badBool = encodeS2C({ type: 'EVENT_STATE', eventId: 1, playerId: 1, present: false }); badBool[9] = 2;
    expect(decodeS2C(badBool).ok).toBe(false);
    const badTime = encodeC2S({ type: 'PING', nonce: 0, clientT: 1 }); new DataView(badTime.buffer).setFloat64(5, NaN, true);
    expect(decodeC2S(badTime).ok).toBe(false);
    expect(decodeC2S(new Uint8Array([C2S.HELLO, 1, 0, 0])).ok).toBe(false);
    expect(() => encodeC2S({ type: 'HELLO', name: 'Karl', resumeToken: 'bad' })).toThrow();
    expect(() => encodeC2S({ type: 'CHAT', clientMsgId: 1, eventId: 0, text: '🌉'.repeat(81) })).toThrow();
  });
  it('retains earlier frames across later encodes and accepts maximum UTF-8 control payloads', () => {
    const message: S2CMessage = { type: 'CHAT_BROADCAST', messageId: 1, senderId: 2, eventId: 3, serverT: 100,
      name: '🌉'.repeat(12), text: '🌉'.repeat(80) };
    const retained = encodeS2C(message), original = retained.slice();
    for (const reply of replies) encodeS2C(reply);
    expect(retained).toEqual(original);
    expect(decodeS2C(retained)).toEqual({ ok: true, msg: message });
    const empty: S2CMessage = { type: 'SNAPSHOT', tick: 1, serverT: 100, entries: [] };
    expect(decodeS2C(encodeS2C(empty))).toEqual({ ok: true, msg: empty });
  });
});

it('normalizes anonymous nicknames while rejecting blank, control and oversized labels', () => {
  expect(normalizeNickname('  Ｋａｒｌ   🌁 ')).toBe('Karl 🌁');
  expect(normalizeNickname('雪 👩‍💻')).toBe('雪 👩‍💻');
  for (const name of ['', '   ', '\u200b', 'Karl\u202e', 'Ka\0rl', '\ud800', '🌁'.repeat(13)]) expect(normalizeNickname(name)).toBeNull();
  expect(normalizeNickname('a'.repeat(48))).toBe('a'.repeat(48));
});
