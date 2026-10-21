-- Economy reset epochs (founder 12:0x: "reset all the money for everyone again"). A profile whose
-- economy_reset_epoch is below shared ECONOMY_RESET_EPOCH is reset once, lazily (resetDeviceToEconomyV3),
-- then stamped with the current epoch. Existing rows start at 0, so everyone (including profiles reset this
-- morning under the old burn-stamp marker) resets exactly once more.
ALTER TABLE funding_profiles ADD COLUMN economy_reset_epoch INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS funding_profiles_reset_epoch ON funding_profiles(economy_reset_epoch);
