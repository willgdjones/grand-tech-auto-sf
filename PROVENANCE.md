# BDTS provenance

Source: `~/Documents/million-dollar-times-square`, HEAD `21045ca5ab9094f1d3c8d2cfe45d0a295d7f6ca8`, working-tree snapshot copied 2026-10-02. Source repository left untouched.

GTASF uses an incompatible city-scale wire format (i32 centimetres, u32 player IDs), anonymous world entry, weekly rentals, and an SF ENU frame. Sale-curve, NYC projection/data, permanent resale and fixed 250-player storage are omitted. At the founder's later request, the FIFO lobby patterns were adapted with a configurable 150-player default. Pure geometry, camera, input, image-budget and interpolation utilities are retained.

| GTASF file | BDTS origin |
|---|---|
| `shared/money.ts` | `shared/money.ts` |
| `shared/rect.ts` | `shared/rect.ts` |
| `shared/clock.ts` | `shared/clock.ts` |
| `shared/master.ts` | `shared/master.ts` |
| `shared/protocol/bytes.ts` | `shared/protocol/bytes.ts` |
| `shared/protocol/serial.ts` | `shared/protocol/serial.ts` |
| `shared/protocol/time.ts` | `shared/protocol/time.ts` |
| `web/src/net/clock.ts` | `web/src/net/clock.ts` |
| `web/src/net/correction.ts` | `web/src/net/correction.ts` |
| `web/src/net/remotes.ts` | `web/src/net/remotes.ts` |
| `web/src/net/provisionalClock.ts` | `web/src/net/provisionalClock.ts` |
| `web/src/camera/thirdPerson.ts` | `web/src/camera/thirdPerson.ts` |
| `web/src/camera/config.ts` | `web/src/camera/config.ts` |
| `web/src/camera/cameraState.ts` | `web/src/camera/cameraState.ts` |
| `web/src/input/actions.ts` | `web/src/input/actions.ts` |
| `web/src/input/keyboard.ts` | `web/src/input/keyboard.ts` |
| `web/src/input/cursor.ts` | `web/src/input/cursor.ts` |
| `web/src/input/pointer.ts` | `web/src/input/pointer.ts` |
| `web/src/input/touch/gestures.ts` | `web/src/input/touch/gestures.ts` |
| `web/src/input/touch/joystick.ts` | `web/src/input/touch/joystick.ts` |
| `web/src/render/events.ts` | `web/src/render/events.ts` |
| `web/src/render/sizing.ts` | `web/src/render/sizing.ts` |
| `web/src/perf/memoryLedger.ts` | `web/src/perf/memoryLedger.ts` |
| `web/src/render/screens/dirtyRows.ts` | `web/src/render/screens/dirtyRows.ts` |
| `web/src/render/screens/rowTexture.ts` | `web/src/render/screens/rowTexture.ts` |
| `web/src/render/screens/texel.ts` | `web/src/render/screens/texel.ts` |
| `web/src/render/screens/constants.ts` | `web/src/render/screens/constants.ts` |
| `web/src/render/screens/adTable.ts` | `web/src/render/screens/adTable.ts` |
| `web/src/render/screens/labels.ts` | `web/src/render/screens/labels.ts` |
| `web/src/render/screens/heatTexture.ts` | `web/src/render/screens/heatTexture.ts` |
| `web/src/render/atlas/freeRectAllocator.ts` | `web/src/render/atlas/freeRectAllocator.ts` |
| `web/src/render/atlas/bitmapCache.ts` | `web/src/render/atlas/bitmapCache.ts` |
| `web/src/render/atlas/atlasTexture.ts` | `web/src/render/atlas/atlasTexture.ts` |
| `web/src/render/atlas/uploadScheduler.ts` | `web/src/render/atlas/uploadScheduler.ts` |
| `web/src/render/atlas/stripCanvas.ts` | `web/src/render/atlas/stripCanvas.ts` |
| `web/src/render/atlas/stripExtractor.ts` | `web/src/render/atlas/stripExtractor.ts` |
| `web/src/render/atlas/stripWorker.ts` | `web/src/render/atlas/stripWorker.ts` |
| `web/src/render/atlas/fade.ts` | `web/src/render/atlas/fade.ts` |
| `web/src/buy/crop/recipe.ts` | `web/src/buy/crop/recipe.ts` |
| `web/src/buy/maxFreeRect.ts` | `web/src/buy/maxFreeRect.ts` |
| `worker/src/world/tick.ts` | `worker/src/world/tick.ts` |
| `worker/src/media/resample.ts` | `worker/src/media/resample.ts` |
| `worker/src/media/prescreen/haiku.ts` | `worker/src/media/prescreen/haiku.ts` |
| `worker/src/media/prescreen/prices.ts` | `worker/src/media/prescreen/prices.ts` |
| `worker/src/media/prescreen/prompt.ts` | `worker/src/media/prescreen/prompt.ts` |
| `shared/moderation/prescreenSchema.ts` | `shared/moderation/prescreenSchema.ts` |
| `tools/map/src/geo.ts` | `tools/layout/src/geo.ts` |
| `tools/map/src/glb.ts` | `tools/layout/src/glb.ts` |
| `tools/map/src/canonical.ts` | `tools/layout/src/canonical.ts` |
| `tools/map/src/sort.ts` | `tools/layout/src/sort.ts` |
| `tools/map/src/rng.ts` | `tools/layout/src/rng.ts` |
| `tools/map/src/fetch/osm.ts` | `tools/layout/src/fetch/osm.ts` |
| `tools/map/src/fetch/lock.ts` | `tools/layout/src/fetch/lock.ts` |
| `tools/map/src/mass/mesh.ts` | `tools/layout/src/mass/mesh.ts` |
| `tools/map/src/mass/setbacks.ts` | `tools/layout/src/mass/setbacks.ts` |
| `tools/map/src/mass/types.ts` | `tools/layout/src/mass/types.ts` |
| `tools/map/src/geom/facades.ts` | `tools/layout/src/geom/facades.ts` |
| `tools/map/src/geom/rings.ts` | `tools/layout/src/geom/rings.ts` |
| `tools/map/src/geo/features.ts` | `tools/layout/src/geo/features.ts` |
| `tools/map/src/clip/polygons.ts` | `tools/layout/src/clip/polygons.ts` |

Further adaptations (product-specific wrappers replaced; reusable algorithms above retained):

| GTASF file | BDTS origin |
|---|---|
| `shared/protocol/{types,constants,c2s,s2c,pose}.ts` | `shared/protocol/{types,constants,c2s,s2c}.ts`: bounded binary codec pattern, city coordinates, GTASF v2: resumable nickname handshake; vehicle/robotaxi/event/chat contract, i32 cm/u32 IDs |
| `web/src/net/ws.ts` | `web/src/net/ws.ts`: binary dispatch, reconnect and PONG nonce/echo checking, direct admission |
| `worker/src/world/{WorldDO,movement,snapshot}.ts` | same paths: tick ownership, elapsed movement credit and distance tiers; dynamic peer map |
| `web/src/render/screens/screenMesh.ts` | `web/src/render/{screens/screenMesh,materials/screen}.ts`: atlas UV sampling and low-gain preview material; one board/creative |
| `web/src/buy/{buyFlow,buyFlow.types,preview3d}.ts` | same paths: rental draft/checkout state and shared world preview material; crop recipe retained |
| `worker/src/media/normalize/pipeline.ts` | same path plus `worker/src/media/resample.ts`: capped decoded-image normalization boundary; queue/codecs track E |
| `worker/src/ledger/checkout.ts` | `tools/stripe-spike/src/parameters.ts`: manual-capture Stripe parameter builder (not present as an implemented LedgerDO route in source) |
| `web/src/config.ts` | same path: device rendering and memory budgets |
| `AGENTS.md` | `AGENTS.md` and `docs/planning/feel-checkpoint.md`: scoped checks, reservations and visual lessons, lean process |

Copied support libraries are buildable but are enabled at feature entry points only. No external provider is called by bootstrap; flags and follow-up beads own integrations. Raw OSM/terrain/CC0 asset downloads are not copied from BDTS.

## CC0 character and vehicle assets (gtasf-1h3)

`web/public/assets/` contains adapted Kenney Car Kit 3.1 / Train Kit 1.1 vehicles
and Quaternius's rigged Hoodie Character from Ultimate Modular Men (February
2022), sourced independently of BDTS on 2026-10-03. The avatar's idle/walk/run
animations are Quaternius originals; its seated breathing loop is authored for
GTASF. Bus/cable-car bodies and robotaxi sensors are GTASF additions on Kenney
bases. These assets and additions are CC0 1.0, without manufacturer logos.

On 2026-10-14 (gtasf-laned-cc0-characters-km1i6) eight more CC0 Quaternius Ultimate Modular Men/Women bodies on the
same rig (`avatars/{business-man,casual-man,beach-man,worker-man,punk-man,casual-woman,formal-woman,punk-woman}.glb`)
were added for street pedestrians behind `cc0People`, built by `tools/assets/build-people.mjs` from pinned Poly Pizza
downloads whose listings each read "Public Domain (CC0)"; uploads Poly Pizza marks CC BY were excluded.

On 2026-10-14 (gtasf-laned-meshy-people-lu1vh, founder GO with existing plan credits only) fourteen characters were generated
with Meshy-6 on GTASF's existing paid Meshy plan (SFPD officer, ten pedestrians, three player looks;
`tools/art/meshy-people.mjs`, every task and credit in `tools/art/meshy-ledger.json`, 532 credits, no purchase). Meshy's
terms grant paid-plan users ownership/commercial use of their generations; they are NOT CC0. Rig and idle/walk/run clips
come from Meshy's auto-rig/animation API; `tools/assets/build-meshy-people.mjs` adds a GTASF-authored seated clip, renames
key bones to the hoodie rig's names and writes `web/public/assets/avatars/meshy-*.glb` (flag `meshyPeople`).

See `web/public/assets/LICENSES.md` for creator links and per-model adaptations,
`tools/assets/sources.json` for download checksums, and `tools/assets/report.json`
for output checksums/sizes. The single-process reproducible pipeline applies
glTF Transform deduplication, quantization and meshopt compression; no BDTS art,
NYC data or third-party animation service is included.


## WebStarter input and harness port (gtasf-h6m)

Source: the user's own private `~/Documents/factory-core/templates/WebStarter`, repository HEAD `66808741b9532480faf5a3f18e0e28872a5c5279`, read 2026-10-02. This reuse is explicitly authorized by the owner. Only the following code and patterns were adapted:

| GTASF destination | WebStarter source and adaptation |
|---|---|
| `web/src/input/input.ts` | `src/input/input.js`: per-frame keyboard/pointer/gamepad/touch merge, edge-triggered actions, virtual input; ported to strict TypeScript with GTASF driving actions, lifecycle cleanup, existing Actions API and pointer-lock fallback |
| `web/src/input/touch.ts` | `src/input/touch.js`: stick, buttons, separate look drag; typed Pointer Events, multi-touch cancellation and GTASF controls |
| `web/src/testing/{core,scenarios}.ts`, `web/tests/*.spec.ts` | `src/factory/core.js`: readiness markers, scenario/clock/frame-loop pattern and real frame intervals; GTASF result/error markers and exact phone budget checks are new |
| `AGENTS.md` | User-requested load budgets and no-placeholder visual checklist; no broader factory process adopted |

No art, audio, Pokémon-named assets, other template systems, or vendored three.js files were copied. GTASF continues using its existing npm three.js dependency; the source template's vendored three.js is MIT. Source repository left untouched.

## Other GTASF additions recorded at coordinated handoff

F13/F14 `shared/analytics.ts`, `web/src/analytics/` and `worker/src/analytics/` adapt the first-party, allowlisted PostHog design in BDTS `docs/planning/MASTER_PLAN.md` §13.3.3 and collector body shape in `worker/test/fakes/posthog.ts`. BDTS had no implemented production collector to copy. GTASF's event taxonomy, bounded UTM/X attribution, configurable EU-default ingestion host and X conversion hooks are new. No BDTS credentials, project IDs or data are reused. Provider protocol references are in `docs/gtm/analytics.md`.

D01 `WorldSessions`, nickname/field helpers, client recovery and their tests are original GTASF additions; existing BDTS mappings describe the retained patterns. See `shared/protocol/README.md`.

Admission (`gtasf-nhw`): `worker/src/world/admission/orderStats.ts` and `mutex.ts` copy BDTS `worker/src/lobby/{orderStats,mutex}.ts`. `LobbyDO.ts` and `admission/reservations.ts` adapt BDTS `BDTSLobbyDO` FIFO and reserve→grant→HELLO patterns to SQLite tickets and anonymous World sessions. GTASF's input activity message, signed invite cookie, launch/signup UI and D1 waitlist capture are new; no BDTS tokens, user data or resources are reused.

Outbid (`gtasf-wqd.2`): `worker/src/outbid/reservedIp.ts` copies BDTS `shared/net/reservedIp.ts`; `linkcheck.ts` adapts its bounded-reader, DNS and manual-redirect patterns; `stripe.ts` adapts Checkout metadata/idempotency parameters. The cumulative ledger, moderation, routes and UI are original GTASF additions. No BDTS keys or resources are reused.

The shared/content billboard candidates, radio scripts and flavour text are original GTASF parody. Billboard street anchors use DataSF Streets (`https://data.sf.gov/d/3psu-pn9h`, PDDL 1.0: `https://opendatacommons.org/licenses/pddl/1.0/`); Bay Bridge toll-area positions are manually approximated. They are game placement candidates, not a surveyed physical-sign inventory. Source details are recorded in `shared/content/billboards.ts` by its author.

## Procedural SF landmarks (gtasf-lxb)

`web/src/render/landmarks/` contains original GTASF three.js geometry, vector clock/sign detail and vertex colours. No BDTS landmark, texture, font atlas or reference photograph is copied into the models. Each landmark was studied from 3–5 real photographs before modelling; source links and interpretation notes are in `web/src/render/landmarks/REFERENCES.md`.

`lombardSource.ts` retains coordinate samples from OpenStreetMap way 402111597 (© OpenStreetMap contributors, ODbL 1.0, https://www.openstreetmap.org/copyright), from the map pipeline's cached extract SHA256 `da74fbb88a3fcbc9fe33f25854809271bd6597b26ce71293a736eaaf883633d0`. This real centreline keeps planting clear of the streamed road; it does not replace the city road mesh. The workshop driving view reuses the independently sourced Kenney hybrid hatchback and GTASF driving controller documented above.

X measurement (`gtasf-bkh`): `web/index.html` retains X's official base snippet from https://help.x.com/en/business-and-advertising/conversion-tracking-for-websites, enclosed in GTASF's once-only consent callback. The consent UI, persistent attribution, optional protocol messages and server Conversion API adapter are original GTASF code based on https://docs.x.com/x-ads-api/measurement/web-conversions. Only GTASF's founder-supplied public pixel/event IDs appear in source; provider credentials remain environment-only.

## Original street and parody artwork (gtasf-8yq, gtasf-6ps)

`web/src/render/props/` is original GTASF instanced geometry, road-derived placement and sagging wire code. `web/public/art/{props,foliage,billboards}/` contains selected Scenario-generated textures and illustrations made from original text prompts. No GTA screenshot, real reference photograph, real company logo or real person was provided as a generation input. The fictional shop signs and six startup advertisements are original parody copy. Missing billboard headlines/taglines were composed locally over the selected generated illustration; trees and chain-link fence received explicit alpha masks.

Recipes and the shared generation/cost ledger are in `tools/art/`. The per-directory manifests record selected generation IDs, source hashes and emitted hashes/sizes. Rejected drafts and full source masters are archived outside the public payload. Packed props are 1024x512, signs 512x512, billboards 1024x768 and individual foliage textures 256x256; all stay below the 1MP decoded image cap. This record does not assert a third-party CC0 licence for generated artwork.

## Original facade, loading and ground artwork (gtasf-z0n, gtasf-i2g, gtasf-7ie)

`web/public/art/{facades,loading,ground}/` contains original text-prompted Scenario
artwork. The eight-cell facade atlas uses seven selected Flux Schnell sources;
the inked loading/title images depict fictional characters against SF landmarks.
Ground sources use Flux 1.1 Pro and become seven 256x256, 32-colour tiles totalling
138,870 bytes. `tools/art/recipes/`, `tools/art/ledger.json` and
`web/public/art/manifest.json` retain the prompts, selected generation IDs, source
hashes, exact crops, output hashes and measured provider credit costs. The ledger
also counts rejected candidates. Generated artwork is not represented as CC0.

## Graphics v2 facade elevation atlas (graphicsV2, docs/engineering/facade-atlas.md)

`web/public/art/facades/{vic,edw,shop,office}.webp`, their `-mask.webp` companions and
`atlas.json` are ORIGINAL front elevations text-prompted with fal `fal-ai/flux/dev`
(`tools/art/facade-atlas.mjs`: prompts, seeds and sizes), then auto-cropped, annotated
(windows, tint mask, base colour) and packed by `tools/art/pack-facade-atlas.mjs`. No
third-party images or files from other projects were used. Every paid call is in
`tools/art/ledger.json`. Generated artwork is not represented as CC0.

The original white-dash tile was cropped to exclude an erroneous crossing stripe;
the first crosswalk candidate and the doubled-dash candidate were rejected.
Ground masters and rejected drafts live only in ignored local review storage.
Runtime tiles are reduced, desaturated, edge-paired and palette-limited by
`tools/art/prepare-ground.ts`. Facades have copied gutters and declared UV cells;
loading images use optimized WebP derivatives.

No Rockstar image, real person or real company logo was supplied to Scenario.
The copyrighted SA reference screenshots remain ignored and are used only for
local visual comparison. Sky/cloud geometry and shaders, SF clock palettes,
haze, grading and the sky-only bloom mask are original GTASF code; no generated
or third-party sky bitmap is shipped.

`web/public/art/road-details.json` is derived from the current OpenStreetMap and
terrain sources in the map bake. Its attribution and source hashes are embedded;
`tools/map/ROAD-DETAILS.md` documents the exact-source centreline, gauge, crossing
and height export. Road paint, inferred decorative sidewalk shoulders and small
kerbs are original runtime styling. They do not replace source road geometry,
terrain contact, routing or collision.

## Realistic procedural facades (gtasf-2rup)

Under `realisticRender` + `realisticFacades` (founder 2026-10-04 BUILDINGS direction),
`web/src/render/realisticFacades.ts` injects a MeshStandard PBR facade shader onto
source building walls, applied **procedurally from the baked map footprints** by
district and land-use — no hand-made building models. It samples a manifest-driven
albedo/normal/ARM atlas in world metres (so adjacent chunks share a pattern, roofs
are excluded), perturbs the normal, drives roughness/metalness/AO for glass curtain
walls vs. masonry, and adds procedural window frames/sills and a ground-floor
storefront band that follows the sourced terrain height.

The atlas is **manifest-driven and source-agnostic** (`web/public/art/facades-pbr/manifest.json`):
- **Scenario texture modules** (the shipped atlas): twelve realistic albedo modules
  (SoMa brick, FiDi stone, stucco, Victorian clapboard, glass curtain wall, concrete,
  storefront, painted brick, Mission mural, + civic granite / Marina stucco / Pacific-Heights
  clapboard 2nd variants) generated with Scenario's hosted **FLUX.1 Dev** 2D model
  from the text prompts in `tools/art/recipes/facades-pbr.json` (via the budget-guarded
  `tools/art/cli.ts`). FLUX outputs diffuse only, so the normal and ARM
  (AO/roughness/metalness) maps are **derived deterministically** from each albedo by
  `tools/art/pack-facades-pbr.mjs` — no extra credits. No Rockstar image, real person,
  real company logo or real storefront sign/text was supplied to Scenario; prompts
  describe generic SF building types with **no text in images**. Generated artwork is
  **not** represented as CC0; every prompt, generation ID, seed, output hash and credit
  cost is recorded in `tools/art/ledger.json` and the manifest (`source` per cell).
  The raw 768² source modules live in gitignored `web/public/art/facades-pbr/src/`;
  only the packed atlas ships.
- **CC0 base** (optional extra, not shipped): four Poly Haven CC0 scans packed by
  `tools/art/realistic-facades.mjs` — see `web/public/assets/LICENSES.md`. Genuinely CC0;
  run that tool to rebuild the atlas from CC0 instead of Scenario.

A few AI-3D facade pieces (bay windows, cornices, awnings, fire escapes, storefront
fronts) are generated via Meshy on GTASF's paid plan (`tools/art/meshy-ledger.json`,
budget coordinated with the cars pane); see `docs/art/asset-purchases.md` and the
Realistic Meshy section below. The ps2 `facades.ts` path and its atlas are untouched;
the realistic path is OFF until pane 6's in-browser + phone-low visual/perf acceptance.

## Realistic Meshy vehicle fleet and facade pieces (gtasf-u9n0, gtasf-realistic-facade-meshy-pieces-xyrw)

The realistic-renderer vehicle fleet and facade hero pieces are **GTASF-commissioned AI-3D
models** generated with Meshy 6 text-to-3D (PBR) on GTASF's paid plan — commercial-use output,
not CC0, fully described in `web/public/assets/LICENSES.md`. No Rockstar asset, real brand, logo,
text or reference image is used as input; prompts describe generic shapes only (the robotaxi is a
parody sensor-dome crossover with no Waymo or Jaguar marks).

- **Vehicles** (`web/public/assets/vehicles-pbr/`, gtasf-u9n0): robotaxi, sedan, hatchback, SUV,
  van, cab, Muni bus, Powell cable car, VC supercar + food-truck/scooter props — HD + phone-Low
  LODs, loaded by asset id under `flags.realisticRender` (`web/src/vehicles/models/vehicle.ts`).
- **Facade pieces** (`web/public/assets/facades-pbr/`): bay window, fire escape, cornice, awning,
  storefront, ornate entrance, wrought-iron balcony. Ground-floor storefront/entrance are instanced
  per chunk (`web/src/render/props/facadeStorefronts.ts`, behind `flags.storefrontPieces`); the
  procedural-equivalent pieces move into `buildingDetail` under gtasf-facade-meshy-buildingdetail-swap-13c6.
- **Pipeline**: `tools/art/meshy.mjs` / `tools/art/meshy-facade-pieces.mjs` generate (shared
  `tools/art/meshy-ledger.json`, 1,500-credit budget guard) → `tools/assets/build-meshy.mjs` /
  `build-facade-pieces.mjs` normalise (Y-up/metre/ground, HD+Low LODs, <=1 MP WebP PBR, meshopt) →
  manifests `web/src/assets/realisticVehicles.ts` / `realisticFacadePieces.ts` (+ report JSONs).
  Every prompt, Meshy task id, credit cost and output hash is recorded in the ledger. The realistic
  path is OFF until pane 6's in-browser + phone-low visual/perf acceptance.

## Character and vehicle polish (gtasf-xsfw)

The existing CC0 Quaternius hoodie and Kenney vehicle geometry retain their
original source licences listed above and in `web/public/assets/LICENSES.md`.
GTASF adds four clothing palettes, flat diffuse shading, adult proportions,
wheel-reaching arms derived from the authored sitting animation, inexpensive
soft contact cards and rectangular bumper/grille trim. No GTA character, vehicle,
texture or reference image is copied or used as a generation input.

`web/public/art/vehicles/` contains original text-prompted Scenario paint and
silver material textures. `tools/art/recipes/vehicles.json`, the guarded shared
cost ledger, and the per-directory manifest record prompts, actual provider
costs, selected candidates, hashes and dimensions. These generated materials are
not described as CC0. Rejected candidate images stay outside the public payload.

## Local chat moderation (gtasf-8kbq.1)

`shared/chat` normalization/confusables/Unicode tables and the Worker local
blocklist adapt the corresponding `million-dollar-times-square` source. Unicode
16 data retains `shared/chat/UNICODE-LICENSE.txt`. Local English profanity
additions, WorldChat membership/rate handling and the client interface are
original GTASF code. No credentials, user data or provider accounts were copied.
The precise source mapping and local/provider moderation split are documented
in `docs/chat.md`.

## Three-line cable transit (gtasf-sxoh)

`shared/transit/cableRoutes.ts` is derived from OpenStreetMap directional route
relations 1959009, 3433158, 1959010, 3433157, 2852264 and 2852265 (ODbL,
© OpenStreetMap contributors), fetched October 3, 2026. Named stop nodes and
complete relation geometry are cached and hashed by
`tools/transit/prepare-cable-routes.ts`; the generated file embeds the hashes.
Elevation uses the same public AWS Terrain Tiles/Terrarium source and projection
as the city map, including four additional verified tiles for the southern
terminals. Official SFMTA Powell–Hyde, Powell–Mason and California route pages
were used to cross-check the directional streets; links are in
`docs/world-systems.md`. Timetables, boarding logic and transit UI are original
GTASF gameplay code, not SFMTA live-service predictions. The cable-car model
retains its previously recorded asset attribution.

## Original city radio loops (gtasf-8kbq.2)

`web/public/audio/radio/` contains three original synthesized instrumental loops:
Seed Round Shuffle (KVC), Soft Launch Afternoon (Lo-fi Hayes Valley), and Next
Train in Two (BART Delays FM). They use no third-party samples, voices or lyrics.
The reproducible source `tools/audio/build-radio.py` and all three loops carry
the CC0 1.0 dedication shipped in that directory. The original DJ scripts remain
in `shared/content/radio.ts`; no TTS provider was called. The three lazy MP3
assets total 469,383 bytes. See `docs/radio.md` for the track and playback details.

## Sea lions and city hazards (gtasf-8kbq.3)

The articulated Pier 39 sea lions extend the original procedural colony using
the five previously recorded photographs in `web/src/render/landmarks/REFERENCES.md`.
Reference images remain outside the shipped payload. The warm-brown animals,
whiskers, cones, banner structures and 512×256 text canvases are original GTASF
geometry and lettering. Muni notices are fictional, using the shared flavour
copy. The coned robotaxi reuses the existing Kenney-derived robotaxi template
and its separately attributed vehicle materials. No new third-party media,
voice or external service was used. Placement and verification are documented
in `docs/city-life.md`.

## SF sun and weather (gtasf-wz9g)

The client uses unmodified npm `suncalc@2.1.0`, copyright 2026 Volodymyr
Agafonkin, under BSD-2-Clause. The complete licence is shipped at
`web/public/art/licenses/SunCalc-BSD-2-Clause.txt`; source:
https://github.com/mourner/suncalc. GTASF converts its degree-based solar
coordinates into the existing east/up/south world axes.

Public weather measurements come from the US National Weather Service API:
https://api.weather.gov/points/37.7842,-122.4078 and
https://api.weather.gov/stations/KSFO/observations/latest. The point response
selects the SF hourly forecast endpoint. Raw source readings are kept separate
from original GTASF fog/cloud styling; KSFO weather is a regional proxy, not
a claim to measure every SF neighbourhood. No weather bitmap, provider key,
paid endpoint or third-party shader is included. See `docs/art/weather.md`.

## Ferry plaza courier (gtasf-kr8v)

`web/src/render/deliveryRobot.ts` is original GTASF procedural geometry: a
six-wheel parked courier, chamfered cargo shell, painted seams, vents, bumpers,
reflectors and safety pennant. The fictional SOUP pickup label is original
256×128 sRGB canvas lettering (0.033 MP), using the browser system font. No
brand, source photograph, downloaded model, provider or third-party image is
included. The existing shared delivery-robot flavour record supplies the
nearby joke; placement, collision ownership and pending acceptance are in
`docs/delivery-robot.md`.

## Ferry coffee queue (gtasf-1blk)

`web/src/render/coffeeQueueModels.ts` is original GTASF geometry and lettering:
the fictional Blue Pitch coffee cart has painted slats, a striped canopy, an
espresso machine and cups. Its only texture is a 512×256 sRGB canvas sign
(0.131 MP), using the browser system font. No real brand, photograph, downloaded
model, provider or third-party image is included. Queue characters reuse the
CC0 Quaternius hoodie and existing GTASF outfits documented above; their idle
and walk animations retain that asset's attribution. Local queue placement,
yielding and coffee-regular parody lines are original GTASF work. Integration
and acceptance evidence are tracked in `docs/coffee-queue.md`.

## Dolores weekend picnic (gtasf-gdzt)

`web/src/render/doloresWeekendModels.ts` contains original GTASF procedural
blankets, a cooler, a tote and drink cans. Colours are stored as linear vertex
colours; there are no new textures, downloads or provider calls at runtime.
The park friends reuse the existing CC0 Quaternius rig, GTASF outfits and idle
animation documented above. Three real park photographs were reviewed before
modelling as visual references only; their URLs and observations are recorded
in `docs/dolores-weekend.md`. No photograph is shipped or committed.

## SA map shoreline (gtasf-xj9z)

`tools/map/src/pipeline/coastline.ts` derives simplified water rings from the
existing pinned OpenStreetMap `natural=coastline` ways, in the shared SF metre
frame. Original GTASF clipping/stitching uses the existing polygon Boolean and
ring simplification utilities. Boundary closure occurs only along the map's
rectangular crop; missing interior ways fail rather than inventing a shoreline.
Island rings remain holes. Source digest, tolerance and way count accompany the
generated asset; existing © OpenStreetMap contributors / ODbL attribution applies.
There are no new downloads or third-party images. Reproduction and checks are in
`tools/map/COASTLINE.md`.

## Lombard hydrangea garden textures (gtasf-t06j, gtasf-sqi3)

`web/src/render/landmarks/lombardFlowerTextures.ts` paints original GTASF leaf,
four-petal floret, clipped hedge and mulch maps at runtime, deterministically.
`lombardFlowers.ts` instances original card/bed geometry around the already sourced
OSM Lombard centreline. Two bundled 512×512 botanical alpha cards now replace the
painted leaf/floret maps after loading, preserving the painted fallback. These
were generated using fal.ai `fal-ai/flux/dev`, with background removal using
`fal-ai/bria/background/remove`, through the budgeted `tools/art/fal.mjs` wrapper.
Prompts, seeds, job IDs, runtime hashes and $0.40 total conservative reservations
are recorded in `tools/art/prompts/lombard-fal.json`; this amount is not an invoice.
The lossless runtime WebP assets total 372,454 bytes. No third-party photograph
was supplied to generation or included in the runtime assets.
Four runtime maps total 606,208 decoded pixels. Three real reference photographs, viewed
before modelling and used only for proportions/colour/plant structure, are linked
in `web/src/render/landmarks/LOMBARD-FLOWERS.md`. Existing OSM attribution applies.

## HD urban surface atlas (gtasf-r60c)

`web/public/art/urban-surfaces.webp` contains six original generated material
swatches: concrete pavement, granite plaza pavers, asphalt repair, worn parking
tarmac, compact gravel and concrete kerb. `tools/art/prompts/urban-surfaces.json`
records the final prompts and seeds; `tools/art/urban-surfaces.mjs` reproduces
the budgeted generation and offline periodic-edge/gutter packing. No third-party
image was used as an input. Sources were generated at 480×480 with fal.ai
[FLUX.1 dev](https://fal.ai/models/fal-ai/flux/dev), then upscaled 2× with
[Clarity](https://fal.ai/models/fal-ai/clarity-upscaler) at low creativity.
Each cached master is 960×960 (921,600 pixels). The runtime atlas is
1152×768 (884,736 pixels; 3,538,944 decoded RGBA bytes), 164,642 bytes
compressed WebP, SHA-256 `472f62ba17d53a25e02a38ef41902418646746a86a3198cc49621338c6e6c506`. Each cell has an 8px wrapped gutter.

The first six candidates contained unwanted markings/objects and were rejected
at image inspection; their costs remain counted. Twenty-four total ground calls
reserved $2.40 conservatively, including that rejected set, not an invoice.
All provider job IDs, hashes and estimated reservations are in
`tools/art/ledger.json`. Ignored originals remain under `tools/assets/cache/fal/`.

`hdUrbanSurfaces` plus `groundTextures` and the HD preset load the single atlas
asynchronously; missing/offline art retains the source palette. Low downloads no
new atlas. Existing terrain geometry and semantic district urban colours select
pavement/plaza/industrial ground; mapped park, scrub, sand and water colours are
untouched. Road hooks retain Lombard brick and night lighting. The existing
OSM ground classification is unchanged: these are authored material treatments,
not a new survey of plaza/parking-lot boundaries. In-game candidate review remains
with the deployment/browser lane; image review and unit checks are not a visual gate.

## Original genre radio (gtasf-jwxu, 2026-10-04)

- `web/public/audio/radio/*-track-*.mp3`: 20 original instrumental tracks generated
  with `fal-ai/ace-step`, 120 seconds each, from genre/instrument briefs only.
  No supplied recordings, real artist references, melodies, or voice clones.
  [fal commercial-use listing](https://fal.ai/models/fal-ai/ace-step);
  [ACE-Step Apache-2.0 model licence](https://github.com/ace-step/ACE-Step/blob/main/LICENSE).
- `*-dj-*.mp3`, `ad-*.mp3`, `talk-*.mp3` in that directory: 24 station/DJ bits,
  six fictional ads and four original VC call-in/podcast satire segments;
  `fal-ai/kokoro/american-english`, stock synthetic voices, original GTASF copy.
  [fal commercial-use listing](https://fal.ai/models/fal-ai/kokoro/american-english);
  [Kokoro Apache-2.0 model card](https://huggingface.co/hexgrad/Kokoro-82M).
- Generated outputs' commercial-use basis is the fal model/service permission;
  the model licence is not presented as an automatic output licence. Full asset
  scope and legacy CC0 distinction: `web/public/audio/radio/LICENSE.txt`.
- Reproducible briefs, scripts, requests, encoder and size inventory:
  `tools/art/radio/`. Pricing was checked before calls; initial conservative
  reservation $1.45, task ceiling $15 and shared ceiling $30. The shared fal ledger
  records reservations, not invoices. Raw WAVs stay in ignored asset cache.
- Final format: 64 kbps MP3; assets are assigned only when a station plays, never
  requested as part of initial city loading. The three previous CC0 synth loops
  remain the `radioStations=false` fallback.
# Graphics v2 Low urban atlas derivative

`web/public/art/urban-surfaces-low.webp` is an offline 576×384 derivative of the
fal-generated urban atlas from `4b7b660`; original generation provenance below
still applies. `node tools/art/urban-surfaces-low.mjs` reproduces the derivative
using Lanczos resampling and WebP quality 80. No additional generation or API use.
Encoded size: 36,162 bytes; decoded RGBA: 884,736 bytes (0.221 MP).
# Graphics v2 HD foliage derivatives

`web/public/art/foliage/{palm,plane,cypress}-hd.webp` reuse the selected Scenario
masters (`palm-1`, `plane-2`, `cypress-1`) already recorded in the street-prop
manifest/ledger. Offline recipe: `node tools/art/foliage-hd.mjs`; same chroma key
and muted palette, smooth 512×512 RGBA instead of the legacy 256px palette PNGs.
No new generated art or external inputs. Each is 0.262 MP / 1,048,576 decoded
RGBA bytes; encoded bytes are 54,590 / 68,704 / 62,492 respectively.

## Google 3D Tiles prototype (gtasf-eltv)

- `3d-tiles-renderer` pinned to **0.5.3**, NASA-AMMOS/3DTilesRendererJS, Apache-2.0: https://github.com/NASA-AMMOS/3DTilesRendererJS . Installed as an npm dependency; no third-party project artwork or sample assets are copied.
- Draco decoding uses the decoder distributed with our pinned Three.js dependency (Apache-2.0), bundled locally by Vite.
- Google Photorealistic 3D Tiles are an explicitly founder-approved, separately licensed streamed basemap, **not CC0 or repository assets**. Fetched directly by the browser only with `graphicsV2`, `googleTiles`, and a build-time Google Maps key. No tile downloads, mirrored assets, offline cache, or collision extraction are shipped. The renderer reports per-visible-tile provider attribution; the UI displays that alongside Google Maps. https://developers.google.com/maps/documentation/tile/policies
- All game models, collision and overlays remain our existing independent sources. No Google content is used to generate our facade atlas or other assets.

## CC0 metric surface tiles (gtasf-odsu)

`web/public/art/surfaces/` contains Poly Haven **CC0-1.0** assets: `asphalt_02`,
`concrete_pavement`, `concrete_pavers`, `grey_roof_01`, `white_stucco`, `red_brick`,
`weathered_plank_siding`, and `concrete_wall_001`. Licence: https://polyhaven.com/license .
The manifest records source download URLs, authors, source/output SHA256 hashes and
original measured metre scales. `tools/art/surface-materials.mjs` verifies source MD5s,
then packs 1k diffuse/OpenGL +Y normal/roughness sources into separate 512px WebP maps
(1,315,004 bytes total). Source cache stays outside the public payload. HD graphicsV2
roofs consume the roof set; the lazy shared material API supplies facade/ground consumers.
No third-party game or SF project files were used. This adds no production flag enablement.

## SF tree impostor atlas and front-yard greenery (gtasf-rswq)

`web/public/art/foliage/sf-trees.webp` is an original generated-art atlas, not CC0:
768×768 pixels, 193,124 encoded bytes. Palm, plane and cypress reuse our selected
Scenario masters documented above. Eucalyptus, Monterey pine and ficus are new
text-only `fal-ai/flux/dev` generations through the capped `tools/art/fal.mjs`
ledger ($0.30 total conservative reserved estimate, not an invoice). Generation
IDs and source SHA256s are in `sf-trees.json`; complete original prompts and
reproducible chroma key, despill, crop and pack steps are in `tools/art/sf-trees.mjs`.
No reference photo or third-party game asset was supplied. Species width/height
in metres are authored plausible mature street-tree dimensions, not surveyed trees.
The runtime crops separate species mip chains and renders ground-based crossed
cards in HD graphicsV2 only. Front-yard tubs reuse our original terracotta/soil/
shrub geometry and require clear ground beside a residential frontage.

## Metric front-atlas mapping derivatives (gtasf-sikj)

The eight original fal facade sheets now contain 119 elevations across vic, edw,
shop, office, mix, brk, apt and tower. The existing packer scales whole sheets
to at most 1,000,000 pixels before compositing, with even cell boundaries and
half-resolution tint/window masks. All sixteen WebPs total 2,089,352 encoded
bytes; each colour sheet decodes to at most 4,000,000 RGBA bytes. No new art
was generated or fetched for this repack. Victorian/Edwardian bay envelopes
were outlined against the cropped contact sheets; their 0.6 m / 0.45 m depths
are authored approximations, not survey data. Recheck envelopes when replacing
the source art or crop. Physical front sizes retain the generator metadata.

## takram three-geospatial atmosphere (graphicsV2 phase 2, item 6)

`@takram/three-atmosphere` and `@takram/three-geospatial` (MIT, Takram,
https://github.com/takram-design-engineering/three-geospatial) are used as npm libraries by
`web/src/render/sky/atmosphereSky.ts` (HD-only, lazy-loaded) for the physically based sky.

### Graphics v2 phase 2: lamp projection (2026-10-04)
- `web/src/render/lampLightMap.ts` adapts the top-down, max-blended lamp footprint and height-rejection technique from https://github.com/jeantimex/tokyo/blob/main/src/world/lamplight.js, Copyright (c) 2026 Yong Su, MIT. Full permission notice ships at `web/public/licenses/tokyo-MIT.txt`.
- `web/src/render/waterMirror.ts` adapts the planar mirror (mirrored camera, oblique clipping, rippled Fresnel) from https://github.com/jeantimex/tokyo/blob/c584f00df3d8c093dfe8a819d4459c66da67a601/src/world/mirror.js, Copyright (c) 2026 Yong Su, MIT. Full notice at `web/public/licenses/tokyo-MIT.txt`; gated by `graphicsV2` on HD only.
- GTASF implementation uses a dedicated bounded instanced pass (Low 256px/192 sources/10Hz; HD 512px/384 sources/20Hz), relative height encoding, local composed material hooks, existing generated street-lamp positions and live vehicle transforms. No Tokyo imagery, map data, or runtime assets are included.

### Phase 2 terrain draping (partial integration, gtasf-kv7r)

`shared/terrainDrape.ts` adapts convex half-plane clipping and world-grid triangle splitting from [jeantimex/tokyo `src/world/drape.js`](https://github.com/jeantimex/tokyo/blob/main/src/world/drape.js), Copyright (c) 2026 Yong Su, MIT. The full notice is retained in `docs/licenses/jeantimex-tokyo-MIT.txt`; the web distribution also includes `web/public/licenses/tokyo-MIT.txt`. GTASF changes use XYZ coordinates, preserve typed UV attributes, project onto actual decoded surface planes and keep caches scoped to a build. No Tokyo city data or imagery is included. Runtime entry points require `graphicsV2`; the road-detail caller remains unwired pending the clearance check and streaming integration.

## Graphics V2 open-data map inputs (gtasf-21w4)
- USGS 3DEP bare-earth DEM via elevation.nationalmap.gov 3DEPElevation ImageServer (US public domain); opt-in `MAP_DEM=3dep`, Terrarium fallback for no-data. `tools/map/src/pipeline/dem3dep.ts`.
- USDA NAIP aerial imagery via imagery.nationalmap.gov USGSNAIPImagery ImageServer (US public domain); per-chunk JPEGs from `tools/map/src/pipeline/aerial.ts`, cached with source hashes.

## Real SF street trees and USGS 3DEP terrain (gtasf-umar, gtasf-bhft)

- **Street trees:** DataSF Street Tree List (`https://data.sf.gov/d/tkzw-k3nq`), Public Domain Dedication and License
  (PDDL 1.0: `https://opendatacommons.org/licenses/pddl/1.0/`), San Francisco Public Works; snapshot data_as_of
  2026-09-30 to 2026-10-06. `tools/map/street-trees.mts` converts every record with plant type 'Tree' and valid
  coordinates (138,723 of 144,466) into `web/public/art/trees/street-trees.bin` (positions in the SF world frame, a
  genus-level shape class onto the existing foliage billboards, and a size class from the recorded DBH). Species names
  are not shipped. Summary and counts: `web/public/art/trees/street-trees.json`.
- **Terrain:** USGS 3D Elevation Program (3DEP) bare-earth DEM via the National Map ImageServer
  (`https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer`), U.S. public domain; NAVD88
  metres. Opt-in for map bakes with `MAP_DEM=3dep` (`tools/map/src/pipeline/dem3dep.ts`); Terrarium remains the
  fallback for no-data pixels.

## Living map places (gtasf-jcxw)

- **Curated places** (`tools/places/curated.json`): 48 real SF tech companies, labs, hacker houses/coworking, accelerators and VCs, agent-drafted from public knowledge (names, public office addresses, websites, one-line descriptive blurbs). Real names are used descriptively; logos (when added) are fetched from each organisation's own site. **Takedown policy:** any organisation can ask for its name/logo to be removed via the in-game "Report / request removal" link or by email; the entry is added to the takedown denylist and hidden at the next data build (logos immediately via the D1 denylist once the client ships). Founder accepted this risk (docs/engineering/living-map.md).
- **Geocoding:** DataSF *San Francisco Addresses – Enterprise Addressing System* (`https://data.sf.gov/d/3mea-di5p`), Open Data Commons PDDL. Cached lookups in `tools/places/cache/eas.json`. Five rows without a street address (Ferry Building, Pier 15, Presidio, Fort Mason) use hand-set coordinates (`"at"`).
- **Footprint snap:** DataSF building footprints (PDDL, the map bake's cached 2010-survey rows). Pins move to the centroid of the footprint containing the address point; `heightM` comes from that footprint and is unreliable for buildings newer than the survey (e.g. Salesforce Tower, 181 Fremont), so in-world signs should use the map bake's buildings.
- **Apollo firmographics** (`tools/places/apollo-orgs.json`): Apollo.io organization search (SF headquarters, 201+ employees, 5 pages) + organization enrich for street addresses, 195 credits under the founder's 200-credit plan (digest `480641838f3c...`, journal `tools/places/cache/apollo-spend.json`). Company-level data only (name, domain, HQ street address, headcount, one-line description); no people or contact data. Apollo HQ rows can be stale or non-tech (e.g. Slack still at 500 Howard, banks/hospitals tagged by headcount); `tools/places/shared-addresses.txt` lists places sharing a building for a skim.
- **Output:** `web/public/data/places.json` built by `tools/places/build.mts`.
- **Logos** (`web/public/data/place-logos/`, `tools/places/logos.mts`): each organisation's own site icon (apple-touch-icon or PNG/SVG icon link), normalised to 128 px tiles in four 1024 px WebP pages (213 KB total); 144 logos, 58 lettermarks generated by us. Trademarks belong to their owners; shown to identify the real places. Removal on request via `tools/places/takedown.json` (`logos` -> lettermark, `places` -> removed). Requests arrive from the map's place card ("Report / request removal"), which files a feedback item reading `Takedown request: place <id> (<name>)` through `/api/feedback`; the operator adds the id to `takedown.json` and re-runs `tools/places/build.mts` / `logos.mts`.
- **Founder-ladder pitching** (`shared/founder/pitch.ts`, `worker/src/pitch/pitch.ts`; founder decision 2026-10-12): the real SF VC firms in `pitchVcs.ts` (derived from the curated/Apollo places above) are the player's pitch investors. The OpenRouter AI judge and the deterministic fallback speak **only** as "a partner at `<firm>`, a San Francisco VC firm" — never a named individual, and never a real person's invented quote (real-person celebrity NPCs are deliberately excluded from pitch targets in `pitchSpots`). The judge **roasts the player's pitch only** (the system prompt forbids personal remarks and ignores instructions inside the pitch); the three tap-fallback lines are the player's own meme pitches. The Ferry-plaza first-pitch investor is one real firm (Pear VC) keyed by its `pitchVcs` id, so the places takedown path above (place-card "Report / request removal" → `takedown.json` → rebuild) drops that firm from `places.json`, `pitchVcs.ts` and `angelStops.ts` and therefore removes its sign, its pitch target and its plaza NPC together.

## Combat sound effects — CC0 / public domain (critique #8, flag sampledAudio)

`web/public/audio/combat/` (lazy-loaded on combat start, MP3 mono 44.1 kHz + one WAV loop, ~390 KB total), cut and encoded with ffmpeg
(trim to one shot + tail, fade-out, loudness/peak normalisation; no other processing):

| File | Source | Licence |
|---|---|---|
| `pistol.mp3` | "The Free Firearm Sound Library" (Ben Jaszczak et al.), Prepared SFX Library, `Walther PPQ/X_31P.wav` @1.075 s, 1.1 s — https://opengameart.org/content/the-free-firearm-sound-library | CC0 1.0 ("Our team holds CC0 NO RIGHTS RESERVED for this library") |
| `smg.mp3` | same library, `PPSh/P_22P.wav` @1.135 s, one round, 0.35 s | CC0 1.0 |
| `rifle.mp3` | same library, `AR-15/D_24P.wav` @0.54 s, 1.4 s | CC0 1.0 |
| `crash.mp3` | Kenney "Impact Sounds" — mix of `impactMetal_heavy_000`, `impactPlate_heavy_002`, `impactGlass_light_001` — https://kenney.nl/assets/impact-sounds | CC0 1.0 (pack `License.txt`) |
| `punch.mp3` | Kenney "Impact Sounds" — `impactPunch_heavy_000` | CC0 1.0 |
| `siren-wail.mp3`, `siren-yelp.mp3` | "Whelen emergency siren tones Wail/Yelp/Piercer used on a Fire Engine" by Heggyhomolit, Wikimedia Commons `File:Whelen.ogg` — wail = 0.15–4.95 s (one sweep), yelp = 5.30–7.60 s (seven sweeps), cut on cycle boundaries for looping, loudness-normalised | CC0 1.0 (`{{self|Cc-zero}}`) |
| `engine.wav` | "Racing car engine sound loops" by domasx2, OpenGameArt, `loop_0.wav` (cut from the public-domain pdsounds.org "start up car with seat belt warning beep"), resampled to 22.05 kHz; WAV so the loop is gapless — https://opengameart.org/content/racing-car-engine-sound-loops | CC0 1.0 |
| `sirens-distant.mp3` | "American police siren i" by lezer (pdsounds.org #590), via Wikimedia Commons `File:American_police_siren_i.ogg` — 18 s from 2.5 s, high-passed + normalised | Public domain (`{{PD-author|lezer}}`, `{{PD-pdsounds.org}}`) |
| `bark-hold.mp3`, `bark-getdown.mp3`, `bark-lookout.mp3`, `bark-backup.mp3` | Kenney "Voiceover Pack" (male voice): `Male/hold.ogg`, `Male/war_get_down.ogg`, `Male/war_look_out.ogg`, `Male/war_call_for_backup.ogg` — peak-normalised to −1 dBFS with a short fade (re-encoded 2026-10-16: the first cut was silent) — https://opengameart.org/content/voiceover-pack-40-lines (kenney.nl) | CC0 1.0 (credit "Kenney.nl" not mandatory) |
| `scream-f1.mp3`, `scream-f2.mp3` | "Female high-pitched scream SFX" by WuxiaScrub, OpenGameArt `screams_0.ogg` — f1 = 0–1.40 s, f2 = 5.02–6.63 s, trimmed + normalised — https://opengameart.org/node/131040 | CC0 1.0 |
| `scream-m1.mp3`, `scream-m2.mp3` | "Male Grunt/Yelling sounds" by HaelDB, OpenGameArt `yelling sounds/1yell11.wav` (0.65–1.45 s), `2yell4.wav` (0.62–1.77 s) — trimmed + normalised (re-encoded 2026-10-16: the first cut was silent) — https://opengameart.org/content/male-gruntyelling-sounds | CC0 1.0 (dual-licensed OGA-BY 3.0 / CC0; used under CC0) |
| `hurt-1.mp3`, `hurt-2.mp3`, `hurt-3.mp3` | "Male Grunt/Yelling sounds" by HaelDB, OpenGameArt `yelling sounds/3grunt1.wav`, `3grunt4.wav`, `3grunt5.wav` — silence-trimmed + loudness-normalised, mono 64 kbps (flag hurtGrunts) — https://opengameart.org/content/male-gruntyelling-sounds | CC0 1.0 (dual-licensed OGA-BY 3.0 / CC0; used under CC0) |

Source archives were downloaded to a scratch directory and are not committed. The synthesised gunshot / crunch remain
the fallback while a sample loads or if it fails.

## USGS 3DEP LiDAR (added for the public snapshot)

Roof and terrain heights are derived from USGS 3DEP LiDAR point cloud `CA_SanFrancisco_1_B23` (public domain).
