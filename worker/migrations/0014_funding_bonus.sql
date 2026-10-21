-- Fictional earned funding only. This ledger never supplies USD or checkout credit.
CREATE TABLE IF NOT EXISTS funding_bonuses (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES funding_profiles(device_id),
  friend_device_id TEXT NOT NULL UNIQUE REFERENCES funding_profiles(device_id),
  season TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind = 'warm-intro'),
  day TEXT NOT NULL,
  awarded_at INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents = 10000000)
);
CREATE INDEX IF NOT EXISTS funding_bonuses_totals ON funding_bonuses(season,device_id,day);
CREATE VIEW IF NOT EXISTS funding_earnings AS
  SELECT device_id,season,day,amount_cents FROM funding_awards
  UNION ALL
  SELECT device_id,season,day,amount_cents FROM funding_bonuses;
