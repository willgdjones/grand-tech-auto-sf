import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FUNDING_SEASON } from '@gtasf/shared/funding';
import { RANK_XP } from '@gtasf/shared/founder/rank';
import { founderRankCounts, founderRankFor } from './rankQuery';

const MIGRATIONS = ['0010_funding.sql', '0014_funding_bonus.sql', '0018_fund_drops.sql', '0020_funding_credits.sql', '0021_referral_reward_amount.sql'];
function db() {
  const sqlite = new DatabaseSync(':memory:');
  for (const m of MIGRATIONS) sqlite.exec(readFileSync(new URL(`../../migrations/${m}`, import.meta.url), 'utf8'));
  const d1 = { prepare(sql: string) { const st = sqlite.prepare(sql); let b: (string | number)[] = [];
    const w = { bind(...v: (string | number)[]) { b = v; return w; }, async first() { return st.get(...b) ?? null; } }; return w; } } as unknown as D1Database;
  return { sqlite, d1 };
}
const credit = (sqlite: DatabaseSync, device: string, source: string, ref: string, season = FUNDING_SEASON) =>
  sqlite.prepare('INSERT INTO funding_credits(id,device_id,season,source,source_ref,label,day,awarded_at,amount_cents) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(`${device}-${ref}-${season}`, device, season, source, ref, 'x', '2026-10-15', 1, 100);

describe('founderRankCounts (read-only ledger counts)', () => {
  it('buckets credits by ref prefix; other devices and seasons do not count', async () => {
    const { sqlite, d1 } = db();
    for (const d of ['p', 'other']) sqlite.prepare('INSERT INTO funding_profiles(device_id,token_hash,startup_name,nickname,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(d, `h-${d}`, 'S', d, 1, 1);
    credit(sqlite, 'p', 'celebrity', 'mission:steal-pitch-deck:2026-10-14');
    credit(sqlite, 'p', 'celebrity', 'mission:steal-pitch-deck:2026-10-15');
    credit(sqlite, 'p', 'celebrity', 'mission:acquihire:2026-10-15');
    credit(sqlite, 'p', 'celebrity', 'mission:cofounder-hunt:2026-10-15');
    credit(sqlite, 'p', 'celebrity', 'pitch:vc:pear:2026-10-15');
    credit(sqlite, 'p', 'celebrity', 'pilgrimage:coit-tower');
    credit(sqlite, 'p', 'celebrity', 'robbery:corner:2026-10-15');
    credit(sqlite, 'p', 'celebrity', 'bounty:2026-10-15');
    credit(sqlite, 'p', 'celebrity', 'meme:share:npc');
    credit(sqlite, 'p', 'event', 'evt-1');
    credit(sqlite, 'other', 'celebrity', 'mission:steal-pitch-deck:2026-10-15');
    credit(sqlite, 'p', 'celebrity', 'pitch:vc:pear:2025-01-01', 'old-season');
    const counts = await founderRankCounts(d1, 'p');
    expect(counts).toMatchObject({ heist: 2, acquihire: 1, mission: 1, pitch: 1, pilgrimage: 1, robbery: 1, bounty: 1, meme: 1, event: 1, drop: 0 });
    const rank = await founderRankFor(d1, 'p');
    expect(rank.xp).toBe(2 * RANK_XP.heist + RANK_XP.acquihire + RANK_XP.mission + RANK_XP.pitch + RANK_XP.pilgrimage + RANK_XP.robbery + RANK_XP.bounty + RANK_XP.meme + RANK_XP.event);
    expect(rank.level).toBeGreaterThan(1);
    expect(await founderRankFor(d1, 'nobody')).toMatchObject({ xp: 0, level: 1, title: 'Hacker' });
  });
});
