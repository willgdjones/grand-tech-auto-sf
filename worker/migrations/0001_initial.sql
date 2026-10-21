CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, host TEXT, starts_at TEXT NOT NULL,
  ends_at TEXT, venue TEXT, url TEXT NOT NULL, lat REAL, lon REAL,
  approximate INTEGER NOT NULL DEFAULT 0, category TEXT, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_starts_at ON events(starts_at);
CREATE TABLE IF NOT EXISTS billboards (
  id TEXT PRIMARY KEY, x REAL NOT NULL, y REAL NOT NULL, z REAL NOT NULL,
  base_cents INTEGER NOT NULL CHECK (base_cents >= 0)
);
CREATE TABLE IF NOT EXISTS rentals (
  id TEXT PRIMARY KEY, board_id TEXT NOT NULL REFERENCES billboards(id), week TEXT NOT NULL,
  status TEXT NOT NULL, price_cents INTEGER NOT NULL CHECK (price_cents >= 0), stripe_session TEXT,
  creative_key TEXT, UNIQUE(board_id, week)
);
CREATE TABLE IF NOT EXISTS impressions (
  session_id TEXT NOT NULL, board_id TEXT NOT NULL, seen_at TEXT NOT NULL,
  PRIMARY KEY(session_id, board_id)
);
