/**
 * Voice metrics (founder: "how many people have tried to speak?"): aggregate, no-PII daily counters keyed by
 * Pacific day (migration 0039). Counts: caption attempts by outcome, voice sessions, publish-gate results.
 * Unique devices per day are stored only as SHA-256(per-day random salt + device id); the salt is purged once
 * its day is over, so hashes are unlinkable to devices and across days. Every write is best-effort: metrics
 * never fail or slow a voice request beyond one small D1 write.
 */
import { fundingDay } from '@gtasf/shared/funding';

export const CAPTION_OUTCOMES = ['sent', 'empty', 'rejected', 'dropped', 'unavailable', 'refused-budget', 'refused-banned', 'error'] as const;
export type CaptionOutcome = typeof CAPTION_OUTCOMES[number];
/** Device sets counted once per day. */
export type VoiceDeviceMetric = 'caption_speaker' | 'voice_optin' | 'verified_speaker';

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function daySalt(db: D1Database, day: string): Promise<string> {
  const fresh = [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
  await db.prepare('INSERT INTO voice_metric_salt(day,salt) VALUES(?,?) ON CONFLICT(day) DO NOTHING').bind(day, fresh).run();
  const row = await db.prepare('SELECT salt FROM voice_metric_salt WHERE day=?').bind(day).first<{ salt: string }>();
  return row?.salt ?? fresh;
}

export async function countVoice(db: D1Database, metric: string, outcome: string, now = Date.now()): Promise<void> {
  try {
    await db.prepare(`INSERT INTO voice_metric_counts(day,metric,outcome,count) VALUES(?,?,?,1)
      ON CONFLICT(day,metric,outcome) DO UPDATE SET count=count+1`).bind(fundingDay(now), metric, outcome).run();
  } catch { /* best-effort */ }
}
export async function countVoiceDevice(db: D1Database, metric: VoiceDeviceMetric, deviceId: string, now = Date.now()): Promise<void> {
  if (!deviceId) return;
  try {
    const day = fundingDay(now), hash = await sha256Hex(`${await daySalt(db, day)}\u0000${deviceId}`);
    await db.prepare('INSERT INTO voice_metric_devices(day,metric,hash) VALUES(?,?,?) ON CONFLICT DO NOTHING').bind(day, metric, hash).run();
  } catch { /* best-effort */ }
}
/** One caption attempt: its outcome plus the speaking device (unique per day). */
export async function countCaption(db: D1Database, outcome: CaptionOutcome, deviceId: string, now = Date.now()): Promise<void> {
  await countVoice(db, 'caption', outcome, now);
  await countVoiceDevice(db, 'caption_speaker', deviceId, now);
}
/** Cron: drop salts for finished days (keeps today's and yesterday's), so old hashes become unlinkable. */
export async function purgeVoiceMetricSalts(db: D1Database, now = Date.now()): Promise<number> {
  const keep = fundingDay(now - 86_400_000);
  const result = await db.prepare('DELETE FROM voice_metric_salt WHERE day<?').bind(keep).run();
  return Number(result.meta?.changes ?? 0);
}
/** Daily report rows for tools/voice-report.mjs (and tests). */
export async function voiceReport(db: D1Database, days = 7, now = Date.now()) {
  const since = fundingDay(now - (days - 1) * 86_400_000);
  const counts = (await db.prepare('SELECT day,metric,outcome,count FROM voice_metric_counts WHERE day>=? ORDER BY day,metric,outcome').bind(since).all<{ day: string; metric: string; outcome: string; count: number }>()).results ?? [];
  const devices = (await db.prepare('SELECT day,metric,COUNT(*) AS devices FROM voice_metric_devices WHERE day>=? GROUP BY day,metric ORDER BY day,metric').bind(since).all<{ day: string; metric: string; devices: number }>()).results ?? [];
  return { counts, devices };
}
