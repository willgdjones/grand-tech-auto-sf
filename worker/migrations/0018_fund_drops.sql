-- VC fund drops (PLAN-v2 decision 3). Fictional earned funding only; never USD or checkout credit.
-- The first DROP_CAPACITY players to drive/walk through an open "come pitch!" checkpoint get a cheque,
-- recorded here as the `fund-drop` cap-table ledger and unioned into funding_earnings so it counts
-- toward the player's funding total, round and leaderboard rank just like event awards.
-- Pairs with 0020_funding_credits.sql, which owns the other v2 sources and defines the final view.
CREATE TABLE IF NOT EXISTS fund_drop_claims (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES funding_profiles(device_id),
  season TEXT NOT NULL,
  drop_id TEXT NOT NULL,
  slot INTEGER NOT NULL,
  fund_name TEXT NOT NULL,
  sponsored INTEGER NOT NULL DEFAULT 0 CHECK(sponsored IN (0, 1)),
  position INTEGER NOT NULL CHECK(position >= 1),
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0 AND amount_cents <= 50000000),
  claimed_at INTEGER NOT NULL,
  day TEXT NOT NULL,
  -- One cheque per player per drop, ever. This is the money-safety boundary.
  UNIQUE(device_id, season, drop_id)
);
-- Counting claims for the live N/50 counter and the capacity guard.
CREATE INDEX IF NOT EXISTS fund_drop_claims_drop ON fund_drop_claims(season, drop_id);
-- Per-device totals and the cap-table listing.
CREATE INDEX IF NOT EXISTS fund_drop_claims_device ON fund_drop_claims(season, device_id, claimed_at DESC);

-- Paid sponsor slots (Stripe-gated ad product; populated only when flags.fundDropSponsors is on).
-- Renames a drop under a real VC/startup without changing its geometry or window.
CREATE TABLE IF NOT EXISTS fund_drop_sponsors (
  season TEXT NOT NULL,
  slot INTEGER NOT NULL,
  name TEXT NOT NULL,
  url TEXT,
  logo_url TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(season, slot)
);

-- Fold drop cheques into the earnings view alongside awards and warm-intro bonuses. This interim
-- view is superseded by 0020_funding_credits.sql, which re-adds funding_credits to the union.
DROP VIEW IF EXISTS funding_earnings;
CREATE VIEW funding_earnings AS
  SELECT device_id,season,day,amount_cents FROM funding_awards
  UNION ALL
  SELECT device_id,season,day,amount_cents FROM funding_bonuses
  UNION ALL
  SELECT device_id,season,day,amount_cents FROM fund_drop_claims;
