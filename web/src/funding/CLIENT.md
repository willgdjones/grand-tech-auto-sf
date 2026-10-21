# Funding integration

Both factories are gated by `flags.fundingLoop` and return null while it is off.

In the current drive-through mode, background status and leaderboard polling
respect the same three-second error backoff as marker recovery. A transport
timeout or network failure keeps the last valid profile visible and shows
“Funding updates are delayed. Retrying…” instead of browser exception text.
Recovery resumes server status processing and clears the error; repeated award
responses still produce only one cheque toast. Server-provided action errors
remain visible. This fixes the raw abort notice observed in the native ride
captures at `artifacts/personal-rides-look/2026-10-04T10-23-29.204Z`.
The 38 client checks and strict web TypeScript pass at 10:47 UTC, including a
timed-out drive-through poll, retained profile, no requests during backoff,
successful recovery and a single award notification across repeated responses.
This controlled-transport check does not complete the native payout acceptance.

`createFundingClient({onProfile,onAward,onStatus,onLeaderboard,onError})` provides:

- `init(): Promise<FundingProfile>`: await after referral bootstrap and before opening the World socket, so both use the same persistent device cookie.
- `saveIdentity(startupName,nickname)` and `leaderboard()`: canonical callbacks for `createFundingHud`.
- `selectEvent(eventId|null)`: call for upcoming rows, radar/map event selection, direct event links, and ambient event entry. Null clears selection for a landmark. This fetches the authoritative road marker; it does not start a timer from afar.
- `update(foot,mode,net.connected)`: call from the game loop. Entering the server marker on foot starts the room; departure cancels; status polls once a second. Rank/leaderboard refreshes every ten seconds. Polls back off after errors.
- Read-only `profile`, `target`, `status`, `inside`, `progress`, `error`, `busy`; `destroy()` aborts requests and requests cancellation. World socket closure also independently cancels on the server.

The initial profile read may retry once after 750 ms for a temporary HTTP,
network or timeout failure. Concurrent `init()` callers share both attempts,
and disposal cancels the retry delay. Permanent failures and invalid profiles
still reject. The game continues to wait for the fully received, canonical
profile before opening its World connection; no fallback identity or balance
is created by the client. Profile saves and funding actions are never retried
by this path. Each read captures its own identity revision, preserving names
saved while that read was pending without overriding newer canonical reads.

The browser sends its device cookie again on retry. A lost body after response
headers retains that cookie and reads the same profile. If the entire response
is lost before cookie delivery, the server may retain an inaccessible empty
profile, just as with a manual reload; only the final cookie-authenticated
profile is installed in the client. This is not exactly-once profile creation.

For `gtasf-ccac`, `node tools/funding-profile-recovery-smoke.mjs` exercises
this client against the actual Worker profile route and identity/store code,
using the real migrations with isolated SQLite and controlled cookie delivery.
The baseline fails all four temporary-failure scenarios; the corrected source
passes all five checks, including ordinary creation, HTTP 503, lost response
body, lost entire response and an existing device cookie. Each recovery accepts
one canonical profile for both callers and creates no funding awards. Reports
are in `artifacts/funding-profile-retry/{baseline,after}/report.json`.
All 34 client regressions pass, including bounded retries, permanent errors,
coalescing, cancellation and identity saves between reads. The applied source
and tests match that tested candidate, and strict web TypeScript passes. Cookie
delivery is modeled in the probe; this does not claim a native browser outage test.

An initial marker read that fails temporarily retries after three seconds while
connected, without requiring the player to select the event again. Network
failures, timeouts, HTTP 408/429 and server failures are retryable; permanent
client errors and invalid successful responses remain visible without polling.
Only one initial marker request runs at a time. Changing or clearing the
selection, or disposing the client, invalidates pending responses. Recovery
only restores the server marker; the normal on-foot, distance and connection
checks still control whether working the room starts. Repeated identical
failures do not repeat the error toast.

For `gtasf-lr83`, `artifacts/initial-marker-retry/baseline/report.json` records
the actual client remaining at one failed request and a null marker after the
server recovers. The same controlled-transport probe in `after/report.json`
restores the marker on request two, clears the error and sends no room-start
request from afar. All 21 client regressions and strict web TypeScript pass.
The checks cover transient HTTP/network/timeout failures, permanent errors,
disconnects, single-request backoff, duplicate notices and stale responses
after changing/clearing a destination or disposal. This verifies client recovery
with controlled responses; it does not claim a native server-failure test.

After an award, the selected event refreshes in the background every sixty
seconds. Pending or failed reads retain the last valid marker and room status;
they do not clear `inside` or the event chat channel. A failure retries after
ten seconds, with at most one background marker request in flight. Position,
connection and movement mode still determine actual departure every frame.
Explicit destination changes continue to clear immediately. Responses for an
older destination or a disposed client are ignored, and a fresh server response
can reopen the event's daily eligibility without carrying yesterday's attempt.

The `gtasf-3bm5` controlled-transport probe reproduced the old same-event
refresh changing a valid marker/`inside: true` into `null`/`false`, permanently
after HTTP 503. The corrected probe retains the same marker and `inside: true`
through both phases. Three targeted regressions cover failure/retry and daily
eligibility, actual departure, changed/cleared destinations, and disposal;
the four existing identity checks also pass. Initial strict checking caught a
missing event ID in the new fixture; the corrected fixture passes web strict
types. These checks exercise the actual client with controlled responses, not
server award acceptance. The observed native chat1100 leave/rejoin and channel
reset are tracked for the queued full-game repeat in `gtasf-8kbq.1`.

The full-game repeat `artifacts/chat/game-1128/report.json` then passed on the
1125 client (37cb3e5, verified to include this refresh change) and Worker 1d0a63b.
The desktop remained inside with no EVENT_LEAVE command; the phone left only
after its physical departure. Both saved names and real award/chat controls
passed with no page or HTTP errors. This ordinary playthrough complements the
controlled transport checks above; it does not inject or prove a live HTTP 503.

Confirmed identity saves supersede the name fields in profile, leaderboard and
status/award reads that were already in flight. Their earned money and other
fields still arrive; another player's leaderboard row is untouched. Reads begun
after the save remain authoritative, including edits from another browser tab.
A delayed save response likewise preserves a larger funding total received while
the request was pending. Failed saves never install the attempted name.

The `gtasf-95w6` baseline at `artifacts/funding-identity/baseline.json` reproduces
the old bug against the actual client: a successful name save reverted when an
older leaderboard response arrived. `after.json` records the same delayed
response preserving the saved name. Four focused regressions in
`client.test.ts` pass for leaderboard results/callbacks/self rows, status and
award callbacks, intervening earned money, failed saves, fresh server reads and
disposal. These use controlled transport responses, not native Worker or earned
ledger acceptance. The final strict web TypeScript check also passes.

`createFundingRoom({scene,surfaceHeightAt,parent?})` provides `update(client)` and `destroy()`. The 8 m ring is draped over loaded terrain on each new server marker response; only draw range and DOM text change between those responses. Interpolation stops below a full ring until the authoritative award arrives.

Both ring buffers are reused while the radius stays the same. Their original
flat coordinates are retained so each refreshed marker still resamples current
terrain, including newly loaded hills and relocated anchors. Base and progress
rings share each terrain query and keep their separate vertical offsets.
Changing the radius replaces and disposes the old buffers. An unloaded center
continues to hide the ring and retry at the existing bounded rate.

For `gtasf-q1kn`, `node tools/funding-room-geometry-smoke.mjs` exercises the actual
Three.js room with a minimal DOM shell. The original source fails two buffer
reuse checks and uses 261 height queries at initial grounding and refresh. The
corrected source passes all eleven checks with 131 queries, preserving exact
sloped vertex/index geometry, updated bounds, progress, eligibility, relocated
markers, unloaded terrain, clearing and disposal. Before/after reports are in
`artifacts/funding-room-reuse/{baseline,after}/report.json`. This is geometry and
operation-count evidence; strict web TypeScript also passes. These checks do not establish native visuals or frame timing.

Forward `onProfile` to funding HUD `setProfile`, `onAward` to `showAward`, and `onLeaderboard` to `setLeaderboard`. In the award callback, show `TERM SHEET SIGNED +${formatFunding(award.amountCents)}` and optionally open that event's card. Under this flag, GPS arrival only prompts `WORK THE ROOM`; opening the card after completion keeps the twenty-second ring visible on phones. Legacy navigation remains unchanged while funding is off.

The room status uses the GPS status position on phones. Hide `guidance.element` while `client.inside`; the guidance update can restore it after departure. Close the funding identity/leaderboard dialog when another modal opens and include `fundingHud.isOpen` in the input hold. Forward `onModalChange` to the same release/mutual-exclusion handling. Initial unnamed profiles call `openIdentity`.

The server resolves markers on its active road map: the configured whole-city graph when available, otherwise the local corridor. Render the returned anchor, never the private venue or a client-invented arrival position. Events without a nearby playable road report unavailable rather than awarding at a fabricated location.

Before activation, apply migrations `0010_funding.sql` and `0014_funding_bonus.sql`, install `handleFundingRequest` in the Worker entry, and integrate the existing WorldDO hooks. Enable the shared flag for the integrated browser/authority smoke before accepting the feature. The native twenty-second WorldDO smoke uses real time and real D1, but does not replace the integrated desktop/phone check.

`createFundingPerks({scene,fleet,surfaceHeightAt,parent?,onModalChange?,notify?})` adds the earned round controls. Forward canonical profiles to `setProfile`, call `update(foot,mode,vehicleId,dt,connected)` each frame, include `isOpen` in modal input/cursor handling, call `hide()` when another modal opens, and `destroy()` on teardown. Its car appearance preserves existing handling and collision; startup signs raycast actual loaded building faces. Party markers come from authenticated `/api/funding/parties` state and cannot award funding or change paid placements.

Round perks now publishes `onModalChange(false)` synchronously from `hide()` and
teardown. Native close events still work, but publish only a real transition
and restore focus once. A queued close cannot release a reopened panel's hold
or take focus back from the next control. Detached launchers ignore activation
after disposal. This follows the same modal contract as the funding board.

For `gtasf-njb9`, `node tools/funding-perks-modal-smoke.mjs` exercises the actual
perks DOM at desktop 1100px and phone 390px widths without a renderer, API or
earned profile. The baseline failed four cases per viewport and logged stale
launcher errors. The fixed source passed all fourteen cases, including physical
Close/Escape, native close, immediate close/reopen, focus handoff and disposal.
The first shared web strict check was blocked by nullable Ferry references in
another pane's unfinished `ferryPedestrians.ts`. The web sources and configs
from committed `d9746e3` then passed isolated strict checking. The Ferry owner
subsequently fixed that work and reported a fresh shared strict pass.
`artifacts/perks-modal/baseline/report.json` and
`after/report.json` retain the before/after evidence. The applied module matches
the tested isolated source exactly. This repair follows the immutable d780be9
release pin and does not change that release candidate.
