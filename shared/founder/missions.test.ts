import { describe, expect, it } from 'vitest';
import { MISSIONS, MISSION_ARRIVE_RADIUS_M, missionById, missionCredit, missionPayoutCents } from './missions';
import { FUNDING_BASE_CENTS } from '../funding';

const NOON_PT = Date.parse('2026-10-08T19:00:00Z');

describe('mission spec', () => {
  it('each mission has an ordered objective list, a valuation payout multiple, and a letter marker', () => {
    expect(MISSIONS.length).toBeGreaterThan(0);
    for (const m of MISSIONS) {
      expect(m.id).toMatch(/^[a-z0-9-]+$/);
      expect(m.objectives.length).toBeGreaterThan(0);
      if (!m.acquihire) expect(m.payoutDemoX).toBeGreaterThan(0n); // acqui-hire pays 1.5× its escrowed price instead
      expect(m.start.letter).toMatch(/^[A-Z]$/);
      expect(['once', 'daily']).toContain(m.cooldown);
      for (const o of m.objectives) expect(['goto', 'collect', 'deliver', 'escape']).toContain(o.kind);
    }
  });

  it('the Steal the Pitch Deck heist grabs at the rival office and delivers to First Round', () => {
    const heist = missionById('steal-pitch-deck');
    expect(heist).toBeDefined();
    expect(heist!.kind).toBe('heist');
    expect(heist!.objectives.map(o => o.kind)).toEqual(['collect', 'escape', 'deliver']);
    const deliver = heist!.objectives.find(o => o.kind === 'deliver')!;
    expect(deliver.at).toEqual({ lat: 37.799653, lon: -122.400453 }); // First Round / FiDi (walkable-snapped, verified via prod ?at= spawn)
    expect(missionById('no-such')).toBeUndefined();
  });

  it('payout scales with the active economy demo base', () => {
    const heist = missionById('steal-pitch-deck')!;
    expect(missionPayoutCents(heist)).toBe(FUNDING_BASE_CENTS.demo * 4n);
  });

  it('credit ref: a daily mission keys on the SF day; a once-ever mission does not', () => {
    const heist = missionById('steal-pitch-deck')!; // daily
    expect(missionCredit(heist, NOON_PT)).toEqual({ source: 'celebrity', sourceRef: 'mission:steal-pitch-deck:2026-10-08' });
    expect(missionCredit(heist, NOON_PT + 86_400_000).sourceRef).toBe('mission:steal-pitch-deck:2026-10-09');
    // A hypothetical once-ever mission omits the day (same ref every day → pays at most once ever).
    const once = { ...heist, id: 'one-shot', cooldown: 'once' as const };
    expect(missionCredit(once, NOON_PT).sourceRef).toBe('mission:one-shot');
    expect(missionCredit(once, NOON_PT + 86_400_000).sourceRef).toBe('mission:one-shot');
  });

  it('exposes a default arrival radius', () => {
    expect(MISSION_ARRIVE_RADIUS_M).toBeGreaterThan(0);
  });
});
