# Live calendar in an open game

`createEventFeed` supplies one validated `/api/events` response to the radar, world markers and V event list. The initial request is shared, then the open game refreshes every five minutes while visible. A stale tab refreshes when it becomes visible again. Requests time out after eight seconds; errors retain the last valid calendar and retry after a minute. Destroying the feed cancels requests, timers and listeners.

The existing `eventsRefresh` switch controls background polling. Initial loading still follows `eventsApi`, `events` or `localEventSnapshot`. This client reads the server's last successful calendar; the separate official-feed crawler runs every three hours.

Background data updates preserve the event list's search/date tab and focused or hovered row. The radar retains the selected event's action elements and highlight, and refreshes its displayed details. An existing GPS destination and route stay in place until the player chooses another destination. Large map bounds are accumulated without spreading all road nodes into one function call.

Integration: create the radar with `autoLoad: false`, remove separate radar/upcoming startup loads, and fan out `createEventFeed({ onEvents, onError })` to `radar.setEvents`, `markers.setEvents` and `upcoming.setEvents`; errors go to `upcoming.setError`. Deep-link event lookup must await `eventFeed.ready` as well as `radar.routingReady`. Destroy the feed alongside those views. A supplied `routeGraph` is reused directly; otherwise the existing `routeGraphUrl` fetch remains available.

The shared controller behavior check passes refresh, retries, visibility resume, request deduplication and disposal. The isolated browser smoke at `artifacts/event-feed/preview/smoke.json` passes one initial request, all three consumers, selected-card detail updates, stable keyboard focus, selection using the latest event record, retained GPS route and last-good data on failure. Desktop radar and phone event-list screenshots were reviewed. Fixture calendar checks do not establish real crawler or funding acceptance; main integration and the accepted common bundle are tracked in bead `gtasf-o7gl`.

Main integration `afebc88` entered the accepted common bundle at `artifacts/founder-path/2026-10-03T0933/app`. The native 09:34 run recorded one successful `/api/events` response, 1,596 real events, a working V list, GPS selection of Investor Happy Hour, physical arrival and a real 20-second award. Its later taxi-stage server disconnect remains a separate failed journey; the five-minute native refresh was not reached. Timer/resume refresh behavior is established by the scoped controller and actual-module browser checks above.

The subsequent native founder journey at
`artifacts/founder-path/2026-10-03T1006/report.json` completed successfully and
records the previously missing natural refresh: `/api/events` returned HTTP 200
at 10:06:27.171 UTC and again at 10:11:27.391 UTC, 300.220 seconds apart. The game
remained connected through the real event award, the 299-second robotaxi ride,
vehicle entry, recovery and keyboard descent of Lombard. The report has empty
browser/HTTP error lists and `passed: true`. Its calendar held 1,596 real events;
none was live on Oct 3, so live funding was not claimed. This supplies native
five-minute refresh evidence without erasing the earlier failed run or claiming
the separate deployed G1/device gates.

## Search the neighbourhood shown on a card — gtasf-gkgv

Event search includes the map neighbourhood displayed on the row, public address,
source venue, title, host and tags. Location labels are cached per calendar and
discarded when refreshed event data arrives. Online events remain searchable
with driving and taxi actions disabled.

The schedule check, strict web types and `tools/event-search-smoke.mjs` pass.
The actual event-view fixture finds a cafe by its displayed Financial District
neighbourhood, preserves SF date filters and other search fields, then finds the
same refreshed event in North Beach and selects its latest public coordinates.
The 390px screenshot and zero-error report in `artifacts/event-search/` were
reviewed. This followup is separate from the earlier 09:33 common game bundle.
