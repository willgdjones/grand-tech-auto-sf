-- "Become an angel" — paid player-sponsored angel NPCs
-- (docs/engineering/become-an-angel.md, PLAN-v2 founder expansion 2026-10-03, gtasf-become-an-angel-7ggb).
-- One row per purchased angel. Pitches reuse the existing per-player once-ever angel ledger keyed by
-- this row's id, and pitch_count is denormalised and incremented in that same transaction so the
-- sponsor dashboard count is authoritative, not client-reported. Charges stay off until Stripe keys
-- exist (gtasf-e5m) and the `sponsoredAngels` flag gates the route/HUD.
CREATE TABLE IF NOT EXISTS sponsored_angels (
  id TEXT PRIMARY KEY,
  sponsor_device_id TEXT NOT NULL,
  display_name TEXT NOT NULL,          -- Jev-approved
  line TEXT NOT NULL,                  -- Jev-approved, <= 140 chars
  avatar_color TEXT,                   -- validated #rgb/#rrggbb, nullable
  spot_id TEXT NOT NULL,               -- id in shared/content/sponsoredAngelSpots.ts
  tier TEXT NOT NULL DEFAULT 'angel',  -- fixed base cheque, sponsors do not buy a bigger tier
  status TEXT NOT NULL DEFAULT 'pending', -- pending -> live -> removed
  checkout_id TEXT,                    -- ledger reference (worker/src/ledger)
  pitch_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  published_at INTEGER,
  removed_at INTEGER
);

-- Dashboard lookup by sponsor.
CREATE INDEX IF NOT EXISTS sponsored_angels_sponsor ON sponsored_angels(sponsor_device_id);
-- World spawn merge pulls the live set.
CREATE INDEX IF NOT EXISTS sponsored_angels_status ON sponsored_angels(status);
-- At most one live angel per spot (a removed/pending row frees the spot for re-use).
CREATE UNIQUE INDEX IF NOT EXISTS sponsored_angels_live_spot ON sponsored_angels(spot_id) WHERE status = 'live';
