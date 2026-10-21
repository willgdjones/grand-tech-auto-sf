// D1 state for proximity voice (migration 0034): session ownership, the publish gate, authorised tracks,
// the report threshold and voice bans. Server logic: unit-tested in store.test.ts.
import type { VoiceState } from '@gtasf/shared/protocol/types';

/** Each PTT hold costs one credit; HTTP track setup has a separate bucket with the same limits. */
export const VOICE_PUBLISH_BURST = 6;
export const VOICE_PUBLISH_REFILL_MS = 10_000;
export const VOICE_REPORT_WINDOW_MS = 60 * 60_000;
export const VOICE_REPORT_THRESHOLD = 3;
export const VOICE_BAN_MS = 24 * 60 * 60_000;

export async function recordVoiceSession(db: D1Database, sessionId: string, deviceId: string, now: number): Promise<void> {
  await db.prepare('INSERT OR IGNORE INTO voice_sessions(session_id,device_id,created_at) VALUES(?,?,?)').bind(sessionId, deviceId, now).run();
}
export async function voiceSessionDevice(db: D1Database, sessionId: string): Promise<string | null> {
  return (await db.prepare('SELECT device_id FROM voice_sessions WHERE session_id=?').bind(sessionId).first<{ device_id: string }>())?.device_id ?? null;
}
export async function voiceBanned(db: D1Database, deviceId: string, now: number): Promise<boolean> {
  return Boolean(await db.prepare('SELECT 1 FROM voice_bans WHERE device_id=? AND until_at>?').bind(deviceId, now).first());
}

async function voiceEligibility(db: D1Database, deviceId: string, now: number): Promise<VoiceState> {
  const verified = await db.prepare('SELECT 1 FROM email_captures WHERE device_id=? AND verified_at IS NOT NULL').bind(deviceId).first();
  if (!verified) return 'refused-unverified';
  return await voiceBanned(db, deviceId, now) ? 'refused-banned' : 'speaking';
}

/** Check current eligibility and atomically spend one credit, including concurrent requests/tabs. */
export async function voicePublishGate(db: D1Database, deviceId: string, now: number, scope: 'publish' | 'setup' = 'publish'): Promise<VoiceState> {
  const eligible = await voiceEligibility(db, deviceId, now);
  if (eligible !== 'speaking') return eligible;
  // Separate key prefixes rate-limit setup without charging the first PTT hold twice.
  // Both buckets are device-wide, never per SFU session or world socket.
  const key = `${scope}:${deviceId}`;
  const spent = await db.prepare(`INSERT INTO voice_publish_budget(device_id,credit,at) VALUES(?,?,?)
    ON CONFLICT(device_id) DO UPDATE SET
      credit=MIN(?,credit+1.0*MAX(0,excluded.at-at)/?)-1,
      at=MAX(at,excluded.at)
    WHERE MIN(?,credit+1.0*MAX(0,excluded.at-at)/?)>=1
    RETURNING device_id`)
    .bind(key, VOICE_PUBLISH_BURST - 1, now, VOICE_PUBLISH_BURST, VOICE_PUBLISH_REFILL_MS,
      VOICE_PUBLISH_BURST, VOICE_PUBLISH_REFILL_MS).first();
  return spent ? 'speaking' : 'refused-rate';
}

/** TURN credential minting (GET /api/voice/ice) is a separate device-wide bucket: listeners need ICE too, so no
 *  verified-email check, but a device can't farm Realtime TURN credentials (burst 6, then 1 per 20 s). */
export const VOICE_ICE_BURST = 6, VOICE_ICE_REFILL_MS = 20_000;
export async function voiceIceBudget(db: D1Database, deviceId: string, now: number): Promise<boolean> {
  const spent = await db.prepare(`INSERT INTO voice_publish_budget(device_id,credit,at) VALUES(?,?,?)
    ON CONFLICT(device_id) DO UPDATE SET
      credit=MIN(?,credit+1.0*MAX(0,excluded.at-at)/?)-1,
      at=MAX(at,excluded.at)
    WHERE MIN(?,credit+1.0*MAX(0,excluded.at-at)/?)>=1
    RETURNING device_id`)
    .bind(`ice:${deviceId}`, VOICE_ICE_BURST - 1, now, VOICE_ICE_BURST, VOICE_ICE_REFILL_MS, VOICE_ICE_BURST, VOICE_ICE_REFILL_MS).first();
  return Boolean(spent);
}

export async function authoriseVoiceTracks(db: D1Database, sessionId: string, deviceId: string, trackNames: readonly string[], now: number): Promise<void> {
  if (!trackNames.length) return;
  await db.batch(trackNames.map(name => db.prepare('INSERT OR REPLACE INTO voice_tracks(session_id,track_name,device_id,authorised_at) VALUES(?,?,?,?)').bind(sessionId, name, deviceId, now)));
}

/** A reused track still needs current verification/ban checks; only a new hold spends the budget. */
export async function voiceTrackState(db: D1Database, deviceId: string | undefined, sessionId: string, trackName: string, now: number,
  intent: 'publish' | 'recheck' = 'recheck'): Promise<VoiceState> {
  if (!deviceId) return 'refused-unverified';
  const row = await db.prepare('SELECT device_id FROM voice_tracks WHERE session_id=? AND track_name=?').bind(sessionId, trackName).first<{ device_id: string }>();
  if (!row || row.device_id !== deviceId) return 'refused-off';
  return intent === 'publish' ? voicePublishGate(db, deviceId, now) : voiceEligibility(db, deviceId, now);
}

/**
 * Report the speaker behind `sessionId`. One counted report per reporter and target per hour; when
 * VOICE_REPORT_THRESHOLD different devices report within the window the target loses voice for 24 h.
 */
export async function reportVoice(db: D1Database, reporterDevice: string, sessionId: string, now: number): Promise<{ ok: boolean; banned: boolean; target?: string }> {
  const target = await voiceSessionDevice(db, sessionId);
  if (!target || target === reporterDevice) return { ok: false, banned: false };
  const since = now - VOICE_REPORT_WINDOW_MS;
  const recent = await db.prepare('SELECT 1 FROM voice_reports WHERE reporter_device=? AND target_device=? AND at>?').bind(reporterDevice, target, since).first();
  if (!recent) await db.prepare('INSERT OR IGNORE INTO voice_reports(reporter_device,target_device,at) VALUES(?,?,?)').bind(reporterDevice, target, now).run();
  const reporters = (await db.prepare('SELECT COUNT(DISTINCT reporter_device) n FROM voice_reports WHERE target_device=? AND at>?').bind(target, since).first<{ n: number }>())?.n ?? 0;
  if (reporters < VOICE_REPORT_THRESHOLD) return { ok: true, banned: false, target };
  await db.prepare('INSERT INTO voice_bans(device_id,until_at,reason,created_at) VALUES(?,?,?,?) ON CONFLICT(device_id) DO UPDATE SET until_at=MAX(until_at, excluded.until_at), reason=excluded.reason')
    .bind(target, now + VOICE_BAN_MS, 'reports', now).run();
  return { ok: true, banned: true, target };
}

/** Replace a listener device's subscribable tracks with exactly `tracks` (WorldDO, on every change). */
export async function setVoiceGrants(db: D1Database, listenerDevice: string, tracks: readonly { sessionId: string; trackName: string }[], now: number): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM voice_grants WHERE listener_device=?').bind(listenerDevice),
    ...tracks.map(track => db.prepare('INSERT OR IGNORE INTO voice_grants(listener_device,session_id,track_name,granted_at) VALUES(?,?,?,?)').bind(listenerDevice, track.sessionId, track.trackName, now)),
  ]);
}
/** May this device subscribe to that remote track right now? */
export async function voiceGranted(db: D1Database, listenerDevice: string, sessionId: string, trackName: string): Promise<boolean> {
  return Boolean(await db.prepare('SELECT 1 FROM voice_grants WHERE listener_device=? AND session_id=? AND track_name=?').bind(listenerDevice, sessionId, trackName).first());
}
