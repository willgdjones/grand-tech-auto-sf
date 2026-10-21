/**
 * Typed browser client for pane 13's friends API (gtasf-q4yo, PLAN-v2.1 decision 5).
 *
 * Thin same-origin fetch wrappers over `/api/friends/*` — the shared consumer for the chat
 * Friends/DM tab (gtasf-6ofg), the radar friends feed (gtasf-radar-friends-feed-d7br) and any HUD
 * friends panel, so those surfaces don't each re-implement the fetches + error handling.
 *
 * Every method FAILS SOFT: when the friends flag is off (the routes 404/503), the network is down,
 * or the body is malformed, reads return a safe empty shape and writes return a safe "nothing
 * happened" status — a caller never has to try/catch. Device identity rides the `gtasf_device`
 * cookie, so all calls are `credentials: 'same-origin'`; usernames are the only ids that cross the
 * wire (device ids never leave the server).
 */

/** `GET /api/friends/me` — your handle + request graph (all usernames). */
export interface FriendMe {
  readonly username: string | null;
  readonly friends: readonly string[];
  readonly incoming: readonly string[];
  readonly outgoing: readonly string[];
}
/** One row of `GET /api/friends/presence` — a friend's live state (position/stage only when online). */
export interface FriendPresence {
  readonly username: string;
  readonly online: boolean;
  readonly x?: number;
  readonly z?: number;
  readonly stage?: number;
}
/** `POST /api/friends/username` — claim outcome. */
export type ClaimResult =
  | { readonly ok: true; readonly username: string }
  | { readonly ok: false; readonly error: 'invalid' | 'rejected' | 'taken' | 'already-claimed' | 'unavailable'; readonly suggestions?: readonly string[]; readonly username?: string };
export type RequestStatus = 'requested' | 'friends' | 'exists' | 'already-friends' | 'self' | 'no-username' | 'unavailable';
export type RespondStatus = 'friends' | 'declined' | 'none';

/**
 * One direct message in a friend thread. PROPOSED friend-DM transport (gtasf-6ofg + founder v2.1:
 * "DMs between friends via pane 13's friends API, Jev-moderated"). Store-and-forward in D1 — the DM
 * tab polls `fetchDms` while open rather than needing a WorldDO socket — so it stays inside pane 13's
 * existing friends API + Jev moderation. Until that endpoint ships these methods fail soft (send →
 * not-sent, fetch → []), so the UI degrades to "no messages yet" and never throws.
 *   POST /api/friends/dm { to, text }           -> { ok } | { error: 'not-friends'|'rejected'|'rate'|'no-username' }
 *   GET  /api/friends/dm?with=<name>[&since=ts] -> { messages: DmMessage[] }  (ascending, Jev-filtered)
 */
export interface DmMessage {
  readonly from: string;
  readonly to: string;
  readonly text: string;
  readonly ts: number;
}
export type DmSendResult = { ok: true } | { ok: false; error: 'not-friends' | 'rejected' | 'rate' | 'no-username' | 'offline' };

export interface FriendsClient {
  me(signal?: AbortSignal): Promise<FriendMe>;
  presence(signal?: AbortSignal): Promise<readonly FriendPresence[]>;
  /** Username availability: `{ found }` — found === taken. Fails soft to `{ found: false }` (available). */
  search(name: string, signal?: AbortSignal): Promise<{ found: boolean; username?: string }>;
  claim(username: string): Promise<ClaimResult>;
  request(username: string, source?: 'referral'): Promise<RequestStatus>;
  respond(username: string, accept: boolean): Promise<RespondStatus>;
  remove(username: string): Promise<boolean>;
  /** Send a DM to a friend (PROPOSED transport — see DmMessage). Fails soft to `{ ok:false, error:'offline' }`. */
  sendDm(to: string, text: string): Promise<DmSendResult>;
  /** Poll a friend thread, optionally only messages after `since` (ms). Fails soft to `[]`. */
  fetchDms(withUser: string, since?: number, signal?: AbortSignal): Promise<readonly DmMessage[]>;
  /**
   * DM discovery: ALL my threads' messages after `since` in one poll (no `with`), so the roster can
   * badge which friends have unread DMs without polling every thread (friends doc S5). Needs the
   * no-`with` server mode (gtasf-q4yo, built on request); until then the current GET returns `[]`
   * for a missing `with`, so this just fails soft to `[]`. Group the result by the other party.
   */
  allDms(since?: number, signal?: AbortSignal): Promise<readonly DmMessage[]>;
}

const EMPTY_ME: FriendMe = { username: null, friends: [], incoming: [], outgoing: [] };

/** Keep hung reads from stopping polling and hung writes from locking the retained draft. */
function requestLifetime(signal?: AbortSignal) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timeout = setTimeout(abort, 15_000);
  return {
    signal: controller.signal,
    dispose() { clearTimeout(timeout); signal?.removeEventListener('abort', abort); },
  };
}

async function getJson<T>(url: string, fallback: T, signal?: AbortSignal): Promise<T> {
  const request = requestLifetime(signal);
  try {
    const res = await fetch(url, { credentials: 'same-origin', cache: 'no-store', signal: request.signal });
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  } finally {
    request.dispose();
  }
}

async function postJson<T>(url: string, body: unknown, fallback: T): Promise<T> {
  const request = requestLifetime();
  try {
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: request.signal,
    });
    // Friends-API errors still return a JSON body (e.g. { error: 'taken' }), so parse 4xx too — but
    // fall back on a hard failure (flag off / offline / non-JSON).
    if (res.status >= 500 || res.status === 404) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  } finally {
    request.dispose();
  }
}

export function createFriendsClient(base = '/api/friends'): FriendsClient {
  return {
    me(signal) {
      return getJson<FriendMe>(`${base}/me`, EMPTY_ME, signal);
    },
    async presence(signal) {
      const data = await getJson<{ friends?: readonly FriendPresence[] }>(`${base}/presence`, {}, signal);
      return data.friends ?? [];
    },
    search(name, signal) {
      return getJson<{ found: boolean; username?: string }>(`${base}/search?u=${encodeURIComponent(name)}`, { found: false }, signal);
    },
    claim(username) {
      return postJson<ClaimResult>(`${base}/username`, { username }, { ok: false, error: 'unavailable' });
    },
    async request(username, source) {
      const data = await postJson<{ status?: RequestStatus }>(`${base}/request`, source ? { username, source } : { username }, {});
      return data.status ?? 'unavailable';
    },
    async respond(username, accept) {
      const data = await postJson<{ status?: RespondStatus }>(`${base}/respond`, { username, accept }, {});
      return data.status ?? 'none';
    },
    async remove(username) {
      const data = await postJson<{ ok?: boolean }>(`${base}/remove`, { username }, {});
      return data.ok ?? false;
    },
    async sendDm(to, text) {
      return postJson<DmSendResult>(`${base}/dm`, { to, text }, { ok: false, error: 'offline' });
    },
    async fetchDms(withUser, since, signal) {
      const q = since != null ? `?with=${encodeURIComponent(withUser)}&since=${since}` : `?with=${encodeURIComponent(withUser)}`;
      const data = await getJson<{ messages?: readonly DmMessage[] }>(`${base}/dm${q}`, {}, signal);
      return data.messages ?? [];
    },
    async allDms(since, signal) {
      const data = await getJson<{ messages?: readonly DmMessage[] }>(`${base}/dm${since != null ? `?since=${since}` : ''}`, {}, signal);
      return data.messages ?? [];
    },
  };
}
