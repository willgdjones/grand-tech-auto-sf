-- World-socket drop rate (gtasf-j7wvv, flag netBeacon): aggregate, no-PII counters per UTC day of world sessions that
-- started, live sessions that dropped (by close code and how long the session had been up), and rejoins (by gap).
-- No ids, IPs or cookies, so it counts every player regardless of analytics consent; the DO's own logs miss the
-- edge's 1006 closes, and `wrangler tail` only samples while someone watches.
CREATE TABLE IF NOT EXISTS net_beacon_counts (
  day TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN('session','drop','rejoin')),
  code TEXT NOT NULL,
  bucket TEXT NOT NULL,
  device TEXT NOT NULL CHECK(device IN('mobile','desktop')),
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(day, kind, code, bucket, device)
);
