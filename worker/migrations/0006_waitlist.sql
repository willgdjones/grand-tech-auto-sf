CREATE TABLE IF NOT EXISTS waitlist_signups (
  email TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK(source IN ('launch','queue')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','confirmed','unsubscribed')),
  created_at TEXT NOT NULL,
  confirmed_at TEXT
);
