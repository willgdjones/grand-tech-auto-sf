# Friends system (gtasf-q4yo, PLAN-v2.1 decision 5)

Globally-unique usernames, mutual opt-in friend requests, a friends panel (online status, stage,
location), friends on the radar/map, "go to friend" (pane-5 robotaxi), and friend DMs (pane-3 UI). All
behind `flags.friends`. Keyed by the funding device id (`gtasf_device` cookie); device ids never leave
the server — every client-facing id is a username.

## Server backbone — shipped ✅

| Piece | What |
|---|---|
| `shared/friends/username.ts` | `normalizeUsername` (3–20 chars `[A-Za-z0-9_]`, casing preserved, casefolded `key` for uniqueness, reserved-handle block), `isValidUsername`, `deriveUsernameBase`, `usernameSuggestions`. 8 tests. |
| `worker/migrations/0025_friends.sql` | `friend_usernames` (device_id PK, `username_key` UNIQUE), `friend_requests` (requester,target PK), `friendships` (ordered pair a<b), `friend_limits`. |
| `worker/src/friends/store.ts` | `claimUsername`/`suggestUsernames`/`usernameForDevice`/`deviceForUsernameKey`, `sendRequest`/`respondRequest`/`removeFriend`/`listFriends`/`areFriends`, `friendsRateLimit`. 6 tests. |
| `worker/src/friends/moderation.ts` | `createUsernameReviewer` (Jev/TypeSafe, fail-closed). |
| `worker/src/friends/routes.ts` | `handleFriendsRequest` (wired in index.ts). 6 tests. |

### API (`/api/friends/*`, same-origin, `flags.friends`, device via `gtasf_device`)
- `GET /me` → `{ username|null, friends[], incoming[], outgoing[] }` (all usernames).
- `POST /username { username }` → `{ ok, username }` or `{ error: 'invalid'|'rejected'|'taken'(+suggestions)|'already-claimed'(+username) }`. Jev-moderated when `TYPESAFE_API_KEY` is set; local rules always. Claimed once per device.
- `GET /search?u=<name>` → `{ found, username? }`.
- `POST /request { username, source? }` → `{ status: 'requested'|'friends'|'exists'|'already-friends'|'self' }`. Mutual opt-in: a pending reverse request becomes a friendship. Caller must have claimed a username (409 `no-username`). `source` `'referral'` is how a referral-link join pre-fills a request (pane calls this with the referrer's username).
- `POST /respond { username, accept }` → `{ status: 'friends'|'declined'|'none' }`.
- `POST /remove { username }` → `{ ok }`.
- `POST /dm { to, text }` → `{ ok } | { error: 'not-friends'|'rejected'|'rate'|'no-username' }` ✅ — store-and-forward friend DM, Jev-moderated, mutual-friends only, rate-limited. `GET /dm?with=<name>[&since=ts]` → `{ messages: [{from,to,text,ts}] }` (usernames, ascending). The chat DM tab (pane 2/3) polls it; no WorldDO socket.
- `GET /referrer` → `{ referrer: username | null }` ✅ — if this device joined via a referral link and that referrer has a username, returns it so the client **pre-fills** a friend request (`POST /request { username, source:'referral' }`); never an automatic friendship. Resolver is injectable (defaults to the referrals attribution `activeReferral`).
- `GET /presence` → `{ friends: [{ username, online, x?, z?, stage? }] }` ✅ — joins the D1 friends list with live WorldDO presence (`/internal/friends/presence`, fanned across the single world or every zone cell). `x,z` are world cm; `stage` is the funding round (from the cosmetic appearance, no funding query). Offline friends report `online:false`. Poll from the panel (a few seconds).

## Remaining slices (client + cross-pane)

- **S3 friends panel + radar (pane 4 / HUD):** panel showing status/stage/location; feed friend positions to `web/src/radar` with name tags + off-screen edge pins (bead `gtasf-radar-friends-feed-d7br`). **Decision (d7br):** radar/map friends come from `GET /api/friends/presence` via `createFriendsClient().presence()` — the same poll the panel runs, so one fetch feeds both — **not** from the WS peer list / a `PLAYER_JOIN` username field. Reasons: works cross-zone (WS peers are per-zone; `/presence` fans across every cell), no protocol change, and no broadcasting every player's username (privacy). WS peers stay the local-crowd layer; the presence `FriendPresence[]` is the friends layer. In-zone WS username sync stays a later option only if sub-second friend tracking is needed.
- **S4 "go to friend" (pane 5):** call the instant robotaxi with the friend's location as destination.
- **S5 friend DMs (pane 3 UI):** DM transport + the chat-tab UI (Nearby/Friends/DM). The transport is shipped (`POST`/`GET /api/friends/dm`), but it's per-thread (`?with=<name>`). **When you build S5, the UI will need DM discovery** — which friends have unread messages without polling every thread. Ping me and I'll add a no-`with` mode to `GET /api/friends/dm` (`?since=ts` → all my threads' messages after `ts`, so one poll badges + populates every thread); it's a non-breaking, ~20-line server add I've deliberately left unbuilt until there's a consumer. Until then, track last-seen per thread client-side and poll `?with=&since=` per open thread.

Client calls `GET /api/friends/me` on load (when `flags.friends`) to populate the panel; `POST /request`
with `source:'referral'` when arriving via a referral link (referrer from the referrals attribution).
