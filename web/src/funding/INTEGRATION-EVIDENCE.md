# Integrated funding, GPS and phone acceptance

## V2 native drive-through review — acceptance recorded

The five browser acceptance items in `gtasf-v2-funding-browser-accept-b4wh`
are covered by the reviewed receipts below. This is local mounted-game evidence
from actual keyboard/touch input and a disposable Worker, not a production,
real-device, floating-label or performance gate. Original failed harness reports
are retained; acceptance uses their recorded game state and reviewed screenshots
where the failure happened after the required player behavior.

| Acceptance | Native evidence |
| --- | --- |
| Event pass-through pays immediately; counter rises; no repeat payment | `11-35-55.451Z`: focused Shark Tank event pays $750k, desktop toast/table and reload/re-entry pass. |
| Shared venue produces one N-event cheque on phone | `11-47-15.335Z`: Built World Breakfast + Bio-Health Athletic Club Run pay on the same tick as **2 events / +$2.7M**; reviewed final toast and both table rows. |
| Grouped cap tables show earned sources; another player can open one | Event groups are reviewed in the two receipts above. `12-07-49.376Z`: self and phone peer tables show the earned $250k VC, $2M celebrity and $5M warm-intro groups, total 725,000,000 cents ($7.25M, compact header $7.2M). |
| Actual celebrity pitch shows ANGEL CHEQUE and its backer row | `12-07-49.376Z/angel-cheque.png` and `angel-desktop-captable.png`: native E pitch to Ron Conway, source heading preserved during Pre-seed promotion. |
| Real referral displays Warm intro: nickname | `12-07-49.376Z/warm-intro-desktop-captable.png` and `welcome-phone-captable.png`: **Warm intro: NativeFriend**, $5M; friend welcome, $1M; server-observed real play gate. |

All receipt paths are under `artifacts/funding-v2-native/2026-10-04T` with the
listed timestamp suffix. Every cited run recorded zero browser console and HTTP
errors. The 12 existing HUD checks passed at 12:07 UTC. That check's web strict
first encountered a concurrent avatar Object3D/Group mismatch. The avatar owner
corrected it without a cast and reported the shared workspace's final web strict
PASS at 12:13 UTC (`b6de779`, Agent Mail 6510), with this HUD change present.

### Receipt details and preserved harness limitations

The 2026-10-04 11:09 native run used a fresh app, disposable real Worker/SQLite
and the unchanged public event calendar. Named zero-balance identities were
seeded; funding, positions and clocks were not injected. Public `?at` links
loaded approaches, followed by normal keyboard input.

`artifacts/funding-v2-native/2026-10-04T11-09-21.246Z` records a genuine $300k
pass-through payment for “Launch & Scale Your Fractional Business,” with its
visible toast and animated counter. The reviewed `single-desktop-award.png`
and `single-desktop-paid.png` show this payment. Console/HTTP errors: zero.
The selected Wednesday event is outside the current focus window, so this
proves the payment path, not the visible-marker/floating-label requirement.

The run then failed the menu setup: its desktop canvas click entered pointer
lock, and the later coordinate click did not open Game options. The retry
uses the real Escape key before DOM controls, without changing game state.
The 11:24 retry passed desktop payout, the actual cap-table UI, and reload/re-entry with no duplicate. Phone input earned three real event cheques and displayed their $1.125M total and entries. Those nearby events paid on separate ticks, so this does not establish a combined N-event toast. Its repeat walk stopped 10.68 m from the selected anchor (inside the 12 m payment ring) and failed the harness’s unnecessarily narrow 3 m arrival check. Combined-toast, angel, referral and peer-table acceptance remain open. The receipt is `artifacts/funding-v2-native/2026-10-04T11-24-07.307Z`; zero console/HTTP errors.

The same receipt exposed incorrect single-event award metadata: the cheque
paid the upcoming preview rate ($300k), but status replaced its exact quote
with `follow-up`, ×0.5 and `preview: false`. The server now preserves the
actual quote for a single-event pass. Combined cheques keep their existing
summary metadata; this change does not alter payout amounts or once-ever
credits. The real SQLite/public-status regression, all five targeted funding checks and Worker strict passed on 2026-10-04 at 11:29 UTC. The retry’s live status also reports the correct upcoming preview quote.

The full-city receipt at
`artifacts/funding-v2-native/2026-10-04T11-35-55.451Z` uses the ordinary roadgraph
SHA `5763c53d` (full SHA is in its report), loaded into the disposable Worker's
immutable R2 binding. The browser's event-anchor API matched the selected graph.
The focused “Shark Tank: Most “Ethical” Hackathon & Pitch Competition” event paid
$750k with the correct upcoming ×1.5 bonus; its desktop cheque, animated counter,
cap-table entry and reload/re-entry check passed. Three desktop PNGs were reviewed.
No browser console/HTTP errors occurred.

The combined phone approach failed to reach its intended ring. Its trace records
actual touch movement veering away, and an unrelated $300k event payment; that
payment is not shared-venue acceptance. The harness had focused the touch page
with a mouse click that acquired pointer lock. The next phone-only attempt uses
real touch entry with a free pointer and records both normalized input axes and
camera yaw. This is an input-harness diagnosis pending confirmation, not a
claimed product fix. `floatingEventNames` is still OFF in this frozen app, so its
screenshots do not establish floating-label acceptance.

The touch-only follow-up
`artifacts/funding-v2-native/2026-10-04T11-47-15.335Z` confirms that diagnosis:
normal joystick input reached 9.82 m from the intended anchor with pointer lock
OFF. “Built World Breakfast” and “Bio-Health Athletic Club Run (w/ NFX)” paid
on the same server tick as one **2 events / +$2.7M** cheque. The final captured
state and personally reviewed `failure-events-combined-phone.png` show the
combined toast and $3.375M balance; the reviewed cap-table screenshot lists both
backers plus two separately earned nearby events. Console/HTTP errors: zero.

The original report keeps its failure: the assertion examined the earlier
`paid` snapshot before the polling client had received that final combined
award. Its failure snapshot contains the actual combined award, and both table
rows have the same `awardedAt`. The harness now waits for an intended event ID
before capturing/asserting the payment. This supplies native combined-payment
and phone-table evidence; it does not claim the skipped phone reload assertion
ran. The successful desktop reload already verifies once-ever persistence.

The first `cheques` run at
`artifacts/funding-v2-native/2026-10-04T11-53-38.344Z` earned Ron Conway's $2M
through a normal approach and E pitch. The reviewed desktop cap table lists him
under Celebrity angels. Its referral pair then earned the $5M **Warm intro:
NativeFriend** and the friend's $1M welcome cheque, both reviewed in the actual
desktop/phone cap-table UI. The server recorded exactly `played_ms: 120000`;
join `1791114918689` and credit `1791115043445` are 124,756 real milliseconds
apart. No clock, play time or reward was injected. Browser console/HTTP errors:
zero.

The same native walk claimed the scheduled $250k drop at Lombard (#1 to pitch),
and additional real event payments brought the founder to $8.75M. The run failed
because the prepared harness awaited that drop in `funding.status`, while drops
have their own `/api/drops/state` contract. It now checks the actual recent drop
claim and counter, then opens the grouped table and taps the founder's plate
from a second tab. Those later assertions did not run in the original receipt.

The angel screenshot also exposed a real presentation issue: closing Pre-seed
replaced the source heading with PRE-SEED CLOSED. The HUD change preserves
**ANGEL CHEQUE** (and the other special cheque headings) and moves the round-close
label into the existing detail line. Amounts and awards are unchanged. Targeted
HUD checks and the fresh native heading/cheque/peer-table review now passed as
described above; the first run remains an unchanged historical receipt.

The fresh `artifacts/funding-v2-native/2026-10-04T12-07-49.376Z` app includes the
HUD change and the cap-table nickname fallback from `a7bd22d`. It earned the
angel, warm intro and welcome cheques normally, then claimed Founder Mode
Capital at Ferry Building Plaza. `/api/drops/state` records the same drop moving
from 50 to 49 remaining, a first claim of 25,000,000 cents and a rendered
**CHEQUE SECURED** toast. `vc-drop-cheque.png`,
`all-backers-desktop-captable.png` and `failure-NativeFriend.png` were reviewed.

The last of those shows the phone player's open table for **Native
cheque-founder**, with all three earned special-source groups and the matching
total. It opened during the normal touch setup before the intended peer walk:
the preliminary canvas-focus tap could meet a moving nameplate between the
layout check and dispatch. The later touch sequence failed with CDP's
`Must send a TouchStart first` while that dialog was already open. The original
report remains FAIL and its planned peer-walk/assertions are not claimed as
executed. The final DOM and screenshot supply the actual peer-table evidence;
the only entry path is the nameplate's native click handler. Phone controls now
receive their first gesture directly, without that unnecessary focus tap.
This last harness-only adjustment is syntax-checked, not a new native receipt.

`tools/funding-v2-native.mjs` is the normal-input replacement for the older
harness. It uses direct CDP, public deep links, a disposable real Worker/SQLite,
and a common frozen build. It changes no gameplay position, clock, funding or
feature flag through the debug API. Run with Node from `.nvmrc` under
`tools/heavy.sh`; `GTASF_FUNDING_CITY_GRAPH` supplies the ordinary roadpack,
`GTASF_FUNDING_APP` reuses a frozen app, `GTASF_FUNDING_PHASE` chooses `events`,
`focused` or `cheques`, and `GTASF_FUNDING_ONLY` narrows event scenarios. Receipts
list their completed scenarios; a partial phase never closes the entire bead.
The `cheques` script has not completed its final assertion sequence cleanly;
the exact native behavior established despite that harness failure is recorded
above. Do not relabel its original report as a fully passing automated run.

The older v1 room-based acceptance below is historical and does not complete
`gtasf-v2-funding-browser-accept-b4wh`.

`gtasf-mj1.8` passed on 2026-10-03 at 06:51 UTC against the real local Worker and D1.
The single combined run used a frozen game build, desktop keyboard input and a
390 × 844 Chromium touch context. Server time, positions and earned balances were
not injected; the harness only sets camera/character heading before normal movement.

## Evidence

Ignored local artifact directory: `artifacts/funding-game/2026-10-03T0649/`.
`report.json` records `passed: true`, `errors: []`, and `httpErrors: []`.

| Check | Recorded result |
| --- | --- |
| Startup identity | Fresh desktop and phone profiles start at zero; the onboarding modal holds movement. |
| Source event | Selected Investor Happy Hour (`tech-week:f9c5d885-7f83-4a7d-b9cb-9df83f93e262`) through the upcoming-events UI. |
| Ground contact | 984 GPS ribbon vertices remain at least 0.18 m above authored Ferry paving; 91 funding-ring vertices remain at least 0.22 m above it. |
| Early departure | Actual keyboard and touch movement out of the marker cancels the room, with zero funding awarded. |
| Real award | Server interval is 20,000 ms; observed award wait is 21,259 ms. Working samples remain below complete progress and at zero funding. |
| Round feedback | Award `bcf08913-0867-46ea-9f0d-7f24ed8cf0fc` pays 50,000,000 cents ($500k), producing Pre-seed, one star, an animated counter and the round toast. |
| Earned perks | The real Pre-seed award enables the VC coupe; HQ and party controls remain locked. |
| Persistence | Leaderboard shows the startup; repeated start returns `already-awarded` without increasing funds; same-cookie navigation preserves the identity and total. |
| Phone HUD | Room panel and funding HUD remain inside the viewport; Funding board opens with an ordinary tap. |
| Robotaxi touch | Hail reaches server pickup with vehicle 1000 and ETA 13 s; a second tap cancels and restores Hail. |

Reviewed screenshots include `gps-ground-desktop.png`, `award-desktop.png`,
`room-phone.png`, `leaderboard-phone.png`, and `robotaxi-touch/touch-pickup.png`.
The nested `robotaxi-touch/report.json` independently records a passing touch check
with no console/page errors. Browser and preview were closed after the run.

## Corrected defects

The earlier `2026-10-03T0638` run failed and does not establish acceptance.
It exposed the phone Funding board being covered by the Ferry shortcut and three
HTTP 409 console errors during approach. Their response paths were not captured.
The clean run includes the phone layout correction `9de7b79`, touch action buffer
`7607b00`, and native Worker arrival correction `fb46ce3`. The latter keeps a
connected player's predicted arrival pending until the server pose reaches the
marker; attendance radius, height, on-foot requirement and 20-second clock remain
authoritative. Missing peers and malformed requests remain rejected.

## Reproduction

With the local Worker running and the GPU slot coordinated:

```sh
GTASF_FUNDING_TAXI=1 nice -n 10 node tools/funding-game-smoke.mjs
```

The default creates one frozen build. `GTASF_FUNDING_APP` reuses an existing build
(this run used `artifacts/funding-perks/app`, frozen at 06:46:27 UTC).
`GTASF_SMOKE_URL` instead uses an existing dev or deployed origin; an optional
`GTASF_INVITE_FILE` authenticates each fresh context without putting the code in a
URL or report. `GTASF_FUNDING_OUT` chooses the evidence directory and
`GTASF_FUNDING_MODE=phone` permits a focused phone follow-up. Harness source is
committed in `898f306`; `node --check` and scoped `git diff --check` passed.

This proves the local integrated gameplay flow. Deployment, real-device and G1
acceptance retain their separate evidence requirements. Phone emulation is not a
real-device performance measurement, and this run makes no performance claim.

## Legacy nickname recovery (`gtasf-zn7`)

On 2026-10-03 at 07:18 UTC, `tools/funding-identity-smoke.mjs` passed in the
mounted game at 390 × 844 with zero console, page or HTTP errors. Report and
reviewed screenshots are in `artifacts/funding-identity/`.

The check creates a real zero-funding device/profile, then changes only one GET
response's nickname to 24 Chinese characters (72 UTF-8 bytes), reproducing a
legacy name accepted by funding but rejected by the existing World protocol.
Cookies, startup name, balance, saves and World connections remain real.

The client reaches Connected, opens the editable identity dialog with a repair
message, and rejects an invalid resave inline without sending a POST. Saving
`雪 👩‍💻` through the real API persists the name. Reload connects without another
repair prompt and retains zero funding. The browser and preview were closed.

Main/HUD recovery is `214c7d4`; shared validation and the harness are `9d66750`.
New nicknames use the existing multiplayer canonicalization and byte limit;
startup Unicode length is unchanged. Seven targeted funding/protocol tests and
strict shared, web and Worker types passed. The default harness freezes one
client build; `GTASF_IDENTITY_APP` reuses it, while `GTASF_SMOKE_URL` uses an
existing origin. The exported `checkFundingIdentity(page, { url, out })` can share
an existing browser slot.

## V2 funding: drive-through, cap table, referrals, celebrity angels

The run above describes the **superseded v1 model** (a 20-second "work the room" dwell, Pre-seed at
$500k). PLAN-v2 replaces that loop; the v1 evidence should be read as historical. The v2 model:

- **Drive-through (decision 1):** passing through an event marker — on foot or driving — pays
  immediately, **once per event ever** (no daily reset, no dwell). Flag `driveThroughFunding`.
- **Stage ladder (decision 2):** Pre-seed → Seed → Series A–Z → Unicorn → Pre-IPO → Decacorn → Hectocorn.
- **Cap table (decision 5):** every backer (events, VC fund drops, celebrity angels, warm intros) via
  a unified `funding_credits` ledger; public `/api/funding/captable`. Flag `capTable`.
- **Referrals (founder decision 2026-10-03, in-game only):** a qualified friend earns the referrer a
  **$5M warm intro** ("Warm intro: <nick>"), the new player a **$1M welcome cheque**, with 5/10-friend
  milestones. All cash pay/cash-out dropped.
- **Celebrity angels:** `POST /api/funding/pitch` credits a tier cheque once-ever, on the cap table.

### V2 server-level evidence (verified 2026-10-03)

| Check | Evidence |
| --- | --- |
| Credits + cap table | `worker/src/funding/credits.test.ts`: once-ever per (device,source,source_ref), grouped cap table across all four ledgers, celebrity tier cheque + label, limits. |
| Drive-through detection | `worker/src/funding/world.test.ts`: `WorldFunding.tick` pays a peer inside an event marker once ever; no double-pay while parked; a peer outside is not paid. |
| Combined multi-event venue | `world.test.ts`: every event at a shared venue is paid once in one pass (one combined cheque/toast). |
| Shared payout API | `world.test.ts`: `WorldFunding.award()` credits once and is idempotent on repeat — the contract VC-drop/celebrity panes rely on. |
| Referral rewards | `worker/src/funding/bonus.test.ts`: $5M warm intro + $1M starter, 5-friend milestone, self-referral/under-played rejection. |
| VC-drop claims | `worker/src/funding/dropsStore.test.ts`: atomic first-N (once-ever), fed into `funding_earnings` + cap table. |
| Client surfacing | `web/src/funding/client.test.ts`: drive-through polls status for the pass-through award; room path preserved when the flag is off. |
| Build health | Full repo suite green (465 tests); `wrangler deploy --dry-run` bundles the Worker with the new `/api/funding/{captable,pitch}` routes; shared/worker/web typecheck clean. |
| Consumers | Cap-table UI (`web/src/hud/capTable.ts`), celebrity pitch wiring (`web/src/main.ts`) and the radar all consume the shared contracts correctly. |
| Event density | 396 events with coordinates sit in the Ferry→Lombard corridor bbox (1,181 in the wider playable area), so the drive-through loop is well-fed. |

### Pending

**V2 in-browser acceptance is not yet recorded.** The real drive-through loop (pass-through payout
toast, combined multi-event toast, cap-table open on a player, referral/celebrity cheques) needs a
pane-6 mounted-game run with reviewed desktop + phone screenshots, like the v1 run above. The
server/integration layer is verified; the visual/device gate remains outstanding.
