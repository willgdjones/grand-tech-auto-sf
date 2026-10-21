# Calendar keyboard behaviour

The existing event view opens with V or its HUD button and focuses search.
Tab and Shift+Tab stay among its visible, enabled controls. If focus escapes
while the calendar is open, the next Tab returns to the appropriate edge. An
empty control set focuses the dialog itself, so Escape remains available.

Closing restores the previous usable control only when focus is still inside
the calendar. A panel that has already taken focus keeps it. If the opener has
been removed, the calendar HUD button is the fallback. Destruction follows the
same rule and releases the cursor lease and keyboard listener. The existing
`eventsView`/`hud` entry flags continue to apply; no new integration is needed.

`nice -n 19 node tools/calendar-keyboard-smoke.mjs <new-output-directory>`
bundles the actual calendar and Input modules with two committed public events.
It uses GPU-disabled Chromium and makes no World, map or API requests.

The original source failed the other-panel handoff assertion at 10:50:35 UTC
on October 3, 2026. Its receipt and frozen module bundle remain in
`artifacts/calendar-keyboard/before-aujd-20261003/`. The final run at 10:52:05 UTC
passed at 1100×760 and 390×844 in
`artifacts/calendar-keyboard/final-aujd-20261003/`. Physical keyboard checks
cover V/search, both Tab directions, disabled/hidden controls, outside focus,
Escape, destination selection, removed opener, an empty dialog, and destruction
while the search field owns focus. Both contexts reported no console/page
errors. Web strict types and the two existing schedule tests also passed.

This is keyboard DOM evidence using the real modules; it does not establish
native world rendering, device performance or a deployment gate.

Opening from another native dialog finishes the integration handoff before
focusing search. In particular, pressing V on a Game options button closes
that modal first so its inert background cannot reject the search focus.
If the integration closes or destroys Events immediately, search stays
unfocused. Existing typing, focus trapping and close restoration still apply.

`nice -n 19 node tools/events-modal-handoff-smoke.mjs` exercises the real
Game options and Events modules with a fixture calendar, without API requests.
`GTASF_EVENTS_HANDOFF_STAGE=before` records the original failure; `--build-only`
and `--run-only` allow the original bundle to be frozen before a source edit.
The October 3 baseline at 11:57:59 UTC reproduced Events search remaining
unfocused after physical V in both desktop and phone viewports. The final
11:58:18 UTC run passed both sizes: immediate filtering, refreshed results
without lost caret, Escape to the visible Events launcher, normal button/V
opening, ignored V in another text field, an immediate-close callback, and
disposal. Both screenshots were reviewed; errors and API requests were empty.
Receipts and bundles are in `artifacts/events-modal-handoff/{before,after}/`.
The existing calendar keyboard smoke also passed at both sizes, with its
receipt in `artifacts/events-modal-handoff/calendar-regression/`. Web strict
types and both schedule tests passed. These remain isolated DOM checks.

## Date tabs

Tab visits the selected date once. Left/Right switch dates and wrap at the
ends; Home/End select Live now/Tech Week. Switching dates resets pagination
while preserving the search text. The selected tab labels and controls the
results panel. Clicking a date updates the same selection and Tab order.
Modified arrow keys and Home/End while editing search retain native behavior.

`nice -n 19 node tools/events-date-tabs-smoke.mjs` uses the actual Events and
Input modules with four fixture dates and no API or WebGL requests.
`GTASF_EVENTS_TABS_STAGE=before` preserves the original Events source/CSS on
its first build; `--build-only` and `--run-only` keep that bundle reusable.
Receipts live in `artifacts/events-date-tabs/{before,after}/`.
The October 3, 2026 baseline at 12:30:03 UTC reproduced ineffective ArrowRight
and Home keys plus four date Tab stops in desktop 1100×720 and phone 390×844.
The final run at 12:33 UTC passed three grouped cases at both sizes: date-key
wrapping and exact results, selected Tab order and search editing, and pointer
selection/modifier handling/Enter destination choice without camera movement.
Both final screenshots were reviewed; console/page errors and API requests
were empty. Web strict types and both schedule tests passed at 12:30 UTC.

Review also caught the generic hover style replacing the selected date's gold
background while retaining dark text. The selected-button selector now keeps
its readable styling on hover. The same browser check verifies text contrast
of at least 4.5:1 while hovering the selected tab; the earlier screenshots are
preserved as `before/selected-hover-{desktop,phone}.png`. This remains isolated
DOM evidence, not a native game or real-device acceptance.

## Showing more events

Activating Show more moves focus to the first newly revealed event's enabled
destination button. Tab continues through that event's actions. Online events
use their source link; an event without an available action receives focus on
the row itself. The final row remains part of the dialog's Tab cycle even when
Show more disappears. The selected date and search text stay in place.

`nice -n 19 node tools/events-more-smoke.mjs` bundles the real Events and Input
modules with 125 local records and no API or WebGL requests.
`GTASF_EVENTS_MORE_STAGE=before` preserves the original Events source/CSS on
its first build; `--build-only` and `--run-only` support a frozen baseline.
Receipts and four reviewed final screenshots are in
`artifacts/events-more/{before,after}/`.

The October 3, 2026 baseline at 13:16:16 UTC reproduced skipped new rows after
both the intermediate and final batches at 1100×720 and 390×844. The final
13:21:26 UTC run passed three grouped cases at both sizes: new-result focus,
Tab continuation and Enter destination selection; an online event's link;
and passive-row focus with next-result or final-row Tab containment. Search,
date selection and game-focus restoration passed, with no camera actions,
API requests or console/page errors. Both schedule tests and web strict types
passed at 13:22 UTC. This is isolated keyboard DOM evidence.
