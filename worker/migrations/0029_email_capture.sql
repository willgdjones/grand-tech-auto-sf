-- Email capture + verification (emailCapture, gtasf-1aon, founder 2026-10-04).
-- One row per funding device/profile. Stores the raw address (needed to send, for the Tech Week recap,
-- and for the account-recovery link) plus HASHED code/link tokens (never plaintext). Reward is granted
-- once per profile (rewarded_at on the device row) and once per address (any row sharing email_hash).
CREATE TABLE IF NOT EXISTS email_captures (
  device_id    TEXT PRIMARY KEY,
  email        TEXT NOT NULL,
  email_hash   TEXT NOT NULL,
  code_hash    TEXT,
  link_hash    TEXT,
  expires_at   INTEGER,
  attempts     INTEGER NOT NULL DEFAULT 0,
  last_sent_at INTEGER NOT NULL DEFAULT 0,
  verified_at  INTEGER,
  rewarded_at  INTEGER,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_captures_email_hash ON email_captures(email_hash);
CREATE INDEX IF NOT EXISTS idx_email_captures_link_hash ON email_captures(link_hash);
