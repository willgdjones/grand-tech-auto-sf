-- Fictional earned funding only. This ledger never supplies USD or checkout credit.
-- PLAN-v2 decision 5: the v2 cap-table ledger for drive-through events, parody celebrity angels and
-- referral warm intros, recorded via recordFundingCredit(). VC fund drops keep their own
-- capacity-aware ledger (fund_drop_claims, migration 0018); this must run after it so the final
-- view below can union it. UNIQUE(device_id, season, source, source_ref) enforces "pays once, ever".
CREATE TABLE IF NOT EXISTS funding_credits (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES funding_profiles(device_id),
  season TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('event','vc-drop','celebrity','warm-intro')),
  source_ref TEXT NOT NULL,
  label TEXT NOT NULL,
  day TEXT NOT NULL,
  awarded_at INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0 AND amount_cents <= 10000000000),
  meta_json TEXT,
  UNIQUE(device_id, season, source, source_ref)
);
CREATE INDEX IF NOT EXISTS funding_credits_device_time ON funding_credits(device_id, season, awarded_at DESC);
CREATE INDEX IF NOT EXISTS funding_credits_season_day ON funding_credits(season, day, device_id);

-- Final earnings view: the single source of truth for a player's season funding. This supersedes
-- the view from 0018 and unions every earned-funding ledger — v1 event-room awards, referral
-- warm-intro bonuses, VC fund-drop cheques and v2 credits — so totals, rounds and the leaderboard
-- include them all. If a pane adds another ledger, add it to THIS union in the highest migration.
DROP VIEW IF EXISTS funding_earnings;
CREATE VIEW funding_earnings AS
  SELECT device_id,season,day,amount_cents FROM funding_awards
  UNION ALL
  SELECT device_id,season,day,amount_cents FROM funding_bonuses
  UNION ALL
  SELECT device_id,season,day,amount_cents FROM fund_drop_claims
  UNION ALL
  SELECT device_id,season,day,amount_cents FROM funding_credits;
