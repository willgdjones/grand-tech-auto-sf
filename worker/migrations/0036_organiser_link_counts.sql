-- Organiser link tracking (flag organiserLinks, gtasf-w0s8; docs/gtm/dm-template.md "Tracking"): an aggregate,
-- no-PII counter per (event, channel, kind). No ids, addresses, IPs, cookies or timestamps per visit are stored,
-- so it counts regardless of analytics consent. Read by tools/gtm/outreach-report.mjs.
CREATE TABLE IF NOT EXISTS organiser_link_counts (
  event_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN('dm','em','link')),
  kind TEXT NOT NULL CHECK(kind IN('view','play_start','share_click')),
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(event_id, channel, kind)
);
