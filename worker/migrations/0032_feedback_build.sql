-- gtasf-367l: tag each F-key feedback submission with the build / changelog version it was filed on,
-- so the founder can triage reports across the day's rapid playtest deploys (#5.6, #6, economy-v3).
-- Additive + nullable: existing rows and any submission made while flags.feedbackBuildTag is off keep
-- build = NULL, so the column is backward-compatible and never blocks an insert.
ALTER TABLE feedback ADD COLUMN build TEXT;
