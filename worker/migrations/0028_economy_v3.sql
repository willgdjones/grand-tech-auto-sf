-- Economy v3 (PLAN-economy-v3 decisions 5 + 7). Fictional earned funding only; never USD.
-- Adds the stored current-vs-lifetime fields the v3 model needs, and is the schema half of the
-- one-time rescale of EXISTING players (decision 7: rescaled, never wiped).
--
-- APPLIED only when economy v3 is enabled (flags.economyV3, OFF in the production allowlist until the
-- founder approves after reviewing docs/economy/v3-calibration.md). These columns stay NULL/unused
-- while the flag is off, so this migration is inert for the current v2 economy.
--
-- POPULATION (runs once, in code, gated on economyV3 — NOT in this .sql, because the mapping is a
-- piecewise-linear per-star-band rescale that SQL can't express): worker/src/funding/economyV3.ts
-- rescaleDeviceToEconomyV3() scales every earned-funding ledger row (funding_awards/credits/bonuses/
-- fund_drop_claims) by the player's uniform factor rescaleV2ToV3Cents(SUM)/SUM, so that for each row:
--   amount_cents := amount_cents * rescaleV2ToV3Cents(SUM) / SUM        -- v2→v3, same share for every backer
-- and then stamps the profile:
--   lifetime_cents  = current_cents = SUM(rescaled rows)  (== the v3 total, a cache of SUM)      -- pre-burn
--   burn_updated_at = now
-- Rescaling the LEDGER (not storing a separate v3 total) is deliberate: lifetime stays SUM(funding_earnings),
-- so the cap table still reconciles (its groups sum to the total — worker/src/funding/reconcile.test.ts).
-- rescaleV2ToV3Cents is proportional WITHIN the player's star band, so each player's current round maps to
-- the matching new star (nobody jumps to max) and relative order is preserved (shared/economyV3.test.ts +
-- worker/src/funding/economyV3.test.ts cover star-preservation, proportions, reconciliation + idempotency).
ALTER TABLE funding_profiles ADD COLUMN economy_v3_lifetime_cents INTEGER;
ALTER TABLE funding_profiles ADD COLUMN economy_v3_current_cents INTEGER;
-- Last time continuous burn was folded into current_cents; burn is computed lazily from this stamp
-- (PLAN-economy-v3 decision 4), never ticked per player.
ALTER TABLE funding_profiles ADD COLUMN economy_v3_burn_updated_at INTEGER;
