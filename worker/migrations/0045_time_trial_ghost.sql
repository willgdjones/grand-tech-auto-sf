-- Time-trial shared ghost (flag timeTrials, GTA-pivot lane C). Store each device's best-run PATH alongside its
-- best time, so another player can race the daily CHAMPION's ghost (the top row's path), not just their own
-- personal best. Cosmetic skill data, no money. One JSON blob (sampled {ms,x,z}) per best row; the board returns
-- the top row's ghost. Nullable + additive — flag-off and existing rows are unaffected.
ALTER TABLE time_trials ADD COLUMN ghost TEXT;
