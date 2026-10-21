-- Organiser outreach emails (flag organiserOutreach, gtasf-w0s8): one send per (normalised address, event).
-- A 'pending' row is written BEFORE the send and flipped to 'sent' after it, so a crash or retry can never
-- double-send; a failed send deletes its row so a retry is allowed. Admin-only data; never exposed publicly.
CREATE TABLE IF NOT EXISTS organiser_outreach_sends (
  email TEXT NOT NULL COLLATE NOCASE, event_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN('pending','sent')),
  created_at INTEGER NOT NULL, sent_at INTEGER,
  PRIMARY KEY(email, event_id)
);
