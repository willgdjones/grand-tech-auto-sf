/**
 * Founder Rank (flag founderRank) — the read-only ledger counts behind shared/founder/rank.ts. One aggregate over the
 * device's season credits (bucketed by source_ref prefix), plus fund-drop cheques and v1 event-room awards. No writes.
 */
import { FUNDING_SEASON } from '@gtasf/shared/funding';
import { founderRank, rankXp, type FounderRank, type RankCounts } from '@gtasf/shared/founder/rank';

export async function founderRankCounts(db: D1Database, deviceId: string): Promise<RankCounts> {
  const credits = await db.prepare(`SELECT
      SUM(CASE WHEN source_ref LIKE 'mission:steal-pitch-deck:%' THEN 1 ELSE 0 END) heist,
      SUM(CASE WHEN source_ref LIKE 'mission:acquihire:%' THEN 1 ELSE 0 END) acquihire,
      SUM(CASE WHEN source_ref LIKE 'mission:%' AND source_ref NOT LIKE 'mission:steal-pitch-deck:%' AND source_ref NOT LIKE 'mission:acquihire:%' THEN 1 ELSE 0 END) mission,
      SUM(CASE WHEN source_ref LIKE 'bounty:%' THEN 1 ELSE 0 END) bounty,
      SUM(CASE WHEN source_ref LIKE 'pitch:%' THEN 1 ELSE 0 END) pitch,
      SUM(CASE WHEN source_ref LIKE 'robbery:%' THEN 1 ELSE 0 END) robbery,
      SUM(CASE WHEN source_ref LIKE 'meme:%' THEN 1 ELSE 0 END) meme,
      SUM(CASE WHEN source_ref LIKE 'pilgrimage:%' THEN 1 ELSE 0 END) pilgrimage,
      SUM(CASE WHEN source = 'event' THEN 1 ELSE 0 END) event
    FROM funding_credits WHERE device_id=? AND season=?`).bind(deviceId, FUNDING_SEASON).first<Record<string, number | null>>();
  const drops = await db.prepare('SELECT COUNT(*) n FROM fund_drop_claims WHERE device_id=? AND season=?').bind(deviceId, FUNDING_SEASON).first<{ n: number }>().catch(() => null);
  const awards = await db.prepare('SELECT COUNT(*) n FROM funding_awards WHERE device_id=? AND season=?').bind(deviceId, FUNDING_SEASON).first<{ n: number }>().catch(() => null);
  const n = (k: string) => Number(credits?.[k] ?? 0);
  return { heist: n('heist'), acquihire: n('acquihire'), mission: n('mission'), bounty: n('bounty'), pitch: n('pitch'), robbery: n('robbery'),
    meme: n('meme'), pilgrimage: n('pilgrimage'), event: n('event') + Number(awards?.n ?? 0), drop: Number(drops?.n ?? 0) };
}
export async function founderRankFor(db: D1Database, deviceId: string): Promise<FounderRank & { counts: RankCounts }> {
  const counts = await founderRankCounts(db, deviceId);
  return { ...founderRank(rankXp(counts)), counts };
}
