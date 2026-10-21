# Street props

`await createStreetProps({world:{graph,heightAt,roadHeightAt,collides},low})` is gated by
`flags.streetProps`. Supply the landmark wrapper's `surface.heightAt`,
the map's building collision function, its existing `roadHeightAt` spatial index,
and its real source road graph. The index is optional for isolated callers.
Mount the returned `root`; call `update(player.position)` from the existing game loop.
The method returns immediately between one-second updates unless the player has
travelled 45 metres. Release the scene mount before `destroy()` on teardown.

Layout builds once and yields between small batches so larger city graphs do not
monopolise boot. Named, ground-level source lane polylines are joined at their
original OSM nodes across way splits. Opposing lane-zero copies are deduplicated.
The Ferry–Columbus/Stockton–Lombard corridor uses 44m pole intervals; other named
streets use 96m and fewer companion props. Any supplied city graph is covered,
without a geographic cutoff. The current 78-chunk map is still the north-east
slice; full-city scenery depends on supplying the full-city graph and terrain.

Only incoming approaches to source signal controls create mast-arm lights. A
short upstream setback and curb search keep the junction clear, and the lenses
face approaching traffic. Poles and lights are placed before companion furniture.
The road sampler excludes every candidate within 3.5m of any lane at its height.
A 128m bucket index supplies nearby props, then loaded terrain and
building collisions determine whether each instance is drawn. Missing chunks
produce no floating furniture. Placement adds no movement colliders or authority.
Muni wires continue along named corridors,
including Columbus and Stockton, with occasional power cables spanning the street.
These are suggested infrastructure, not a surveyed inventory of overhead wires.

Source `stop` controls receive a separate `trafficStop` prop: a galvanized post,
an octagonal red/cream plate, and original block STOP lettering built from planar
row runs. It shares the existing prop atlas/material, adding one instanced draw
and no asset or texture request. Signs stand 2–7m upstream of a source-controlled
incoming lane, face its approaching driver, and retain the same lane, terrain and
building exclusions. Signal approaches keep placement priority. This is visual
street furniture under `flags.streetProps`; it does not change traffic authority.
`stop` remains the separate decorative Muni stop sign kind.

Original curbside `parkingMeter` geometry adds a rounded metal head, coin slot,
buttons and a fictional `$14` pixel-mesh display. It uses the existing atlas and
one bounded instance batch, with no added image or texture request. A final
placement pass follows named source streets, facing the road and leaving all
existing source controls and furniture intact. Meters are sparser outside the
detailed route and retain the same loaded-ground/building exclusions. The
existing `flags.streetProps` entry point controls them; this decorative rate
does not describe real parking prices or create a payment/funding interaction.
`tools/street-prop-layout-smoke.ts --meters-only` and
`tools/street-props-smoke.mjs --meters-only` keep their evidence in
`artifacts/parking-meters`.
The source placement check passed at 09:29 UTC on 2026-10-03 with 146 meter
candidates; the 443 signals, 635 stop signs, 187 Muni spans and density control
remain unchanged.

Traffic lamps and the server consume `shared/traffic/signals.ts`: the unchanged
28-second cycle gives each axis 13 seconds of green, separated by one-second
all-red gaps. Original OSM junction IDs keep lane aliases and compact city IDs in
the same phase. Pass the synchronized clock from the regular game loop with
`update(position, performanceNow, net.clock.serverNow())`; initial/offline views
fall back to wall time. At most three small lens batches update at 10Hz, separate
from the one-second placement work. A lens is drawn only for an actually mounted
source-controlled mast arm. `flags.streetProps` gates the renderer and
`flags.traffic` selects red/green behavior; traffic-off lamps retain amber.
Traffic must only be enabled with the authoritative simulation's own acceptance.
Isolated renderer fixtures can explicitly select `trafficEnabled`; the game uses
the shared flag and provides no override.

Per-type instance caps are 90 on low and 180 otherwise, over 230m/380m respectively.
All trees are crossed alpha-tested cards with depth writes. Shadows are not cast.
Poles, hydrants, vending boxes, bus-stop signs, frames and fences share one
1024x512 atlas; each tree texture is 256x256. Wires use one instanced batch of
camera-facing ribbons with 1,400/2,800 segment caps. Their 1.5-pixel minimum width
is measured against the actual render viewport, including the phone's reduced
resolution. Nearby wires retain a projected physical width, capped at four
pixels. Smooth edge coverage prevents the old subpixel cylinder scanline gaps;
depth testing hides wires behind solid geometry. They fade over 85–200 m on low
and 140–330 m otherwise, with ordinary scene fog as well. No texture is added.
The foundation preserves this wire shader rather than converting it to Lambert.

Each span retains its sag and reserves its complete segment budget before being
drawn. Every sag segment gets overlapping building-clearance probes at most one
metre apart. A blocked power cable is removed completely while adjacent clear
street-side cables are retained. Muni contact wires and their transverse supports
are checked as one connected assembly. Pass the existing `landmarks` group in `createStreetProps` options:
source map footprints plus the authored models' current transforms are checked.
Ferry and Pier solid footprints keep the clear plaza/boardwalk outside the solid
facade; other authored buildings use conservative local model bounds. Placement
and clearance work remain in the existing once-per-second update. Viewport
resolution updates at render time; width and distance fade are GPU calculations.
The existing `streetProps` feature flag gates the full behavior.

`wires.test.ts` checks sag, a thin facade between coarse curve vertices, the real
rotated Ferry model/plaza clearance, live landmark height changes, complete-span
capacity and shader preservation. The targeted behavior check and web strict
types passed on October 3. `node tools/street-props-smoke.mjs --wires-only` passed
at 10:56:44 UTC with the actual streamed map, authored landmarks, atmosphere and
production bloom. All six Ferry facade/arrival/Columbus views were inspected at
1280×800 medium and 390×844 low: nearby sagged cables remain continuous, distant
cables fade, and clear street-side Columbus runs survive facade rejection. All
drawn segments cleared the source/authored building probes; shader preservation,
depth testing and the 1.5-pixel minimum passed, with no console/page/map errors.
Columbus retained 1,228 desktop/588 phone wire segments while rejecting pieces
of 14/6 obstructed pole spans. The final images and receipt are in
`artifacts/power-wires/preview/`; pre-fix images are in `before/`. The initial
overly broad culling result is preserved in `first-clearance/`.

The original six-view pass removed whole pole pairs when just one outer cable
hit a facade. Its Columbus image was rejected, leading to the per-cable policy.
A focused factory probe also retained all 16 clear middle-cable segments while
removing all 16 obstructed outer-cable segments. The once-per-second placement
updates measured 9.8–35.2 ms in the final isolated fixture; these are diagnostic
timings, not a frame-rate or device gate. This renderer acceptance does not
claim production deployment or full-city driving performance. Main passes the
existing landmark group to the factory; no additional flag activation is needed.

Original word-only Scenario Flux Pro recipes live in `tools/art/recipes/props.json`
and `foliage.json`. `tools/art/pack-props.mjs` deterministically keys magenta plates,
reduces colours and packs the chosen art. It archives unshipped original PNGs in
ignored `artifacts/street-props/masters`. Public `props/manifest.json` records
generation IDs, source hashes, selections and output dimensions. All provider
calls use the shared budget/ledger client; no SA reference image was uploaded.

The source placement smoke in `tools/street-prop-layout-smoke.ts` passed on
2026-10-03 at 08:22 UTC: 2,484 sites, 443 mast arms tied to real source controls,
219 Muni spans and 148 cross-street spans. All candidates clear source lanes.
Columbus has 29 Muni spans and Stockton has 37. The same 1km road generates 46
poles inside the route and 22 outside it. Evidence is in
`artifacts/street-props/layout-smoke.json`.

The real-map renderer smoke in `tools/street-props-smoke.mjs` passed at 08:40 UTC
with production bloom and sequential desktop (1280x800, medium) and touch phone
(390x844, low) contexts. All twelve saved views were inspected: Ferry, a readable
parody board, Columbus, Stockton, sparse Polk and Lombard on both sizes. Foliage
alpha and ground contact are clean, overhead runs continue along the streets,
Polk is visibly less furnished, and the source Lombard curves remain clear.
Desktop draws 196/282 nearby props at Ferry/Lombard; phone draws 120/117. Phone
Columbus and Stockton each show 19 Muni spans; Polk has 72 sparse props and no
route props within its low-tier radius. There were no console, page or world
errors. Evidence is in `artifacts/street-props/preview/smoke.json` and adjacent
screenshots. Scoped web TypeScript passed at 08:38 UTC. Main mounts, updates and
disposes the module in normal and cinematic play. These checks support local
enablement; they do not establish a performance, real-device or deployment gate.

Use `tools/street-prop-layout-smoke.ts --controls-only` and
`tools/street-props-smoke.mjs --controls-only` for the source stop-sign check.
They write separate evidence under `artifacts/stop-signs` and preserve the earlier
route-view evidence. The source check also verifies incoming face direction and
intersection setback; the renderer captures a clear approach on desktop and phone.

`tools/street-props-smoke.mjs --signals-only` uses explicit enabled/disabled
renderer fixture modes. It checks a green lens and the same source mast arm's red
lens 14 seconds later, then the disabled amber fallback, on desktop and phone.
This produces `artifacts/signal-lamps` evidence and does not establish native
WorldDO traffic, real-device performance or production enablement.

Focused renderer acceptance passed on 2026-10-03 using the real north-east map,
production foundation/bloom, sequential desktop (1280x800, medium) and touch-phone
(390x844, low) contexts. All ten images were inspected:

- STOP signs passed at 09:39 UTC after moving the support behind the plate. The
  octagon and STOP lettering are clear at a seven-metre incoming approach on
  both sizes; there is no post through the face. Polk draws 78/49 nearby signs
  on desktop/phone, within the normal caps. Evidence:
  `artifacts/stop-signs/preview/smoke.json` and adjacent images.
- Lamps passed at 09:38 UTC. The same source post changes from a visible lower
  green lens to an upper red lens at the shared clock +14 seconds. Explicit
  traffic-off mode shows only the middle amber lens. Stockton draws 21/4 active
  lamps on desktop/phone. Evidence: `artifacts/signal-lamps/preview/smoke.json`
  and six adjacent images. Main passes the synchronized clock in ordinary play;
  the shared traffic flag still owns actual NPC enablement.
- Meters passed at 09:38 UTC. The rounded head, coin slot, buttons and `$14`
  display are readable from 3.7m and grounded on the sidewalk. Columbus draws
  18/8 meters on desktop/phone. Evidence:
  `artifacts/parking-meters/preview/smoke.json` and adjacent images.

All checks recorded zero console, page or world errors and disposed their scenes.
Web strict types passed again after the STOP support correction; shared/Worker
phase checks and tools strict types passed. These are local renderer checks,
not native NPC, full-city visual, frame-rate, real-device or deployment gates.

The prepared full-city source graph passed the same placement smoke at 09:20 UTC
on 2026-10-03, including source junction identity for every signal. Its 155,510
nodes and 244,460 edges produce 48,751 sites: 981 on the detailed route and 47,770
in the sparse city category, with 4,840 source signals and 10,322 stop signs.
All candidates clear source lanes; STOP approaches retain their direction and
setback checks. Columbus and Stockton have 28 and 29 Muni spans. Reproduce with
`npx tsx tools/street-prop-layout-smoke.ts tools/map/out/sf/roadgraph.json --output=artifacts/street-props/full-city-layout-smoke.json`.
This is source coverage only. Full-city activation, streamed ground/building
filtering and visual acceptance were still pending at the time of this receipt;
later activation and performance evidence live in `tools/map/CITY-COVERAGE.md`.

At 09:34 UTC the actual `sf/roadgraph.bin` also passed through the shared decoder
and browser compatibility adapter, including the new meters. The centimetre
geometry produced 51,276 candidates: 4,835 signals, 10,325 stop signs and 2,532
meters. Every signal retained its original OSM phase key; road clearance, STOP
orientation/setback and density checks passed. The same tool accepts `.bin` input;
use `--output=artifacts/street-props/full-city-packed-layout-smoke.json` to preserve
the separate JSON-source receipt. This remains a source check, not a city playtest.

### Reusing unchanged wire clearance (`gtasf-o0cb.1`)

The 11:06 UTC Columbus profile identified a 50ms task through wire clearance.
The street-prop factory now retains at most 512 spans, including their exact curve
vertices and clearance results. A streamed collision revision, either support's
height, or an authored landmark's position, yaw, visibility or group membership
invalidates the corresponding reuse. Chunk loads/unloads and world disposal
advance `world.collisionRevision`. The application must forward this as a live
getter on `sceneryWorld`; factories without a revision keep full fresh checks.
The existing `streetProps` switch remains the entry gate.

The actual-factory smoke compares cached and uncached rendered buffers after
source obstacles appear/disappear, support height changes, and landmark
movement/rotation/elevation/hiding/removal. Stable refreshes make zero overhead
wire collision queries. Both targeted tests and web strict types passed on
2026-10-03 at 11:27 UTC. The cache clears on disposal; line geometry, independent
power-cable clearance, atomic Muni assemblies and shader settings are unchanged.
The six native views passed at 11:39:30 UTC and all six images were reviewed:
Ferry side, arrival and Columbus at 1280×800 medium and 390×844 low. Every rendered
segment clears independent collision probes. Counts match the earlier accepted
wire fix exactly: 1866/1522/1228 on desktop and 1140/1070/588 on phone. Warm
refreshes preserve the complete float buffer, with 21–55 cache hits, zero misses
and 21–55 retained spans. Full prop refresh cost was 0.6–2.1ms in this fixture;
remaining collision queries check furniture placements. These timings are
diagnostics, not driving-frame or device performance acceptance.

Evidence is `artifacts/power-wires/preview/smoke.json` and its six PNGs. The prior
accepted views are preserved in `artifacts/power-wires/accepted-qez5-20261003T1056`.
Source `c3de189` and the main getter `e15f483` are included in release candidate
`d780be9`. The parent `gtasf-o0cb` still owns actual unfiltered driving performance
acceptance, and deployment is tracked separately.

### Cold refresh scheduling (`gtasf-o0cb.2`)

The unfiltered 11:53 UTC drive still retained an 81.8ms cold scenery refresh:
road-height queries and full polygon/landmark clearance dominated that frame.
The existing per-second refresh now progresses from the normal per-frame
`update` call with a 2ms cooperative work budget. Furniture checks yield between
sites; cable clearance yields after eight of the same overlapping probes.
The budget includes both kinds of work. Candidate sorting and the final bounded
buffer publication are indivisible, so this is not a hard 2ms frame guarantee.

Matrices, signal placements and accepted cables are staged together and become
visible only when the refresh completes. Revision changes cancel unfinished
work and immediately hide old wires; existing furniture and its lenses remain
together until replacement matrices are ready. Each power cable still needs a
complete clearance result, and Muni contact/support wires remain one assembly.
A move of 45m restarts work around the new position. Staging buffers are bounded
by the existing instance limits, and disposal cancels the pending iterator.

The live `collisionRevision` getter remains required for cooperative refresh and
clearance reuse. A caller without a revision keeps a synchronous fresh check,
because it cannot certify an unchanged world between frames. The normal game
already forwards that getter. No feature switch or clearance tolerance changed.
`refreshPending`, `refreshSlices`, `lastRefreshSliceMs` and `maxRefreshSliceMs`
provide diagnostics. The visual helper waits for the actual staged refresh across
animation frames; its timings are not driving-frame or device acceptance.

The extended actual-factory smoke covers completed matrix/wire equivalence,
signal consistency, deterministic expensive-world yielding, in-flight collision
and landmark cancellation, and disposal. Both targeted tests passed at 12:13 UTC
on 2026-10-03. Shared/web/Worker strict checks passed against the unchanged source
hashes in `tools/map/out/o0cb-memory/strict.json`; the isolated renderer bundle
also built successfully. The six native views completed at 12:19:25 UTC and all
six images were reviewed. Their wire counts still exactly match the accepted
1866/1522/1228 desktop and 1140/1070/588 phone views. Independent probes report
zero blocked segments; line depth/fade and the street-side Columbus cables remain
intact. Every refresh settled before capture, with unchanged warm float buffers,
21–55 cache hits and zero misses.

The cold Ferry refresh used 17 animation frames on desktop (36.1ms total work,
2.8ms maximum call) and 12 on phone (25.5ms total, 2.8ms maximum). Columbus used
11 desktop frames (21.9ms total, 2.1ms maximum) and five phone frames (9.8ms total,
2.1ms maximum). These inclusive caller timings retain setup and signal work;
warm refreshes took 0.8–2.8ms total across one or two frames. They establish the
fixture's scheduling behavior, not the driving or real-device frame budget.

Current evidence is `artifacts/power-wires/preview/smoke.json` plus six PNGs.
The 11:39 cache-only receipt and images are preserved in
`artifacts/power-wires/accepted-o0cb1-20261003T1139`. Source `972f91a` was included
in the pinned `3bf4f6d` app used for the unchanged 12:23 UTC Columbus replay.

That actual controller-driven replay completed 1876.76m across 11 tiles, retaining
all 11,406 wall frames, including 6,411 on Columbus. It still failed: seven
Columbus frames exceeded 50ms, with a 150.1ms maximum. The exact mapped profile in
`artifacts/columbus-stream/2026-10-03T1223/slow-window-stacks.json` no longer shows
the previous long synchronous scenery refresh in those windows. The remaining
pauses include garbage collection, rendering and radar work. Ground, camera,
browser and HTTP checks were clean. This completes the bounded-refresh child's
source, visual and replay evidence; the parent `gtasf-o0cb` frame and cold-load
budgets remain open. No frames were excluded and no device gate is claimed.

## Camera clearance through foliage

`gtasf-gsjg` adds a camera-local ordered cutout to the three tree-card materials.
Leaf fragments within two metres of the camera are hidden; coverage returns
smoothly between two and five metres, with the original texture silhouette
fully preserved beyond five metres. This stays in the opaque depth-writing
path with the existing alpha test, lighting and fog. No tree is removed and
there is no per-frame JavaScript scan, instance upload or extra draw. The
material marker carries the effect through `prepareWorldGeometry` conversion;
the source material also works when PS2 conversion is disabled.

Source `4a0d02d` and reproduction helper `ac3b9e4` passed six focused foundation
and scenery tests, strict web types, and the common production-style web build.
Native before/after runs at 12:40–12:42 UTC use the real recorded Powell–Mason
exit near Mason and Union. A normal location link first snaps onto the lane;
physical WASD walks back to the original exit, and arrow keys restore its view.
The initial failed link-only attempt is retained in `before-1235`.

`artifacts/foliage-camera/before-1240/report.json` records the unfixed `3bf4f6d`
build: reviewed phone and desktop images show foliage covering nearly the whole
world view. `after-1241/report.json` uses `ac3b9e4` with the same `dc90ea7c` city
map. Both final profiles reach within 0.205 m of the recorded exit, orbit using
physical touch/keys, restore the chase view and walk 5.15–5.35 m. All eight final
images were reviewed: the actor and street remain visible, and the tree returns
to its authored silhouette when the camera clears it. Tree instance counts are
unchanged (phone 4/5/3, desktop 8/28/13 for palm/plane/cypress). Browser, HTTP and
map errors are empty; all browser and preview processes closed. This is local
visual/control acceptance, not a new deployment or device/performance gate.

### Realistic furniture (`gtasf-street-furniture-realistic-bkc0`)

`flags.streetDetail` adds three instanced kinds to the same layout pass, after the
utility pole and its companions: `streetLamp` (galvanized cobra-head, arm over the
carriageway), `mailbox` (blue collection box) and `bikeRack` (two inverted-U
hoops), plus one or two extra plane/cypress trees per pole site. They use the
existing atlas WHITE tile with vertex colours (no new texture or request) and the
same lane clearance, crowding, loaded-ground and building checks. Each kind gets
one instanced draw only when the flag is on; the Low preset keeps the 90-instance
per-kind cap over 230m. `streetFurniture.test.ts` checks counts and lane clearance.
Visual and phone-fps acceptance is still owed to the pane-6 look review.
