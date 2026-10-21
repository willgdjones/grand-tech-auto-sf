-- Acqui-hire escrow (flag acquihireQuest, GTA-pivot lane C, docs/decision-burnt-out-founder.md option A). One row per
-- purchase. The debit at start books an 'open' row in the same atomic batch; the row is settled 'delivered' after the
-- server-checked delivery credit, or 'refunded' on abandon / teleport / disconnect / timeout. At most one open row per
-- device (partial unique index) so a start can never double-debit.
CREATE TABLE IF NOT EXISTS acquisitions (
  acq_id      TEXT PRIMARY KEY,
  device_id   TEXT NOT NULL,
  day         TEXT NOT NULL,
  cost_cents  INTEGER NOT NULL CHECK (cost_cents > 0),
  status      TEXT NOT NULL CHECK (status IN ('open', 'delivered', 'refunded')),
  started_at  INTEGER NOT NULL,
  deadline_at INTEGER NOT NULL,
  settled_at  INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS acquisitions_one_open ON acquisitions (device_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS acquisitions_open_deadline ON acquisitions (deadline_at) WHERE status = 'open';
