-- Automated test visits (look captures, Playwright; client sends a gtasf_bot=1 session cookie) are marked so player
-- counts can exclude them (tools/players.mjs). Nullable: NULL/0 = real player. Analytics hygiene only.
ALTER TABLE funding_profiles ADD COLUMN is_bot INTEGER;
