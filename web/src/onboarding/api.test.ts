import { describe, it, expect, vi } from 'vitest';
import { loadOnboardingState, saveOnboardingState } from './api';
import { freshOnboarding } from '@gtasf/shared/onboarding/state';

// Node-safe coverage for the onboarding client API (gtasf-882u) via an injected fake fetch.

function okJson(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

it('aborts stalled startup bodies and saves, retaining the nonthrowing fallback', async () => {
  vi.useFakeTimers();
  try {
    const pending = (signal: AbortSignal) => new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    });
    // Headers arrived but the state body stalled: startup must still recover.
    const load = loadOnboardingState(async (_url, init) => Object.assign(new Response(), {
      json: () => pending(init!.signal!),
    }));
    const save = saveOnboardingState(freshOnboarding(), (_url, init) => pending(init!.signal!));
    await vi.advanceTimersByTimeAsync(8000);
    await expect(load).resolves.toBeNull();
    await expect(save).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    await loadOnboardingState(async () => okJson({ state: {} }));
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

describe('loadOnboardingState', () => {
  it('parses the server-provided state object', async () => {
    const fetchImpl = async () => okJson({ state: { step: 'walk', hints: ['enterCar'], completed: false, skipped: false } });
    const state = await loadOnboardingState(fetchImpl as typeof fetch);
    expect(state).not.toBeNull();
    expect(state!.step).toBe('walk');
    expect(state!.hints).toContain('enterCar');
  });
  it('returns null on a non-ok response (e.g. 503 when the flag is off)', async () => {
    const fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({}) } as unknown as Response);
    expect(await loadOnboardingState(fetchImpl as typeof fetch)).toBeNull();
  });
  it('returns null (never throws) when fetch rejects', async () => {
    const fetchImpl = async () => { throw new Error('offline'); };
    expect(await loadOnboardingState(fetchImpl as typeof fetch)).toBeNull();
  });
  it('returns null when the body has no state', async () => {
    const fetchImpl = async () => okJson({});
    expect(await loadOnboardingState(fetchImpl as typeof fetch)).toBeNull();
  });
});

describe('saveOnboardingState', () => {
  it('POSTs { state: <serialized> } to the endpoint, same-origin, and never throws', async () => {
    let seen: { url: string; init?: RequestInit } | null = null;
    const fetchImpl = async (url: string, init?: RequestInit) => { seen = { url, init }; return okJson({}); };
    await saveOnboardingState(freshOnboarding(), fetchImpl as typeof fetch);
    expect(seen).not.toBeNull();
    expect(seen!.url).toBe('/api/onboarding/state');
    expect(seen!.init?.method).toBe('POST');
    expect(seen!.init?.credentials).toBe('same-origin');
    const body = JSON.parse(String(seen!.init?.body)) as { state: unknown };
    expect(typeof body.state).toBe('string'); // serializeOnboarding output
    expect(JSON.parse(body.state as string).step).toBe('intro'); // freshOnboarding starts at intro
  });
  it('swallows a failing POST', async () => {
    const fetchImpl = async () => { throw new Error('offline'); };
    await expect(saveOnboardingState(freshOnboarding(), fetchImpl as typeof fetch)).resolves.toBeUndefined();
  });
});
