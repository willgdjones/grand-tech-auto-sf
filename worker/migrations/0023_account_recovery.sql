-- Account recovery (gtasf-17df): a memorable GTASF-XXXX-XXXX code restores a profile on a new device.
-- One active code per profile (regenerating replaces it). code_hash is HMAC-SHA256(pepper, code);
-- the pepper is a worker secret (the salt) and is never stored here.
CREATE TABLE IF NOT EXISTS recovery_codes (
  code_hash TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS recovery_codes_device ON recovery_codes(device_id);

-- Extra device cookies bound to an existing profile so a recovered device and the original both
-- resolve to the same device_id ("old device keeps playing"). token_hash uses the same SHA-256 as
-- funding_profiles.token_hash; the funding identity lookup falls back here when the flag is on.
CREATE TABLE IF NOT EXISTS device_aliases (
  token_hash TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS device_aliases_device ON device_aliases(device_id);

-- Cosmetic state (outfit/archetype) is otherwise client-only localStorage; captured when the player
-- saves their startup so recovery can restore the look too.
CREATE TABLE IF NOT EXISTS profile_cosmetics (
  device_id TEXT PRIMARY KEY,
  outfit TEXT,
  updated_at INTEGER NOT NULL
);
