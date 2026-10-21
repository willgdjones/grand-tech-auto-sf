import type { Clock } from '@gtasf/shared/clock';
import { PRESCREEN_MAX_TOKENS, PRESCREEN_MODEL } from '@gtasf/shared/constants';
import { validatePrescreenOutput } from '@gtasf/shared/moderation/prescreenSchema';
import type { PrescreenOutput } from '@gtasf/shared/moderation/prescreenSchema';
import { openRouterChat, OpenRouterError, stripJsonFence } from '../../llm/openrouter';
import type { OpenRouterMessage, OpenRouterUsage } from '../../llm/openrouter';
import { costMicrousd } from './prices';
import type { PrescreenUsage } from './prices';
import { PRESCREEN_SYSTEM_PROMPT } from './prompt';

/** One request's own ceiling; the advisory job's overall budget is tighter (§9.2.1, 5 s). */
export const PRESCREEN_REQUEST_TIMEOUT_MS = 10_000;

export type PrescreenCallStatus =
  'ok' | 'incomplete_max_tokens' | 'refused' | 'schema_invalid' | 'transport_error' | 'timeout';
export interface PrescreenCall {
  readonly status: PrescreenCallStatus;
  /** Present only for `ok`: a partial or unvalidated answer is never exposed. */
  readonly output?: PrescreenOutput;
  /** Transport errors that may be retried once (network, 408/429/5xx); never model outcomes. */
  readonly retryable: boolean;
  readonly usage: PrescreenUsage;
  readonly costMicrousd: number;
  readonly latencyMs: number;
  /** A bounded diagnostic code (never provider text). */
  readonly detail: string;
}
export interface HaikuDeps {
  readonly fetch: typeof fetch;
  readonly apiKey: string;
  readonly clock: Clock;
  readonly timeoutMs?: number;
  /** Details mode supplies its versioned text-only prompt; image advisory keeps its exact prompt. */
  readonly systemPrompt?: string;
  /** Image MIME for the data URL (uploads may be png/jpeg/webp); defaults to image/webp. */
  readonly mediaType?: string;
}

const NO_USAGE: PrescreenUsage = { input_tokens: 0, output_tokens: 0 };

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
/** OpenRouter reports OpenAI-style usage; map it onto the Anthropic-shaped {@link PrescreenUsage}. */
function usageFrom(value: OpenRouterUsage | null): PrescreenUsage {
  if (!value) return NO_USAGE;
  const n = (v: number) => (Number.isSafeInteger(v) && v >= 0 ? v : 0);
  return { input_tokens: n(value.prompt_tokens), output_tokens: n(value.completion_tokens) };
}

/**
 * The OpenRouter chat messages for one prescreen call: a system prompt, then a user turn with the image
 * (as an OpenAI `image_url` data URL) and the task text. The advisory prompt stays byte-for-byte; details
 * mode passes its own `systemPrompt`.
 */
export function prescreenMessages(
  image: Uint8Array | null,
  taskText: string,
  systemPrompt = PRESCREEN_SYSTEM_PROMPT,
  mediaType = 'image/webp',
): OpenRouterMessage[] {
  return [
    { role: 'system', content: systemPrompt },
    {
      role: 'user',
      content: [
        ...(image ? [{ type: 'image_url' as const, image_url: { url: `data:${mediaType};base64,${base64(image)}` } }] : []),
        { type: 'text' as const, text: taskText },
      ],
    },
  ];
}

/**
 * One OpenRouter Chat Completions call (§9.2.2; founder decision 2026-10-03: GTASF has no Anthropic key, so
 * Haiku runs through OpenRouter's OpenAI-compatible API). Only a `stop` (or absent) finish with a JSON body
 * that passes {@link validatePrescreenOutput} is `ok`; a `length` truncation, a `content_filter` refusal and
 * any schema failure are never partially used. This function never retries: the caller owns the retry policy.
 */
export async function callPrescreen(
  deps: HaikuDeps,
  image: Uint8Array | null,
  taskText: string,
): Promise<PrescreenCall> {
  const started = deps.clock.monotonicMs();
  const done = (
    status: PrescreenCallStatus,
    detail: string,
    usage = NO_USAGE,
    extra: { output?: PrescreenOutput; retryable?: boolean } = {},
  ): PrescreenCall => ({
    status,
    detail,
    usage,
    costMicrousd: costMicrousd(PRESCREEN_MODEL, usage),
    latencyMs: Math.max(0, Math.round(deps.clock.monotonicMs() - started)),
    retryable: extra.retryable ?? false,
    ...(extra.output ? { output: extra.output } : {}),
  });
  let result;
  try {
    result = await openRouterChat({
      apiKey: deps.apiKey,
      fetch: deps.fetch,
      model: PRESCREEN_MODEL,
      maxTokens: PRESCREEN_MAX_TOKENS,
      temperature: 0,
      responseFormat: { type: 'json_object' },
      title: 'GTASF',
      timeoutMs: deps.timeoutMs ?? PRESCREEN_REQUEST_TIMEOUT_MS,
      messages: prescreenMessages(image, taskText, deps.systemPrompt, deps.mediaType),
    });
  } catch (error) {
    const code = error instanceof OpenRouterError ? error.code : 'transport';
    if (code === 'timeout') return done('timeout', 'timeout');
    const httpStatus = code.startsWith('http_') ? Number(code.slice(5)) : null;
    const retryable = httpStatus !== null ? httpStatus >= 500 || httpStatus === 408 || httpStatus === 429 : code === 'transport';
    return done('transport_error', code, NO_USAGE, { retryable });
  }
  const usage = usageFrom(result.usage);
  // OpenAI/OpenRouter finish reasons: 'length' truncated, 'content_filter' refused, 'stop'/null complete.
  if (result.finishReason === 'length') return done('incomplete_max_tokens', 'length', usage);
  if (result.finishReason === 'content_filter') return done('refused', 'content_filter', usage);
  if (result.finishReason && result.finishReason !== 'stop') return done('schema_invalid', 'finish_reason', usage);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(result.text));
  } catch {
    return done('schema_invalid', 'not_json', usage);
  }
  const validated = validatePrescreenOutput(parsed);
  if (!validated.ok) return done('schema_invalid', 'schema', usage);
  return done('ok', 'ok', usage, { output: validated.value });
}
