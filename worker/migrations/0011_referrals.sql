CREATE TABLE IF NOT EXISTS referral_accounts (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  email_hash TEXT UNIQUE,
  claimed_at INTEGER
);
CREATE TABLE IF NOT EXISTS referral_devices (
  device_id TEXT PRIMARY KEY REFERENCES funding_profiles(device_id),
  account_id TEXT NOT NULL REFERENCES referral_accounts(id),
  first_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS referral_devices_account ON referral_devices(account_id);
CREATE TABLE IF NOT EXISTS referral_attributions (
  buyer_device_id TEXT PRIMARY KEY REFERENCES referral_devices(device_id),
  referrer_id TEXT NOT NULL REFERENCES referral_accounts(id),
  clicked_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS referral_clicks (
  visit_id TEXT PRIMARY KEY,
  referrer_id TEXT NOT NULL REFERENCES referral_accounts(id),
  buyer_device_id TEXT NOT NULL REFERENCES referral_devices(device_id),
  clicked_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS referral_clicks_referrer ON referral_clicks(referrer_id, clicked_at);
CREATE TABLE IF NOT EXISTS referral_players (
  buyer_device_id TEXT PRIMARY KEY REFERENCES referral_devices(device_id),
  referrer_id TEXT NOT NULL REFERENCES referral_accounts(id),
  joined_at INTEGER NOT NULL,
  played_ms INTEGER NOT NULL DEFAULT 0,
  warm_intro_at INTEGER
);
CREATE INDEX IF NOT EXISTS referral_players_referrer ON referral_players(referrer_id);
CREATE TABLE IF NOT EXISTS referral_limits (
  key TEXT PRIMARY KEY,
  window_at INTEGER NOT NULL,
  count INTEGER NOT NULL
);
