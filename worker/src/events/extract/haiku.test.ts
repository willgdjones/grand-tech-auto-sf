import { expect, it, vi } from 'vitest';
import { crawlTechWeek } from '../crawler';
import { parseEventPage } from '../parse';
import { createHaikuExtractor, validateExtraction } from './haiku';

it('smoke: extracts a public body-only event, preserves structured events and rejects invented/missing times', async () => {
  const text = 'Builders Breakfast. October 5, 2026 at 8:00 AM PDT. Community Hall, San Francisco.';
  const input = { text, url: 'https://partiful.com/e/breakfast', hidden: false };
  const output = { title: 'Builders Breakfast', host: null, venue: 'Community Hall', address: null,
    start: { date: 'October 5, 2026', time: '8:00 AM', zone: 'PDT' }, end: null };
  const provider = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json({ choices: [{ message: { content: JSON.stringify(output) }, finish_reason: 'stop' }] }));
  const extractor = createHaikuExtractor({ apiKey: 'fixture-only', fetch: provider });
  expect(await extractor(input)).toMatchObject({ title: output.title, start: '2026-10-05T15:00:00.000Z', url: input.url });
  expect(validateExtraction({ ...output, start: { ...output.start, zone: null } }, input)?.start).toBe('2026-10-05T15:00:00.000Z');
  expect(validateExtraction({ ...output, start: null }, input)).toBeNull();
  expect(() => validateExtraction({ ...output, venue: 'Invented Venue' }, input)).toThrow('ungrounded');
  expect(validateExtraction(output, { ...input, hidden: true })).toMatchObject({ venue: undefined, address: undefined, hidden: true });
  expect(parseEventPage('<script id="__NEXT_DATA__">{"props":{"pageProps":{"passwordRequired":true}}}</script>', input.url).fallback).toBeUndefined();
  const fetched = vi.fn(async (url: string | URL | Request) => {
    const path = String(url);
    const html = (body: string) => new Response(body, { headers: { 'content-type': 'text/html' } });
    if (path.endsWith('robots.txt')) return new Response('User-agent: *\nAllow: /');
    if (path.includes('tech-week.com')) return html('<a href="https://partiful.com/e/breakfast">Breakfast</a><a href="https://luma.com/structured">Structured</a>');
    if (path.includes('/structured')) return html('<script type="application/ld+json">{"@type":"Event","name":"Structured","startDate":"2026-10-06T08:00:00-07:00"}</script>');
    return html(`<meta property="og:title" content="Builders Breakfast"><p>${text}</p>`);
  });
  let now = 0;
  const model = vi.fn(extractor);
  const result = await crawlTechWeek({ enabled: true, geocode: async () => null, extractEvent: model,
    fetchOptions: { fetch: fetched, now: () => now, sleep: async ms => { now += ms; } } });
  expect(result.events.map(e => e.title)).toEqual(['Builders Breakfast', 'Structured']);
  expect(model).toHaveBeenCalledTimes(1);
  expect(result.events[0]).toMatchObject({ source: 'partiful', end: null, address: null, approx: true });
  expect(provider.mock.calls[0]?.[0]).toBe('https://openrouter.ai/api/v1/chat/completions');
});
