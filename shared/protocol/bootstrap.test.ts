import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { encodeC2S, decodeC2S } from './c2s';
import { encodeS2C, decodeS2C } from './s2c';
import { parseCents } from '../money';
import { validateRect, rectTileIds } from '../rect';
const pose = fc.record({ x: fc.integer({ min: -2_000_000, max: 2_000_000 }), y: fc.integer({ min: -2_000_000, max: 2_000_000 }), z: fc.integer({ min: -2_000_000, max: 2_000_000 }), yaw: fc.integer({ min: 0, max: 255 }), flags: fc.integer({ min: 0, max: 255 }) });
describe('city-scale binary protocol', () => {
  it('round-trips signed city coordinates beyond the old 256 m boundary', () => {
    fc.assert(fc.property(pose, fc.integer({ min: 0, max: 65535 }), (p, seq) => {
      const message = { type: 'MOVE' as const, seq, ...p };
      expect(decodeC2S(encodeC2S(message))).toEqual({ ok: true, msg: message });
    }), { numRuns: 150 });
  });
  it('carries more than 250 players and IDs above 255 without truncation', () => {
    const entries = Array.from({ length: 301 }, (_, i) => ({ id: 1000 + i, x: 900_000, y: 6500, z: -900_000, yaw: 255, flags: 0 }));
    const msg = { type: 'SNAPSHOT' as const, tick: 1, serverT: Date.now(), entries };
    expect(decodeS2C(encodeS2C(msg))).toEqual({ ok: true, msg });
  });
  it('never throws on arbitrary frames and rejects truncated/trailing data', () => {
    fc.assert(fc.property(fc.uint8Array({ maxLength: 4096 }), bytes => {
      expect(() => decodeC2S(bytes)).not.toThrow(); expect(() => decodeS2C(bytes)).not.toThrow();
    }), { numRuns: 250 });
    const frame = encodeC2S({ type: 'MOVE', seq: 0, x: 0, y: 0, z: 0, yaw: 0, flags: 0 });
    for (let n = 0; n < frame.length; n++) expect(decodeC2S(frame.slice(0, n)).ok).toBe(false);
    expect(decodeC2S(new Uint8Array([...frame, 0])).ok).toBe(false);
    expect(() => encodeC2S({ type: 'MOVE', seq: 1, x: 2_000_001, y: 0, z: 0, yaw: 0, flags: 0 })).toThrow();
  });
  it('round-trips handshake, chat, clock and corrections', () => {
    const messages = [{ type: 'HELLO', name: 'Karl 🌁' }, { type: 'CHAT', clientMsgId: 1, eventId: 0, text: 'See you at Lombard' }, { type: 'PING', nonce: 4, clientT: 1780000000000 }] as const;
    for (const msg of messages) expect(decodeC2S(encodeC2S(msg))).toEqual({ ok: true, msg });
    const replies = [{ type: 'WELCOME', id: 65536, serverT: 1780000000000, name: 'Karl', pose: { x: 0, y: 0, z: 0, yaw: 0, flags: 0 }, resumeToken: 'a'.repeat(64), lastMoveSeq: 0, resumed: false }, { type: 'PONG', nonce: 4, clientT: 1780000000000, serverT: 1780000000010 }, { type: 'PLAYER_LEAVE', id: 65536 }, { type: 'CORRECTION', pose: { x: -890_000, y: 12_000, z: 650_000, yaw: 1, flags: 0 } }] as const;
    for (const msg of replies) expect(decodeS2C(encodeS2C(msg))).toEqual({ ok: true, msg });
  });
});
it('keeps cents exact and rejects malformed external decimal strings', () => {
  expect(parseCents('9007199254740993', 10n ** 20n)).toEqual({ ok: true, value: 9007199254740993n });
  for (const value of ['01', '1\n', '-1', '1.0', '1e2']) expect(parseCents(value, 1000n).ok).toBe(false);
});
it('rectangle validation preserves voids and boundaries', () => {
  const surface = { id: 1, cols: 3, rows: 2, tileBase: 0, tileWeight: 1, isVoid: (col: number, row: number) => col === 2 && row === 1 };
  const cat = { surface: (id: number) => id === 1 ? surface : undefined };
  const rect = { surfaceId: 1, col0: 0, row0: 0, cols: 2, rows: 2 };
  expect(validateRect(cat, rect).ok).toBe(true); expect([...rectTileIds(surface, rect)]).toEqual([0, 1, 3, 4]);
  expect(validateRect(cat, { ...rect, cols: 3 }).ok).toBe(false);
  expect(validateRect(cat, { ...rect, col0: 2 }).ok).toBe(false);
});
