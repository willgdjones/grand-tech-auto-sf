-- Robotaxi quick travel fares (docs/engineering/quick-robotaxi.md "Fare and free rides").
-- free_rides_used: 0..3 per profile; not touched by the economy reset, so free rides are never re-granted.
ALTER TABLE funding_profiles ADD COLUMN free_rides_used INTEGER NOT NULL DEFAULT 0;
-- One row per ride id: the idempotency key for chargeRide. amount_cents is 0 for a free ride.
CREATE TABLE IF NOT EXISTS robotaxi_fares (
  ride_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  free INTEGER NOT NULL CHECK (free IN (0, 1)),
  charged_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS robotaxi_fares_device ON robotaxi_fares(device_id, charged_at DESC);
