/**
 * Founder Rank (flag founderRank; GTA V critique #20 "nothing persists", RP-style): XP earned from the things a player
 * has DONE — jobs, the heist, pitches, side quests, pilgrimages, crimes, bounties, event cheques, fund drops — counted
 * read-only from the season's ledgers (no new money, no new writes), turned into a level + title: a bare 'LV n' on the
 * crown chip, the full rank in the jobs phone, and a centre RANK UP splash on a level change.
 */
export const RANK_XP = Object.freeze({
  heist: 250,      // mission:steal-pitch-deck:<day>
  acquihire: 200,  // mission:acquihire:<day>
  bounty: 200,     // bounty:<day>
  mission: 150,    // any other mission:<id>[:<day>]
  pitch: 100,      // pitch:<kind>:<id>:<day> (the ladder's rounds, angels, VCs)
  robbery: 80,     // robbery:<store>:<day>
  meme: 75,        // meme:drive|share:<npc>…
  pilgrimage: 60,  // pilgrimage:<site>
  drop: 30,        // a VC fund-drop cheque
  event: 20,       // a drive-through / event-room cheque
});
export type RankActivity = keyof typeof RANK_XP;
export type RankCounts = Partial<Record<RankActivity, number>>;

export function rankXp(counts: RankCounts): number {
  let xp = 0;
  for (const [k, n] of Object.entries(counts) as [RankActivity, number | undefined][]) if (n && n > 0 && RANK_XP[k]) xp += RANK_XP[k] * Math.floor(n);
  return xp;
}

/** Level L starts at 50·L·(L−1) XP: L2 at 100, L3 at 300, L4 at 600, L5 at 1,000, L10 at 4,500, L20 at 19,000. */
export const xpForLevel = (level: number): number => 50 * level * (level - 1);
// Flatter the climb, never demote after a win (critic 03:35): track the founder fantasy, Hacker → Unicorn.
const TITLES: readonly [number, string][] = [[20, 'Unicorn'], [15, 'Mogul'], [10, 'Operator'], [6, 'Founder'], [3, 'Builder'], [1, 'Hacker']];
export const rankTitle = (level: number): string => (TITLES.find(([min]) => level >= min) ?? TITLES[TITLES.length - 1]!)[1];

export interface FounderRank {
  readonly xp: number;
  readonly level: number;
  readonly title: string;
  /** XP into the current level / XP the next level needs (for a progress bar). */
  readonly into: number;
  readonly span: number;
}
export function founderRank(xp: number): FounderRank {
  const safe = Math.max(0, Math.floor(xp));
  // Solve 50·L·(L−1) <= xp for the largest L (then guard float error).
  let level = Math.max(1, Math.floor((1 + Math.sqrt(1 + safe / 12.5)) / 2));
  while (xpForLevel(level + 1) <= safe) level++;
  while (level > 1 && xpForLevel(level) > safe) level--;
  return { xp: safe, level, title: rankTitle(level), into: safe - xpForLevel(level), span: xpForLevel(level + 1) - xpForLevel(level) };
}
