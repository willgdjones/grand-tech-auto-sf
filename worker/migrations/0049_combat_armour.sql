-- GTA-pivot lane B (vitalsPickups): body-armour purchases at the gun shop. One row per client purchase request, so
-- a retried / replayed request can never charge twice (request_id PRIMARY KEY guards the debit).
CREATE TABLE IF NOT EXISTS combat_armour_purchases (
  request_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  purchased_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS combat_armour_purchases_device ON combat_armour_purchases(device_id, purchased_at);
