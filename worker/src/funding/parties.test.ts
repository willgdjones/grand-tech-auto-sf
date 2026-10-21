import { describe, expect, it } from 'vitest';
import { fundingRound, type FundingProfile } from '@gtasf/shared/funding';
import { FundingPartiesState } from './parties';
import type { FundingPeer } from './world';

describe('earned party authority', () => {
  it('requires an earned round and real peer, shares its server position and expires without an award', () => {
    const state = new FundingPartiesState(), totalCents = '1500000000';
    const profile: FundingProfile = { deviceId: 'founder', startupName: 'Real Startup', nickname: 'Founder', totalCents,
      todayCents: totalCents, round: fundingRound(totalCents), rank: 1, todayRank: 1, lastAwardAt: 1, streak: 1 };
    const peer: FundingPeer = { id: 1, deviceId: profile.deviceId, onFoot: true, pose: { x: 118103, y: 294, z: -120916, yaw: 0, flags: 0 } };
    expect(() => state.set({ ...profile, totalCents: '0' }, true, [peer], 1000)).toThrow(/Series A/);
    expect(() => state.set(profile, true, [], 1000)).toThrow(/on foot/);
    expect(() => state.set(profile, true, [{ ...peer, onFoot: false }], 1000)).toThrow(/on foot/);
    state.set(profile, true, [peer], 1000);
    const view = state.snapshot('other-player', [peer], 1100);
    expect(view.parties[0]?.anchor).toEqual({ x: 1181.03, y: 2.94, z: -1209.16 });
    expect(view.yours).toBeNull();
    expect(state.snapshot(profile.deviceId, [peer], 1100).yours?.startupName).toBe('Real Startup');
    expect(state.snapshot(profile.deviceId, [peer], 901000).parties).toEqual([]);
    state.set(profile, true, [peer], 902000);
    expect(state.snapshot(profile.deviceId, [], 902100).parties).toEqual([]);
    expect(profile.totalCents).toBe(totalCents);
  });
});
