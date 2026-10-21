-- GTA V pivot — LANE B gun shop (flag gunShop, gtasf-combat-gunshop-nnna, docs/PLAN-gta-pivot.md §B.9).
-- One row per device per owned weapon: the server-authoritative ownership record and the idempotency key for
-- buyWeapon, so buying a weapon you already own never debits valuation twice. price_cents is what was paid
-- (0 when granted without economy v3). Melee/starter weapons are never rows here.
CREATE TABLE IF NOT EXISTS combat_weapons (
  device_id    TEXT NOT NULL,
  weapon       TEXT NOT NULL,
  price_cents  INTEGER NOT NULL CHECK (price_cents >= 0),
  purchased_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, weapon)
);
CREATE INDEX IF NOT EXISTS combat_weapons_device ON combat_weapons(device_id, purchased_at);
