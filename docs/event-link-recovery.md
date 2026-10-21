# Event-link GPS recovery

The `gtasf-f166` baseline uses the real `resolveSpawn` and `createEventFeed`, plus
the event-feed and link callbacks extracted from `main.ts` through the TypeScript
AST. An ordinary `/go/linked-event` selects the event once. If the spawn lookup
succeeds but the separate initial feed returns HTTP 503, a later successful feed
populates the radar, world-marker and calendar sinks without selecting the linked
GPS destination. The initial feed's `ready` promise settles even on error, so the
original one-shot startup callback cannot recover.

`artifacts/event-link-recovery/baseline/report.json` records that failure and
`main-wiring.txt` preserves the exact callbacks. The probe uses controlled
calendar responses and view/action sinks. It does not run the renderer, native
GPS, a browser, or WorldDO.

## Integration contract

Create `createLinkedDestination(request.place.eventId, event => selectEvent(event)
=== true)` before the feed and before navigation callbacks can execute. The
existing `deepLinkSpawns`, event and waypoint switches govern the entry; the
helper does not fetch or invent coordinates, routes, funding or World state.

Pass each canonical feed to `setEvents(events)`. This retains the latest event
but waits for `start()`, called after routing and funding initialization at the
old link-selection point. A successful selection consumes the link. An absent
event or rejected route can recover from a later calendar. The existing main
`selectEvent` routine still performs routing and funding selection.

Call `cancel()` after an accepted explicit map/calendar destination, map hail,
transit or city-life direction, Ferry/Lombard choice, and successful hail to the
current destination. Cancellation is permanent even if the chosen destination
is the same initial default. Failed actions must retain the active route and
must not pretend to succeed. Cancel on teardown as well. Automatic boot setup
of the default destination must not cancel the pending link.

## Checked behavior

`node tools/event-link-recovery-smoke.mjs` extracts the actual main feed,
routing readiness, event selection, map actions, transit/city directions,
Ferry/Lombard buttons, current-destination hail and gameplay teardown. It uses
the real spawn lookup, feed and helper with controlled route/taxi/view sinks.
The separate cinematic teardown is excluded from this gameplay check.

The extended original-source baseline fails 13 of 23 cases. The actual updated
main source passes all 23: temporary feed failure; either data/readiness order;
updated canonical event coordinates; nine accepted manual intents including
the same initial Ferry destination; eight rejected actions preserving the
active route and funding selection; and teardown before delayed routing.
Successful linked selection happens only once across later feed updates.
All eight focused helper regressions also pass.

Reports are in `artifacts/event-link-recovery/before-extended/report.json` and
`after/report.json`. Each run saves its exact extracted callbacks and SHA-256;
the accepted main wiring hash is
`08e2c0b406316b154f275555242ab89992a2a9dd2f2a0fb2638d6bc4b8d95924`.
Set `GTASF_EVENT_MAIN_SOURCE` to a saved main source to reproduce the baseline,
and `GTASF_EVENT_LINK_OUT` to select an output directory.

Strict web TypeScript passes for the actual integrated source (pane 1 run
18827). Helper/tool source is committed in `75ef9dc`; the matching main wiring
is committed in `4aed1c6`. Both are included in the exact-commit shared bundle
`8a42a569f648dd423f47d18f1151ac8ed354c8a6`, built successfully at
2026-10-03T14:02:54.908Z (pane 1 run 68282, 175 modules). The immutable app and
source receipt are under `artifacts/founder-path/2026-10-03T1402/`; ancestry
and the unchanged integrated main source were checked before closure.
These controlled checks do not establish native route/device/performance
acceptance.
