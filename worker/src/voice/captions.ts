/**
 * Spoken bubbles server storage (flag voiceCaptions, docs/engineering/spoken-bubbles.md, gtasf-qjja):
 * per-device and per-IP caption budgets, the $20/day transcription spend meter, moderation strikes toward the
 * existing 24 h voice ban, and report-attached caption transcripts with a 7-day purge. No audio is stored.
 */
import { fundingDay } from '@gtasf/shared/funding';
import { referralRateLimit } from '../referrals/store';
import { hashedIpKey } from '../referrals/ipLimiter';

/** Workers AI @cf/openai/whisper-large-v3-turbo price: $0.00051 per audio minute (Cloudflare Workers AI pricing).
 *  Keep in one place; check against the current price list. */
export const STT_USD_PER_MINUTE = 0.00051;
export const STT_USD_PER_HOUR = STT_USD_PER_MINUTE * 60;
/** Founder hard cap on transcription spend per SF day. */
export const CAPTION_DAILY_USD = 20;
export const CAPTION_DAILY_SECONDS = Math.floor(CAPTION_DAILY_USD / STT_USD_PER_HOUR * 3600);
/** Push-to-talk auto-releases at 8 s; a clip is billed as at least 1 s. */
export const CAPTION_MAX_SECONDS = 8, CAPTION_MIN_BILL_SECONDS = 1;
export const CAPTION_BURST = 4, CAPTION_REFILL_MS = 4_000;
export const CAPTION_IP_MAX = 60, CAPTION_IP_WINDOW_MS = 600_000;
export const CAPTION_RING_MS = 120_000, CAPTION_REPORT_RETENTION_MS = 7 * 86_400_000;
/** A moderation-rejected caption counts like one report; the existing threshold (3 in 1 h -> 24 h ban) applies. */
export const CAPTION_STRIKE_WINDOW_MS = 3_600_000, CAPTION_STRIKE_THRESHOLD = 3, CAPTION_BAN_MS = 86_400_000;

/** Per-device token bucket (burst 4, one clip per 4 s), stored beside the other voice buckets. */
export async function captionDeviceBudget(db: D1Database, deviceId: string, now: number): Promise<boolean> {
  return Boolean(await db.prepare(`INSERT INTO voice_publish_budget(device_id,credit,at) VALUES(?,?,?)
    ON CONFLICT(device_id) DO UPDATE SET credit=MIN(?,credit+1.0*MAX(0,excluded.at-at)/?)-1, at=MAX(at,excluded.at)
    WHERE MIN(?,credit+1.0*MAX(0,excluded.at-at)/?)>=1 RETURNING device_id`)
    .bind(`caption:${deviceId}`, CAPTION_BURST - 1, now, CAPTION_BURST, CAPTION_REFILL_MS, CAPTION_BURST, CAPTION_REFILL_MS).first());
}
/** Per-IP cap across rotating device cookies. */
export async function captionIpBudget(db: D1Database, ip: string, now: number, secret?: string): Promise<boolean> {
  return referralRateLimit(db, await hashedIpKey('voice-caption-ip:', 'gtasf-voice-caption', ip, now, secret), CAPTION_IP_MAX, CAPTION_IP_WINDOW_MS, now); // gtasf-cnjpc
}
/** Upload cap: 8 s at up to ~160 kbps fits easily (webm/opus ~32 kbps, Safari mp4/aac ~64 kbps). */
export const CAPTION_MAX_BYTES = 160_000;
/** Living map pitching (flags.pitching): a clip sent with X-GTASF-Pitch may run 15 s (founder plan); same meter. */
export const PITCH_MAX_SECONDS = 15, PITCH_MAX_BYTES = 300_000;
/** Conservative bitrate floor (32 kbps) used to estimate a clip's length from its size before transcription. */
const CAPTION_MIN_BYTES_PER_SECOND = 4_000;
/**
 * Seconds to RESERVE before transcription: the larger of the client-reported length and a size-based estimate,
 * clamped to [1, 8]. Never trusted alone: reconcileCaptionSeconds charges the provider-measured length afterwards
 * (gtasf-wd9h: a modified client could otherwise claim 1 s for a long low-bitrate upload).
 */
export function billableSeconds(reported: number, bytes = 0, maxSeconds = CAPTION_MAX_SECONDS): number {
  const estimate = Math.max(Number.isFinite(reported) ? reported : maxSeconds, bytes / CAPTION_MIN_BYTES_PER_SECOND);
  return Math.min(maxSeconds, Math.max(CAPTION_MIN_BILL_SECONDS, estimate));
}
/**
 * After transcription, charge the difference between the provider-measured length and the reservation (no cap check:
 * the provider already billed it). The next reservation then sees the true total, so the cap holds; overshoot is
 * bounded by clips already in flight. A missing duration keeps the reservation.
 */
export async function reconcileCaptionSeconds(db: D1Database, reserved: number, actual: number | undefined, now: number): Promise<number> {
  if (actual === undefined || !Number.isFinite(actual) || actual <= reserved) return reserved;
  await db.prepare('UPDATE voice_caption_spend SET seconds=seconds+? WHERE day=?').bind(actual - reserved, fundingDay(now)).run();
  return actual;
}
/**
 * Atomically reserve `seconds` of today's transcription budget BEFORE calling the provider, so concurrent clips can
 * never overshoot the cap. False (and the overflow counted and logged) once the day is spent.
 */
export async function reserveCaptionSeconds(db: D1Database, seconds: number, now: number, capSeconds = CAPTION_DAILY_SECONDS): Promise<boolean> {
  const day = fundingDay(now);
  const row = await db.prepare(`INSERT INTO voice_caption_spend(day,seconds,refused) SELECT ?,?,0 WHERE ?<=?
    ON CONFLICT(day) DO UPDATE SET seconds=seconds+excluded.seconds WHERE seconds+excluded.seconds<=? RETURNING seconds`)
    .bind(day, seconds, seconds, capSeconds, capSeconds).first();
  if (row) return true;
  await db.prepare('INSERT INTO voice_caption_spend(day,seconds,refused) VALUES(?,0,1) ON CONFLICT(day) DO UPDATE SET refused=refused+1').bind(day).run();
  console.warn('voice captions paused: daily transcription cap reached', JSON.stringify({ day, capUsd: CAPTION_DAILY_USD }));
  return false;
}
/**
 * Release a reservation when the provider refused or failed the transcription (it bills nothing then), so an
 * outage such as an unpaid account cannot exhaust the day's meter. Never drops below zero.
 */
export async function releaseCaptionSeconds(db: D1Database, reserved: number, now: number): Promise<void> {
  if (!Number.isFinite(reserved) || reserved <= 0) return;
  await db.prepare('UPDATE voice_caption_spend SET seconds=MAX(0,seconds-?) WHERE day=?').bind(reserved, fundingDay(now)).run();
}
/** Record a moderation rejection as a strike; three in an hour bans voice (audio and captions) for 24 h. */
export async function recordCaptionStrike(db: D1Database, deviceId: string, now: number): Promise<{ banned: boolean }> {
  await db.prepare('INSERT OR IGNORE INTO voice_reports(reporter_device,target_device,at) VALUES(?,?,?)').bind(`moderation:${now}`, deviceId, now).run();
  const strikes = (await db.prepare("SELECT COUNT(*) n FROM voice_reports WHERE target_device=? AND reporter_device LIKE 'moderation:%' AND at>?")
    .bind(deviceId, now - CAPTION_STRIKE_WINDOW_MS).first<{ n: number }>())?.n ?? 0;
  if (strikes < CAPTION_STRIKE_THRESHOLD) return { banned: false };
  await db.prepare('INSERT INTO voice_bans(device_id,until_at,reason,created_at) VALUES(?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET until_at=MAX(until_at, excluded.until_at), reason=excluded.reason')
    .bind(deviceId, now + CAPTION_BAN_MS, 'caption-moderation', now).run();
  return { banned: true };
}

export interface CaptionLine { at: number; text: string }
/** In-memory per-player ring of the last ~2 min of APPROVED captions (WorldDO). Never persisted on its own. */
export class CaptionRing {
  private readonly lines = new Map<string, CaptionLine[]>();
  constructor(private readonly windowMs = CAPTION_RING_MS, private readonly maxLines = 40) {}
  add(deviceId: string, text: string, now: number): void {
    const list = this.prune(deviceId, now); list.push({ at: now, text });
    while (list.length > this.maxLines) list.shift();
    this.lines.set(deviceId, list);
  }
  recent(deviceId: string, now: number): CaptionLine[] { return [...this.prune(deviceId, now)]; }
  forget(deviceId: string): void { this.lines.delete(deviceId); }
  private prune(deviceId: string, now: number): CaptionLine[] {
    const list = (this.lines.get(deviceId) ?? []).filter(line => now - line.at <= this.windowMs);
    if (list.length) this.lines.set(deviceId, list); else this.lines.delete(deviceId);
    return list;
  }
}
/** Attach the reported player's recent captions to the report (the only time a transcript is stored). */
export async function attachReportCaptions(db: D1Database, targetDevice: string, reporterDevice: string, lines: readonly CaptionLine[], now: number): Promise<boolean> {
  if (!lines.length) return false;
  await db.prepare('INSERT INTO voice_report_captions(target_device,reporter_device,at,captions_json) VALUES(?,?,?,?)')
    .bind(targetDevice, reporterDevice, now, JSON.stringify(lines.slice(-40))).run();
  return true;
}
/** 7-day retention for report transcripts (3-hourly cron). */
export async function purgeReportCaptions(db: D1Database, now: number): Promise<number> {
  const result = await db.prepare('DELETE FROM voice_report_captions WHERE at<?').bind(now - CAPTION_REPORT_RETENTION_MS).run();
  return Number((result as { meta?: { changes?: number } }).meta?.changes ?? 0);
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
/** Fit a transcript into one chat bubble: whitespace collapsed, at most 160 graphemes (cut on a grapheme boundary). */
export function fitCaption(text: string, maxGraphemes = 160): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  let out = '', count = 0;
  for (const { segment } of graphemes.segment(clean)) { if (++count > maxGraphemes) break; out += segment; }
  return out;
}
