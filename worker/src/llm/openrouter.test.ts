import { expect, it, vi } from 'vitest';
import { openRouterChat, OpenRouterError, OPENROUTER_DEFAULT_MODEL, stripJsonFence } from './openrouter';

function jsonResponse(body: unknown, status = 200): Response { return Response.json(body, { status }); }

it('posts an OpenAI-compatible request to OpenRouter and returns the message text', async () => {
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init?.method).toBe('POST');
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer sk-test');
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe(OPENROUTER_DEFAULT_MODEL);
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    expect(body.response_format).toEqual({ type: 'json_object' });
    return jsonResponse({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } });
  }) as unknown as typeof fetch;
  const result = await openRouterChat({ apiKey: 'sk-test', fetch: fetcher, responseFormat: { type: 'json_object' }, messages: [{ role: 'user', content: 'hi' }] });
  expect(result).toEqual({ text: '{"ok":true}', finishReason: 'stop', usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } });
});

it('flattens array content parts to text', async () => {
  const fetcher = (async () => jsonResponse({ choices: [{ message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }, finish_reason: 'stop' }] })) as unknown as typeof fetch;
  expect((await openRouterChat({ apiKey: 'k', fetch: fetcher, messages: [{ role: 'user', content: 'x' }] })).text).toBe('ab');
});

it('throws a coded OpenRouterError on HTTP failure, missing key and empty choices', async () => {
  await expect(openRouterChat({ apiKey: '  ', fetch: (async () => jsonResponse({})) as unknown as typeof fetch, messages: [] })).rejects.toMatchObject({ code: 'no_api_key' });
  const http500 = (async () => jsonResponse({ error: 'x' }, 500)) as unknown as typeof fetch;
  await expect(openRouterChat({ apiKey: 'k', fetch: http500, messages: [] })).rejects.toMatchObject({ code: 'http_500' });
  const noChoices = (async () => jsonResponse({ choices: [] })) as unknown as typeof fetch;
  await expect(openRouterChat({ apiKey: 'k', fetch: noChoices, messages: [] })).rejects.toMatchObject({ code: 'no_choices' });
});

it('maps transport failures to a coded error', async () => {
  const boom = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
  const error = await openRouterChat({ apiKey: 'k', fetch: boom, messages: [] }).catch(e => e);
  expect(error).toBeInstanceOf(OpenRouterError);
  expect(error.code).toBe('transport');
});

it('strips a ```json fence before parsing', () => {
  expect(stripJsonFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
  expect(stripJsonFence('{"b":2}')).toBe('{"b":2}');
});
