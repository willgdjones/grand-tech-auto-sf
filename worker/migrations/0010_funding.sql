CREATE TABLE IF NOT EXISTS funding_profiles (
  device_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  startup_name TEXT NOT NULL DEFAULT '',
  nickname TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS funding_awards (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES funding_profiles(device_id),
  season TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_title TEXT NOT NULL,
  day TEXT NOT NULL,
  entered_at INTEGER NOT NULL,
  awarded_at INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0 AND amount_cents <= 1200000000),
  quote_json TEXT NOT NULL,
  UNIQUE(device_id, season, event_id, day)
);
CREATE INDEX IF NOT EXISTS funding_awards_device_time ON funding_awards(device_id, season, awarded_at DESC);
CREATE INDEX IF NOT EXISTS funding_awards_season_day ON funding_awards(season, day, device_id);
