-- Friend DM transport (PLAN-v2.1 decision 5/6, gtasf-q4yo S5), behind flags.friends. Store-and-forward
-- direct messages between two friends; the chat DM tab (pane 2/3) polls GET /api/friends/dm. Keyed by
-- the ordered friend pair (pair_a < pair_b) so a thread is one range scan; sender/recipient give
-- direction. Text is Jev-moderated before insert. No proximity/WorldDO socket involved.
CREATE TABLE IF NOT EXISTS friend_dms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pair_a TEXT NOT NULL,
  pair_b TEXT NOT NULL,
  sender TEXT NOT NULL,
  recipient TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS friend_dms_thread ON friend_dms(pair_a, pair_b, created_at);
CREATE INDEX IF NOT EXISTS friend_dms_recipient ON friend_dms(recipient, created_at);
