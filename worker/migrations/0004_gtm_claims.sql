-- Offer snapshot is immutable: subsequent lead enrichment cannot change its verified domain/building.
CREATE TABLE IF NOT EXISTS office_offers (
  token_hash TEXT PRIMARY KEY, lead_slug TEXT NOT NULL REFERENCES leads(slug),
  company TEXT NOT NULL, domain TEXT NOT NULL, building_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN(0,1)),
  CHECK(length(domain)>3), CHECK(length(building_id)>0)
);
CREATE TABLE IF NOT EXISTS office_verifications (
  token_hash TEXT PRIMARY KEY, offer_hash TEXT NOT NULL REFERENCES office_offers(token_hash),
  email TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  used_at INTEGER, session_hash TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS office_verifications_offer ON office_verifications(offer_hash,created_at);
CREATE TABLE IF NOT EXISTS office_verification_drafts (
  token_hash TEXT PRIMARY KEY REFERENCES office_verifications(token_hash),
  recipient TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','approved','expired')),
  created_at INTEGER NOT NULL
);
-- Single weekly slot per physical building, regardless of multiple tenants/offer tokens.
-- Populated ONLY by the future payment+moderation integration, not by viewing/verifying a claim.
CREATE TABLE IF NOT EXISTS office_wrap_bookings (
  building_id TEXT NOT NULL, week TEXT NOT NULL,
  offer_hash TEXT NOT NULL REFERENCES office_offers(token_hash),
  verified_session_hash TEXT NOT NULL REFERENCES office_verifications(session_hash),
  price_cents INTEGER NOT NULL CHECK(price_cents=10000),
  status TEXT NOT NULL CHECK(status IN('held','paid','approved','live')),
  stripe_session TEXT UNIQUE, creative_key TEXT,
  PRIMARY KEY(building_id,week)
);
-- No expiry: opt-out links remain valid beyond the required 30 days.
CREATE TABLE IF NOT EXISTS gtm_unsubscribe_tokens (
  token_hash TEXT PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE, created_at INTEGER NOT NULL
);
