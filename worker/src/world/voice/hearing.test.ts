import { describe, expect, it } from 'vitest';
import { decodeC2S, encodeC2S } from '@gtasf/shared/protocol/c2s';
import { decodeS2C, encodeS2C } from '@gtasf/shared/protocol/s2c';
import { VOICE_PEERS_MAX } from '@gtasf/shared/protocol/constants';
import { voiceGain, voicePeers, WorldVoice, type VoicePlayer } from './hearing';

const at = (id: number, metresX: number, extra: Partial<VoicePlayer> = {}): VoicePlayer =>
  ({ id, x: metresX * 100, y: 0, z: 0, vehicleId: 0, eventId: 0, ...extra });
const track = (id: number) => ({ sessionId: `s${id}`, trackName: `t${id}` });

describe('voice who-can-hear', () => {
  it('is full volume within 10 m, fades linearly, and is silent from 40 m', () => {
    const speaker = at(1, 0);
    expect(voiceGain(at(2, 10), speaker)).toBe(1);
    expect(voiceGain(at(2, 25), speaker)).toBeCloseTo(0.5);
    expect(voiceGain(at(2, 40), speaker)).toBe(0);
    expect(voiceGain(at(2, 50), speaker)).toBe(0);
  });

  it('hears everyone in the same vehicle at full volume and the same event room at 0.8, at any distance', () => {
    expect(voiceGain(at(2, 500, { vehicleId: 7 }), at(1, 0, { vehicleId: 7 }))).toBe(1);
    expect(voiceGain(at(2, 500, { eventId: 9 }), at(1, 0, { eventId: 9 }))).toBe(0.8);
    expect(voiceGain(at(2, 500, { vehicleId: 7 }), at(1, 0, { vehicleId: 8 }))).toBe(0);
    // Close by in an event room: proximity wins over the room level.
    expect(voiceGain(at(2, 5, { eventId: 9 }), at(1, 0, { eventId: 9 }))).toBe(1);
  });

  it('lists only publishing speakers, never yourself or muted players, loudest first', () => {
    const players = [at(1, 0, { track: track(1) }), at(2, 20, { track: track(2) }), at(3, 5), at(4, 100, { track: track(4) })];
    const peers = voicePeers(players, new Map([[3, new Set([2])]]));
    expect(peers.get(3)!.map(p => p.playerId)).toEqual([1]);
    expect(peers.get(1)!.map(p => [p.playerId, p.gain])).toEqual([[2, Math.round(255 * 20 / 30)]]);
    expect(peers.get(4)).toEqual([]);
    expect(peers.get(2)!.find(p => p.playerId === 2)).toBeUndefined();
  });

  it('caps a crowded event room at VOICE_PEERS_MAX peers', () => {
    const crowd = Array.from({ length: VOICE_PEERS_MAX + 10 }, (_, i) => at(i + 1, i * 3, { eventId: 9, track: track(i + 1) }));
    expect(voicePeers(crowd, new Map()).get(1)).toHaveLength(VOICE_PEERS_MAX);
  });
});

describe('WorldVoice', () => {
  it('sends a listener their peers only when the set changes, and clears it when the speaker stops', () => {
    const voice = new WorldVoice(), world = [at(1, 0), at(2, 5)];
    expect(voice.update(world)).toEqual([]);
    voice.publish(1, track(1));
    expect(voice.update(world)).toEqual([[2, [{ playerId: 1, sessionId: 's1', trackName: 't1', gain: 255 }]]]);
    expect(voice.update(world)).toEqual([]);
    voice.stop(1);
    expect(voice.update(world)).toEqual([[2, []]]);
  });

  it('applies mutes and forgets a player who leaves', () => {
    const voice = new WorldVoice(), world = [at(1, 0), at(2, 5)];
    voice.publish(1, track(1)); voice.update(world);
    voice.mute(2, 1, true);
    expect(voice.update(world)).toEqual([[2, []]]);
    voice.mute(2, 1, false);
    expect(voice.update(world)[0]![1]).toHaveLength(1);
    voice.remove(1);
    expect(voice.speaking(1)).toBe(false);
    expect(voice.update([at(2, 5)])).toEqual([[2, []]]);
  });
});

describe('voice protocol', () => {
  it('round-trips the client and server voice messages', () => {
    for (const m of [{ type: 'VOICE_PUBLISH', sessionId: 'abc_1', trackName: 'mic-1' }, { type: 'VOICE_STOP' }, { type: 'VOICE_MUTE', target: 42, muted: true }] as const)
      expect(decodeC2S(encodeC2S(m))).toEqual({ ok: true, msg: m });
    const peers = { type: 'VOICE_PEERS' as const, peers: [{ playerId: 7, sessionId: 's7', trackName: 't7', gain: 204 }] };
    expect(decodeS2C(encodeS2C(peers))).toEqual({ ok: true, msg: peers });
    expect(decodeS2C(encodeS2C({ type: 'VOICE_STATE', playerId: 3, state: 'refused-unverified' }))).toEqual({ ok: true, msg: { type: 'VOICE_STATE', playerId: 3, state: 'refused-unverified' } });
  });

  it('refuses ids that are not opaque URL-safe tokens and out-of-range mute flags', () => {
    expect(decodeC2S(encodeC2S({ type: 'VOICE_PUBLISH', sessionId: 'a b', trackName: 't' })).ok).toBe(false);
    const mute = encodeC2S({ type: 'VOICE_MUTE', target: 1, muted: true }); mute[mute.length - 1] = 2;
    expect(decodeC2S(mute).ok).toBe(false);
    expect(() => encodeS2C({ type: 'VOICE_PEERS', peers: Array.from({ length: VOICE_PEERS_MAX + 1 }, (_, i) => ({ playerId: i, sessionId: 's', trackName: 't', gain: 1 })) })).toThrow();
  });
});
