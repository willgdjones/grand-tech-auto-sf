-- Garage phase 1 (flag garageSlots, critique 20e, docs/PLAN-garage.md): extra saved-car slots per funding device. Slot 0 stays
-- the personal_cars row (0051, the last car you drove and left), untouched, so a rollback of the garage still works
-- (reviewer condition 7). Slots 1+ hold cars kept explicitly or given at a funding tier; a slot keeps the model, never a
-- location (a delivered car spawns at the nearest road).
CREATE TABLE IF NOT EXISTS garage_cars (
  device_id TEXT NOT NULL,
  slot      INTEGER NOT NULL CHECK (slot >= 1),
  kind      TEXT NOT NULL,
  source    TEXT NOT NULL CHECK (source IN ('kept', 'gift')),
  saved_at  INTEGER NOT NULL,
  PRIMARY KEY (device_id, slot)
);
-- One gift per (device, tier), ever (reviewer condition 5): the primary key makes a replay or a second tab a no-op.
CREATE TABLE IF NOT EXISTS garage_gifts (
  device_id TEXT NOT NULL,
  tier      INTEGER NOT NULL,
  slot      INTEGER NOT NULL,
  ref       TEXT NOT NULL,
  given_at  INTEGER NOT NULL,
  PRIMARY KEY (device_id, tier)
);
