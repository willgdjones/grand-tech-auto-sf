-- Voice metrics (gtasf-voice-metrics): no-PII daily counters keyed by Pacific day. No device ids, IPs, text or audio.
-- voice_metric_counts: events by metric/outcome (caption attempts by outcome, voice sessions, publish-gate results).
CREATE TABLE IF NOT EXISTS voice_metric_counts (
  day TEXT NOT NULL,
  metric TEXT NOT NULL,
  outcome TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(day, metric, outcome)
);
-- Unique devices per day: SHA-256 of a random per-day salt + device id. The salt is deleted after its day
-- (voice_metric_salt), so a stored hash can never be linked back to a device or across days.
CREATE TABLE IF NOT EXISTS voice_metric_devices (
  day TEXT NOT NULL,
  metric TEXT NOT NULL,
  hash TEXT NOT NULL,
  PRIMARY KEY(day, metric, hash)
);
CREATE TABLE IF NOT EXISTS voice_metric_salt (
  day TEXT PRIMARY KEY,
  salt TEXT NOT NULL
);
