import { describe, expect, it } from 'vitest';
import type { Env } from '../env';
import { checkoutConfigured, stripePublishableKey, stripeSecretKey, stripeWebhookSecret } from './stripeEnv';

const env = (over: Partial<Env>): Env => ({
  ENVIRONMENT: 'local',
  STRIPE_SECRET_KEY: 'sk_live_LIVE', STRIPE_WEBHOOK_SECRET: 'whsec_LIVE', STRIPE_PUBLISHABLE_KEY: 'pk_live_LIVE',
  STRIPE_TEST_SECRET_KEY: 'sk_test_T', STRIPE_TEST_WEBHOOK_SECRET: 'whsec_test', STRIPE_TEST_PUBLISHABLE_KEY: 'pk_test_T',
  ...over,
} as unknown as Env);

describe('stripeEnv key selection', () => {
  it('non-production uses the TEST keys only — never the live key', () => {
    for (const environment of ['local', 'test', 'staging'] as const) {
      const v = env({ ENVIRONMENT: environment });
      expect(stripeSecretKey(v)).toBe('sk_test_T');
      expect(stripeWebhookSecret(v)).toBe('whsec_test');
      expect(stripePublishableKey(v)).toBe('pk_test_T');
      expect(stripeSecretKey(v)).not.toBe('sk_live_LIVE');
    }
  });

  it('production uses the live keys', () => {
    const v = env({ ENVIRONMENT: 'production' });
    expect(stripeSecretKey(v)).toBe('sk_live_LIVE');
    expect(stripeWebhookSecret(v)).toBe('whsec_LIVE');
    expect(stripePublishableKey(v)).toBe('pk_live_LIVE');
  });

  it('checkoutConfigured is ALWAYS false in production (live checkout stays off until approved)', () => {
    expect(checkoutConfigured(env({ ENVIRONMENT: 'production' }))).toBe(false);
  });

  it('checkoutConfigured is true in non-production with genuine test credentials', () => {
    expect(checkoutConfigured(env({ ENVIRONMENT: 'local' }))).toBe(true);
    expect(checkoutConfigured(env({ ENVIRONMENT: 'staging' }))).toBe(true);
  });

  it('checkoutConfigured is false when a non-test key sits in the test slot', () => {
    expect(checkoutConfigured(env({ ENVIRONMENT: 'local', STRIPE_TEST_SECRET_KEY: 'sk_live_OOPS' }))).toBe(false);
  });

  it('checkoutConfigured is false without complete test credentials', () => {
    expect(checkoutConfigured(env({ ENVIRONMENT: 'local', STRIPE_TEST_SECRET_KEY: undefined }))).toBe(false);
    expect(checkoutConfigured(env({ ENVIRONMENT: 'local', STRIPE_TEST_WEBHOOK_SECRET: undefined }))).toBe(false);
  });
});
