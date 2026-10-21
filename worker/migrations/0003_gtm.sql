-- Private lead data: no public SELECT * endpoint. Logos are metadata, never public creatives.
CREATE TABLE IF NOT EXISTS leads (
  slug TEXT PRIMARY KEY, company TEXT NOT NULL, domain TEXT NOT NULL DEFAULT '',
  founder TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
  office_address TEXT NOT NULL DEFAULT '', lat REAL, lon REAL,
  building_id TEXT NOT NULL DEFAULT '', logo_url TEXT NOT NULL DEFAULT '', source TEXT NOT NULL,
  CHECK ((lat IS NULL AND lon IS NULL) OR (lat BETWEEN -90 AND 90 AND lon BETWEEN -180 AND 180))
);
CREATE INDEX IF NOT EXISTS leads_domain ON leads(domain);
CREATE INDEX IF NOT EXISTS leads_building ON leads(building_id);

CREATE TABLE IF NOT EXISTS gtm_suppressions (
  email TEXT PRIMARY KEY COLLATE NOCASE, suppressed_at INTEGER NOT NULL, reason TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gtm_spawns (
  slug TEXT PRIMARY KEY REFERENCES leads(slug), lat REAL NOT NULL, lon REAL NOT NULL,
  heading REAL NOT NULL, building_id TEXT NOT NULL, map_digest TEXT NOT NULL,
  CHECK(lat BETWEEN 37.703 AND 37.833), CHECK(lon BETWEEN -122.527 AND -122.348),
  CHECK(heading >= 0 AND heading < 360)
);
