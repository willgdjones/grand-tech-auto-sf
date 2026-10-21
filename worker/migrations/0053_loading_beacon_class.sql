-- Loading funnel by coarse client class (reviewer 13:3x / critic 13:4x, 2026-10-18): the 0037 counters can't tell a real
-- phone that gave up from a link-preview renderer that loads the page for a second and closes it. Same aggregate, no-PII
-- shape as loading_beacon_counts plus two coarse columns:
--   ua   = browser | inapp (social/messaging app WebViews: real users) | preview (link-unfurl fetchers BOT_UA misses)
--   seen = 1 when the page was ever visible (document.visibilityState) before the beacon, 0 when it never was
-- No ids, IPs, cookies or raw user agents are stored.
CREATE TABLE IF NOT EXISTS loading_beacon_class_counts (
  day TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN('start','ready','abandon')),
  stage TEXT NOT NULL,
  bucket TEXT NOT NULL,
  device TEXT NOT NULL CHECK(device IN('mobile','desktop')),
  ua TEXT NOT NULL CHECK(ua IN('browser','inapp','preview')),
  seen INTEGER NOT NULL CHECK(seen IN(0,1)),
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(day, kind, stage, bucket, device, ua, seen)
);
