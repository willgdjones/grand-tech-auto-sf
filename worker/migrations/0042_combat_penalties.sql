-- GTA V pivot — LANE B (combat & police): the valuation cost of dying (flag combat, gtasf-combat-gate-health-economy-8cqg,
-- docs/PLAN-gta-pivot.md section B). One row per death/busted incident: the idempotency key for applyCombatPenalty,
-- so a laggy retry (or a server-driven death that fires once) never debits valuation twice. amount_cents is the
-- valuation actually taken (already clamped to the player's balance). kind is 'wasted' (−2%, min $1k) or 'busted' (−5%).
CREATE TABLE IF NOT EXISTS combat_penalties (
  incident_id TEXT PRIMARY KEY,
  device_id   TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('wasted', 'busted')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS combat_penalties_device ON combat_penalties(device_id, created_at DESC);
