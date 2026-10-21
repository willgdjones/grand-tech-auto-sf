-- Acqui-hire claim-first delivery (review fix, 2026-10-14): a delivery first CLAIMS the escrow ('open' → 'delivering',
-- one conditional UPDATE) and only then books the credit, so a racing refund (abandon / disconnect / second tab) can no
-- longer pay the price back after the flip was paid. SQLite can't alter a CHECK, so the table is rebuilt (prod: the
-- flag has never been on, so it is empty). 'delivering' also counts as active for the one-per-device index.
CREATE TABLE acquisitions_v2 (
  acq_id      TEXT PRIMARY KEY,
  device_id   TEXT NOT NULL,
  day         TEXT NOT NULL,
  cost_cents  INTEGER NOT NULL CHECK (cost_cents > 0),
  status      TEXT NOT NULL CHECK (status IN ('open', 'delivering', 'delivered', 'refunded')),
  started_at  INTEGER NOT NULL,
  deadline_at INTEGER NOT NULL,
  settled_at  INTEGER
);
INSERT INTO acquisitions_v2 (acq_id, device_id, day, cost_cents, status, started_at, deadline_at, settled_at)
  SELECT acq_id, device_id, day, cost_cents, status, started_at, deadline_at, settled_at FROM acquisitions;
DROP TABLE acquisitions;
ALTER TABLE acquisitions_v2 RENAME TO acquisitions;
CREATE UNIQUE INDEX IF NOT EXISTS acquisitions_one_active ON acquisitions (device_id) WHERE status IN ('open', 'delivering');
CREATE INDEX IF NOT EXISTS acquisitions_active_deadline ON acquisitions (deadline_at) WHERE status IN ('open', 'delivering');
