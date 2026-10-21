-- Friends system (PLAN-v2.1 decision 5, gtasf-q4yo), behind flags.friends. Keyed by the funding device
-- identity (funding_profiles.device_id), like referrals/recovery. Usernames are globally unique and
-- case-insensitive (username_key is the casefolded UNIQUE column). Friendships are mutual opt-in; a
-- request becomes a friendship only when the other side sends/accepts. Rate limits reuse the referral
-- atomic-counter shape. No PII beyond the chosen username.
CREATE TABLE IF NOT EXISTS friend_usernames (
  device_id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_key TEXT NOT NULL,
  claimed_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS friend_usernames_key ON friend_usernames(username_key);

-- Pending mutual-opt-in requests: requester wants to friend target. source: 'search'|'click'|'referral'.
CREATE TABLE IF NOT EXISTS friend_requests (
  requester TEXT NOT NULL,
  target TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'search',
  PRIMARY KEY (requester, target)
);
CREATE INDEX IF NOT EXISTS friend_requests_target ON friend_requests(target);

-- Accepted friendships, stored once as an ordered pair (a < b) so the relation is symmetric + unique.
CREATE TABLE IF NOT EXISTS friendships (
  a TEXT NOT NULL,
  b TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (a, b)
);
CREATE INDEX IF NOT EXISTS friendships_b ON friendships(b);

-- Atomic rate-limit counters (same shape as referral_limits), e.g. friend requests / username claims.
CREATE TABLE IF NOT EXISTS friend_limits (
  key TEXT PRIMARY KEY,
  window_at INTEGER NOT NULL,
  count INTEGER NOT NULL
);
