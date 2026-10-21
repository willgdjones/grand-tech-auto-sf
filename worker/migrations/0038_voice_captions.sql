-- Spoken bubbles (flag voiceCaptions, docs/engineering/spoken-bubbles.md, gtasf-qjja).
-- No audio is ever stored. Transcripts are kept ONLY when attached to a report (the reported player's last
-- ~2 min of approved captions), and deleted after 7 days by the 3-hourly cron.
-- Daily transcription spend meter (SF day): accumulated clip seconds, plus refused clips once the cap is hit.
CREATE TABLE IF NOT EXISTS voice_caption_spend (
  day      TEXT PRIMARY KEY,
  seconds  REAL NOT NULL DEFAULT 0,
  refused  INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS voice_report_captions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  target_device   TEXT NOT NULL,
  reporter_device TEXT NOT NULL,
  at              INTEGER NOT NULL,
  captions_json   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_voice_report_captions_at ON voice_report_captions(at);
