# Walk-up event entry

`createEventMarkers` renders nearby public event rings and emits `onEnter` once
per physical visit. The game passes `canEnter=false` while the player is in a
vehicle or a modal owns the controls.

## Venue grouping + floating labels (PLAN-v2 decisions 1 + 8)

When `flags.venueGrouping` is on (default), `setEvents` folds the feed into one
marker **per venue** instead of one per geocoded point, via `focusVenues` /
`groupVenues` from `./venues` — so events sharing a venue are never hidden by the
5 m dedupe (which is now skipped for grouped venues, since each venue is already
unique by key; `gtasf-v2-venue-marker-dedupe-1b18`). `flags.eventFocus24h` limits
the set to the next 24 h (with the weekend slide to the soonest events so the
pre-Tech-Week map is never blank), else the whole week. A marker's `onEnter`
fires the venue's **representative** live-or-soonest event (`representativeEvent`),
so drive-through funding targets a real event. With grouping off, the v1
per-event path (and its 5 m dedupe) is preserved. Options `now`, `groupByVenue`,
`focusNext24h`, `showLabels` override the flags/clock for tests.

`flags.floatingEventNames` (local playtest **on**) floats a
pooled billboarded SA-style label above each marker: the lone event's name for a
single-event venue (decision 1), else the venue name with a `+N this week` badge
(decision 8). The canvas render is headless-safe (a no-op without a `document`).

Labels reuse a 448 × 144 canvas (64,512 decoded pixels) and texture for each of
at most 12 nearby markers. Titles fit the actual font width with an ellipsis;
day, Preview, Collected and `+N this week` badges wrap at badge boundaries.
Textures redraw only when their text changes. Passing the current chase
`camera` to `createEventMarkers` also hides a farther label when its projected
panel overlaps a nearer label. The rings and venue entries remain present.

`flags.dimCollectedMarkers` uses the server's once-ever collected ledger. A
fully paid venue has grey rings and a Collected badge; a venue with an unpaid
focus event stays bright. `flags.checkpointPillars` adds a translucent column
to unpaid rings and hides the column once that venue is fully collected.

The read-only `venues` getter returns the `VenueGroup[]` the markers currently
represent (one per venue), or `null` when grouping is off — the hook the
founder-path `event-focus-24h` probe reads to verify one-marker-per-venue
(`gtasf-v2-markers-venues-accessor-nd29`).

For `gtasf-qiyk`, a blocked arrival remains eligible: exiting the car or closing
the panel inside the ring activates the event on the next eligible update.
An event that already activated stays consumed while the player remains inside,
including across another modal or vehicle hold. Physical departure always clears
that visit, even when interaction is blocked. Marker positions, height limits,
event data and existing HUD/events switches are unchanged.

## Recorded module check

On 2026-10-03, the actual Three scene-graph module reproduced two failures in
`artifacts/marker-entry/baseline/report.json`: initial blocked arrival and leaving
then reentering while blocked. The other six cases passed. The corrected source
passed all eight cases in `artifacts/marker-entry/after/report.json`, including
ordinary reentry, no repeated activation after a hold, cancellation of a deferred
entry on departure, vertical exclusion, unloaded ground, removal and disposal.
The applied source matches the tested copy exactly.

The coordinated web strict check passed at 12:13 UTC with exit code zero:
`nice -n 10 node node_modules/typescript/bin/tsc --noEmit -p web/tsconfig.json`.
`tools/map/out/o0cb-memory/strict.json` records the same marker SHA-256 before and
after that check: `09e096c530fe7752e27b5bbe228389027e0a1d3130ec19f536c3710d0cb16448`.

```sh
nice -n 10 node tools/events-marker-entry-smoke.mjs
```

`GTASF_MARKER_ENTRY_OUT` selects the report directory; `GTASF_MARKER_SOURCE`
optionally loads a preserved source snapshot for before/after reproduction.
The smoke uses current flags and the actual marker module without a renderer,
browser, API request or simulated funding award. It establishes entry behavior;
native visuals, performance, deployment and real-device checks remain separate.

## Dense marker review (2026-10-04)

The ten existing marker cases and web strict check passed at 13:23 UTC after
the text fitting and camera overlap changes. The fresh native build in
`artifacts/funding-v2-native/2026-10-04T13-26-12.281Z/` shows a readable single
panel on Powell Street without the farther panels bleeding through it. Its
original report remains failed: the check expected a specific label to remain
visible; the follow-up below established the actual ordering defect. Desktop/phone collected-state
acceptance is still pending the corrected native check. These checks do not
establish the phone frame-rate, real-device or production gates.

The 13:41 follow-up caught an actual ordering defect: the visible USER EXPERIENCE
marker was about 49 m away, while The Future of Video Intelligence at 33 m was
culled. The candidate list was sorted before road snapping. Label priority now
uses the rendered label's squared distance to the camera, with a reused bounded
array; arrival order and venue data are unchanged. The real target payout and
cap-table receipt passed in that run, but its collected-label look failed and
is retained as such. The corrected rendered-position order needs a fresh build
and native look check.

The ten marker cases passed again at 13:51 UTC with the rendered-position
correction. The combined web strict/native command stopped on the concurrently
added required `OnboardingState.emailPrompts` field, whose constructors and test
fixture were incomplete outside this change. The onboarding owner is repairing
that contract; native marker verification is queued independently. No global
strict or visual pass is claimed from this interrupted command.

## Local enable receipt — October 4, 13:53 UTC

`artifacts/funding-v2-native/2026-10-04T13-53-47.732Z/report.json` passes both
focused scenarios using a fresh current build, real full-city road graph,
isolated Worker and ordinary keyboard/touch controls. No pose, clock, award or
feature state is injected. Browser console and HTTP error arrays are empty.

Desktop 1440 × 900 and phone 390 × 844 screenshots show the nearer Future of
Video Intelligence panel retained in the dense Powell Street cluster, with
no farther label bleeding through it. Its complete `+5 this week` badge fits
the pooled canvas. Real attendance pays and appears on the cap table. After
public-link reload, the server's ledger prevents a second payment; the target
ring is grey (`8c8c86`), its pillar is hidden, and its label says Collected.
The desktop collected panel is clear. The phone paid view and exported actual
label canvas show the Collected badge; foreground world geometry partly
obscures the phone reload screenshot. That frame is retained, not described
as an unobscured view.

Floating names, collected dimming and checkpoint pillars are enabled for the
local playtest. The original failed intermediate reports above remain intact.
This accepts the local functional/readability smoke; it does not establish the
shared phone-FPS, real-device, whole-scene look or production deployment gates.
