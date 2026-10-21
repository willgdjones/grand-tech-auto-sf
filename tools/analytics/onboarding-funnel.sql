-- Onboarding funnel from prod D1 (read-only). The paint-the-Ferry step is stored as step 'intro' (by design:
-- flags.playfulMayhem makes the intro step a paint step). funding/identity.ts seeds an 'intro' row when a device's
-- cookie is minted during LOADING, and the client re-saves 'intro' once onboarding starts in the world, so
--   updated_at - created_at < 2 s  => left before the game was playable (loading bounce)
--   otherwise                      => reached the game; step = how far they got
-- Run: cd worker && npx wrangler d1 execute gtasf-production --remote --config wrangler.production.jsonc --file ../tools/analytics/onboarding-funnel.sql
SELECT CASE WHEN o.updated_at - p.created_at < 2000 THEN 'left during loading' ELSE 'reached game' END AS bucket,
       CASE json_extract(o.state, '$.step') WHEN 'intro' THEN 'paint_ferry' ELSE json_extract(o.state, '$.step') END AS step,
       COUNT(*) AS players
FROM onboarding_state o JOIN funding_profiles p ON p.device_id = o.device_id
WHERE p.created_at > (strftime('%s', 'now') - 24 * 3600) * 1000 AND COALESCE(p.is_bot, 0) = 0
GROUP BY 1, 2 ORDER BY 1, 3 DESC;
