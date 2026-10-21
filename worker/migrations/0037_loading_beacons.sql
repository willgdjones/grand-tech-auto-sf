-- Loading funnel (gtasf-loading-abandon): aggregate, no-PII counters of page loads that started, reached READY,
-- or were abandoned before READY, per UTC day, last loading stage and elapsed-time bucket. No ids, IPs or cookies,
-- so it counts regardless of analytics consent (PostHog asks for consent around READY and misses most bounces).
CREATE TABLE IF NOT EXISTS loading_beacon_counts (
  day TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN('start','ready','abandon')),
  stage TEXT NOT NULL,
  bucket TEXT NOT NULL,
  device TEXT NOT NULL CHECK(device IN('mobile','desktop')),
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(day, kind, stage, bucket, device)
);
