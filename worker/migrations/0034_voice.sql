-- Proximity voice (flag proximityVoice, docs/engineering/proximity-voice.md, gtasf-bdzy).
-- The Worker proxies Cloudflare Realtime: sessions belong to one funding device; a published (local) track
-- is recorded only after the verified-email / ban / rate gate, and WorldDO accepts VOICE_PUBLISH only for a
-- recorded track. No audio, transcript or recording is ever stored.
CREATE TABLE IF NOT EXISTS voice_sessions (
  session_id TEXT PRIMARY KEY,
  device_id  TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS voice_tracks (
  session_id    TEXT NOT NULL,
  track_name    TEXT NOT NULL,
  device_id     TEXT NOT NULL,
  authorised_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, track_name)
);
-- Three reports from different devices within an hour revoke a speaker's voice for 24 hours.
CREATE TABLE IF NOT EXISTS voice_reports (
  reporter_device TEXT NOT NULL,
  target_device   TEXT NOT NULL,
  at              INTEGER NOT NULL,
  PRIMARY KEY (reporter_device, target_device, at)
);
CREATE INDEX IF NOT EXISTS idx_voice_reports_target ON voice_reports(target_device, at);
CREATE TABLE IF NOT EXISTS voice_bans (
  device_id  TEXT PRIMARY KEY,
  until_at   INTEGER NOT NULL,
  reason     TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
-- Which published tracks each listener device may subscribe to right now, written by WorldDO whenever that
-- listener's audible set changes. The proxy refuses remote subscriptions not listed here, so an old
-- session/track id cannot be used to listen after leaving range, muting, or the speaker's ban.
CREATE TABLE IF NOT EXISTS voice_grants (
  listener_device TEXT NOT NULL,
  session_id      TEXT NOT NULL,
  track_name      TEXT NOT NULL,
  granted_at      INTEGER NOT NULL,
  PRIMARY KEY (listener_device, session_id, track_name)
);
CREATE TABLE IF NOT EXISTS voice_publish_budget (
  device_id TEXT PRIMARY KEY,
  credit    REAL NOT NULL,
  at        INTEGER NOT NULL
);
