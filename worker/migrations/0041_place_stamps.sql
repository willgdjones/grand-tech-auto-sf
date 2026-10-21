-- Living map place stamps (flag placeStamps, gtasf-stc2, docs/engineering/living-map.md item 7): one row per
-- device per real SF place it has visited ("SF pilgrimage: 12/150"). Cosmetic only - no money attached.
CREATE TABLE IF NOT EXISTS place_stamps (
  device_id  TEXT NOT NULL,
  place_id   TEXT NOT NULL,
  stamped_at INTEGER NOT NULL,
  PRIMARY KEY (device_id, place_id)
);
CREATE INDEX IF NOT EXISTS place_stamps_device_time ON place_stamps (device_id, stamped_at);
