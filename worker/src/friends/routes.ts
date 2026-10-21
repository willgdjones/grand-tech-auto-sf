import { flags } from '@gtasf/shared/flags';
import { normalizeUsername } from '@gtasf/shared/friends/username';
import type { Env } from '../env';
import { ensureFundingDevice, fundingSameOrigin } from '../funding/identity';
import { smallJson } from '../world/admission/http';
import { worldBroadcastTargets } from '../world/zoneRouting';
import { activeReferral } from '../referrals/store';
import { createUsernameReviewer, type UsernameReviewer } from './moderation';
import {
  claimUsername, suggestUsernames, usernameForDevice, deviceForUsernameKey,
  sendRequest, respondRequest, removeFriend, listFriends, friendsRateLimit, areFriends,
} from './store';
import { insertDm, dmThread } from './dm';
import { moderateChat } from '../world/chat/moderation';

function json(value: unknown, status = 200, cookie?: string): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', ...(cookie ? { 'Set-Cookie': cookie } : {}) } });
}

export interface FriendsDeps {
  reviewer?: UsernameReviewer;
  /** Resolve this device's referral-link referrer device id (or null). Defaults to the referrals
   *  attribution (`activeReferral`); injectable so the route is testable without that store's SQL. */
  resolveReferrer?: (db: D1Database, deviceId: string, now: number) => Promise<string | null>;
}

/** Map device ids to display usernames, dropping any without one (never leak device ids to clients). */
async function usernamesFor(db: D1Database, devices: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const device of devices) { const u = await usernameForDevice(db, device); if (u) out.push(u.display); }
  return out;
}

/**
 * Friends endpoints (PLAN-v2.1 decision 5, gtasf-q4yo), behind `flags.friends`. All client-facing ids
 * are usernames — device ids never leave the server. Device identity via the gtasf_device cookie
 * (ensureFundingDevice), same-origin only, rate-limited. Username claims are Jev-moderated when a key
 * is configured; the local rules (shared/friends/username.ts) always run first.
 *   GET  /api/friends/me                         -> { username, friends[], incoming[], outgoing[] }
 *   POST /api/friends/username { username }       -> { ok, username } | { error: 'invalid'|'rejected'|'taken'|'already-claimed', ... }
 *   GET  /api/friends/search?u=<name>             -> { found, username? }
 *   POST /api/friends/request { username, source? }-> { status }   (mutual opt-in; reverse request => friends)
 *   POST /api/friends/respond { username, accept } -> { status }
 *   POST /api/friends/remove  { username }         -> { ok }
 */
export async function handleFriendsRequest(request: Request, env: Env, deps: FriendsDeps = {}): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith('/api/friends/')) return null;
  if (!flags.friends) return json({ error: 'Friends are disabled' }, 503);
  if (!fundingSameOrigin(request)) return json({ error: 'Same-origin request required' }, 403);
  const now = Date.now();
  const reviewer = deps.reviewer ?? (env.TYPESAFE_API_KEY ? createUsernameReviewer(env.TYPESAFE_API_KEY) : undefined);
  const resolveReferrer = deps.resolveReferrer ?? (async (d, id, when) => { const a = await activeReferral(d, id, when); return a && a.referrerId !== id ? a.referrerId : null; });
  try {
    const identity = await ensureFundingDevice(request, env.DB, now);
    const me = identity.deviceId, cookie = identity.cookie;

    if (path === '/api/friends/me' && request.method === 'GET') {
      const mine = await usernameForDevice(env.DB, me);
      const list = await listFriends(env.DB, me);
      return json({
        username: mine?.display ?? null,
        friends: await usernamesFor(env.DB, list.friends),
        incoming: await usernamesFor(env.DB, list.incoming),
        outgoing: await usernamesFor(env.DB, list.outgoing),
      }, 200, cookie);
    }

    if (path === '/api/friends/username' && request.method === 'POST') {
      if (!(await friendsRateLimit(env.DB, `friend-claim:${me}`, 8, 60_000, now))) return json({ error: 'Too many attempts' }, 429);
      const norm = normalizeUsername((await smallJson(request))?.username);
      if (!norm) return json({ error: 'invalid' }, 400);
      if (reviewer && !(await reviewer(norm.display))) return json({ error: 'rejected' }, 200, cookie);
      const result = await claimUsername(env.DB, me, norm.display, norm.key, now);
      if (result.ok) return json({ ok: true, username: result.username }, 200, cookie);
      if (result.reason === 'already-claimed') return json({ error: 'already-claimed', username: result.current }, 200, cookie);
      return json({ error: 'taken', suggestions: await suggestUsernames(env.DB, norm.display, 3) }, 200, cookie);
    }

    if (path === '/api/friends/presence' && request.method === 'GET') {
      const devices = (await listFriends(env.DB, me)).friends;
      const presence: Record<string, { x: number; z: number; stage: number }> = {};
      if (devices.length) {
        for (const name of worldBroadcastTargets(flags.zonedWorld)) {
          try {
            const res = await env.WORLD.get(env.WORLD.idFromName(name)).fetch('https://world.internal/internal/friends/presence', {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceIds: devices }),
            });
            if (res.ok) Object.assign(presence, (await res.json() as { presence?: Record<string, { x: number; z: number; stage: number }> }).presence ?? {});
          } catch { /* a world instance being unavailable just reads those friends as offline */ }
        }
      }
      const friends: { username: string; online: boolean; x?: number; z?: number; stage?: number }[] = [];
      for (const device of devices) {
        const u = await usernameForDevice(env.DB, device);
        if (!u) continue;
        const p = presence[device];
        friends.push(p ? { username: u.display, online: true, x: p.x, z: p.z, stage: p.stage } : { username: u.display, online: false });
      }
      return json({ friends }, 200, cookie);
    }

    if (path === '/api/friends/dm' && request.method === 'POST') {
      // Send a DM to a friend (store-and-forward; the DM tab polls the GET). Jev-moderated; only between
      // mutual friends; the sender must have a username so the thread maps to a handle.
      if (!(await usernameForDevice(env.DB, me))) return json({ error: 'no-username' }, 200, cookie);
      const body = await smallJson(request);
      const norm = normalizeUsername(body?.to);
      const other = norm ? await deviceForUsernameKey(env.DB, norm.key) : null;
      if (!other || other === me || !(await areFriends(env.DB, me, other))) return json({ error: 'not-friends' }, 200, cookie);
      if (!(await friendsRateLimit(env.DB, `friend-dm:${me}`, 30, 60_000, now))) return json({ error: 'rate' }, 429);
      const moderated = await moderateChat(typeof body?.text === 'string' ? body.text : '', env.TYPESAFE_API_KEY);
      if (!moderated) return json({ error: 'rejected' }, 200, cookie);
      if (!await insertDm(env.DB, me, other, moderated, now)) return json({ error: 'not-friends' }, 200, cookie);
      return json({ ok: true }, 200, cookie);
    }

    if (path === '/api/friends/dm' && request.method === 'GET') {
      const url = new URL(request.url);
      const norm = normalizeUsername(url.searchParams.get('with'));
      const other = norm ? await deviceForUsernameKey(env.DB, norm.key) : null;
      if (!other || other === me || !(await areFriends(env.DB, me, other))) return json({ messages: [] }, 200, cookie);
      const since = Number(url.searchParams.get('since')) || 0;
      const mineU = (await usernameForDevice(env.DB, me))?.display ?? '';
      const otherU = (await usernameForDevice(env.DB, other))?.display ?? norm!.display;
      const messages = (await dmThread(env.DB, me, other, since)).map(r => ({
        from: r.sender === me ? mineU : otherU, to: r.recipient === me ? mineU : otherU, text: r.text, ts: r.created_at,
      }));
      return json({ messages }, 200, cookie);
    }

    if (path === '/api/friends/referrer' && request.method === 'GET') {
      // Referral-link prefill (PLAN-v2.1 d5): if this device joined via someone's referral link and that
      // referrer has a username, surface it so the client pre-fills a friend request (source:'referral').
      // Never an automatic friendship — just the suggested handle. null if no attribution / no username.
      const referrerDevice = await resolveReferrer(env.DB, me, now);
      const referrer = referrerDevice && referrerDevice !== me ? await usernameForDevice(env.DB, referrerDevice) : null;
      return json({ referrer: referrer?.display ?? null }, 200, cookie);
    }

    if (path === '/api/friends/search' && request.method === 'GET') {
      const norm = normalizeUsername(new URL(request.url).searchParams.get('u'));
      const device = norm ? await deviceForUsernameKey(env.DB, norm.key) : null;
      if (!norm || !device || device === me) return json({ found: false }, 200, cookie);
      const u = await usernameForDevice(env.DB, device);
      return json({ found: true, username: u?.display ?? norm.display }, 200, cookie);
    }

    if ((path === '/api/friends/request' || path === '/api/friends/respond' || path === '/api/friends/remove') && request.method === 'POST') {
      const body = await smallJson(request);
      const norm = normalizeUsername(body?.username);
      if (!norm) return json({ error: 'invalid' }, 400);
      const other = await deviceForUsernameKey(env.DB, norm.key);
      if (!other) return json({ error: 'not-found' }, 404);

      if (path === '/api/friends/request') {
        if (!(await usernameForDevice(env.DB, me))) return json({ error: 'no-username' }, 409); // claim one first so requests are visible
        if (!(await friendsRateLimit(env.DB, `friend-req:${me}`, 20, 60_000, now))) return json({ error: 'Too many requests' }, 429);
        const sources = ['search', 'click', 'referral'];
        const source = typeof body?.source === 'string' && sources.includes(body.source) ? body.source : 'search';
        return json({ status: await sendRequest(env.DB, me, other, source, now) }, 200, cookie);
      }
      if (path === '/api/friends/respond') {
        return json({ status: await respondRequest(env.DB, me, other, body?.accept === true, now) }, 200, cookie);
      }
      await removeFriend(env.DB, me, other, now);
      return json({ ok: true }, 200, cookie);
    }
    return json({ error: 'Not found' }, 404);
  } catch {
    return json({ error: 'Friends are temporarily unavailable' }, 503);
  }
}
