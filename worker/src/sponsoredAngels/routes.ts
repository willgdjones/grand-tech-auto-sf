import { flags } from '@gtasf/shared/flags';
import {
  SPONSORED_ANGEL_PRICE_USD_CENTS,
  validateSponsorDraft,
  type SponsoredAngel,
  type SponsoredAngelDraft,
  type SponsorDraftInput,
} from '@gtasf/shared/sponsoredAngels';
import { isSponsoredAngelSpot, openSponsoredAngelSpots } from '@gtasf/shared/content/sponsoredAngelSpots';
import type { Env } from '../env';
import { ensureFundingDevice } from '../funding/identity';
import { createSponsorReviewer, type SponsorReviewer } from './moderation';
import { getAngel, insertPendingAngel, listAngelsBySponsor, listLiveAngels, removeAngel, takenSpotIds } from './store';
import { checkoutConfigured } from '../outbid/stripeEnv';

/** A Stripe Checkout session; pane 7's ledger supplies {@link SponsoredAngelCheckout}. */
export interface CheckoutSession { id: string; url: string }
/**
 * Create a **USD** Stripe Checkout session for one sponsored angel. Owned by pane 7 (ledger,
 * `worker/src/ledger/checkout.ts`); injected here so the route is testable and this module never
 * reaches into the ledger. Must set `currency: 'usd'` (the account default is GBP).
 */
export type SponsoredAngelCheckout = (args: {
  env: Env; deviceId: string; draft: SponsoredAngelDraft; amountUsdCents: bigint;
}) => Promise<CheckoutSession>;

export interface SponsoredAngelDeps {
  /** Resolve the sponsor's device identity; defaults to the funding cookie. */
  identify?: (request: Request) => Promise<{ deviceId: string; cookie?: string }>;
  /** Jev name/line reviewer; defaults to the TypeSafe reviewer when `TYPESAFE_API_KEY` is set. */
  review?: SponsorReviewer;
  /** Pane 7 checkout; absent ⇒ /submit returns 503 (feature reachable, purchase not yet wired). */
  checkout?: SponsoredAngelCheckout;
  now?: () => number;
  newId?: () => string;
}

function json(body: unknown, status = 200, cookie?: string): Response {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cookie) headers['set-cookie'] = cookie;
  return new Response(JSON.stringify(body), { status, headers });
}

/** Only the public, non-identifying fields the sponsor dashboard / spawn need. */
function publicAngel(angel: SponsoredAngel) {
  return {
    id: angel.id, displayName: angel.displayName, line: angel.line, avatarColor: angel.avatarColor,
    spotId: angel.spotId, status: angel.status, pitchCount: angel.pitchCount,
  };
}

/** Constant-time token compare (mirrors worker/src/{feedback,events}/routes.ts). */
function tokenMatches(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
function isAdmin(request: Request, env: Env): boolean {
  const token = env.ADMIN_TOKEN?.trim();
  if (!token) return false;
  const match = /^Bearer\s+(.+)$/.exec(request.headers.get('authorization') ?? '');
  return match ? tokenMatches(match[1]!, token) : false;
}

/**
 * "Become an angel" API (docs/engineering/become-an-angel.md). Returns null for non-matching paths,
 * and also when `becomeAnAngel` is off so the request 404s like any disabled feature.
 * - GET  /api/angels/spots  → open spots (allow-list minus live-held) + the USD price.
 * - GET  /api/angels/mine   → the caller's sponsored angels (dashboard).
 * - POST /api/angels/submit → validate → Jev → checkout → persist pending; returns {checkoutUrl}.
 */
export async function handleSponsoredAngelsRequest(request: Request, env: Env, deps: SponsoredAngelDeps = {}): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/angels/')) return null;
  if (!flags.becomeAnAngel) return null;

  const db = env.DB;
  const now = deps.now ?? (() => Date.now());
  const identify = deps.identify ?? ((req: Request) => ensureFundingDevice(req, db, now()));
  const review = deps.review ?? (env.TYPESAFE_API_KEY ? createSponsorReviewer(env.TYPESAFE_API_KEY) : undefined);
  const newId = deps.newId ?? (() => crypto.randomUUID());

  if (request.method === 'GET' && url.pathname === '/api/angels/spots') {
    const spots = openSponsoredAngelSpots(await takenSpotIds(db));
    return json({ spots, priceUsdCents: SPONSORED_ANGEL_PRICE_USD_CENTS.toString() });
  }

  if (request.method === 'GET' && url.pathname === '/api/angels/mine') {
    const { deviceId, cookie } = await identify(request);
    const angels = (await listAngelsBySponsor(db, deviceId)).map(publicAngel);
    return json({ angels }, 200, cookie);
  }

  if (request.method === 'POST' && url.pathname === '/api/angels/submit') {
    const { deviceId, cookie } = await identify(request);
    let body: unknown;
    try { body = await request.json(); } catch { return json({ error: 'Invalid request body.' }, 400, cookie); }

    const taken = new Set(await takenSpotIds(db));
    let draft: SponsoredAngelDraft;
    try {
      draft = validateSponsorDraft(body as SponsorDraftInput, id => isSponsoredAngelSpot(id) && !taken.has(id));
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Check your entry.' }, 400, cookie);
    }

    // Jev name/line moderation (fail closed). No key ⇒ feature unavailable, never an open door.
    if (!review) return json({ error: 'Sponsored angels are not available right now.' }, 503, cookie);
    const verdict = await review({ displayName: draft.displayName, line: draft.line });
    if (!verdict.ok) return json({ error: verdict.reason ?? 'That did not pass moderation.' }, 422, cookie);

    // Checkout is pane 7's; until wired, the feature is reachable but a purchase cannot complete.
    if (!deps.checkout) return json({ error: 'Checkout is not configured yet.' }, 503, cookie);
    // Belt-and-braces for the Stripe live key: never start a real charge unless checkout is configured
    // for this environment. checkoutConfigured() is false in production until the founder approves one
    // real purchase, so the live-charge gate lives on the route itself, not just the flag + DI wiring
    // (mirrors LedgerDO.checkoutAvailable()).
    if (!checkoutConfigured(env)) return json({ error: 'Checkout is not available in this environment.' }, 503, cookie);
    let session: CheckoutSession;
    try { session = await deps.checkout({ env, deviceId, draft, amountUsdCents: SPONSORED_ANGEL_PRICE_USD_CENTS }); }
    catch { return json({ error: 'Could not start checkout. Please try again.' }, 502, cookie); }

    await insertPendingAngel(db, { id: newId(), sponsorDeviceId: deviceId, draft, checkoutId: session.id, now: now() });
    return json({ checkoutUrl: session.url }, 200, cookie);
  }

  if (request.method === 'POST' && url.pathname === '/api/angels/remove') {
    const { deviceId, cookie } = await identify(request);
    let body: unknown;
    try { body = await request.json(); } catch { return json({ error: 'Invalid request body.' }, 400, cookie); }
    const id = (body as { id?: unknown } | null)?.id;
    if (typeof id !== 'string') return json({ error: 'An angel id is required.' }, 400, cookie);
    const angel = await getAngel(db, id);
    if (!angel || angel.status === 'removed') return json({ error: 'That angel was not found.' }, 404, cookie);
    if (angel.sponsorDeviceId !== deviceId) return json({ error: 'You can only remove your own angel.' }, 403, cookie);
    // Data removal frees the spot (status→removed; live-spot index clears). A refund/void of the
    // Stripe charge for a live angel is pane 7's ledger concern (docs/engineering/become-an-angel.md §5).
    await removeAngel(db, id, now());
    const angels = (await listAngelsBySponsor(db, deviceId)).map(publicAngel);
    return json({ angels }, 200, cookie);
  }

  // Admin moderation (design §7/§9): list live angels and remove bad ones. Invisible (404) until an
  // ADMIN_TOKEN secret is configured, then Bearer-gated — mirrors feedback/events admin endpoints.
  if (url.pathname === '/api/angels/admin' || url.pathname === '/api/angels/admin/remove') {
    if (!env.ADMIN_TOKEN?.trim()) return json({ error: 'Not found' }, 404);
    if (!isAdmin(request, env)) return json({ error: 'Unauthorized' }, 401);
    if (request.method === 'GET' && url.pathname === '/api/angels/admin') {
      const angels = (await listLiveAngels(db)).map(a => ({ ...publicAngel(a), sponsorDeviceId: a.sponsorDeviceId }));
      return json({ angels });
    }
    if (request.method === 'POST' && url.pathname === '/api/angels/admin/remove') {
      let body: unknown;
      try { body = await request.json(); } catch { return json({ error: 'Invalid request body.' }, 400); }
      const id = (body as { id?: unknown } | null)?.id;
      if (typeof id !== 'string') return json({ error: 'An angel id is required.' }, 400);
      const angel = await getAngel(db, id);
      if (!angel || angel.status === 'removed') return json({ error: 'That angel was not found.' }, 404);
      await removeAngel(db, id, now());
      return json({ removed: id });
    }
  }

  return null;
}
