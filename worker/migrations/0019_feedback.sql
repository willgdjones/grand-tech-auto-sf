-- PLAN-v2 decision 10: F-key player feedback. One row per submission.
-- All player-reported fields are untrusted content for the founder to read; the
-- server derives created_at, id, theme and ip_hash. ip_hash is a salted digest
-- used only for rate limiting and dedup, never a raw address (no PII stored).
CREATE TABLE IF NOT EXISTS feedback (
  id            TEXT PRIMARY KEY,
  created_at    TEXT NOT NULL,
  text          TEXT NOT NULL,
  theme         TEXT NOT NULL,
  screenshot    TEXT,
  mode          TEXT,
  round         TEXT,
  startup       TEXT,
  nick          TEXT,
  world_x       REAL,
  world_z       REAL,
  lat           REAL,
  lon           REAL,
  location_name TEXT,
  path          TEXT,
  ip_hash       TEXT NOT NULL,
  user_agent    TEXT
);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_theme ON feedback(theme);
CREATE INDEX IF NOT EXISTS idx_feedback_rate ON feedback(ip_hash, created_at);
