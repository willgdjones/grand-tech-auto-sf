import type { Clock } from '@gtasf/shared/clock';
import type { Env } from '../../env';
import { callPrescreen, type PrescreenCall } from '../prescreen/haiku';
import { ADVISORY_TASK_TEXT } from '../prescreen/prompt';

/**
 * Queue consumer for a `moderate-image` job (bead gtasf-ad-moderation-consumer-ri4a).
 *
 * The producer (LedgerDO.upload) stores the uploaded ad logo in R2 quarantine and enqueues the job; this runs
 * the OpenRouter advisory prescreen (worker/src/media/prescreen/haiku.ts) on the quarantined bytes and writes
 * the advisory JSON back to R2 as a `<key>.prescreen.json` sidecar for the human reviewer.
 *
 * Scope of this slice: OpenRouter vision accepts the uploaded image directly, so no server-side decode/encode
 * codec is needed here (that, and the asset-status transition + admin surfacing, are the follow-up tracked on
 * the bead — coordinate the storage location with the outbid/ledger pane). Caller gates on `flags.moderation`.
 */
export const MAX_MODERATION_IMAGE_BYTES = 2_200_000; // just above the upload's readBounded(2.1 MB) cap
const ALLOWED_MIME = new Set(['image/webp', 'image/png', 'image/jpeg']);
const SYSTEM_CLOCK: Clock = { monotonicMs: () => Date.now() } as Clock;

export interface ModerateImageDeps {
  clock?: Clock;
  fetch?: typeof fetch;
  /** Injectable prescreen for tests; defaults to the real OpenRouter call. */
  prescreen?: typeof callPrescreen;
  now?: () => number;
}

export interface ModerationOutcome { status: PrescreenCall['status'] | 'skipped'; reason: string }

/** Returns the prescreen result, or null when skipped (no key, missing/oversized object, no OpenRouter key). */
export async function handleModerateImage(key: string, env: Env, deps: ModerateImageDeps = {}): Promise<PrescreenCall | null> {
  if (!env.OPENROUTER_API_KEY) return null; // prescreen unavailable without the key
  const object = await env.ASSETS.get(key);
  if (!object) return null; // already removed / expired out of quarantine
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_MODERATION_IMAGE_BYTES) return null;
  const mime = object.httpMetadata?.contentType ?? 'image/webp';
  const mediaType = ALLOWED_MIME.has(mime) ? mime : 'image/webp';
  const prescreen = deps.prescreen ?? callPrescreen;
  const now = deps.now ?? (() => Date.now());
  const result = await prescreen(
    { fetch: deps.fetch ?? fetch, apiKey: env.OPENROUTER_API_KEY, clock: deps.clock ?? SYSTEM_CLOCK, mediaType },
    bytes,
    ADVISORY_TASK_TEXT,
  );
  // Advisory sidecar for the human reviewer. The asset-status flip + admin surfacing is the follow-up.
  const sidecar = {
    at: now(), key, status: result.status, detail: result.detail,
    costMicrousd: result.costMicrousd, output: result.output ?? null,
  };
  await env.ASSETS.put(`${key}.prescreen.json`, JSON.stringify(sidecar), { httpMetadata: { contentType: 'application/json' } });
  return result;
}
