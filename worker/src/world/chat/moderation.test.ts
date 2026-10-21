import { describe, expect, it } from 'vitest';
import { locallyApproved, moderateChat, moderateChatVerdict, SPOKEN_SHOW_AT } from './moderation';

/** Mock the TypeSafe/Jev endpoint the same way outbid.test.ts does. */
function jevFetcher(probability: number, opts: { throws?: boolean; calls?: { n: number } } = {}): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('https://api.typesafe.ai/')) {
      if (opts.calls) opts.calls.n++;
      if (opts.throws) throw new Error('network');
      return Response.json({ answers: { acceptable: { noul: probability } } });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
}

describe('locallyApproved (always-on word filter)', () => {
  it('passes ordinary chat and returns the cleaned display string', () => {
    expect(locallyApproved('anyone at the ferry building meetup?')).toBe('anyone at the ferry building meetup?');
  });
  it('blocks self-harm / threat phrasing (also when leet-squashed)', () => {
    expect(locallyApproved('kill yourself')).toBeNull();
    expect(locallyApproved('kill y0urself')).toBeNull(); // leet digits are squashed back to letters
  });
  it('rejects empty or whitespace-only input', () => {
    expect(locallyApproved('   ')).toBeNull();
  });
});

describe('moderateChat', () => {
  it('with no key returns the local result (local-only moderation)', async () => {
    expect(await moderateChat('grabbing coffee at blue bottle', undefined)).toBe('grabbing coffee at blue bottle');
    expect(await moderateChat('kill yourself', undefined)).toBeNull();
  });

  it('with a configured key, approves normal chat that Jev rates acceptable', async () => {
    const calls = { n: 0 };
    expect(await moderateChat('who wants to carpool to the hackathon', 'test-key', jevFetcher(1, { calls })))
      .toBe('who wants to carpool to the hackathon');
    expect(calls.n).toBe(1);
  });

  it('with a configured key, rejects chat Jev rates below the 0.95 threshold', async () => {
    expect(await moderateChat('a borderline message', 'test-key', jevFetcher(0.5))).toBeNull();
  });

  it('short-circuits the local filter before calling Jev (no provider call for blocked text)', async () => {
    const calls = { n: 0 };
    expect(await moderateChat('kill yourself', 'test-key', jevFetcher(1, { calls }))).toBeNull();
    expect(calls.n).toBe(0);
  });

  it('fails closed (drops the message) when the provider errors or times out', async () => {
    expect(await moderateChat('perfectly fine message', 'test-key', jevFetcher(1, { throws: true }))).toBeNull();
  });

  it('fails closed on an out-of-range or non-finite Jev score (invalid classification)', async () => {
    expect(await moderateChat('fine message', 'test-key', jevFetcher(1.5))).toBeNull();  // > 1
    expect(await moderateChat('fine message', 'test-key', jevFetcher(-1))).toBeNull();   // < 0
    expect(await moderateChat('fine message', 'test-key', jevFetcher(NaN))).toBeNull();  // JSON → null, non-finite
  });

  it('fails closed when the provider returns a malformed body with no classification', async () => {
    const fetcher = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith('https://api.typesafe.ai/')) return Response.json({ unexpected: true });
      throw new Error(`unexpected fetch ${url}`);
    }) as typeof fetch;
    expect(await moderateChat('fine message', 'test-key', fetcher)).toBeNull();
  });
  it('verdict separates a refusal (blocked) from a provider outage (unavailable) — only refusals strike spoken bubbles', async () => {
    expect(await moderateChatVerdict('kill yourself', 'test-key', jevFetcher(1))).toEqual({ verdict: 'blocked', text: null });
    expect(await moderateChatVerdict('a borderline message', 'test-key', jevFetcher(0.5))).toEqual({ verdict: 'borderline', text: null, score: 0.5 });
    expect(await moderateChatVerdict('a borderline message', 'test-key', jevFetcher(0.94))).toEqual({ verdict: 'borderline', text: null, score: 0.94 });
    expect(await moderateChatVerdict('a clearly refused message', 'test-key', jevFetcher(0.1))).toEqual({ verdict: 'blocked', text: null, score: 0.1 });
    expect(await moderateChatVerdict('a message', 'test-key', jevFetcher(Number.NaN))).toEqual({ verdict: 'unavailable', text: null });
    expect(await moderateChatVerdict('a message', 'test-key', jevFetcher(0.97))).toEqual({ verdict: 'approved', text: 'a message', score: 0.97 });
    const down = (async () => { throw new TypeError('network down'); }) as unknown as typeof fetch;
    expect(await moderateChatVerdict("what's up guys", 'test-key', down)).toEqual({ verdict: 'unavailable', text: null });
    expect(await moderateChat("what's up guys", 'test-key', down)).toBeNull(); // typed chat still fails closed
    expect(await moderateChatVerdict("what's up guys", undefined)).toEqual({ verdict: 'approved', text: "what's up guys" });
  });
  it('spoken captions show from 0.5 (casual speech); typed chat still needs .95; strikes stay below .3', async () => {
    expect(await moderateChatVerdict('testing testing', 'test-key', jevFetcher(0.6), SPOKEN_SHOW_AT)).toEqual({ verdict: 'approved', text: 'testing testing', score: 0.6 });
    expect(await moderateChatVerdict('hello is this working', 'test-key', jevFetcher(0.4), SPOKEN_SHOW_AT)).toEqual({ verdict: 'borderline', text: null, score: 0.4 });
    expect(await moderateChatVerdict('a refused line', 'test-key', jevFetcher(0.2), SPOKEN_SHOW_AT)).toEqual({ verdict: 'blocked', text: null, score: 0.2 });
    expect(await moderateChat('testing testing', 'test-key', jevFetcher(0.6))).toBeNull(); // typed: unchanged
    expect((await moderateChatVerdict('kill yourself', 'test-key', jevFetcher(1), SPOKEN_SHOW_AT)).verdict).toBe('blocked'); // local blocklist first
  });
});
