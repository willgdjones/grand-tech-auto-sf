-- PLAN-v2 decision 9: paste-a-link community event submissions.
-- 0 = official/crawled (tech-week feed), 1 = player-submitted "community" event.
ALTER TABLE events ADD COLUMN community INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS events_community ON events(community);
