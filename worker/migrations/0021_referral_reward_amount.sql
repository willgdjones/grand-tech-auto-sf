-- Founder decision (2026-10-03): referrals are in-game only. Warm intros now pay a generous
-- $5M of fictional funding (was $100k), so relax the funding_bonuses amount CHECK. SQLite cannot
-- ALTER a CHECK, so recreate the table and copy the existing rows (all satisfy the wider range).
-- The funding_earnings view depends on funding_bonuses, so drop it first and recreate it afterwards
-- (unchanged union: awards + bonuses + fund_drop_claims + credits, matching 0020).
DROP VIEW IF EXISTS funding_earnings;
CREATE TABLE funding_bonuses_new (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES funding_profiles(device_id),
  friend_device_id TEXT NOT NULL UNIQUE REFERENCES funding_profiles(device_id),
  season TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind = 'warm-intro'),
  day TEXT NOT NULL,
  awarded_at INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0 AND amount_cents <= 5000000000)
);
INSERT INTO funding_bonuses_new (id,device_id,friend_device_id,season,kind,day,awarded_at,amount_cents)
  SELECT id,device_id,friend_device_id,season,kind,day,awarded_at,amount_cents FROM funding_bonuses;
DROP TABLE funding_bonuses;
ALTER TABLE funding_bonuses_new RENAME TO funding_bonuses;
CREATE INDEX IF NOT EXISTS funding_bonuses_totals ON funding_bonuses(season,device_id,day);
CREATE VIEW funding_earnings AS
  SELECT device_id,season,day,amount_cents FROM funding_awards
  UNION ALL
  SELECT device_id,season,day,amount_cents FROM funding_bonuses
  UNION ALL
  SELECT device_id,season,day,amount_cents FROM fund_drop_claims
  UNION ALL
  SELECT device_id,season,day,amount_cents FROM funding_credits;
