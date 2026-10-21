# Tech Week radar

`createRadar({graph,frame,onSelect,onHail?,onExpandedChange?,onClear?,parent?})` checks
`flags.radar`. Call `update(position,yaw,peers,taxis)` each frame; drawing is capped
at about 16 Hz. Input positions are world metres and yaw is +Z-forward radians.

The circular view rotates with heading; M/the button opens a north-up event map.
Gold pins show the real `/api/events` response, green pulsing pins are live by
their UTC start/end times, cyan peers and white taxi squares use game positions.
Dashed rings mark approximate public neighborhoods. Dense pins are counted in
screen-space clusters; the searchable list preserves individual event selection.
The map takes a free-cursor lease and releases it on close/destroy. `isExpanded`
and `onExpandedChange` let the integrator also pause movement/vehicle input.

## SA pause-menu map, venue grouping and waypoints (v2)

`flags.saMapStyle` restyles the expanded map as a GTA-SA pause menu: a parchment
texture, labelled SF district centroids, SA-graded blips, and basic zoom — wheel,
pinch and +/- buttons zoom toward the cursor (1x–8x) with drag-to-pan when zoomed.
District labels live in `./districts.ts` (`SF_DISTRICTS`, 36 whole-city centroids each
with a collision `priority`). Since the map now fits the whole city, the labels are
de-overlapped per draw by the pure `cullOverlappingLabels()`: each on-screen label is a
centred box (width from name length × font size), and lower-priority labels whose boxes
overlap a kept one are dropped, so the big neighbourhoods show at fit-zoom and finer ones
reappear as you zoom in. Centroids beyond current road coverage are harmless — they
project off-screen and are culled. Unit-tested in `districts.test.ts` (gtasf-i801/z756).
`flags.venueGrouping` replaces the per-event screen clusters with one blip per venue
(from `../events/venues` `focusVenues`/`groupVenues`/`representativeEvent`, rebuilt only
when the feed changes); clicking a venue opens a browser card listing all its events
this week with Set destination, and the side list is grouped by venue too.
`flags.eventFocus24h` limits those blips to the next 24 hours (with a weekend fallback
to the soonest events so the pre-Tech-Week map is never blank), and a "+N" badge marks
venues hosting more parties later in the week. With both flags off, the original
per-event clustering and list are used unchanged.

With `flags.saMapStyle` and `flags.waypoints`, clicking empty map space drops a
waypoint snapped to the nearest road (via `router.route`, which snaps the destination)
and routes to it. When the integrator passes `onClear`, a "Clear route" button appears
in the navigation line while a destination is set; clicking it clears the radar's own
route and calls `onClear` so the host can clear the world GPS line too. `onClear` is
optional and the button stays hidden until it is wired, so there is no half-wired state.
All of this is gated by the new flags; the collapsed circular radar also uses the
venue blips when `flags.venueGrouping` is on.

Expanded-map pointer gestures distinguish a tap from a drag at every zoom level,
including fit zoom where panning is unavailable. A second pointer immediately
makes the gesture a pinch instead of a waypoint tap. Cancelling a pointer, losing
capture, closing the map or destroying it releases the gesture state; the
trailing click cannot replace the accepted route. A remaining finger after a
pinch starts a fresh pan anchor, and the next ordinary tap remains usable.

`tools/radar-gesture-smoke.mjs` bundles the real radar and SA theme with explicit
fixture roads. It uses native Playwright mouse input and Chromium touch events
at desktop and 390×844 phone sizes, including fit-zoom dragging, zoomed panning,
pinching, cancellation, lost capture and close/reopen during a press. Use
`GTASF_GESTURE_STAGE=before|after tools/heavy.sh node tools/radar-gesture-smoke.mjs`;
`--build-only` and `--run-only` allow the bundle to be frozen separately. An
existing `artifacts/radar-gestures/<stage>/radar-source.ts` is deliberately reused
so a queued baseline keeps its original source; `GTASF_GESTURE_OUT` selects a
fresh artifact directory when investigating a later change. This GPU-disabled
DOM check makes no API or map-asset requests and does not establish a native-game,
device or performance gate.

For `gtasf-mdjn`, the October 4 08:23 UTC baseline in
`artifacts/radar-gestures/before-2/report.json` reproduces accidental waypoints
after a fit-zoom mouse drag, lost mouse capture and closing during a press on
both desktop and phone. The 08:24 fixed run in `after-2/report.json` passes all
19 checks with zero browser errors; both final screenshots were reviewed. The
five existing SA-map/radar tests and strict web TypeScript also pass. Earlier
`before`/`after` reports are retained: their capture-loss case released pending capture before Chrome had
activated it. The corrected check explicitly observes `gotpointercapture`,
then `lostpointercapture`, before assessing the trailing click.

With `flags.waypoints`, the map search also finds all 24 district names/slugs from
the shared map-pipeline district registry. Results appear only for a nonempty
query, alongside matching venues/events; clearing the query restores the event
browse. Each district uses its verified street spawn hint, rather than a label
centroid. Selecting a result focuses the existing destination card; Set destination
and Hail robotaxi use the same source-road approach (including road height),
rejection handling and accepted-route transaction as landmarks. Districts outside
the current drivable graph report that limit without replacing the active GPS.
This extends the existing `radar`/`fullMap`/`waypoints` entry points, with no new
external service or flag required. `saMap.test.ts` exercises western searches,
route and taxi acceptance/rejection, focus, road height and clearing the query in
one DOM/router smoke. Desktop/phone visual review remains separate.

The five-second result refresh pauses while a district result owns keyboard focus
or pointer hover, matching the existing venue list. Once the player leaves the
group, periodic distance/order updates resume; explicit search or calendar
updates still render immediately. `saMap.test.ts` checks retained selection,
resumed refresh, card focus and clearing the query in one bounded DOM smoke.
Receipt (gtasf-9tjd): both radar test files passed all six tests. Whole-web strict
TypeScript passed after the shared collision-decoder guard was corrected; the
coordinated check used the same radar source hashes. No browser/device gate is claimed.

Text caching experiment (gtasf-n24e): **rejected; the game keeps native text
painting**. The bounded glyph/count cache preserved behavior and appearance but
increased measured draw-submission cost in every case:

| Fixture | Native mean ms | Cache mean ms | Change |
| --- | ---: | ---: | ---: |
| Desktop minimap | 1.642 | 2.212 | +34.7% |
| Desktop expanded map | 2.657 | 4.062 | +52.9% |
| Phone minimap | 15.440 | 17.365 | +12.5% |
| Phone expanded map | 21.547 | 40.233 | +86.7% |

Pane 6's receipt is `artifacts/radar-text-cache/pane6-second/report.json`, with
SHA-256 `dcc7a6d19499633631e8a957eaa640b332bc017c6e37326ddfcf06777ce6ec5f`
and eight before/after screenshots reviewed. Chromium 153.0.8010.12 used desktop
1100×760 / DPR 1 and phone 390×844 / DPR 2 / 4× CPU throttle. The isolated fixture
has 981 events at 421 venues, live/collected/approximate cases, 20 warmup draws and
60 unfiltered timed draw calls per case. A fixed fixture clock keeps pulse sizes
equal; these are instrumented 2D submission timings, **not wall-frame FPS or a
whole-game/device performance gate**. Their underlying browser cost was not
isolated further. Reducing minimap text calls from 262 to 1 per draw did not make
this candidate faster.

The native smoke passed all single-event/grouped venue cards, distant-venue
search, source-road destination, mouse/touch waypoint and disposal checks, with
zero console/page errors. Direct versus cached text had mean premultiplied
channel difference below 0.066/255 at DPR 1 and 2. The stress case retained 256
entries / 114,641 pixels, evicted 644 entries, reused a warm stamp and released all
retained pixels on clear (declared limits: 256 entries / 262,144 pixels). This does
not justify its CPU regression.
The first report in `pane6-first` is retained: its baseline stopped at a wrong
singleton-card heading expectation, corrected in the successful run.

The exact rejected helper and wiring patch live only in
`tools/radar-text-cache-candidate.ts` and `tools/radar-text-cache-candidate.patch`.
`node tools/radar-text-cache-smoke.mjs --prepare-only` reconstructs and hashes the
candidate in an owned temporary directory without editing the checkout, compiling
or launching a browser. It reads baseline `0425a5d` from Git; the baseline SHA is
`b6f99ae46a4a5983dcc570beaf77e88a24f6842f5858383d5b6f578b611e7d87`, rejected radar
SHA is `e944a14b0a5eca80f05c11f5ff5dbe2c9f86d979794611bc0ad89d6800db4a67`, and
helper SHA is `691e3aadc2f4cd0862a9f08d2ac4f7165f9898204325adf6977810f0a828e334`.
Pane 6 can repeat the isolated comparison through
`tools/heavy.sh node tools/radar-text-cache-smoke.mjs`; `--build-only` only bundles
the two fixtures. A new output directory preserves each earlier report.
The candidate passed six radar tests and strict web TypeScript. Its tools-only
reconstruction, isolated fixture bundling and standalone strict TypeScript also
passed. The live radar was restored byte-for-byte to the baseline after the
rejection; no cache feature, flag or player-facing changelog claim ships from
this investigation.

Draw-loop allocation discipline (gtasf-2zmc): the canvas box is measured only on
resize / `ResizeObserver` / map expand-collapse and cached, not read via
`getBoundingClientRect()` every draw (that forced a synchronous reflow). The per-venue
blip loop reprojects into a single reused scratch (`projectInto`) so it allocates no
points per frame; `project()` keeps its allocating form for the low-count sites
(districts, landmarks, peers, taxis, drops).

The expanded map is a keyboard dialog under the same `radar`/`fullMap` flags.
Opening it focuses the event search after other panels have closed. Tab and
Shift+Tab stay among its visible enabled controls; Escape works from search or
any map control. Closing restores the prior connected, visible control, falling
back to the map button if necessary. When another HUD/dialog has already taken
focus, closing the map preserves that new focus. Destroy releases the focus trap
and cursor lease. The collapsed circular radar has no modal keyboard trap.

Keyboard smoke: `nice -n 19 node tools/map-keyboard-smoke.mjs`. This bundles only
the real Input and Radar DOM modules with explicit fixture roads/events, then
uses physical Playwright key presses in GPU-disabled Chromium. It does not call
the API, connect to WorldDO or load map assets. The October 3 baseline in
`artifacts/map-keyboard/before-felu-20261003/report.json` failed because M did not
focus search. The fixed run in `artifacts/map-keyboard/after-felu-20261003/report.json`
passes M/search, movement suppression, forward/reverse Tab wrapping, Escape,
keyboard event selection and destination commitment, focus handoff to another
HUD, and cleanup/resumed movement, with zero browser errors. The existing routing
regression remains a separate scoped check; no native gameplay/device gate is
claimed by this DOM smoke.

Calendar updates invalidate a selected event that disappears or loses its public
map location. Its card shows a calendar message and removes destination/taxi
actions. If a removed action had focus, search receives focus; another control's
focus is preserved. Retained action handlers also resolve the latest calendar
before dispatch, so stale clicks cannot select a removed event. An existing GPS
route remains accepted, and landmark choices continue to work.

Venue cards retain their venue identity when the calendar changes. Refreshes
rebuild the current event list, including additions and cancellations, and keep
focus on the same event or destination/taxi action. If the focused event goes
away, focus returns to Set destination. Removing the representative event does
not close a venue that still has upcoming events; its actions resolve the latest
representative and road approach. If no upcoming events remain, the card explains
that and removes its actions without clearing the accepted GPS route. Background
refreshes never reopen the map or take focus from another control. Clicking a
grouped venue on the circular minimap opens this browser directly. Existing
`radar`, `fullMap`, `saMapStyle` and `venueGrouping` switches still apply.
Feed refreshes also defer replacing a focused or hovered district search result,
matching the periodic result-list refresh guard.

The `saMap.test.ts` venue-calendar smoke exercises these transitions through the
real radar and directed router with a DOM/canvas stand-in. It covers changed,
added and removed events, representative replacement, current taxi/destination
callbacks, focus and GPS preservation. This is component behavior evidence,
not a browser look, actual taxi journey or performance/device acceptance.
October 4, 10:44 UTC: `tools/heavy.sh sh -c 'npx vitest run
web/src/radar/saMap.test.ts web/src/radar/radar.test.ts --maxWorkers=1 &&
npx tsc --noEmit -p web/tsconfig.json'` passed all seven radar checks and strict
web TypeScript for this fix (`gtasf-80a0`).

`tools/radar-calendar-smoke.mjs` freezes before/after bundles with
`GTASF_CALENDAR_STAGE=before|after --build-only`; use `--run-only` to exercise the
saved bundle. At October 3 10:35 UTC, the original desktop and phone views both
dispatched destination and taxi actions for a removed event. The fixed views
block removed/unlocated events, preserve the accepted route, restore focus and
close with Escape, use an updated event title/location, preserve unrelated focus,
accept a landmark hail and dispose cleanly. Both screenshots were reviewed;
`artifacts/radar-calendar/{before,after}/report.json` records zero browser errors
and no API requests. The existing radar transaction regression and strict web
check also pass. This GPU-disabled fixture verifies DOM behavior with fixture
roads, not a native journey, actual taxi dispatch or a device/performance gate.

Explicit event or landmark selection now reveals the destination card and
focuses Set destination. Its actions appear before the results in DOM order;
without this handoff, Enter on the first event left keyboard users tabbing
through the other 49 results. Card scrolling runs before normal action focus,
so even details taller than the phone panel leave the route action visible.
Background calendar refreshes retain focus and do not invoke this handoff.

`tools/radar-card-focus-smoke.mjs` uses 50 isolated calendar results with the real
radar module. The October 3 10:57 baseline reproduces the result-list focus
problem on desktop and phone. The final 10:58 check passes immediate visible
action focus, Enter route commitment, pointer selection of the last result,
landmark selection, background-refresh focus, Escape, tall event details and
cleanup on both viewports. Both screenshots were reviewed; the reports in
`artifacts/radar-card-focus/{before,after}/report.json` have zero browser errors
and no API requests. Run with `GTASF_RADAR_FOCUS_STAGE=before|after`, using
`--build-only` to freeze source and `--run-only` to exercise the saved bundle.
Scoped radar and strict web checks pass. These GPU-disabled DOM checks do not
establish a native journey or a device/performance gate.

`ready` resolves after the first fetch. `events` exposes the same located source
events for world markers without a duplicate fetch. `onSelect` and optional
`onHail` receive `{id,title,x,y:0,z,event}`; the integrator supplies the destination
ground/road height before dispatch. Public strings use textContent; outbound
links allow HTTP(S) only. No hidden venue address is invented.

Collected blips use the player's once-ever event history. After funding identity
initialization, on World reconnect and after event payouts, `main.ts` refreshes
the existing `funding.collected()` endpoint and shares one merged set with the radar and world
markers. Awards received during a slow history request remain collected; failed
requests retain known history, overlapping requests share a promise, and disposal
prevents late updates. A new award during an older read schedules one follow-up
read: combined venue cheques name only their last event, so the other paid IDs
must come from history. Account recovery reloads the game and starts a fresh set.
The history read requires `driveThroughFunding`; legacy in-session radar dimming
continues without that endpoint. The existing `dimCollectedMarkers` switch still
gates world-marker appearance and remains off pending its original look gate.

A grouped venue dims only when **all focus events** have been collected, matching
the world marker rule. Radar computes this when the feed or collected set changes,
so drawing does not scan every venue's event list. `events/collected.test.ts`
exercises the history lifecycle against the real marker materials with the marker
flag enabled only in its fixture. `saMap.test.ts` checks the actual radar paint
for partially and fully collected venues. These are component checks, not native
journey or visual/device/performance acceptance.

Receipt (gtasf-1h6o, October 4): all 18 affected history/marker/radar tests passed
at 11:16 UTC. After adding combined-cheque reconciliation, the expanded history
smoke passed at 11:32 UTC, and strict web TypeScript passed against the final
source. Both used `tools/heavy.sh`; Vitest used one worker. The main hydration
hooks were carried in `b240ec1`; the remaining helper/consumer changes and final
payout hook complete that integration.

One feature smoke: `node tools/radar-smoke.mjs`, reusing the shared npm dev server.
Real API: 1,538 located events. Desktop and phone map/card screenshots, selecting
Rabbits on the Run and invoking both destination/hail callbacks passed without
browser errors. Artifacts live in `artifacts/radar/`. Integrated game smoke also
confirmed Ferry real terrain, 6 chunks, 2 players, 5 cars, the event count, event
selection and movement suppression while the map was open, with zero errors.
This is local feature evidence, not a deployment or performance gate.

The full map checks `flags.fullMap`; source-road directions check `flags.waypoints`.
Pass `landmarks: RadarDestination[]` for named places and call
`setDestination(destination)` for initial/quick destination buttons. `routingReady`
waits for `/map/lombard/roadgraph-playable.json`, the pipeline's connected,
collision-audited source graph; the visual/contact graph is not a safe substitute.
`route` exposes the current source polyline, road distance and approach point.
Routes refresh after moving 35m, at most once every two seconds. Map selection
callbacks receive the road approach coordinates, preserving the source event;
an unroutable/outside-area destination stays visible with a clear local-area label.
The original destination remains on the card; longer road-to-pin distance is
labelled as the final walk. No straight-line road fallback is fabricated.

Pass the actual player `y` in `update({x,y,z}, yaw)`. GPS starts now interpolate
lane height and reject source lanes more than three metres from that height,
so a bridge or tunnel cannot borrow its starting lane from another deck.
Two-dimensional callers retain planar snapping. Event and landmark destinations
remain planar because their initial height can be an unloaded fallback; the
chosen source lane supplies the actual destination height.

`routing.test.ts` checks stacked lanes, a sloping origin, invalid/missing height,
the one-way restriction and destination fallback. The existing radar transaction
check also passes. `nice -n 19 npx tsx tools/gps-height-smoke.ts` passed at
10:04 UTC on October 3 against the real north-east graph: Hyde no longer starts
on Broadway 4.82 m below, and Broadway no longer starts on Cyrus Place 17.28 m
above. The receipt is `artifacts/gps-height/source.json`; it is source evidence,
not a native drive or visual/device gate. Existing radar/waypoint flags apply.

Route smoke: `npx tsx tools/radar-route-smoke.ts` uses the actual baked safe graph.
Ferry plaza→Lombard hilltop is 2,859.70m over 2,184 source polyline points, with a
maximum segment of 3.0m and drop-off at [-1041.863,85.954,-1975.201]. A point outside
the local roads is explicitly unroutable. Sky atmosphere is integrated separately
by pane 1 in 1a85944.
