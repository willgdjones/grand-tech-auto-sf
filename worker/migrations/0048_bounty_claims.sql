-- "Most Wanted founder" bounty (flag mostWantedBounty, GTA-pivot lane C multiplayer). One row per paid (or in-flight)
-- bounty. The claim row is written BEFORE the house-paid credit, so two simultaneous takedowns of the same target can't
-- both pay: at most one bounty per target per SF day AND at most one per killer per SF day (unique indexes).
CREATE TABLE IF NOT EXISTS bounty_claims (
  claim_id      TEXT PRIMARY KEY,
  day           TEXT NOT NULL,
  target_device TEXT NOT NULL,
  killer_device TEXT NOT NULL CHECK (killer_device <> target_device),
  amount_cents  INTEGER NOT NULL CHECK (amount_cents > 0),
  status        TEXT NOT NULL CHECK (status IN ('claiming', 'paid')),
  claimed_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS bounty_claims_target_day ON bounty_claims (target_device, day);
CREATE UNIQUE INDEX IF NOT EXISTS bounty_claims_killer_day ON bounty_claims (killer_device, day);
