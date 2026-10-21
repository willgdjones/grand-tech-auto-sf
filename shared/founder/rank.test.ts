import { describe, expect, it } from 'vitest';
import { RANK_XP, founderRank, rankTitle, rankXp, xpForLevel } from './rank';

describe('founder rank', () => {
  it('XP sums each activity × its weight, ignoring junk', () => {
    expect(rankXp({})).toBe(0);
    expect(rankXp({ heist: 1, pitch: 2, pilgrimage: 3 })).toBe(RANK_XP.heist + 2 * RANK_XP.pitch + 3 * RANK_XP.pilgrimage);
    expect(rankXp({ mission: -4, event: 0 })).toBe(0);
  });
  it('levels follow 50·L·(L−1) exactly at every boundary', () => {
    expect(founderRank(0)).toMatchObject({ level: 1, title: 'Hacker', into: 0, span: 100 });
    for (const level of [2, 3, 5, 10, 20, 37]) {
      expect(founderRank(xpForLevel(level)).level).toBe(level);
      expect(founderRank(xpForLevel(level) - 1).level).toBe(level - 1);
    }
    expect(founderRank(650)).toMatchObject({ level: 4, into: 50, span: 400 });
  });
  it('titles by band', () => {
    expect([1, 2, 3, 5, 6, 9, 10, 14, 15, 19, 20, 50].map(rankTitle)).toEqual(
      ['Hacker', 'Hacker', 'Builder', 'Builder', 'Founder', 'Founder', 'Operator', 'Operator', 'Mogul', 'Mogul', 'Unicorn', 'Unicorn']);
  });
});
