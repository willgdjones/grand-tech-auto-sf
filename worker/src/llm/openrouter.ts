/**
 * Small shared OpenRouter client (founder decision 2026-10-03: GTASF has no Anthropic key, so every
 * Claude/Haiku call goes through OpenRouter's OpenAI-compatible Chat Completions API). Text and vision
 * are both supported via the OpenAI message-content shape. The caller owns the OPENROUTER_API_KEY secret
 * and caps how often this is used; this function does one bounded, timed request and never retries.
 */

export const OPENROUTER_ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions';
/** Founder-chosen default: Claude Haiku 4.5 (text + vision) via OpenRouter. */
export const OPENROUTER_DEFAULT_MODEL = 'anthropic/claude-haiku-4.5';

export type OpenRouterContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };
export type OpenRouterContent = string | ReadonlyArray<OpenRouterContentPart>;
export interface OpenRouterMessage { role: 'system' | 'user' | 'assistant'; content: OpenRouterContent }

export interface OpenRouterUsage { prompt_tokens: number; completion_tokens: number; total_tokens: number }
export interface OpenRouterResult {
  /** Assistant message text (content parts are flattened to their text). */
  text: string;
  /** OpenAI-style: 'stop' = complete, 'length' = truncated, etc. Null when the provider omits it. */
  finishReason: string | null;
  usage: OpenRouterUsage | null;
}

export interface OpenRouterOptions {
  apiKey: string;
  messages: ReadonlyArray<OpenRouterMessage>;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  /** Passed through as OpenAI `response_format`, e.g. `{ type: 'json_object' }`. */
  responseFormat?: unknown;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Hard cap on the decoded response size. Default 256 KiB. */
  maxResponseBytes?: number;
  /** Optional OpenRouter attribution headers. */
  referer?: string;
  title?: string;
}

/** A bounded diagnostic code is always set; provider text is never surfaced. */
export class OpenRouterError extends Error {
  constructor(readonly code: string, message?: string) { super(message ?? code); this.name = 'OpenRouterError'; }
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/** Content may be a string or an array of parts (some providers echo the array); flatten text parts. */
function contentText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const text = content
      .map(part => (asObject(part).type === 'text' && typeof asObject(part).text === 'string' ? (asObject(part).text as string) : ''))
      .join('');
    return text ? text : null;
  }
  return null;
}

function usageOf(value: unknown): OpenRouterUsage | null {
  const usage = asObject(value);
  if (!('prompt_tokens' in usage) && !('completion_tokens' in usage) && !('total_tokens' in usage)) return null;
  const n = (key: string) => (Number.isSafeInteger(usage[key]) && (usage[key] as number) >= 0 ? (usage[key] as number) : 0);
  return { prompt_tokens: n('prompt_tokens'), completion_tokens: n('completion_tokens'), total_tokens: n('total_tokens') };
}

export async function openRouterChat(options: OpenRouterOptions): Promise<OpenRouterResult> {
  if (!options.apiKey.trim()) throw new OpenRouterError('no_api_key', 'OpenRouter requires an API key');
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) throw new OpenRouterError('bad_timeout', 'Invalid OpenRouter timeout');
  const maxBytes = options.maxResponseBytes ?? 262_144;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetch ?? fetch)(OPENROUTER_ENDPOINT, {
      // workerd rejects redirect:'error' ("won't be implemented… use manual and check the status"), which
      // threw transport errors on every runtime OpenRouter call (pitch judge fell back silently). 'manual'
      // returns any 3xx unfollowed; the `!response.ok` check below then rejects it exactly as 'error' intended. [gtasf-y5vc]
      method: 'POST', credentials: 'omit', redirect: 'manual', signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${options.apiKey}`,
        ...(options.referer ? { 'HTTP-Referer': options.referer } : {}),
        ...(options.title ? { 'X-Title': options.title } : {}),
      },
      body: JSON.stringify({
        model: options.model ?? OPENROUTER_DEFAULT_MODEL,
        messages: options.messages,
        max_tokens: options.maxTokens ?? 1024,
        temperature: options.temperature ?? 0,
        ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
      }),
    });
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new OpenRouterError(`http_${response.status}`, `OpenRouter HTTP ${response.status}`); }
    const reader = response.body?.getReader();
    if (!reader) throw new OpenRouterError('empty', 'OpenRouter returned no body');
    const decoder = new TextDecoder();
    let bytes = 0, raw = '';
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > maxBytes) { await reader.cancel(); throw new OpenRouterError('too_large', 'OpenRouter response exceeded the size cap'); }
        raw += decoder.decode(chunk.value, { stream: true });
      }
    } finally { reader.releaseLock(); }
    let parsed: unknown;
    try { parsed = JSON.parse(raw + decoder.decode()); } catch { throw new OpenRouterError('not_json', 'OpenRouter response was not JSON'); }
    const message = asObject(parsed);
    if (message.error) throw new OpenRouterError('api_error', 'OpenRouter returned an error');
    const choices = message.choices;
    if (!Array.isArray(choices) || choices.length === 0) throw new OpenRouterError('no_choices', 'OpenRouter returned no choices');
    const choice = asObject(choices[0]);
    const text = contentText(asObject(choice.message).content);
    if (text === null) throw new OpenRouterError('no_content', 'OpenRouter choice had no text content');
    return { text, finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : null, usage: usageOf(message.usage) };
  } catch (error) {
    if (error instanceof OpenRouterError) throw error;
    throw new OpenRouterError(controller.signal.aborted ? 'timeout' : 'transport', error instanceof Error ? error.message : String(error));
  } finally { clearTimeout(timer); }
}

/** Strip a single ```json … ``` (or bare ```) fence some models wrap JSON in, before JSON.parse. */
export function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(trimmed);
  return fence ? fence[1]!.trim() : trimmed;
}
