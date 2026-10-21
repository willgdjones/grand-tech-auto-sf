# Sea lions and city hazards

`cityLife` adds movement to the existing Pier 39 sea-lion colony and its west
boardwalk viewing sign. `hazards` adds a coned white robotaxi on the Ferry plaza
and fictional Muni-late banners on the plaza and Pier 39 entrance. Both flags
gate `createCityLife`; the Pier 39 animation also checks `cityLife` at creation.
The module supplies directions through the existing Game options modal.

The robotaxi reuses the existing Kenney-derived GTASF asset and its recorded
material provenance. Its lidar stays still under a reflective orange cone.
The car and the banner posts add narrow local footprints to the existing
landmark collision system. Disposal removes only those footprints. The Ferry
plaza crossing and Pier 39's 20-metre centre drive aisle remain open.

Muni copy is fictional and comes from `SF_HAZARDS`; these are not real transit
arrival boards. Short proximity notices and sea-lion visitor copy use the same
shared flavour inventory. They never impersonate real players or enter chat.

## Visual reference and original work

This extends the existing Pier 39 model. Its five cached photographs
were reviewed before the change; see the source URLs and viewpoints in
`web/src/render/landmarks/REFERENCES.md`, Pier 39. The contact sheet is at
`artifacts/landmarks/references/pier-sheet.jpg` (reference only, not shipped).
The west-side rectangular rafts, clusters of warm tan/brown animals, raised necks,
short muzzles and side flippers remain consistent with those photographs.

Nine animals replace static counterparts in the near model. Each uses two merged
flat-shaded meshes, with whiskers, visible ears and eyes, gentle breathing and
head turns. Low quality animates three; distant animation stops beyond 240 metres.
Signs and the coned taxi cull at 100 metres on low quality and 150 otherwise.
Each original text sign uses a 512×256 sRGB canvas (0.131 MP), below the 1 MP cap.
No new image assets, external service or voice is needed; the robotaxi retains
its existing shared vehicle materials.

## Integration

Await `createCityLife({landmarks,parent:gameOptions.content,low,onDestination,
onNotice})`, add its root to the scene, call `update(foot,performanceNow)` each
frame and `dispose()` before disposing landmarks. The destination callback gets
an ID, title, position, lat/lon and short description. Pier 39 directions route
to the entrance; follow the outer west boardwalk to K Dock. Source landmark
transforms keep placements aligned when real terrain loads.

The southern four metres of Pier 39's existing apron blend its fixed 3.2-metre
deck into the real loaded waterfront height. Rendered triangles and movement
use the same interpolated surface; there is no cliff-step exception. The blend
stays unavailable until its outer edge has loaded terrain. The former Lombard
map ended north at world z=-2560, while the pier entrance is at z=-2673. The
sourced SF map now covers the approach in normal local play, completing
gtasf-bwbi; this does not activate the full map in production.

## Verification

`node tools/city-life-smoke.mjs` uses the normal local game and public deep-link
entry. It physically walks to both Ferry props, opens their options controls,
walks onto Pier 39 and along the outer boardwalk, checks that the rendered head
actually moves, and returns to the pier entrance. Desktop and phone-width images
are written to `artifacts/city-life/game/`. No poses, input state or clock are
assigned by the harness. This is not a device, performance or deployment gate.
The recorded local acceptance below completes gtasf-8kbq.3.

The actual run at `artifacts/city-life/game-1102/report.json` passed its physical
checks on immutable client `9464470`, native Worker `072f15f` and the full SF preview
map. Game options produced real routes to the coned taxi and Pier 39. Keyboard
walking crossed the waterfront apron, reached the west boardwalk, observed a
changing sea-lion head, and returned across the seam to local z=220. Console,
HTTP and map errors were empty. Desktop and phone views of the coned taxi and
Muni banner passed review.

The original sea-lion images in that run were not accepted: the viewing sign
obscured the camera. The final `artifacts/city-life/pier-1130/report.json` repeats
the full physical Pier round trip on immutable client `37cb3e5` and native Worker
`1d0a63b`, using the same sourced SF map. At a real viewpoint through the shop
gap, the desktop and 390-pixel phone images show the warm brown/tan sea lions
clearly on their wooden rafts, including their raised heads and flippers. Both
images passed comparison with the cached Pier photographs. Animation, entry and
return checks passed; console, HTTP and map errors were empty.

`GTASF_CITY_LIFE_PIER_ONLY=1` restricts this repeat to the Pier checks; the accepted
Ferry images remain those from `game-1102`. Together these complete the local
city-life acceptance. Whole-city driving, Pier vehicle entry/exit, device, load
and deployment gates remain separate.

Normal local startup was switched through the map CLI at 11:21:49 UTC on
2026-10-03, with `localOnly: true` and `withinProductionMapBudget: false`.
The restarted Vite server returned the sourced SF manifest at 11:25:47: 3,654
chunks, bounds `[-10752,-5632,5376,9216]`, SHA-256
`dc90ea7c05e411cfff1bdced2a31ce27add2dd35bb8e8a373375dba36c33603d`.
The receipt is `artifacts/city-life/local-map-1126.json`. The map owner's
coverage and budget evidence is in `tools/map/CITY-COVERAGE.md`; load and frame
budgets remain open. Production map publication and full Pier drive-in/out
acceptance remain separate.
