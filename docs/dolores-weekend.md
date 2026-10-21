# Dolores weekend picnic — gtasf-gdzt

PLAN B09 calls for Dolores Park on weekends. The local candidate adds an original
picnic on the east lawn, south of the central promenade: two checked blankets,
a cooler, a tote and at most four existing animated park friends (two on low).
The `doloresWeekend` switch stays **false** until mounted local acceptance.

## References reviewed before modelling

Downloaded to ignored `artifacts/dolores-weekend/references/` and personally viewed
on October 3, 2026. These are visual references, never shipped textures.

| Source | Viewpoint and observations used |
| --- | --- |
| [SF Recreation and Parks: Dolores Park](https://sfrecpark.org/800/Dolores-Park), [photo](https://sfrecpark.org/ImageRepository/Document?documentID=3362) | Across the northern field toward Mission High: broad green lawn, low pale path, palms much taller than visitors. Preserve the open ground and clear circulation. |
| [Hamilton + Aitken Architects](https://haarchs.com/dolores-park), [photo](https://images.squarespace-cdn.com/content/v1/557cd10ae4b0c0319fa8f8bd/1530475418366-VJYCL5R4Z5T8X9T0TOE7/Dolores%2Bext_45.jpg) | East entrance looking uphill: wide central promenade, stairs/ramps, lawns on either side. Keep the picnic south of the promenade, away from the approach. |
| [UC Berkeley Extension, Hannah Boettge photo](https://voices.berkeley.edu/international/do-more-just-study-berkeley-global), [photo](https://voices.berkeley.edu/sites/default/files/2024-12/Hannah-Boettge_DoloresSF_700w.jpg) | Upper lawn toward the skyline: separate small groups on colourful low blankets; portable bags and coolers; green space between clusters. This supplies the picnic proportions and muted teal/ochre/cream palette. |

The [city picnic page](https://sfrecpark.org/814/Dolores-Park-Picnic-Areas) describes
the weekend picnic use and asks visitors to pack out their belongings. The small
fictional gathering uses cans, a tote and portable cooler. This change does not
rebuild the park, its monument, paths or surrounding buildings.

## Placement and lifecycle

The anchor is WGS84 **37.7595, -122.4264**, converted with the map's canonical
`geodeticToWorld`/`SF_FRAME`; it has no hand-copied landmark transform. The initial
packed-graph probe at `artifacts/dolores-weekend/placement.json` found the nearest
surface lane 35.30 m away and no building intersection within 4 m. Full picnic
footprint and physical approach remain part of mounted acceptance.

The wider emitted-map baseline at 14:10 UTC found that the entire 8×8 m envelope
clears all surface highway ribbons by at least 22.22 m, including footways,
cycleways and busways, and intersects no building. However, 289 ground samples
showed up to **33.08 cm** difference between the heightfield contact and visible
terrain triangles at both LODs; even the centre differs by 17.72 cm. The baseline
at `artifacts/dolores-weekend/placement-full.json` therefore **failed**. The scene
stays off pending a corrected site or consistent visible/contact ground and
fresh acceptance. A lane-only clearance result does not resolve this mismatch.

The factory checks its switch and template, takes the composed movement surface
and a separate raw map-loaded predicate, and mounts directly into the scene.
Blankets conform to sampled ground; props and each character use their own ground
height. The root culls at 110 m (65 m on low) and on missing/nonfinite ground.
Cloth resampling is bounded to one near-ground refresh per two seconds. The
America/Los_Angeles weekend result is cached by epoch minute; weekdays hide both
the scenery and Game options section. Nearby friends use existing park chatter.
There is no event attendance, player identity, reward, provider or network packet.

Integration: `createDoloresWeekend` receives `enabled`, `template`, `ground`,
`isLoaded`, `low`, `parent`, `now`, `onDestination` and `onNotice`. Add `root` to the
scene, call `update(foot, dt)` after composed-ground updates, and call `dispose()`
before disposing the avatar template. `now` should read the normal server clock
with a local clock fallback. Directions use the existing city destination flow.
Disposal releases only the picnic's geometry/materials and its avatar instances.

## Acceptance status

Web/shared strict TypeScript passed October 3 at 13:26 UTC. The focused actual
clock check passed SF Friday/Saturday and Sunday/Monday boundaries, the repeated
DST hour, invalid timestamps and the disabled factory's no-resource path; receipt
`artifacts/dolores-weekend/calendar.json`.

The actual-module DOM lifecycle smoke passed at 14:00 UTC with the shipped avatar
rig and an explicit fixture clock/ground. `tools/dolores-weekend-lifecycle-smoke.mjs`
checks SF Friday/Saturday and Sunday/Monday transitions, the real directions
button and stale weekday click, the repeated DST hour, unloaded/invalid ground,
range culling, collision hiding and recovery. It also checks that 120 unchanged
weekend frames produce no DOM attribute mutations and repeated disposal removes
the picnic and controls without disposing shared player geometry. Receipt:
`artifacts/dolores-weekend/lifecycle/report.json`; errors were empty and browser
and preview cleanup completed. This fixture uses no GPU or game state overrides.

Pane 1 integrated the disabled factory in `aad993e`; the shared common 1410
bundle passed with the switch still false. Real directions/walking, elapsed-time animation and personally
reviewed desktop/390-pixel phone visuals remain pending. The prepared
`tools/dolores-weekend-smoke.mjs` uses normal public startup, actual Game options,
physical keyboard walking and the ordinary SF clock. This is not production,
real-device, performance, G1 or complete B09 acceptance.
