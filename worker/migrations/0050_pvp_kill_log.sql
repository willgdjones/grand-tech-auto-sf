-- Most Wanted bounty review fix (flag mostWantedBounty): a log of server-validated PvP kills between devices, so a bounty
-- is never paid between a pair who killed each other in the last 7 days (collusion / farming guard). Written only while
-- the bounty is on; rows older than 7 days are pruned by the bounty module.
CREATE TABLE IF NOT EXISTS pvp_kill_log (
  killer_device TEXT NOT NULL,
  victim_device TEXT NOT NULL,
  killed_at     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pvp_kill_log_pair ON pvp_kill_log (killer_device, victim_device, killed_at);
