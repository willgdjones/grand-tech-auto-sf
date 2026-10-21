# Earned funding UI

`createFundingHud()` checks `flags.fundingLoop`. Pass the existing
`hud.element` as `statusParent` and forward `onDisplayChange` to
`hud.setFundingProfile(profile, displayedCents)`. This retains one funding counter,
the SF clock and radio, and projects five round stars plus the canonical rank.
Only the displayed amount animates, for at most 850 ms after a larger server total;
reduced-motion users see the final value immediately. No frame polling is added.

Animation progress is clamped to `[0, 1]`. A first animation-frame timestamp can
precede the `performance.now()` captured when the profile update starts the
count-up. Without the lower clamp, the first award could publish negative cents
and stop the counter at zero through the strict playable HUD validator.
`node tools/funding-animation-smoke.mjs` reproduced that exact error using the
actual funding/playable HUD modules before the fix, then passed with early-frame
hold, increasing count-up, same-total identity refresh, subsequent awards,
reduced motion, invalid total rejection and teardown. Web strict types passed.
The ignored `artifacts/funding-animation/before.json` and `report.json` preserve
the failing and passing runs. This DOM regression uses controlled frame callbacks;
the real two-player award/chat retry is tracked separately in `gtasf-8kbq.1`.

That native retry passed in `artifacts/chat/game-1128/report.json` on the 1125
client (37cb3e5) and Worker 1d0a63b. A real twenty-second room changed the profile
from zero to 50,000,000 cents and settled the visible counter at `$00500000`.
The composer stayed open with its draft and focus, and the event card stayed
closed. The reviewed `desktop-award-chat.png` shows the counter, promotion star
and focused draft together. Page and HTTP errors were empty.

Wire `onSaveIdentity(startupName, nickname)` to the funding client's save method,
and `onRefreshLeaderboard()` to its leaderboard method. Both return canonical
shared contracts. Forward profile updates with `setProfile`, new awards through
`showAward`, and an initial unnamed profile to `openIdentity`. The leaderboard
button is reachable in the existing HUD. Its Live now tab filters the server's
weekly leaderboard to currently live players.

Include `onModalChange` in the existing movement/cursor hold and close other game
dialogs when it opens. `hide()` handles Escape/game close; `isOpen` reports both
native dialogs. Call `destroy()` on teardown. Names, event titles and headlines
are rendered as text. A failed identity save stays open with its error; it never
updates the local identity optimistically.

The feature stays off until server identity, attendance and client integration
are ready. This module cannot award funding, derive paid totals, or finish a room
timer. The separate room client supplies server-confirmed awards.

With `loadingArt` enabled, a genuine round threshold also shows the reviewed
`/art/loading/round-closed.webp` illustration behind the toast. No artwork or
achievement is requested at boot. `node tools/funding-hud-smoke.mjs` checks the
canonical callbacks and records desktop/phone screenshots in the ignored
`artifacts/funding-hud/preview` folder; its profiles never reach the real API.

The board now presents weekly/today totals and ranks separately, plus progress
from the current round threshold to the next. `Online now` describes the live
player filter; `Top raisers today` uses the server's SF calendar-day standings.
A server-time anchor drives the countdown to SF midnight (including DST days).
Old daily rows are hidden at rollover until a fresh response arrives. The
ledger's weekly total and unlocked rounds are retained; no balance is reset.

Promotions lead with the actual `PRE-SEED CLOSED`, `SERIES A CLOSED`, etc. title
and that round's parody headline. Ordinary awards retain `TERM SHEET SIGNED`.
The bonus line uses the canonical award's timing, distinct-device crowd and
streak multipliers. `tools/funding-depth-smoke.mjs` runs two native player
identities through real 20-second rooms, then runs the isolated DOM fixture.

Identity saves keep updating the canonical profile, but their completion only
controls the identity view that submitted them. Closing or reopening the form,
or opening the funding board, prevents an old response from closing that newer
view or placing an old error in it. Editing either name while a save is pending
keeps the current draft and caret; the form explains that the earlier names were
saved and offers another save for the changes. An unchanged successful save
still closes normally, and current failures remain visible and retryable.

The 2026-10-03 `gtasf-0d2k` check froze real-module bundles before and after the
change with `GTASF_IDENTITY_STAGE=before|after node tools/identity-save-smoke.mjs
--build-only`, then ran each using `--run-only`. Desktop 1100×720 and phone
390×844 baselines reproduced all four stale-view/draft failures. Both corrected
views passed those cases plus normal save, retry and disposal, with no console
errors or API requests; focused-draft screenshots were reviewed. Receipts are
in ignored `artifacts/identity-save/{before,after}/report.json`. Web strict types
passed. This proves the isolated dialog behavior, not a native journey or
deployment gate.
