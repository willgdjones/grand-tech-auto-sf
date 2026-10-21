# B04 playable HUD and event markers

`flags.hud` gates `createPlayableHud` and `createEventMarkers`; the marker also
requires the live events flag or the explicit local snapshot flag. Pane 1 enables
the existing HUD switch when wiring these into the main loop. Existing driving
prompts, quick destinations, map and status text remain in `main.ts`.

```ts
const hud = createPlayableHud({ onCardChange: open => setModalControls(open) });
const markers = createEventMarkers({ scene, frame: world.manifest.frame,
  surfaceHeightAt: world.surfaceHeightAt,
  // Supply a loaded, collision-free road/sidewalk target, or null.
  resolvePosition: point => resolveSafeEventMarker(point),
  // Non-modal: show a toast. NEVER open the modal card from onEnter/onArrive —
  // showEvent releases input + pointer lock and stops the car (gtasf-96rj).
  onEnter: event => toasts.show({ title: event.title, tone: 'event' }),
});
// Prefer the radar's fetched events; load() is an optional standalone fallback.
markers?.setEvents(events);
// Per frame; no additional animation loop:
hud?.update({ now: Date.now() });
markers?.update(foot, dt, mode === 'on-foot' && !modalOpen);
```

Pause movement/look, release pointer lock and hold a free cursor while the event
card is open. `hideEvent()` closes it; `cardOpen` exposes its state. `showEvent`
accepts an optional *known* in-game attendance count. Unknown attendance and
funding are labelled unavailable; they are never fabricated. Only server-validated
visits, with both `eventVisits` and `fundedStars` enabled, fill the Seed–Unicorn
stars. Radio state is supplied by its player; until then the HUD says Radio off.

Markers are limited to 12 within 220 m of the player and deduplicated within 5 m,
share two small ring geometries/materials, and only use loaded terrain. Approximate
event pins are explicitly neighborhood markers, never claims of a precise venue.
Entering an event marker now shows a non-modal toast (`toasts.show`), not the modal
card, so movement and pointer lock are never interrupted (gtasf-96rj). All external
text uses `textContent`; outbound links accept only HTTP(S) and open with noopener.
Call both `destroy()` methods on teardown. Full event visits/rewards remain B09/C05.

## Local smoke evidence

`nice -n 10 node tools/hud-smoke.mjs` uses the running `npm run dev` app. On
2026-10-02 PT it passed with zero console/page errors: Ferry HUD, real Embarcadero
"Rabbits on the Run" marker and official Tech Week RSVP link, approximate venue
label, paused movement during its card, close without immediate reopening, and
1440×900 / 390×844 layouts. Visual review moved the desktop clock below the quick
destination buttons; the smoke now checks that overlap. Screenshots and the
source event ID/URL are in ignored `artifacts/hud/`. Web TypeScript and production
bundle checks passed. Attendance/funding remain explicit unavailable values until
their authoritative state is wired; no visit/reward or device gate is claimed.

## Street names on stacked roads

The street HUD uses `world.locationNameAt(x, z, maxDistance, referenceY)`. Pass
`world.locationNameAt(foot.x, foot.z, 80, foot.y)` on its existing four-Hz update.
The lookup interpolates each source segment's height at the nearest horizontal
point and excludes roads more than three metres from the current foot/vehicle
height. This allows curb and vehicle offsets while separating tunnel and bridge
decks. Calls without the optional height retain the original planar behavior;
neighbourhood polygons still resolve when no matching street level is nearby.
The existing `flags.hud` switch continues to govern the visible label.

`locationNames.test.ts` checks the overlapping-road case, hillside interpolation,
legacy callers, radius bounds and independent district lookup. The finite
`tools/street-location-smoke.ts` also compares real bridge/tunnel roadside points
against the planar lookup and writes `artifacts/street-hud/height-aware-source.json`.
The current north-east graph check passed at 09:55 UTC on 2026-10-03. A Hyde
Street roadside position above Broadway was previously labelled Broadway; the
height-aware lookup correctly selects Hyde Street. A Broadway tunnel position
previously labelled Cyrus Place now selects Broadway. This source receipt is
not a native drive or visual/device gate.

## Event-details keyboard focus — gtasf-5w8q

The open event card declares its modal role and wraps Tab/Shift+Tab among visible,
enabled controls. A disabled Share button is skipped while its request is pending.
Escape closes the card and returns focus to the prior usable control when the
card still owns focus. Closing during another HUD's focus handoff preserves that
new owner; hidden, disabled or disconnected return targets are ignored. Destroy
removes the keyboard handler and performs the same safe return.

Refreshing event details preserves the focused RSVP/Share control when it remains
usable. The RSVP link applies its final validated URL and visibility directly,
avoiding a transient removal that blurred it. If updated data hides a focused
control, Close receives focus. The existing `hud` entry switch and main modal
callback remain unchanged; no styles or main-loop code are modified.

The strict web check passes. `tools/event-card-keyboard-smoke.mjs` freezes bundles
using `GTASF_CARD_STAGE=before|after` and `--build-only`; `--run-only` exercises
the saved bundle. At October 3 10:44–10:45 UTC, both original viewports reproduced
Tab escaping and close stealing another HUD's focus. The final 1100×720 desktop
and 390×844 phone checks pass forward/reverse wrapping, focused-content updates,
disabled/hidden actions, Escape/return, another HUD taking focus, invalid return
targets and destruction with normal Tab restored. Both screenshots were reviewed;
`artifacts/event-card-keyboard/{before,after}/report.json` records zero browser
errors and no API requests. The GPU-disabled fixture uses an isolated sharing
callback and establishes DOM behavior, not a native award or real clipboard gate.

## SF clock minute cache — gtasf-2sy5

The clock uses an explicit 00–23 hour cycle and caches its formatted SF label by
absolute epoch minute. The minute also participates in the DOM key, so a repeated
local label after a DST or date jump refreshes the semantic timestamp. Funding
count-up, rank/stars and mutations of the existing radio state still update in
the same minute; this does not cache the entire HUD state.

At October 3 12:46:56 UTC the original actual HUD module produced 600 Intl clock
formats for 600 same-minute updates on both 1100×720 desktop and 390×844 phone.
This Chromium already resolved to h23 and showed 00:05 at SF midnight; the initial
24:05 hypothesis was disproved and is not claimed as a visible fix. Frozen source
and the report are in ignored `artifacts/hud-clock/before/`.

`tools/hud-clock-smoke.mjs` accepts `GTASF_HUD_CLOCK_STAGE=before|after` and
`--build-only` / `--run-only`. The October 3 12:56:23 UTC after smoke passes four
grouped cases per viewport with no console/page errors or API requests: 600
same-minute updates now make zero extra clock formats; minute/backwards/day/DST
transitions and repeated labels keep the displayed and semantic time correct;
funding count-up, rank/stars and mutable radio state update immediately; the event
card keeps its date formatting, initial focus and Escape return. Both midnight
screenshots were reviewed and strict web TypeScript passes. The receipt is
`artifacts/hud-clock/after/report.json`. This measures clock formatting only; no
native frame, GC or device improvement is claimed.

## Funding display work — gtasf-o0cb.4

The legacy visit-tier order is prepared once. Each HUD caches its funding round
by the total-cents string and its money label by the displayed cents value.
Values are compared directly, so a profile or radio object changed in place
still updates. Count-up, downward corrections and unavailable legacy funding
retain their existing behavior. Shared funding math and main integration are
unchanged.

`tools/hud-funding-work-smoke.mjs` accepts
`GTASF_HUD_FUNDING_STAGE=before|after` and `--build-only` / `--run-only`.
The original module and CSS are preserved in
`artifacts/hud-funding-work/before/source/`. Its October 3, 2026 baseline at
13:31 UTC measured 600 visit-tier reversals, 600 funding-round reversals and
600 money formats across 600 unchanged canonical HUD updates. Legacy funding
also repeated 600 visit-tier reversals and money formats.

The final 13:34 UTC run measures zero additional operations in those categories
for both funding modes at 1100×720 and 390×844. Four behavior groups per viewport
also pass: legacy amount/unavailable recovery; canonical count-up, clamping and
mutable profile/radio inputs; every funding threshold, maximum and downward
correction; and event-card keyboard focus/disposal. Minute, rank, amount width,
stars and radio state stay correct. Both screenshots were reviewed, and browser
errors and API requests are empty. Reports are under
`artifacts/hud-funding-work/{before,after}/`.

Web strict types and the existing funding tests pass. These are actual DOM
operation counts, not evidence of a native frame-rate or GC improvement. The
parent's whole-frame, cold-load and device gates remain separate.

## Non-modal awards/arrivals audit — gtasf-96rj

Final audit (2026-10-08) of every automatic award/arrival path, confirming none
blocks movement (none releases input or exits pointer lock):

- `drops` client `onClaim` (`main.ts`) → `dropBanner.celebrate()` + `toasts.show`.
  `celebrate()` only sets `textContent`, toggles a CSS class and starts a 4.2 s
  timer; `.gt-drop-toast` and `.gt-drop-banner` are `pointer-events:none`
  (`drops/banner.css`). No input/pointer-lock calls.
- `guidance.onArrive` (`main.ts`): funding on → `notify(...)`; funding off →
  `toasts.show({ tone: 'event' })`. Both non-modal.
- `markers.onEnter` (`main.ts`): funding on → `funding.selectEvent` + `notify`;
  funding off → `toasts.show({ tone: 'event' })`. Both non-modal.
- The modal event card `hud.showEvent` (the old blocker — it releases input +
  pointer lock) now has **no caller**: entering/arriving use toasts, and clicking a
  marker opens the external event URL (`events/worldEventLinks.ts`), never the card.

Follow-up (separate bead): the card `showEvent` is now unreachable, so the toast
hint "Open V/J for event details" has no in-game opener. Decide whether to restore
an explicit V/click opener or drop the hint — not a movement-blocking issue.
