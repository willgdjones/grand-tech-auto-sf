/**
 * Onboarding client API (gtasf-882u): the client caller for pane 14's worker routes
 * (worker/src/onboarding/routes.ts) — `GET/POST /api/onboarding/state -> { state }`. Pane 6 uses these
 * to seed and persist the flow:
 *
 *   const state = (await loadOnboardingState()) ?? freshOnboarding();
 *   const flow = createOnboardingFlow({ state, isTouch, ui, persist: saveOnboardingState });
 *
 * The worker already chooses the right fresh-vs-returning state for a new/known device, so a 200
 * resolves to that. `fetch` is injectable for tests. Both calls are same-origin with credentials so
 * the device cookie rides along; they require `flags.onboarding` on the worker (503 -> treated as no
 * state / a no-op, so a disabled worker never throws into the game loop).
 */
import { parseOnboarding, serializeOnboarding, type OnboardingState } from '@gtasf/shared/onboarding/state';

const ENDPOINT = '/api/onboarding/state';
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Load this device's onboarding state, or null on any error (the caller falls back, e.g. `?? freshOnboarding()`). */
export async function loadOnboardingState(fetchImpl: FetchLike = fetch): Promise<OnboardingState | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetchImpl(ENDPOINT, { method: 'GET', credentials: 'same-origin', signal: controller.signal });
    if (!res.ok) return null;
    const body = (await res.json()) as { state?: unknown };
    return body?.state == null ? null : parseOnboarding(body.state);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Persist onboarding progress. Best-effort: network/worker errors are swallowed so the flow keeps running. */
export async function saveOnboardingState(state: OnboardingState, fetchImpl: FetchLike = fetch): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    await fetchImpl(ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: serializeOnboarding(state) }),
    });
  } catch {
    /* best-effort; a failed save just means this step re-persists on the next sync */
  } finally {
    clearTimeout(timeout);
  }
}
