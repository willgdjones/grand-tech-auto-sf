-- Time trials (flag timeTrials, GTA-pivot lane C, docs/PLAN-gta-pivot.md section C). One row per device per route
-- per SF day = that device's best time; the per-route daily leaderboard reads from here. A SKILL board, cosmetic
-- only - no money/valuation attached. The daily key (route_id, day) resets the board each fundingDay.
CREATE TABLE IF NOT EXISTS time_trials (
  route_id   TEXT NOT NULL,
  day        TEXT NOT NULL,
  device_id  TEXT NOT NULL,
  name       TEXT NOT NULL,
  ms         INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (route_id, day, device_id)
);
-- board ordering (top-N by time) + rank (COUNT ms < x) for a route's day
CREATE INDEX IF NOT EXISTS time_trials_board ON time_trials (route_id, day, ms);
