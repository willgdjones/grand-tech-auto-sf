-- Onboarding (PLAN-onboarding.md, gtasf-n34i): the player's tutorial step + one-time hint log, kept
-- per device so the SA intro/tutorial runs once and contextual hints show once. The JSON payload is
-- shared/onboarding/state.ts's OnboardingState ({ step, hints[], completed, skipped }); the worker only
-- stores and returns it (validated with parseOnboarding), it is not authoritative gameplay. Behind
-- flags.onboarding.
CREATE TABLE IF NOT EXISTS onboarding_state (
  device_id TEXT PRIMARY KEY,
  state TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
