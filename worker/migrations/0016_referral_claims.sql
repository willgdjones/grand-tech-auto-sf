ALTER TABLE referral_accounts ADD COLUMN owner_id TEXT REFERENCES referral_accounts(id);
CREATE INDEX IF NOT EXISTS referral_account_owner ON referral_accounts(owner_id);
CREATE TABLE IF NOT EXISTS referral_email_claims (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES referral_devices(device_id),
  account_id TEXT NOT NULL REFERENCES referral_accounts(id),
  email_hash TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  consume_nonce TEXT
);
CREATE INDEX IF NOT EXISTS referral_claim_expiry ON referral_email_claims(expires_at);
