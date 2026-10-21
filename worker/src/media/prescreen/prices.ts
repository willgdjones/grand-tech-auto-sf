import { PRESCREEN_MODEL } from '@gtasf/shared/constants';

/**
 * Versioned list prices in micro-USD per token (§16.3: verify against the provider's price page when
 * this changes). Haiku 4.5: $1 per million input tokens, $5 per million output tokens.
 */
export const PRESCREEN_PRICE_TABLE = {
  version: 'pp-2026-09-30',
  models: {
    [PRESCREEN_MODEL]: { inputMicrousdPerToken: 1, outputMicrousdPerToken: 5 },
  },
} as const;

export interface PrescreenUsage {
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cache_creation_input_tokens?: number;
  readonly cache_read_input_tokens?: number;
}

/** Whole micro-USD, rounded up; cached input (never requested here) is billed at the input rate. */
export function costMicrousd(model: string, usage: PrescreenUsage): number {
  const price = (
    PRESCREEN_PRICE_TABLE.models as Record<
      string,
      (typeof PRESCREEN_PRICE_TABLE.models)[typeof PRESCREEN_MODEL]
    >
  )[model];
  if (!price) throw new RangeError('No price for model');
  const count = (value: number | undefined) => (Number.isSafeInteger(value) && value! > 0 ? value! : 0);
  const input =
    count(usage.input_tokens) +
    count(usage.cache_creation_input_tokens) +
    count(usage.cache_read_input_tokens);
  return Math.ceil(
    input * price.inputMicrousdPerToken + count(usage.output_tokens) * price.outputMicrousdPerToken,
  );
}
