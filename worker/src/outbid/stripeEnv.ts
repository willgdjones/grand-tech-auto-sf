import type { Env } from '../env';

/**
 * Stripe key selection (founder directive 2026-10-03). A LIVE sk_live key is configured for
 * production; TEST keys live under STRIPE_TEST_*. Non-production uses the TEST keys ONLY and never
 * references the live key, so local dev and the founder-path smoke can exercise checkout end to end
 * with card 4242 4242 4242 4242 while it is impossible to touch a real card off production.
 */
export function stripeSecretKey(env: Env): string | undefined {
  return env.ENVIRONMENT === 'production' ? env.STRIPE_SECRET_KEY : env.STRIPE_TEST_SECRET_KEY;
}

export function stripeWebhookSecret(env: Env): string | undefined {
  return env.ENVIRONMENT === 'production' ? env.STRIPE_WEBHOOK_SECRET : env.STRIPE_TEST_WEBHOOK_SECRET;
}

/** The pk_* key the client initialises Stripe.js with — live in production, test otherwise. */
export function stripePublishableKey(env: Env): string | undefined {
  return env.ENVIRONMENT === 'production' ? env.STRIPE_PUBLISHABLE_KEY : env.STRIPE_TEST_PUBLISHABLE_KEY;
}

/**
 * True only when Stripe checkout is safely configured for this environment. Production is ALWAYS
 * false here: live checkout stays OFF until the founder approves one real low-value test charge
 * end-to-end (then refunds it) — a deliberate future change, not a flag flip. Non-production
 * requires genuine TEST credentials (sk_test_ / whsec_), so a misplaced live key never enables it.
 */
export function checkoutConfigured(env: Env): boolean {
  if (env.ENVIRONMENT === 'production') return false;
  return Boolean(env.STRIPE_TEST_SECRET_KEY?.startsWith('sk_test_') && env.STRIPE_TEST_WEBHOOK_SECRET?.startsWith('whsec_'));
}
