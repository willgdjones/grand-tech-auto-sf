import { describe, expect, it, vi } from 'vitest';
import { callPrescreen, prescreenMessages } from './haiku';
import { PRESCREEN_MAX_TOKENS, PRESCREEN_MODEL } from '@gtasf/shared/constants';
import { POLICY_CATEGORIES, PRESCREEN_LABELS } from '@gtasf/shared/moderation/prescreenSchema';
import type { Clock } from '@gtasf/shared/clock';

const clock = { monotonicMs: () => 0 } as unknown as Clock;
const img = new Uint8Array([1, 2, 3, 4]);

const validOutput = {
  policy: Object.fromEntries(POLICY_CATEGORIES.map(k => [k, 0])),
  brands: [],
  people: [],
  text: { detected: '', language: '', translation_en: '' },
  labels: Object.fromEntries(PRESCREEN_LABELS.map(k => [k, false])),
  claims: [],
  affiliation_claims: [],
  summary: 'ok',
  reviewer_attention: 'none',
  reasons: [],
};

function openAiResponse(
  content: string,
  finish_reason = 'stop',
  usage: unknown = { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
  status = 200,
): Response {
  return Response.json({ choices: [{ message: { content }, finish_reason }], usage }, { status });
}

describe('callPrescreen (OpenRouter)', () => {
  it('sends an OpenAI-compatible vision request and returns the validated output + mapped usage', async () => {
    let seenBody: Record<string, any> = {};
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
      seenBody = JSON.parse(String(init?.body));
      return openAiResponse(JSON.stringify(validOutput));
    }) as unknown as typeof fetch;

    const res = await callPrescreen({ fetch: fetcher, apiKey: 'sk-test', clock }, img, 'annotate this');
    expect(res.status).toBe('ok');
    expect(res.output?.reviewer_attention).toBe('none');
    expect(res.usage).toEqual({ input_tokens: 10, output_tokens: 4 });
    expect(res.costMicrousd).toBe(10 * 1 + 4 * 5); // Haiku 4.5 list price: $1/M in, $5/M out

    // Request shape: OpenRouter model slug, max_tokens held at 1500, json_object, image data URL + text.
    expect(PRESCREEN_MODEL).toBe('anthropic/claude-haiku-4.5');
    expect(seenBody.model).toBe(PRESCREEN_MODEL);
    expect(seenBody.max_tokens).toBe(PRESCREEN_MAX_TOKENS);
    expect(seenBody.max_tokens).toBe(1500);
    expect(seenBody.response_format).toEqual({ type: 'json_object' });
    expect(seenBody.messages[0].role).toBe('system');
    expect(seenBody.messages[1].content[0].type).toBe('image_url');
    expect(seenBody.messages[1].content[0].image_url.url.startsWith('data:image/webp;base64,')).toBe(true);
    expect(seenBody.messages[1].content[1]).toEqual({ type: 'text', text: 'annotate this' });
  });

  it('omits the image part for a text-only (details-mode) call', () => {
    const msgs = prescreenMessages(null, 'text only', 'sys');
    expect(msgs[0]).toEqual({ role: 'system', content: 'sys' });
    const content = msgs[1]!.content as { type: string; text?: string }[];
    expect(content).toHaveLength(1);
    expect(content[0]).toEqual({ type: 'text', text: 'text only' });
  });

  it('reports a length truncation as incomplete_max_tokens', async () => {
    const fetcher = (async () => openAiResponse(JSON.stringify(validOutput), 'length')) as unknown as typeof fetch;
    expect((await callPrescreen({ fetch: fetcher, apiKey: 'k', clock }, img, 't')).status).toBe('incomplete_max_tokens');
  });

  it('reports a content_filter finish as refused', async () => {
    const fetcher = (async () => openAiResponse('', 'content_filter')) as unknown as typeof fetch;
    expect((await callPrescreen({ fetch: fetcher, apiKey: 'k', clock }, img, 't')).status).toBe('refused');
  });

  it('rejects non-JSON and schema-invalid content as schema_invalid', async () => {
    const notJson = (async () => openAiResponse('not json at all')) as unknown as typeof fetch;
    expect((await callPrescreen({ fetch: notJson, apiKey: 'k', clock }, img, 't')).status).toBe('schema_invalid');
    const badSchema = (async () => openAiResponse(JSON.stringify({ policy: {} }))) as unknown as typeof fetch;
    expect((await callPrescreen({ fetch: badSchema, apiKey: 'k', clock }, img, 't')).status).toBe('schema_invalid');
  });

  it('maps a 5xx to a retryable transport error', async () => {
    const http500 = (async () => openAiResponse('{}', 'stop', undefined, 500)) as unknown as typeof fetch;
    const res = await callPrescreen({ fetch: http500, apiKey: 'k', clock }, img, 't');
    expect(res.status).toBe('transport_error');
    expect(res.retryable).toBe(true);
    expect(res.detail).toBe('http_500');
  });

  it('strips a ```json fence before validating', async () => {
    const fenced = (async () => openAiResponse('```json\n' + JSON.stringify(validOutput) + '\n```')) as unknown as typeof fetch;
    expect((await callPrescreen({ fetch: fenced, apiKey: 'k', clock }, img, 't')).status).toBe('ok');
  });
});
